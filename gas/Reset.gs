/**************************************************************
 * File: Reset.gs  (HBT Core v0.6.0)
 * สำรองข้อมูล (สถานะ/เวลา) + admin รีเซ็ตรายวิชา/ภาคเรียน = ลบถาวร ไม่มีถังขยะ
 *
 *  สำรอง : ตัว Zip ประกอบที่เบราว์เซอร์ (JSZip) จากข้อมูลที่ API เดิมให้อยู่แล้ว — ที่นี่มีแค่
 *          backup.manifest (รายการ/ขนาดที่จะสำรอง) และ backup.mark (บันทึกว่าสำรองครบแล้ว ณ เวลานี้)
 *          สถานะ: empty (ไม่มีข้อมูล) | none (ไม่เคยสำรอง) | stale (มีการเปลี่ยนแปลงหลังสำรองล่าสุด) | ok
 *  รีเซ็ต : reset.course ลบทีละช่วง (งบเวลา) เรียกซ้ำได้จนกว่า done — ทำซ้ำปลอดภัย (สถานะดูจากข้อมูลจริง)
 *     0) ตรวจ Exam ตอบอยู่ (ตั้ง EXAM_URL ไว้แต่ไม่ตอบ = ไม่เริ่ม ไม่ลบอะไรเลย)
 *     1) ตั้งธง reset_at (วิชาเข้า/แก้ไม่ได้อีก) แล้วลบรายชื่อ → token นักศึกษาหมดผลทันที
 *     2) Exam: รูปใน Drive (ถาวร) → แถวทั้งหมด
 *     3) Drive: โฟลเดอร์ของงานแต่ละงาน (ถาวร พร้อมไฟล์ข้างใน)
 *     4) แถวทั้งหมดของวิชาในทุกตาราง (COURSE_TABLES) → ลบแถววิชาเป็นอย่างสุดท้าย
 *  ลบถาวรด้วย Drive advanced service (Drive.Files.remove) · ใช้ไม่ได้ = ทิ้งลงถังขยะและรายงานจำนวนให้
 **************************************************************/

var Reset = (function () {

  /** ตารางที่มี course_id — ลบทั้งหมดตอนรีเซ็ตวิชา (ลูกก่อนแม่) · ตารางใหม่ของระบบอื่น "ต้อง" มาเพิ่มที่นี่ (มีเทสต์ตรวจ) */
  var COURSE_TABLES = [
    'AsgFiles', 'AsgSubs', 'AsgGrades', 'AsgMembers', 'AsgGroups', 'Assignments',
    'AttApprovals', 'AttDevices', 'AttRecords', 'AttSessions',
    'ScoreRecords', 'ScoreTypes', 'PinRequests', 'Students'
  ];
  var DEFAULT_BUDGET_MS = 40000;

  /* ---------- สถานะสำรอง ---------- */
  function hasData_(courseId) {
    return Db.findRows('Students', 'course_id', courseId).length > 0 ||
      Db.findRows('AttSessions', 'course_id', courseId).length > 0 ||
      Db.findRows('Assignments', 'course_id', courseId).length > 0 ||
      Db.findRows('ScoreTypes', 'course_id', courseId).length > 0;
  }
  function backupState_(c, data) {
    if (!data) return 'empty';
    if (!c.backup_at) return 'none';
    return String(c.last_change_at) > String(c.backup_at) ? 'stale' : 'ok';
  }

  function manifest(user, a) {
    var c = Courses.require(user, a.courseId), id = c.course_id;
    var t = c.term_id ? Db.byId('Terms', c.term_id) : null;
    var files = Db.findRows('AsgFiles', 'course_id', id), subs = Db.findRows('AsgSubs', 'course_id', id);
    var asgs = Db.findRows('Assignments', 'course_id', id).sort(function (x, y) { return x.created_at < y.created_at ? -1 : 1; }).map(function (r) {
      var f = files.filter(function (x) { return x.asg_id === r.asg_id; });
      return {
        asgId: r.asg_id, code: r.code, title: r.title, kind: r.kind,
        files: f.length, bytes: f.reduce(function (s, x) { return s + (Number(x.size) || 0); }, 0),
        submitted: subs.filter(function (x) { return x.asg_id === r.asg_id; }).length
      };
    });
    var data = hasData_(id);
    return {
      course: { courseId: id, code: c.code, name: c.name, section: c.section, termName: t ? t.name : '' },
      students: Db.findRows('Students', 'course_id', id).length,
      attSessions: Db.findRows('AttSessions', 'course_id', id).length,
      scoreTypes: Db.findRows('ScoreTypes', 'course_id', id).length,
      assignments: asgs,
      lastChangeAt: c.last_change_at, backupAt: c.backup_at, state: backupState_(c, data)
    };
  }

  /** บันทึกว่าสำรองครบแล้ว ณ เวลานี้ (หน้าสำรองเรียกเมื่อสร้าง Zip ครบทุกชิ้นแล้ว) */
  function mark(user, a) {
    var c = Courses.require(user, a.courseId);
    var now = U.nowIso();
    Db.update('Courses', c.course_id, { backup_at: now });
    Audit.log(user.email, 'backup.mark', c.course_id, { parts: Number(a.parts) || 0 });
    return { backupAt: now };
  }

  /* ---------- Drive ---------- */
  /** ลบถาวร (โฟลเดอร์/ไฟล์) → 'deleted' | 'trashed' (ทำถาวรไม่ได้ จึงทิ้งลงถังขยะ) */
  function purgeDrive_(id) {
    if (!id) return 'deleted';
    try { Drive.Files.remove(id); return 'deleted'; }
    catch (e) {
      if (/not found|No item/i.test(String(e && e.message || e))) return 'deleted';
      try { DriveApp.getFileById(id).setTrashed(true); return 'trashed'; } catch (e1) {
        try { DriveApp.getFolderById(id).setTrashed(true); return 'trashed'; } catch (e2) { return 'deleted'; }
      }
    }
  }

  /* ---------- ภาพรวมก่อนลบ ---------- */
  function preview(user, a) {
    var cur = Terms.current();
    var term = a.termId ? Db.byId('Terms', String(a.termId)) : (cur ? Db.byId('Terms', cur.termId) : null);
    if (!term) throw U.E(a.termId ? 'E_NOT_FOUND' : 'E_NO_TERM');
    var rows = Db.findRows('Courses', 'term_id', term.term_id);
    var ids = rows.map(function (r) { return r.course_id; });
    var ex = null, exErr = '';
    if (ids.length && ExamLink.configured()) {
      try { ex = ExamLink.countCourses(ids); } catch (e) { exErr = e.code || 'E_EXAM_DOWN'; }
    }
    var stu = {}, sess = {}, scoreT = {}, files = {}, bytes = {}, asg = {};
    Db.all('Students').forEach(function (r) { stu[r.course_id] = (stu[r.course_id] || 0) + 1; });
    Db.all('AttSessions').forEach(function (r) { sess[r.course_id] = (sess[r.course_id] || 0) + 1; });
    Db.all('ScoreTypes').forEach(function (r) { scoreT[r.course_id] = (scoreT[r.course_id] || 0) + 1; });
    Db.all('Assignments').forEach(function (r) { asg[r.course_id] = (asg[r.course_id] || 0) + 1; });
    Db.all('AsgFiles').forEach(function (r) { files[r.course_id] = (files[r.course_id] || 0) + 1; bytes[r.course_id] = (bytes[r.course_id] || 0) + (Number(r.size) || 0); });
    var courses = rows.sort(function (x, y) { return (x.code + '-' + x.section) < (y.code + '-' + y.section) ? -1 : 1; }).map(function (c) {
      var u = Users.get(c.owner_email);
      var data = (stu[c.course_id] || 0) + (sess[c.course_id] || 0) + (asg[c.course_id] || 0) + (scoreT[c.course_id] || 0) > 0;
      var e = ex && ex.counts ? ex.counts[c.course_id] : null;
      if (e && (e.quizzes || e.rounds || e.attempts)) data = true;
      return {
        courseId: c.course_id, code: c.code, name: c.name, section: c.section, ownerEmail: c.owner_email, ownerName: u ? u.name : '',
        students: stu[c.course_id] || 0, attSessions: sess[c.course_id] || 0, assignments: asg[c.course_id] || 0,
        files: files[c.course_id] || 0, bytes: bytes[c.course_id] || 0, scoreTypes: scoreT[c.course_id] || 0,
        exam: e || null, lastChangeAt: c.last_change_at, backupAt: c.backup_at, backupState: backupState_(c, data),
        resetting: !!c.reset_at
      };
    });
    return {
      term: { termId: term.term_id, name: term.name, isCurrent: !!cur && cur.termId === term.term_id },
      courses: courses, examConfigured: ExamLink.configured(), examError: exErr,
      note: 'การลบเป็นถาวร ไม่มีถังขยะ'
    };
  }

  /* ---------- ลบวิชา (ทีละช่วง) ---------- */
  function confirmText_(c) { return (c.code + '-' + c.section).toUpperCase(); }

  function course(user, a) {
    var c = Db.byId('Courses', U.req(a.courseId, 'courseId'));
    if (!c) throw U.E('E_NOT_FOUND');
    if (String(a.confirm || '').replace(/\s+/g, '').toUpperCase() !== confirmText_(c)) throw U.E('E_RESET_CONFIRM', { expect: confirmText_(c) });
    var budget = Math.max(0, Math.min(Number(a.budgetMs) >= 0 && a.budgetMs !== undefined ? Number(a.budgetMs) : DEFAULT_BUDGET_MS, 120000));
    var t0 = Date.now();
    var id = c.course_id, res = { courseId: id, code: c.code, section: c.section, done: false, phase: '', removed: {}, drive: { deleted: 0, trashed: 0 }, exam: null };

    // 0) Exam ต้องตอบก่อนเริ่ม (เฉพาะครั้งแรก) — ไม่งั้นไม่ลบอะไรเลย
    if (!c.reset_at) {
      if (ExamLink.configured()) ExamLink.ping();
      Db.update('Courses', id, { reset_at: U.nowIso(), reset_by: user.email });
      Audit.log(user.email, 'reset.start', id, { code: c.code, section: c.section, owner: c.owner_email });
    }

    // 1) รายชื่อนักศึกษา (+คำขอรีเซ็ต PIN) → token นักศึกษาของวิชานี้ใช้ไม่ได้ทันที
    res.phase = 'students';
    U.lock(function () {
      Db.flush();
      res.removed.Students = Db.removeWhere('Students', function (o) { return o.course_id === id; });
      res.removed.PinRequests = Db.removeWhere('PinRequests', function (o) { return o.course_id === id; });
    });

    // 2) Exam (รูปใน Drive → แถว)
    if (ExamLink.configured()) {
      res.phase = 'exam';
      var im;
      do {
        im = ExamLink.purgeImages(id, Math.max(1000, budget - (Date.now() - t0)));
        res.exam = res.exam || { images: 0, trashed: 0 };
        res.exam.images += im.deleted; res.exam.trashed += im.trashed;
      } while (!im.done && Date.now() - t0 < budget);
      if (!im.done) return res;
      var pc = ExamLink.purgeCourse(id);
      if (!pc.done) return res;
      res.exam.removed = pc.removed;
    }

    // 3) Drive ของงาน: ลบโฟลเดอร์ต่องาน (ไฟล์ข้างในไปด้วย) · ทำเสร็จแล้วล้าง folder_id เพื่อไม่ทำซ้ำ
    res.phase = 'drive';
    var asgs = Db.findRows('Assignments', 'course_id', id).filter(function (r) { return r.folder_id; });
    for (var i = 0; i < asgs.length; i++) {
      if (i > 0 && Date.now() - t0 >= budget) return res;
      var how = purgeDrive_(asgs[i].folder_id);
      res.drive[how]++;
      U.lock(function () { Db.flush(); Db.update('Assignments', asgs[i].asg_id, { folder_id: '' }); });
    }

    // 4) แถวทั้งหมดของวิชา → แถววิชาเป็นอย่างสุดท้าย
    res.phase = 'rows';
    U.lock(function () {
      Db.flush();
      COURSE_TABLES.forEach(function (t) {
        var n = Db.removeWhere(t, function (o) { return o.course_id === id; });
        res.removed[t] = (res.removed[t] || 0) + n;
      });
      Db.remove('Courses', id);
    });
    Db.flush();
    res.done = true; res.phase = 'done';
    Audit.log(user.email, 'reset.course', id, { code: c.code, section: c.section, owner: c.owner_email, removed: res.removed, drive: res.drive, exam: res.exam });
    return res;
  }

  /* ---------- ลบภาคเรียน (ว่างเปล่าเท่านั้น) ---------- */
  function term(user, a) {
    var t = Db.byId('Terms', U.req(a.termId, 'termId'));
    if (!t) throw U.E('E_NOT_FOUND');
    if (String(a.confirm || '').replace(/\s+/g, '') !== String(t.name).replace(/\s+/g, '')) throw U.E('E_RESET_CONFIRM', { expect: t.name });
    if (U.bool(t.is_current)) throw U.E('E_TERM_CURRENT');
    var n = Db.findRows('Courses', 'term_id', t.term_id).length;
    if (n) throw U.E('E_TERM_HAS_COURSES', { count: n });
    Db.remove('Terms', t.term_id);
    Audit.log(user.email, 'reset.term', t.term_id, { name: t.name });
    return { removed: true };
  }

  /* ---------- PIN ที่ไม่มีนักศึกษาในวิชาใดแล้ว ---------- */
  function pins(user, a) {
    var alive = {};
    Db.all('Students').forEach(function (r) { alive[r.std_id] = true; });
    var orphan = Db.all('StudentPIN').filter(function (r) { return !alive[r.std_id]; }).map(function (r) { return r.std_id; });
    if (U.bool(a.dryRun)) return { orphans: orphan.length, dryRun: true };
    var set = {}; orphan.forEach(function (s) { set[s] = true; });
    var out = { orphans: orphan.length, removedPin: 0, removedDevices: 0 };
    if (orphan.length) {
      out.removedPin = Db.removeWhere('StudentPIN', function (o) { return set[o.std_id] === true; });
      out.removedDevices = Db.removeWhere('StudentDevices', function (o) { return set[o.std_id] === true; });
    }
    Audit.log(user.email, 'reset.pins', '-', out);
    return out;
  }

  return { manifest: manifest, mark: mark, preview: preview, course: course, term: term, pins: pins, COURSE_TABLES: COURSE_TABLES, purgeDrive: purgeDrive_ };
})();
