/**************************************************************
 * File: CoreLink.gs  (HBT Exam API v0.5.0)
 * ติดต่อ HBT Core (เซิร์ฟเวอร์ต่อเซิร์ฟเวอร์) ด้วย token บริการ x {sv:'exam'} อายุ 5 นาที
 *   access  : อาจารย์คนนี้ใช้ระบบสอบกับวิชานี้ได้ไหม (active, สิทธิ์ exam, เจ้าของวิชา/admin)  จำ 60 วินาที
 *   course  : ข้อมูลวิชา (+รายชื่อนักศึกษา) จำ 5 นาที / 2 นาที
 *   syncScores / removeRound : ส่งคะแนนรอบสอบเข้าประเภทคะแนน EXAM ของ Core
 *
 * กฎกันเดดล็อก: ห้ามเรียก Core ขณะถือ lock ของ Exam (Core อาจเรียกกลับมาลบข้อมูลนักศึกษาโดยถือ lock ของ Core)
 **************************************************************/

var Core = (function () {

  function url_() {
    var u = Db.prop('CORE_URL');
    if (!u) throw U.E('E_NOT_SETUP');
    return u;
  }

  /** เรียก Core 1 คำสั่ง · ลองใหม่ 1 ครั้งเมื่อเน็ตสะดุด/Core ยุ่ง · คืน data หรือโยน error ที่มีรหัส */
  function call(action, args, opId) {
    var req = { action: action, token: Auth.mint('x', { sv: 'exam' }, APP.SVC_TTL_SEC), args: args || {} };
    if (opId) req.opId = opId;
    var payload = JSON.stringify(req);
    var lastErr = null;
    for (var tries = 1; tries <= 2; tries++) {
      var j = null;
      try {
        var res = UrlFetchApp.fetch(url_(), { method: 'post', contentType: 'text/plain', payload: payload, muteHttpExceptions: true, followRedirects: true });
        j = JSON.parse(res.getContentText());
      } catch (e) {
        if (e && e.code === 'E_NOT_SETUP') throw e;
        lastErr = U.E('E_CORE_DOWN', { why: 'fetch' });
      }
      if (j && j.ok) return j.data;
      if (j && !j.ok && j.error) {
        var er = j.error;
        if (er.code === 'E_BUSY' && tries < 2) { U.sleep(800); continue; }
        if (er.code === 'E_AUTH') throw U.E('E_CORE_DOWN', { why: 'service_auth' });       // secret ไม่ตรงกับ Core
        throw U.E(er.code || 'E_UNKNOWN', er.detail, er.msg);
      }
      if (j) lastErr = U.E('E_CORE_DOWN', { why: 'shape' });
      if (tries < 2) U.sleep(800);
    }
    throw lastErr || U.E('E_CORE_DOWN');
  }

  /** สิทธิ์อาจารย์ในวิชา → { role, course } · ไม่มีสิทธิ์โยน E_FORBIDDEN / E_NOT_FOUND / E_DISABLED / E_AUTH */
  function access(email, courseId) {
    var key = 'ACC_' + U.sha256(email + '|' + courseId).substring(0, 24);
    var hit = U.parse(U.cGet(key), null);
    if (hit) return hit;
    var r = call('svc.access', { email: email, courseId: courseId });
    U.cPut(key, U.json(r), APP.ACCESS_CACHE_SEC);
    return r;
  }

  /** ข้อมูลวิชา (+ รายชื่อ ถ้า withRoster) · fresh = ข้ามแคช */
  function course(courseId, withRoster, fresh) {
    var key = (withRoster ? 'ROS_' : 'CRS_') + courseId;
    if (!fresh) {
      var hit = U.parse(U.cGet(key), null);
      if (hit) return hit;
    }
    var r = call('svc.course', { courseId: courseId, roster: !!withRoster });
    U.cPut(key, U.json(r), withRoster ? APP.ROSTER_CACHE_SEC : APP.COURSE_CACHE_SEC);
    return r;
  }

  /** ชื่อนักศึกษาในวิชา (null = ไม่อยู่ในวิชา) · ไม่พบในแคชจะถามสดอีกครั้งก่อนตัดสิน */
  function studentName(courseId, stdId) {
    for (var pass = 0; pass < 2; pass++) {
      var r = course(courseId, true, pass === 1);
      var list = r.students || [];
      for (var i = 0; i < list.length; i++) if (list[i].stdId === stdId) return list[i].name;
    }
    return null;
  }

  function syncScores(a) { return call('svc.syncScores', a, 'sync-' + Utilities.getUuid()); }
  function removeRound(courseId, sessionId) { return call('svc.removeRound', { courseId: courseId, sessionId: sessionId }, 'rm-' + Utilities.getUuid()); }

  return { call: call, access: access, course: course, studentName: studentName, syncScores: syncScores, removeRound: removeRound };
})();

/** ตัวตรวจสิทธิ์ของอาจารย์ต่อวัตถุ — ทุก route ของอาจารย์ต้องผ่านตัวนี้ */
var Gate = {
  course: function (actor, courseId) {
    if (!courseId) throw U.E('E_REQUIRED', { field: 'courseId' });
    return Core.access(actor.email, String(courseId));
  },
  quiz: function (actor, quizId) {
    var z = quizId ? Db.byId('Quizzes', String(quizId)) : null;
    if (!z || z.status === 'DELETED') throw U.E('E_QUIZ_REQUIRED');
    Gate.course(actor, z.course_id);
    return z;
  },
  round: function (actor, sessionId) {
    var s = sessionId ? Db.byId('Rounds', String(sessionId)) : null;
    if (!s || s.status === 'DELETED') throw U.E('E_NOT_FOUND');
    Gate.course(actor, s.course_id);
    return s;
  }
};
