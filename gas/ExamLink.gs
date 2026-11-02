/**************************************************************
 * File: ExamLink.gs  (HBT Core v0.6.0) — จุดเชื่อมกับ Exam API (GAS แยก)
 *
 *  ฝั่งที่ Exam เรียกเข้ามา (token บริการ x, sv:'exam' — ตรวจที่ Router: auth:'service')
 *    svc.access      อาจารย์คนนี้ใช้ระบบสอบกับวิชานี้ได้ไหม (active, สิทธิ์ exam, เจ้าของวิชา/admin)
 *    svc.course      ข้อมูลวิชา (+รายชื่อนักศึกษา)
 *    svc.syncScores  ส่งคะแนนรอบสอบเข้าประเภทคะแนน EXAM (หนึ่งรอบ = หนึ่งประเภท · ref = รหัสรอบ)
 *    svc.removeRound ลบประเภทคะแนนของรอบที่ถูกลบ
 *  ฝั่งที่ Core เรียกออกไป (token x, sv:'core')
 *    svc.countStudent / svc.removeStudents  → ใช้กับ STUDENT_CASCADE (ลบนักศึกษา = ลบผลสอบของเขาด้วย)
 *    ไม่ได้ตั้ง EXAM_URL = ยังไม่ใช้ระบบสอบ ข้ามไป · ตั้งแล้วแต่ติดต่อไม่ได้ = ปฏิเสธการลบ (ไม่ทิ้งข้อมูลกำพร้า)
 **************************************************************/

var ExamLink = (function () {

  function courseOut_(c) {
    var cur = Terms.current();
    return { courseId: c.course_id, code: c.code, name: c.name, section: c.section, termId: c.term_id, current: !!cur && cur.termId === c.term_id };
  }
  function needCourse_(id) {
    var c = Db.byId('Courses', String(id || ''));
    if (!c || c.reset_at) throw U.E('E_NOT_FOUND');          // วิชาที่ admin กำลังลบ = ถือว่าไม่มี
    return c;
  }

  /* ---------- Exam → Core ---------- */

  function access(a) {
    var email = U.normEmail(a.email);
    var u = email ? Users.get(email) : null;
    if (!u) throw U.E('E_NOT_LISTED');
    if (!u.active) throw U.E('E_DISABLED');
    var c = needCourse_(a.courseId);
    if (!Auth.can(u, 'exam')) throw U.E('E_FORBIDDEN');
    if (u.role !== 'admin' && c.owner_email !== email) throw U.E('E_FORBIDDEN');
    return { role: u.role, course: courseOut_(c) };
  }

  function course(a) {
    var c = needCourse_(a.courseId);
    var o = courseOut_(c), out = { course: o, current: o.current };
    if (U.bool(a.roster)) out.students = Students.roster(c.course_id).map(function (s) { return { stdId: s.std_id, name: s.name }; });
    return out;
  }

  /**
   * รับคะแนนทั้งรอบเป็นชุดเดียว: สร้าง/ปรับประเภท EXAM ของรอบ → เขียนทับคะแนนที่ส่งมา → ล้างคะแนนของคนที่เคยมีแต่ไม่อยู่ในชุดนี้
   * ทำซ้ำได้ (ผลเท่าเดิม) · น้ำหนัก % เริ่มที่ 0 ให้อาจารย์ตั้งเองในหน้าคะแนน
   */
  function syncScores(a) {
    var c = needCourse_(a.courseId);
    var sid = String(a.sessionId || '');
    if (!sid || sid.length > 80) throw U.E('E_BAD_REQUEST', { why: 'sessionId' });
    var name = String(a.name === undefined || a.name === null ? '' : a.name).replace(/\s+/g, ' ').trim();
    if (!name || name.length > 60) throw U.E('E_SCORE_TYPE', { field: 'name' });
    var max = Number(a.max);
    if (!isFinite(max) || max <= 0 || max > 1000) throw U.E('E_SCORE_TYPE', { field: 'max' });
    max = Math.round(max * 100) / 100;
    if (!Array.isArray(a.rows)) throw U.E('E_BAD_REQUEST', { why: 'rows' });

    var t = Scores.ensureType(c.course_id, 'EXAM', sid, { name: name, max: max });
    if (t.name !== name || Number(t.max_score) !== max) t = Scores.updateAuto(c.course_id, 'EXAM', sid, { name: name, max: max });

    var rows = a.rows.slice(), given = {};
    rows.forEach(function (r) { try { given[Students.cleanId(r && r.stdId)] = true; } catch (e) {} });
    Db.findRows('ScoreRecords', 'type_id', t.type_id).forEach(function (r) {
      if (r.score !== '' && !given[r.std_id]) rows.push({ stdId: r.std_id, score: '' });
    });
    var res = rows.length ? Scores.setRecords(c.course_id, t.type_id, rows, 'exam') : { saved: 0, cleared: 0, unchanged: 0, skipped: [], skippedCount: 0 };
    Courses.touch(c.course_id);
    Audit.log('exam', 'exam.sync', sid, { course: c.course_id, saved: res.saved, cleared: res.cleared, skipped: res.skippedCount });
    res.typeId = t.type_id;
    return res;
  }

  function removeRound(a) {
    var c = needCourse_(a.courseId);
    var n = Scores.removeAuto(c.course_id, 'EXAM', String(a.sessionId || ''));
    if (n) Courses.touch(c.course_id);
    Audit.log('exam', 'exam.removeRound', String(a.sessionId || ''), { course: c.course_id, records: n });
    return { removed: n };
  }

  /* ---------- Core → Exam ---------- */

  function url_() { return String(Config.get('EXAM_URL') || ''); }

  function callExam_(action, args, opId) {
    var req = { action: action, token: Auth.mintService('core'), args: args || {} };
    if (opId) req.opId = opId;
    var j = null;
    for (var tries = 1; tries <= 2 && !j; tries++) {
      try {
        var res = UrlFetchApp.fetch(url_(), { method: 'post', contentType: 'text/plain', payload: JSON.stringify(req), muteHttpExceptions: true, followRedirects: true });
        j = JSON.parse(res.getContentText());
      } catch (e) { j = null; if (tries < 2) U.sleep(800); }
    }
    if (!j || !j.ok) throw U.E('E_EXAM_DOWN', { why: j && j.error ? j.error.code : 'fetch' });
    return j.data;
  }

  function countForStudent(courseId, stdId) {
    if (!url_()) return 0;
    return Number(callExam_('svc.countStudent', { courseId: courseId, stdId: stdId }).count) || 0;
  }
  function removeForStudents(courseId, stdIds) {
    if (!url_() || !stdIds.length) return 0;
    return Number(callExam_('svc.removeStudents', { courseId: courseId, stdIds: stdIds }, 'rm-' + Utilities.getUuid()).removed) || 0;
  }

  /** ----- ใช้กับ Reset (admin รีเซ็ตวิชา) ----- */
  function configured() { return !!url_(); }
  function ping() { return callExam_('svc.ping', {}); }
  function countCourses(ids) { return callExam_('svc.countCourses', { courseIds: ids }); }
  function purgeImages(courseId, budgetMs) { return callExam_('svc.purgeImages', { courseId: courseId, budgetMs: budgetMs }); }
  function purgeCourse(courseId) { return callExam_('svc.purgeCourse', { courseId: courseId }); }

  return { configured: configured, ping: ping, countCourses: countCourses, purgeImages: purgeImages, purgeCourse: purgeCourse, access: access, course: course, syncScores: syncScores, removeRound: removeRound, countForStudent: countForStudent, removeForStudents: removeForStudents };
})();
