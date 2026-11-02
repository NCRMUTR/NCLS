/**************************************************************
 * File: Auth.gs  (HBT Core v0.1.0)
 * ล็อกอินอาจารย์ด้วย Google Sign-In
 *
 *  1) หน้าเว็บได้ ID token (JWT) จาก Google Identity Services
 *  2) server ตรวจกับ Google (tokeninfo): aud = Client ID ของเรา, iss, exp, email_verified,
 *     และ hd (โดเมน) — ตรวจที่ server เสมอ ไม่เชื่อ hint จากหน้าเว็บ
 *  3) ค้นอีเมลในชีต Users (ต้อง active) แล้วออก token ของระบบเอง (HMAC-SHA256) อายุ 8 ชม.
 *  4) ทุก API ตรวจ token → ผู้ใช้ยัง active → สิทธิ์ระบบ  (สิทธิ์ที่แก้ มีผลภายใน ~60 วินาที)
 *
 *  token ใช้โครงเดียวกับ Exam API (แชร์ secret): u = อาจารย์ · s = นักศึกษา · x = บริการระหว่างระบบ
 **************************************************************/

var Auth = (function () {

  var GOOGLE_ISS = ['accounts.google.com', 'https://accounts.google.com'];

  function secret_() {
    var s = Db.prop('SEC_TOKEN');
    if (!s) throw U.E('E_NOT_SETUP');
    return s;
  }
  function sign_(body) {
    return U.b64u(Utilities.computeHmacSha256Signature(body, secret_()));
  }
  function nowSec_() { return Math.floor(Date.now() / 1000); }

  /** ออก token: kind = 'u' (อาจารย์/ผู้ดูแล) ... */
  function mint(kind, claims, ttlSec) {
    var p = { k: kind, iat: nowSec_(), exp: nowSec_() + ttlSec };
    Object.keys(claims || {}).forEach(function (k) { p[k] = claims[k]; });
    var body = U.strToB64u(JSON.stringify(p));
    return body + '.' + sign_(body);
  }

  /** ตรวจ token: ลายเซ็น → ชนิด → หมดอายุ */
  function parse(token, kind) {
    if (!token || typeof token !== 'string' || token.length > 2048) throw U.E('E_AUTH');
    var i = token.indexOf('.');
    if (i < 1) throw U.E('E_AUTH');
    var body = token.substring(0, i), sig = token.substring(i + 1);
    if (!U.safeEq(sig, sign_(body))) throw U.E('E_AUTH');
    var p;
    try { p = JSON.parse(U.b64uToStr(body)); } catch (e) { throw U.E('E_AUTH'); }
    if (!p || typeof p !== 'object') throw U.E('E_AUTH');
    if (kind && p.k !== kind) throw U.E('E_AUTH');
    if (!p.exp || p.exp < nowSec_()) throw U.E('E_AUTH');
    return p;
  }

  function peek_(jwt) {
    var parts = jwt.split('.');
    if (parts.length !== 3 || !parts[1]) return null;
    try { var o = JSON.parse(U.b64uToStr(parts[1])); return (o && typeof o === 'object') ? o : null; } catch (e) { return null; }
  }

  /** ตรวจ Google ID token กับ Google แล้วคืน {email, name} */
  function verifyGoogle(idToken) {
    if (!idToken || typeof idToken !== 'string' || idToken.length > 4096) throw U.E('E_BAD_TOKEN');
    var clientId = Config.get('GOOGLE_CLIENT_ID');
    var domain = String(Config.get('DOMAIN') || '').toLowerCase();
    if (!clientId || !domain) throw U.E('E_NOT_SETUP');

    // กรองขยะก่อนเรียก Google (ประหยัดโควตา UrlFetch กันคนยิงสแปม): ต้องหน้าตาเป็น JWT ที่ aud/exp ดูเข้าท่า
    // ค่าที่อ่านตรงนี้ "ยังไม่ได้ยืนยัน" — ใช้เป็นตัวกรองเท่านั้น การตัดสินจริงอยู่ที่ผลจาก Google ด้านล่าง
    var pk = peek_(idToken);
    if (!pk || pk.aud !== clientId || !pk.exp || Number(pk.exp) < nowSec_()) throw U.E('E_BAD_TOKEN', { why: 'precheck' });

    var res;
    try {
      res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(idToken),
        { muteHttpExceptions: true });
    } catch (e) { throw U.E('E_BAD_TOKEN', { why: 'fetch' }); }
    if (res.getResponseCode() !== 200) throw U.E('E_BAD_TOKEN', { why: 'status' });

    var t = U.parse(res.getContentText(), null);
    if (!t) throw U.E('E_BAD_TOKEN', { why: 'parse' });
    if (t.aud !== clientId) throw U.E('E_BAD_TOKEN', { why: 'aud' });
    if (GOOGLE_ISS.indexOf(t.iss) < 0) throw U.E('E_BAD_TOKEN', { why: 'iss' });
    if (!t.exp || Number(t.exp) < nowSec_()) throw U.E('E_BAD_TOKEN', { why: 'exp' });
    if (String(t.email_verified) !== 'true') throw U.E('E_BAD_TOKEN', { why: 'unverified' });

    var email = U.normEmail(t.email);
    var hd = String(t.hd || '').toLowerCase();
    if (!email || hd !== domain || email.slice(-(domain.length + 1)) !== '@' + domain) throw U.E('E_DOMAIN');
    return { email: email, name: String(t.name || '') };
  }

  function login(idToken) {
    var g = verifyGoogle(idToken);
    var u = Users.get(g.email);
    if (!u) throw U.E('E_NOT_LISTED');
    if (!u.active) throw U.E('E_DISABLED');
    // บันทึก last_login ใน lock + ตรวจสถานะสดอีกรอบ: กัน (1) เขียนทับการแก้สิทธิ์/ปิดบัญชีที่ admin เพิ่งทำพร้อมกัน
    // (Db.update เขียนทั้งแถว) และ (2) ออก token ให้บัญชีที่เพิ่งถูกปิดระหว่างตรวจ Google
    U.lock(function () {
      Db.flush();
      var r = Db.byId('Users', g.email);
      if (!r) throw U.E('E_NOT_LISTED');
      if (!U.bool(r.active)) throw U.E('E_DISABLED');
      Users.touchLogin(g.email, g.name);
    });
    var token = mint('u', { e: g.email }, APP.TOKEN_TTL_SEC);
    return {
      token: token,
      expiresAt: Date.now() + APP.TOKEN_TTL_SEC * 1000,
      user: Users.get(g.email)
    };
  }

  /** ตรวจ token อาจารย์ → คืนผู้ใช้ล่าสุด (สิทธิ์อ่านผ่านแคช 60 วินาที) */
  function requireUser(token) {
    var p = parse(token, 'u');
    var u = Users.get(p.e);
    if (!u) throw U.E('E_AUTH');
    if (!u.active) throw U.E('E_DISABLED');
    return u;
  }

  /** ตรวจ token นักศึกษา (ชนิด 's') → {courseId, stdId, name} · นักศึกษาที่ถูกลบออกจากวิชาแล้ว token เดิมใช้ไม่ได้ทันที */
  function requireStudent(token) {
    var p = parse(token, 's');
    var st = Students.find(String(p.c || ''), String(p.s || ''));
    if (!st) throw U.E('E_AUTH');
    return { courseId: st.course_id, stdId: st.std_id, name: st.name };
  }

  /** นักศึกษาเข้าระบบด้วยรหัสวิชา+รหัสนักศึกษา+PIN → token อายุ 2 ชม. (ใช้กับส่งงาน) · ต้องเรียกใน lock (นับ PIN ผิด) */
  function studentLogin(a) {
    var courseId = String(a.courseId || ''), cur = Terms.current();
    var c = Db.byId('Courses', courseId);
    if (!c || !cur || c.term_id !== cur.termId) throw U.E('E_NOT_FOUND');
    var std;
    try { std = Students.cleanId(a.stdId); } catch (e) { throw U.E('E_NOT_FOUND'); }
    var st = Students.find(courseId, std);
    if (!st) throw U.E('E_NOT_FOUND');
    Pin.verify(std, a.pin);
    var ttl = 2 * 3600;
    return {
      token: mint('s', { c: courseId, s: std }, ttl), expiresAt: Date.now() + ttl * 1000,
      stdId: std, name: st.name, course: { courseId: c.course_id, code: c.code, name: c.name, section: c.section }
    };
  }

  /** token บริการ (ชนิด 'x') ระหว่าง Core ↔ Exam API · sv = ชื่อผู้เรียก ('exam' เรียกเข้า Core / 'core' เรียกเข้า Exam) */
  function requireService(token, sv) {
    var p = parse(token, 'x');
    if (p.sv !== sv) throw U.E('E_AUTH');
    return { email: 'svc:' + sv, service: sv };
  }
  function mintService(sv) { return mint('x', { sv: sv }, 300); }

  function can(user, system) {
    return !!user && (user.role === 'admin' || user.systems.indexOf(system) >= 0);
  }

  return { mint: mint, parse: parse, verifyGoogle: verifyGoogle, login: login, requireUser: requireUser, requireStudent: requireStudent, studentLogin: studentLogin, requireService: requireService, mintService: mintService, can: can };
})();
