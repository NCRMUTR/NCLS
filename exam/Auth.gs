/**************************************************************
 * File: Auth.gs  (HBT Exam API v0.5.0)
 * ตรวจ token ที่ Core ออก (โครงเดียวกัน: body.sig, HMAC-SHA256 ด้วย SEC_TOKEN ที่แชร์กัน)
 *   u = อาจารย์ (Core ออก, 8 ชม.)  → ตรวจลายเซ็น/อายุที่นี่ · สิทธิ์สด (active/ระบบ exam/เจ้าของวิชา) ถาม Core (จำ 60 วินาที)
 *   s = นักศึกษา (Core ออก, 2 ชม.)  → ใช้แค่ตอนเริ่มทำข้อสอบ (exam.start)
 *   a = ผู้ทำข้อสอบ (Exam ออกเองตอน exam.start) → ใช้ระหว่างทำ ไม่ผูกกับอายุ 2 ชม. ของ s
 *   x = บริการ (sv:'core' เรียกเข้ามา / sv:'exam' ที่เราเรียก Core)
 **************************************************************/

var Auth = (function () {

  function secret_() {
    var s = Db.prop('SEC_TOKEN');
    if (!s) throw U.E('E_NOT_SETUP');
    return s;
  }
  function sign_(body) { return U.b64u(Utilities.computeHmacSha256Signature(body, secret_())); }
  function nowSec_() { return Math.floor(Date.now() / 1000); }

  function mint(kind, claims, ttlSec) {
    var p = { k: kind, iat: nowSec_(), exp: nowSec_() + ttlSec };
    Object.keys(claims || {}).forEach(function (k) { p[k] = claims[k]; });
    var body = U.strToB64u(JSON.stringify(p));
    return body + '.' + sign_(body);
  }

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

  function teacher(token) {
    var p = parse(token, 'u');
    var email = U.normEmail(p.e);
    if (!email) throw U.E('E_AUTH');
    return { kind: 'teacher', email: email };
  }
  function student(token) {
    var p = parse(token, 's');
    if (!p.c || !p.s) throw U.E('E_AUTH');
    return { kind: 'student', courseId: String(p.c), stdId: String(p.s) };
  }
  function attempt(token) {
    var p = parse(token, 'a');
    if (!p.a || !p.s || !p.c) throw U.E('E_AUTH');
    return { kind: 'attempt', attemptId: String(p.a), stdId: String(p.s), courseId: String(p.c) };
  }
  function service(token, sv) {
    var p = parse(token, 'x');
    if (p.sv !== sv) throw U.E('E_AUTH');
    return { kind: 'service', service: sv };
  }

  return { mint: mint, parse: parse, teacher: teacher, student: student, attempt: attempt, service: service };
})();
