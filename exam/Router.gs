/**************************************************************
 * File: Router.gs  (HBT Exam API v0.5.0)
 * จุดเข้า doPost · ตาราง ROUTES · ตรวจสิทธิ์ตามประเภทผู้เรียก
 *
 * คำขอ  { action, token, opId?, args }  (POST text/plain)  →  { ok:true, data } | { ok:false, error:{code,msg,detail} }
 * auth :  'none' | 'student' (token s จาก Core) | 'attempt' (token a ออกโดย exam.start)
 *         | 'teacher' (token u จาก Core — สิทธิ์สด/เจ้าของวิชาตรวจใน handler ด้วย Gate) | 'core' (token x จาก Core)
 * lock :  ครอบด้วย lock กลาง + อ่านข้อมูลสด · ไม่ใส่ = handler จัดการเอง (ใช้ lock ช่วงสั้น ๆ แล้วเรียก Core นอก lock)
 * once :  กันทำซ้ำด้วย opId (ส่งซ้ำเมื่อเน็ตหลุดจะได้ผลเดิม)
 * big  :  รับ body ใหญ่ได้ (บันทึกข้อสอบพร้อมรูป) — action ต้องเป็นคีย์แรกของ JSON
 *
 * ทางที่นักศึกษาตอบข้อ (answer/go/advance/heartbeat) ไม่ใช้ lock กลาง: แต่ละคนเขียนแถวของตัวเอง
 **************************************************************/

var ROUTES = {
  /* ---------- สาธารณะ ---------- */
  'exam.resolve': { auth: 'none', fn: function (a) { return Rounds.resolve(a); } },

  /* ---------- นักศึกษา (token s) ---------- */
  'exam.start': { auth: 'student', once: true, fn: function (a, u) { return Runner.start(u, a); } },
  'exam.my':    { auth: 'student', fn: function (a, u) { return Runner.my(u, a); } },

  /* ---------- ผู้ทำข้อสอบ (token a) ---------- */
  'exam.paper':     { auth: 'attempt', fn: function (a, u) { return Runner.paper(u); } },
  'exam.answer':    { auth: 'attempt', once: true, fn: function (a, u) { return Runner.answer(u, a); } },
  'exam.go':        { auth: 'attempt', once: true, fn: function (a, u) { return Runner.go(u, a); } },
  'exam.advance':   { auth: 'attempt', once: true, fn: function (a, u) { return Runner.advance(u, a); } },
  'exam.submit':    { auth: 'attempt', once: true, fn: function (a, u) { return Runner.submit(u); } },
  'exam.heartbeat': { auth: 'attempt', fn: function (a, u) { return Runner.heartbeat(u, a); } },

  /* ---------- อาจารย์: แบบทดสอบ/ข้อสอบ ---------- */
  'exam.quiz.list':   { auth: 'teacher', fn: function (a, u) { return Quiz.list(u, a); } },
  'exam.quiz.save':   { auth: 'teacher', lock: true, once: true, fn: function (a, u) { return Quiz.save(u, a); } },
  'exam.quiz.delete': { auth: 'teacher', lock: true, once: true, fn: function (a, u) { return Quiz.remove(u, a); } },
  'exam.q.list':      { auth: 'teacher', fn: function (a, u) { return Questions.list(u, a); } },
  'exam.q.save':      { auth: 'teacher', big: true, once: true, fn: function (a, u) { return Questions.save(u, a); } },     // อัปโหลดรูปนอก lock, เขียนแถวใน lock
  'exam.q.delete':    { auth: 'teacher', lock: true, once: true, fn: function (a, u) { return Questions.remove(u, a); } },
  'exam.q.deleteMany':{ auth: 'teacher', lock: true, once: true, fn: function (a, u) { return Questions.removeMany(u, a); } },
  'exam.q.move':      { auth: 'teacher', lock: true, fn: function (a, u) { return Questions.move(u, a); } },
  'exam.q.renumber':  { auth: 'teacher', lock: true, fn: function (a, u) { return Questions.renumber(u, a); } },
  'exam.q.import':    { auth: 'teacher', lock: true, once: true, fn: function (a, u) { return Questions.importCsv(u, a); } },
  'exam.q.export':    { auth: 'teacher', fn: function (a, u) { return Questions.exportCsv(u, a); } },

  /* ---------- อาจารย์: รอบฝึกทำ/สอบ ---------- */
  'exam.round.list':      { auth: 'teacher', fn: function (a, u) { return Rounds.list(u, a); } },
  'exam.round.create':    { auth: 'teacher', lock: true, once: true, fn: function (a, u) { return Rounds.create(u, a); } },
  'exam.round.setStatus': { auth: 'teacher', once: true, fn: function (a, u) { return Rounds.setStatus(u, a); } },
  'exam.round.update':    { auth: 'teacher', once: true, fn: function (a, u) { return Rounds.update(u, a); } },
  'exam.round.delete':    { auth: 'teacher', once: true, fn: function (a, u) { return Rounds.remove(u, a); } },
  'exam.round.monitor':   { auth: 'teacher', fn: function (a, u) { return Rounds.monitor(u, a); } },
  'exam.round.report':    { auth: 'teacher', fn: function (a, u) { return Report.round(u, a); } },
  'exam.round.export':    { auth: 'teacher', fn: function (a, u) { return Report.exportCsv(u, a); } },
  'exam.round.sync':      { auth: 'teacher', fn: function (a, u) { Gate.round(u, a.sessionId); return Sync.push(String(a.sessionId)); } },

  /* ---------- Core เรียกเข้ามา (token x, sv:'core') ---------- */
  'svc.countStudent':   { auth: 'core', fn: function (a) { return { count: Runner.countForStudent(String(a.courseId || ''), String(a.stdId || '')) }; } },
  'svc.ping':           { auth: 'core', fn: function () { return { ok: true, version: APP.VERSION }; } },
  'svc.countCourses':   { auth: 'core', fn: function (a) { return Purge.counts(Array.isArray(a.courseIds) ? a.courseIds.slice(0, 200) : []); } },
  'svc.purgeImages':    { auth: 'core', fn: function (a) { return Purge.images(a); } },
  'svc.purgeCourse':    { auth: 'core', lock: true, fn: function (a) { return Purge.course(a); } },
  'svc.removeStudents': { auth: 'core', lock: true, once: true, fn: function (a) {
    var ids = Array.isArray(a.stdIds) ? a.stdIds.map(String) : [];
    return { removed: ids.length ? Runner.removeForStudents(String(a.courseId || ''), ids) : 0 };
  } }
};

/** ตรวจ token ตามที่ route ประกาศ → ตัวตนผู้เรียก */
function authorize_(route, token) {
  switch (route.auth) {
    case 'none':    return null;
    case 'student': return Auth.student(token);
    case 'attempt': return Auth.attempt(token);
    case 'teacher': return Auth.teacher(token);
    case 'core':    return Auth.service(token, 'core');
  }
  throw U.E('E_FORBIDDEN');          // route ที่ประกาศ auth ผิดรูป = ปฏิเสธไว้ก่อน
}

function actorKey_(actor) {
  if (!actor) return '-';
  return actor.email || actor.attemptId || (actor.courseId ? actor.courseId + '|' + actor.stdId : '') || actor.service || '-';
}

/** ประมวลผลคำขอ (แยกจาก doPost เพื่อทดสอบง่าย) → คืนข้อความ JSON */
function handle_(body) {
  return API_(function () {
    if (typeof body !== 'string' || !body) throw U.E('E_BAD_REQUEST');
    var bigBody = body.length > APP.MAX_BODY;
    if (bigBody && (body.length > APP.MAX_BODY_BIG || body.substring(0, 300).indexOf('"exam.q.save"') < 0)) throw U.E('E_BAD_REQUEST', { why: 'too_large' });
    var req;
    try { req = JSON.parse(body); } catch (e) { throw U.E('E_BAD_REQUEST', { why: 'json' }); }
    if (!req || typeof req !== 'object' || Array.isArray(req)) throw U.E('E_BAD_REQUEST');

    var action = (typeof req.action === 'string') ? req.action : '';
    var route = Object.prototype.hasOwnProperty.call(ROUTES, action) ? ROUTES[action] : null;
    if (!route) throw U.E('E_BAD_REQUEST', { why: 'action' });
    if (bigBody && route.big !== true) throw U.E('E_BAD_REQUEST', { why: 'too_large' });

    var args = (req.args && typeof req.args === 'object' && !Array.isArray(req.args)) ? req.args : {};
    var actor = authorize_(route, req.token);
    var opId = req.opId ? String(req.opId).substring(0, 80) : '';
    var run = function () { return route.fn(args, actor); };
    var exec = route.once ? function () { return U.once(actorKey_(actor) + '|' + action, opId, run); } : run;
    if (route.lock) return U.lock(function () { Db.flush(); return exec(); });
    return exec();
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
