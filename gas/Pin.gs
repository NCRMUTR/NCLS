/**************************************************************
 * File: Pin.gs  (HBT Core v0.3.0)
 * PIN นักศึกษา 4 หลัก — 1 คน 1 PIN ใช้ข้ามวิชา/ข้ามระบบ (อาจารย์ไม่มี PIN: ตัวตนคือบัญชี Google)
 *
 *  - เก็บเฉพาะแฮช: SHA-256(salt | stdId | pin | pepper)  pepper = SEC_PIN (Script Properties, สร้างอัตโนมัติ)
 *    ⚠ ห้ามเปลี่ยน/ลบ SEC_PIN: ทุก PIN จะใช้ไม่ได้ ต้องออกรหัสชั่วคราวใหม่ทั้งหมด
 *  - ตั้ง PIN ครั้งแรก/ลืม PIN = ใช้ "รหัสชั่วคราว" 4 หลักที่อาจารย์ออกให้ (ใช้ได้ครั้งเดียว อายุ 7 วัน)
 *    กันคนอื่นแย่งตั้ง PIN แทนด้วยรหัสนักศึกษาอย่างเดียว
 *  - กันเดา: ผิดเกินกำหนด (ตั้งค่า pin_max_fail) → ล็อกต่อรหัสนักศึกษา pin_lock_min นาที (นับใน cache)
 *    รหัสชั่วคราวที่ใส่ผิดก็นับรวมกัน
 *  - ตั้ง PIN ตอนเช็คชื่อครั้งแรกในห้อง (setInitial) จะเพิ่มในขั้นเช็คชื่อ — ฟังก์ชันพร้อมแล้ว
 **************************************************************/

var Pin = (function () {

  var TEMP_DAYS = 7;

  /* ---------- pepper ---------- */
  function pepper_() {
    var p = Db.prop('SEC_PIN');
    if (p) return p;
    U.lock(function () {
      Db.reloadProps();
      if (!Db.prop('SEC_PIN')) Db.setProp('SEC_PIN', U.randomHex(32));
    });
    p = Db.prop('SEC_PIN');
    if (!p) throw U.E('E_NOT_SETUP');
    return p;
  }
  function hash_(stdId, pin, salt) { return U.sha256(salt + '|' + stdId + '|' + pin + '|' + pepper_()); }

  function validPin_(pin) {
    if (typeof pin === 'number') pin = String(pin);
    if (typeof pin !== 'string' || !/^\d{4}$/.test(pin)) throw U.E('E_PIN_FORMAT');
    return pin;
  }

  /* ---------- ล็อกกันเดา (cache) ---------- */
  function limits_() { return { max: Number(Settings.get('pin_max_fail')), lockMin: Number(Settings.get('pin_lock_min')) }; }
  function failKey_(stdId) { return 'PINF_' + stdId; }
  function failState_(stdId) { return U.parse(U.cGet(failKey_(stdId)), { n: 0, until: 0 }); }

  function assertNotLocked_(stdId) {
    var st = failState_(stdId), now = Date.now();
    if (st.until && st.until > now) {
      var min = Math.max(1, Math.ceil((st.until - now) / 60000));
      throw U.E('E_PIN_LOCKED', { minutes: min }, 'ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว ลองใหม่ใน ' + min + ' นาที');
    }
  }
  /** บันทึกความผิดพลาด 1 ครั้ง แล้ว throw (ล็อก หรือ บอกจำนวนครั้งที่เหลือ) */
  function fail_(stdId, code, msg) {
    var L = limits_(), st = failState_(stdId), now = Date.now();
    if (st.until && st.until <= now) st = { n: 0, until: 0 };
    st.n = (st.n || 0) + 1;
    var ttl = Math.max(L.lockMin * 60, 900);
    if (st.n >= L.max) {
      st.until = now + L.lockMin * 60000;
      U.cPut(failKey_(stdId), JSON.stringify(st), ttl);
      throw U.E('E_PIN_LOCKED', { minutes: L.lockMin }, 'ใส่ผิดครบ ' + L.max + ' ครั้ง ถูกล็อก ' + L.lockMin + ' นาที');
    }
    U.cPut(failKey_(stdId), JSON.stringify(st), ttl);
    var left = L.max - st.n;
    throw U.E(code, { left: left }, msg + ' (เหลืออีก ' + left + ' ครั้ง)');
  }
  function clearFail_(stdId) { U.cDel(failKey_(stdId)); }

  /* ---------- สถานะ ---------- */
  function rowStatus_(r) {
    if (!r) return 'none';
    if (r.hash) return 'set';
    var exp = U.toDate(r.temp_expires_at);
    if (r.temp_hash && exp && exp.getTime() > Date.now()) return 'temp';
    return 'none';
  }
  function status(stdId) { return rowStatus_(Db.byId('StudentPIN', String(stdId))); }
  /** สถานะของหลายคนในครั้งเดียว (อ่านชีตรอบเดียว) → { stdId: 'none'|'temp'|'set' } */
  function statuses(stdIds) {
    var map = {};
    Db.all('StudentPIN').forEach(function (r) { map[r.std_id] = r; });
    var out = {};
    stdIds.forEach(function (id) { out[id] = rowStatus_(map[id]); });
    return out;
  }

  /* ---------- ตรวจ PIN (ใช้ในเช็คชื่อ/ส่งงาน/สอบ ขั้นถัดไป) ---------- */
  function verify(stdId, pin) {
    stdId = String(stdId);
    pin = validPin_(pin);
    assertNotLocked_(stdId);
    var r = Db.byId('StudentPIN', stdId);
    if (!r || !r.hash) throw U.E('E_PIN_NONE');
    if (!U.safeEq(hash_(stdId, pin, r.salt), r.hash)) fail_(stdId, 'E_PIN_BAD', 'PIN ไม่ถูกต้อง');
    clearFail_(stdId);
    return true;
  }

  function write_(stdId, patch) {
    var r = Db.byId('StudentPIN', stdId);
    var base = { hash: '', salt: '', set_at: '', temp_hash: '', temp_salt: '', temp_expires_at: '' };
    if (r) Db.update('StudentPIN', stdId, Object.assign(base, patch));
    else Db.insert('StudentPIN', Object.assign({ std_id: stdId }, base, patch));
  }
  function setHash_(stdId, newPin) {
    var salt = U.randomHex(8);
    write_(stdId, { hash: hash_(stdId, newPin, salt), salt: salt, set_at: U.nowIso() });
  }

  /** ตั้ง PIN ครั้งแรกโดยไม่ต้องมีรหัสชั่วคราว (ใช้เฉพาะตอนเช็คชื่อในห้องครั้งแรก — ขั้นเช็คชื่อ) */
  function setInitial(stdId, newPin) {
    stdId = String(stdId);
    newPin = validPin_(newPin);
    var r = Db.byId('StudentPIN', stdId);
    if (r && r.hash) throw U.E('E_BAD_REQUEST', { why: 'pin_exists' });
    setHash_(stdId, newPin);
  }

  /** รหัสนักศึกษาจากหน้าเว็บ (ไม่ล็อกอิน) → รูปแบบมาตรฐาน; รูปแบบเพี้ยน = หาไม่พบ (ไม่บอกใบ้) */
  function norm_(v) { try { return Students.cleanId(v); } catch (e) { throw U.E('E_NOT_FOUND'); } }
  function inCourse_(courseId, stdId) {
    var s = Db.byId('Students', String(courseId) + '|' + stdId);
    if (!s) throw U.E('E_NOT_FOUND');
    return s;
  }

  /** นักศึกษาตั้ง PIN ด้วยรหัสชั่วคราว */
  function setWithTemp(a) {
    var stdId = norm_(a.stdId);
    inCourse_(a.courseId, stdId);
    var tempPin = validPin_(a.tempPin), newPin = validPin_(a.newPin);
    assertNotLocked_(stdId);
    var r = Db.byId('StudentPIN', stdId);
    var exp = r ? U.toDate(r.temp_expires_at) : null;
    if (!r || !r.temp_hash || !exp || exp.getTime() <= Date.now() ||
        !U.safeEq(hash_(stdId, tempPin, r.temp_salt), r.temp_hash)) {
      fail_(stdId, 'E_PIN_TEMP', 'รหัสชั่วคราวไม่ถูกต้องหรือหมดอายุ');
    }
    setHash_(stdId, newPin);              // เขียนทับ → temp_* ถูกล้าง (ใช้ได้ครั้งเดียว)
    clearFail_(stdId);
    resolveRequests_(null, stdId);
    return { ok: true };
  }

  function change(a) {
    var stdId = norm_(a.stdId);
    inCourse_(a.courseId, stdId);
    var oldPin = validPin_(a.oldPin), newPin = validPin_(a.newPin);
    if (oldPin === newPin) throw U.E('E_PIN_SAME');
    verify(stdId, oldPin);
    setHash_(stdId, newPin);
    return { ok: true };
  }

  /** ลืม PIN: ส่งคำขอให้อาจารย์ (ซ้ำได้ ไม่สร้างแถวเพิ่มถ้ายังค้างอยู่) */
  function request(a) {
    var stdId = norm_(a.stdId);
    inCourse_(a.courseId, stdId);
    var open = Db.all('PinRequests').filter(function (r) { return r.course_id === String(a.courseId) && r.std_id === stdId && r.status === 'open'; });
    if (!open.length) Db.insert('PinRequests', { req_id: U.uid('PRQ'), course_id: String(a.courseId), std_id: stdId, at: U.nowIso(), status: 'open' });
    return { ok: true };
  }

  function resolveRequests_(courseId, stdId) {
    var patch = {};
    Db.all('PinRequests').forEach(function (r) {
      if (r.status === 'open' && r.std_id === stdId && (!courseId || r.course_id === courseId)) patch[r._row] = { status: 'done' };
    });
    if (Object.keys(patch).length) Db.bulkPatch('PinRequests', patch);
  }

  function openRequestIds(courseId) {
    var m = {};
    Db.all('PinRequests').forEach(function (r) { if (r.course_id === courseId && r.status === 'open') m[r.std_id] = true; });
    return m;
  }

  function code4_() {
    var n = parseInt(U.randomHex(4), 16) % 10000;
    return ('000' + n).slice(-4);
  }

  /**
   * อาจารย์ออกรหัสชั่วคราว  a = { courseId, stdId } (คนเดียว: รีเซ็ต PIN เดิมทิ้ง) หรือ { courseId, all:true } (เฉพาะคนที่ยังไม่มี PIN
   * และยังไม่มีรหัสชั่วคราวที่ใช้ได้ — ไม่ทับรหัสที่แจกไปแล้ว)
   * คืนรหัสแบบอ่านได้ "ครั้งเดียวในคำตอบนี้" ไม่เก็บรหัสจริงไว้ที่ใด
   */
  function issueTemp(user, a) {
    var course = Courses.require(user, a.courseId);
    var roster = Db.findRows('Students', 'course_id', course.course_id);
    var targets;
    if (U.bool(a.all)) {
      var st = statuses(roster.map(function (s) { return s.std_id; }));
      targets = roster.filter(function (s) { return st[s.std_id] === 'none'; });
    } else {
      var id = Students.cleanId(U.req(a.stdId, 'stdId'));
      targets = roster.filter(function (s) { return s.std_id === id; });
      if (!targets.length) throw U.E('E_NOT_FOUND');
    }
    var exp = U.fmt(new Date(Date.now() + TEMP_DAYS * 86400000));
    var existing = {};
    Db.all('StudentPIN').forEach(function (r) { existing[r.std_id] = r; });
    var patches = {}, inserts = [], codes = [];
    targets.forEach(function (s) {
      var code = code4_(), salt = U.randomHex(8);
      var vals = { hash: '', salt: '', set_at: '', temp_hash: hash_(s.std_id, code, salt), temp_salt: salt, temp_expires_at: exp };
      var r = existing[s.std_id];
      if (r) patches[r._row] = vals; else inserts.push(Object.assign({ std_id: s.std_id }, vals));
      codes.push({ stdId: s.std_id, name: s.name, pin: code });
      clearFail_(s.std_id);
    });
    if (Object.keys(patches).length) Db.bulkPatch('StudentPIN', patches);
    if (inserts.length) Db.insertMany('StudentPIN', inserts);
    codes.forEach(function (c) { resolveRequests_(course.course_id, c.stdId); });
    Attendance.forgetDevices(codes.map(function (c) { return c.stdId; }));      // รีเซ็ต PIN = ต้องยืนยัน PIN ใหม่บนทุกเครื่อง
    Courses.touch(course.course_id);
    Audit.log(user.email, 'pin.issueTemp', course.course_id, { count: codes.length, all: U.bool(a.all) });
    return { codes: codes, expiresAt: exp, skipped: U.bool(a.all) ? roster.length - codes.length : 0 };
  }

  return {
    status: status, statuses: statuses, verify: verify, setInitial: setInitial,
    setWithTemp: setWithTemp, change: change, request: request,
    issueTemp: issueTemp, openRequestIds: openRequestIds
  };
})();
