/**************************************************************
 * File: Router.gs  (HBT Core v0.4.0)
 * จุดเข้า Web App: doPost (API ทั้งหมด) + doGet (ตรวจสุขภาพ)
 *
 * คำขอ  : POST  Content-Type: text/plain;charset=utf-8  (ไม่เกิด CORS preflight)
 *         { action, token, opId, args }
 * คำตอบ : { ok:true, data } | { ok:false, error:{ code, msg, detail } }
 *
 * ทุก route ประกาศ  auth  :  'none' | 'user' | 'admin' | 'student' | { system:'att'|'exam'|'asg' }
 *   'student' = token นักศึกษา (ชนิด 's' ได้จาก stu.login ด้วย PIN) · big:true = รับ body ใหญ่ได้ (อัปโหลดไฟล์)
 *   write:true  →  ทำใน lock เดียว + กันทำซ้ำด้วย opId (กดซ้ำ/เน็ตหลุดแล้วส่งใหม่ ไม่ทำสองรอบ)
 *   lock:true   →  ทำใน lock แต่ไม่ใช้ opId (ใช้กับ PIN: การลองผิดต้องนับทุกครั้ง ห้ามคืนผลเก่าจาก cache)
 * ขั้นถัดไปเพิ่ม route ของ asg ต่อท้ายตารางนี้
 **************************************************************/

var ROUTES = {

  'meta.ping': {
    auth: 'none',
    fn: function () { return { name: APP.NAME, version: APP.VERSION, time: U.nowIso() }; }
  },

  /* ---------- เข้าสู่ระบบ ---------- */
  'auth.login': {
    auth: 'none',
    fn: function (a) { return Auth.login(a.idToken); }
  },
  'auth.me': {
    auth: 'user',
    fn: function (a, u) {
      return { user: u, term: Terms.current(), version: APP.VERSION, systems: APP.SYSTEMS };
    }
  },
  'auth.logout': {          // token ไม่เก็บฝั่ง server (stateless) — ออกจากระบบ = ทิ้ง token ที่เบราว์เซอร์
    auth: 'user',
    fn: function (a, u) { Audit.log(u.email, 'auth.logout', u.email, ''); return { bye: true }; }
  },

  /* ---------- ผู้ใช้/สิทธิ์ (admin) ---------- */
  'user.list': {
    auth: 'admin',
    fn: function () { return { users: Users.list(), systems: APP.SYSTEMS }; }
  },
  'user.upsert': {
    auth: 'admin', write: true,
    fn: function (a, u) { return Users.upsert(u.email, a || {}); }
  },
  'user.setActive': {
    auth: 'admin', write: true,
    fn: function (a, u) { return Users.setActive(u.email, a.email, a.active); }
  },

  /* ---------- ค่าตั้งค่า / ภาคเรียน ---------- */
  'settings.get': {
    auth: 'user',
    fn: function () { return { settings: SettingsAll_() }; }
  },
  'settings.set': {
    auth: 'admin', write: true,
    fn: function (a, u) {
      var changes = a.changes || {};
      var keys = Object.keys(changes);
      if (!keys.length) throw U.E('E_BAD_REQUEST');
      // ตรวจทุกค่าก่อนเขียน — ผิดข้อเดียวไม่เขียนอะไรเลย
      keys.forEach(function (k) { Settings.check(k, changes[k]); });
      keys.forEach(function (k) { Settings.set(u.email, k, changes[k]); });
      return { settings: SettingsAll_() };
    }
  },
  'term.list': {
    auth: 'user',
    fn: function () { return { terms: Terms.list() }; }
  },
  'term.create': {
    auth: 'admin', write: true,
    fn: function (a, u) { Terms.create(u.email, a || {}); return { terms: Terms.list() }; }
  },
  'term.setCurrent': {
    auth: 'admin', write: true,
    fn: function (a, u) { return { terms: Terms.setCurrent(u.email, U.req(a.termId, 'termId')) }; }
  },
  /* ---------- รายวิชา (อาจารย์: เฉพาะของตัวเอง · admin ดูได้ทุกวิชา) ---------- */
  'course.list': {
    auth: 'user',
    fn: function (a, u) { return Courses.list(u, a); }
  },
  'course.get': {
    auth: 'user',
    fn: function (a, u) { return Courses.get(u, a.courseId); }
  },
  'course.create': {
    auth: 'user', write: true,
    fn: function (a, u) { return Courses.create(u, a); }
  },
  'course.update': {
    auth: 'user', write: true,
    fn: function (a, u) { return Courses.update(u, a); }
  },

  /* ---------- นักศึกษา / PIN ---------- */
  'student.list': {
    auth: 'user',
    fn: function (a, u) { return Students.list(u, a.courseId); }
  },
  'student.add': {
    auth: 'user', write: true,
    fn: function (a, u) { return Students.add(u, a); }
  },
  'student.update': {
    auth: 'user', write: true,
    fn: function (a, u) { return Students.update(u, a); }
  },
  'student.importCsv': {
    auth: 'user', write: true,
    fn: function (a, u) { return Students.importCsv(u, a); }
  },
  'student.impact': {
    auth: 'user',
    fn: function (a, u) { return Students.impact(u, a); }
  },
  'student.remove': {
    auth: 'user', write: true,
    fn: function (a, u) { return Students.remove(u, a); }
  },
  'pin.issueTemp': {
    auth: 'user', write: true,
    fn: function (a, u) { return Pin.issueTemp(u, a); }
  },

  /* ---------- คะแนน ---------- */
  'score.types': {
    auth: 'user',
    fn: function (a, u) { return Scores.listTypes(u, a.courseId); }
  },
  'score.saveType': {
    auth: 'user', write: true,
    fn: function (a, u) { return Scores.saveType(u, a); }
  },
  'score.deleteType': {
    auth: 'user', write: true,
    fn: function (a, u) { return Scores.deleteType(u, a); }
  },
  'score.table': {
    auth: 'user',
    fn: function (a, u) { return Scores.table(u, a.courseId); }
  },
  'score.saveBulk': {
    auth: 'user', write: true,
    fn: function (a, u) { return Scores.saveBulk(u, a); }
  },
  'score.exportCsv': {
    auth: 'user',
    fn: function (a, u) { return Scores.exportCsv(u, a.courseId); }
  },

  /* ---------- เช็คชื่อ (อาจารย์: ต้องมีสิทธิ์ระบบ att) ---------- */
  'att.open':         { auth: { system: 'att' }, write: true, fn: function (a, u) { return Attendance.open(u, a); } },
  'att.pause':        { auth: { system: 'att' }, write: true, fn: function (a, u) { return Attendance.pause(u, a); } },
  'att.resume':       { auth: { system: 'att' }, write: true, fn: function (a, u) { return Attendance.resume(u, a); } },
  'att.close':        { auth: { system: 'att' }, write: true, fn: function (a, u) { return Attendance.close(u, a); } },
  'att.decide':       { auth: { system: 'att' }, write: true, fn: function (a, u) { return Attendance.decide(u, a); } },
  'att.setStatus':    { auth: { system: 'att' }, write: true, fn: function (a, u) { return Attendance.setStatus(u, a); } },
  'att.import':       { auth: { system: 'att' }, write: true, fn: function (a, u) { return Attendance.importRows(u, a); } },
  'att.deleteSession':{ auth: { system: 'att' }, write: true, fn: function (a, u) { return Attendance.deleteSession(u, a); } },
  'att.deleteEmpty':  { auth: { system: 'att' }, write: true, fn: function (a, u) { return Attendance.deleteEmpty(u, a); } },
  'att.current':      { auth: { system: 'att' }, fn: function (a, u) { return Attendance.current(u, a); } },
  'att.live':         { auth: { system: 'att' }, fn: function (a, u) { return Attendance.live(u, a); } },
  'att.sessions':     { auth: { system: 'att' }, fn: function (a, u) { return Attendance.sessionsList(u, a); } },
  'att.report':       { auth: { system: 'att' }, fn: function (a, u) { return Attendance.report(u, a); } },
  'att.studentDetail':{ auth: { system: 'att' }, fn: function (a, u) { return Attendance.studentDetail(u, a); } },
  'att.exportCsv':    { auth: { system: 'att' }, fn: function (a, u) { return Attendance.exportCsv(u, a); } },

  /* ---------- ส่งงาน (อาจารย์: ต้องมีสิทธิ์ระบบ asg) ---------- */
  'asg.list':        { auth: { system: 'asg' }, fn: function (a, u) { return Assignments.list(u, a); } },
  'asg.get':         { auth: { system: 'asg' }, fn: function (a, u) { return Assignments.get(u, a); } },
  'asg.submissions': { auth: { system: 'asg' }, fn: function (a, u) { return Assignments.submissions(u, a); } },
  'asg.fileGet':     { auth: { system: 'asg' }, fn: function (a, u) { return Assignments.fileGet(u, a); } },
  'asg.save':        { auth: { system: 'asg' }, write: true, fn: function (a, u) { return Assignments.save(u, a); } },
  'asg.setStatus':   { auth: { system: 'asg' }, write: true, fn: function (a, u) { return Assignments.setStatus(u, a); } },
  'asg.delete':      { auth: { system: 'asg' }, write: true, fn: function (a, u) { return Assignments.remove(u, a); } },
  'asg.grade':       { auth: { system: 'asg' }, write: true, fn: function (a, u) { return Assignments.grade(u, a); } },

  /* ---------- หน้านักศึกษา (ไม่ล็อกอิน) ---------- */
  'pub.teachers': {
    auth: 'none',
    fn: function () { return Courses.pubTeachers(); }
  },
  'pub.courses': {
    auth: 'none',
    fn: function (a) { return Courses.pubCourses(a.tid); }
  },
  'pub.students': {
    auth: 'none',
    fn: function (a) { return Students.pubList(a.courseId); }
  },
  'pin.setWithTemp': {
    auth: 'none', lock: true,
    fn: function (a) { return Pin.setWithTemp(a); }
  },
  'pin.change': {
    auth: 'none', lock: true,
    fn: function (a) { return Pin.change(a); }
  },
  'pin.request': {
    auth: 'none', lock: true,
    fn: function (a) { return Pin.request(a); }
  },
  /* นักศึกษาเช็คชื่อ: checkIn ล็อกเองภายในฟังก์ชัน (ตรวจก่อนล็อก แล้วเขียนใต้ล็อก) จึงไม่ใส่ lock:true */
  'asg.resolve': { auth: 'none', fn: function (a) { return Assignments.resolve(a); } },
  'stu.login':   { auth: 'none', lock: true, fn: function (a) { return Auth.studentLogin(a); } },
  /* ส่งงาน (token นักศึกษา) — แก้ข้อมูลทั้งหมดอยู่ใน lock · stu.upload ส่งไฟล์ขึ้น Drive นอก lock แล้วค่อยล็อกตอนบันทึก */
  'stu.tasks':       { auth: 'student', fn: function (a, s) { return Assignments.stuTasks(s); } },
  'stu.task':        { auth: 'student', fn: function (a, s) { return Assignments.stuTask(s, a); } },
  'stu.upload':      { auth: 'student', big: true, fn: function (a, s) { return Assignments.stuUpload(s, a); } },
  'stu.removeFile':  { auth: 'student', lock: true, fn: function (a, s) { return Assignments.stuRemoveFile(s, a); } },
  'stu.saveNote':    { auth: 'student', lock: true, fn: function (a, s) { return Assignments.stuSaveNote(s, a); } },
  'stu.groupSave':   { auth: 'student', lock: true, fn: function (a, s) { return Assignments.stuGroupSave(s, a); } },
  'stu.groupDelete': { auth: 'student', lock: true, fn: function (a, s) { return Assignments.stuGroupDelete(s, a); } },
  /* ---------- สำรอง (เจ้าของวิชา/admin) · รีเซ็ต (admin) ---------- */
  'backup.manifest': { auth: 'user', fn: function (a, u) { return Reset.manifest(u, a); } },
  'backup.mark':     { auth: 'user', write: true, fn: function (a, u) { return Reset.mark(u, a); } },
  'reset.preview':   { auth: 'admin', fn: function (a, u) { return Reset.preview(u, a); } },
  'reset.course':    { auth: 'admin', fn: function (a, u) { return Reset.course(u, a); } },     // ล็อกเองเป็นช่วงๆ ข้างในฟังก์ชัน (Drive/Exam ช้า ห้ามถือ lock ตลอด)
  'reset.term':      { auth: 'admin', lock: true, fn: function (a, u) { return Reset.term(u, a); } },
  'reset.pins':      { auth: 'admin', lock: true, fn: function (a, u) { return Reset.pins(u, a); } },
  /* ---------- Exam API เรียกเข้ามา (token บริการ x) ---------- */
  'svc.access':      { auth: 'service', fn: function (a) { return ExamLink.access(a); } },
  'svc.course':      { auth: 'service', fn: function (a) { return ExamLink.course(a); } },
  'svc.syncScores':  { auth: 'service', write: true, fn: function (a) { return ExamLink.syncScores(a); } },
  'svc.removeRound': { auth: 'service', write: true, fn: function (a) { return ExamLink.removeRound(a); } },
  'att.info':            { auth: 'none', fn: function (a) { return Attendance.info(a); } },
  'att.checkIn':         { auth: 'none', fn: function (a) { return Attendance.checkIn(a); } },
  'att.requestOverride': { auth: 'none', lock: true, fn: function (a) { return Attendance.requestOverride(a); } },
  'att.approvalStatus':  { auth: 'none', fn: function (a) { return Attendance.approvalStatus(a); } }
};

function SettingsAll_() { return Settings.getAll(); }

/** ตรวจสิทธิ์ตามที่ route ประกาศ → คืนผู้ใช้ (หรือ null ถ้า auth:'none') */
function authorize_(route, token) {
  if (route.auth === 'none') return null;
  if (route.auth === 'student') return Auth.requireStudent(token);
  if (route.auth === 'service') return Auth.requireService(token, 'exam');     // Exam API เรียกเข้ามา (token x)
  var u = Auth.requireUser(token);
  if (route.auth === 'user') return u;
  if (route.auth === 'admin') {
    if (u.role !== 'admin') throw U.E('E_FORBIDDEN');
    return u;
  }
  if (route.auth && route.auth.system) {
    if (!Auth.can(u, route.auth.system)) throw U.E('E_FORBIDDEN');
    return u;
  }
  throw U.E('E_FORBIDDEN');      // route ที่ประกาศ auth ผิดรูป = ปฏิเสธไว้ก่อน
}

/** ประมวลผลคำขอ (แยกจาก doPost เพื่อทดสอบง่าย) → คืนข้อความ JSON */
function handle_(body) {
  return API_(function () {
    if (typeof body !== 'string' || !body) throw U.E('E_BAD_REQUEST');
    // body ใหญ่ (> MAX_BODY) รับเฉพาะ route ที่ประกาศ big:true — ตรวจเบื้องต้นจากชื่อ action ที่หัว body ก่อน parse แล้วตรวจซ้ำหลัง parse
    var bigBody = body.length > APP.MAX_BODY;
    if (bigBody && (body.length > APP.MAX_BODY_BIG || body.substring(0, 300).indexOf('"stu.upload"') < 0)) throw U.E('E_BAD_REQUEST', { why: 'too_large' });
    var req;
    try { req = JSON.parse(body); } catch (e) { throw U.E('E_BAD_REQUEST', { why: 'json' }); }
    if (!req || typeof req !== 'object' || Array.isArray(req)) throw U.E('E_BAD_REQUEST');

    var action = (typeof req.action === 'string') ? req.action : '';     // ต้องเป็นข้อความจริง (กัน array ถูกแปลงเป็นชื่อ action)
    var route = Object.prototype.hasOwnProperty.call(ROUTES, action) ? ROUTES[action] : null;
    if (!route) throw U.E('E_BAD_REQUEST', { why: 'action' });

    if (bigBody && route.big !== true) throw U.E('E_BAD_REQUEST', { why: 'too_large' });
    var args = (req.args && typeof req.args === 'object') ? req.args : {};
    var user = authorize_(route, req.token);
    var run = function () { return route.fn(args, user); };

    if (route.lock && !route.write) {
      return U.lock(function () { Db.flush(); return run(); });
    }
    if (!route.write) return run();
    var opId = req.opId ? String(req.opId).substring(0, 80) : '';
    return U.lock(function () {
      Db.flush();                       // อ่านข้อมูลสดภายใน lock เสมอ
      return U.once((user ? user.email : '-') + '|' + action, opId, run);
    });
  });
}

function doPost(e) {
  var body = (e && e.postData && e.postData.contents) || '';
  return ContentService.createTextOutput(handle_(body)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput(U.ok({ name: APP.NAME, version: APP.VERSION, status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
