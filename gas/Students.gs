/**************************************************************
 * File: Students.gs  (HBT Core v0.3.0)
 * รายชื่อนักศึกษาต่อวิชา (ข้อมูลกลางที่เช็คชื่อ/สอบ/ส่งงาน/คะแนนใช้ร่วมกัน)
 *  - รหัสนักศึกษาซ้ำในวิชาเดียวกันไม่ได้ · นักศึกษาคนเดียวอยู่หลายวิชาได้ (PIN ใช้ร่วมตามรหัส)
 *  - นำเข้า CSV: merge (เพิ่ม/แก้ชื่อ) หรือ replace (คนที่ไม่อยู่ในไฟล์ถูกลบถาวร) · มี dryRun ให้ดูผลก่อน
 *  - ลบนักศึกษา = ลบถาวรพร้อมข้อมูลของเขาในวิชานี้ผ่านรายการ CASCADE (ขั้นถัดไปเพิ่มเช็คชื่อ/งานที่ส่งต่อท้ายตรงนี้)
 **************************************************************/

/**
 * ข้อมูลที่ "ผูกกับนักศึกษาในวิชา" ต้องลบตามเมื่อลบนักศึกษา
 *   count(courseId, stdId) → จำนวนที่จะหาย (แสดงก่อนยืนยันลบ)
 *   remove(courseId, stdIds[]) → ลบจริง
 * เพิ่มของระบบใหม่ต่อท้ายอาร์เรย์นี้ (อ้างฟังก์ชันตอนเรียก ไม่ใช่ตอนโหลดไฟล์ — ลำดับไฟล์ใน Apps Script ไม่มีผล)
 */
var STUDENT_CASCADE = [
  {
    // สอบอยู่คนละระบบ (Exam API) → ลบก่อนเป็นอันดับแรก: ถ้าติดต่อไม่ได้จะโยน error ก่อนลบอะไรของ Core (ไม่ลบครึ่งๆ กลางๆ)
    key: 'exam', label: 'ผลการทำข้อสอบ',
    count: function (courseId, stdId) { return ExamLink.countForStudent(courseId, stdId); },
    remove: function (courseId, stdIds) { return ExamLink.removeForStudents(courseId, stdIds); }
  },
  {
    key: 'scores', label: 'คะแนน',
    count: function (courseId, stdId) { return Scores.countForStudent(courseId, stdId); },
    remove: function (courseId, stdIds) { return Scores.removeForStudents(courseId, stdIds); }
  },
  {
    key: 'attendance', label: 'ประวัติเช็คชื่อ',
    count: function (courseId, stdId) { return Attendance.countForStudent(courseId, stdId); },
    remove: function (courseId, stdIds) { return Attendance.removeForStudents(courseId, stdIds); }
  },
  {
    key: 'assignments', label: 'งานที่ส่ง/คะแนนงาน/กลุ่ม',
    count: function (courseId, stdId) { return Assignments.countForStudent(courseId, stdId); },
    remove: function (courseId, stdIds) { return Assignments.removeForStudents(courseId, stdIds); }
  }
];

var Students = (function () {

  var MAX_IMPORT = 1000;

  function key_(courseId, stdId) { return courseId + '|' + stdId; }

  function cleanId_(v) {
    var s = String(v === undefined || v === null ? '' : v).replace(/[\s\u200b]/g, '');
    if (!/^[A-Za-z0-9\-]{4,20}$/.test(s)) throw U.E('E_STD_ID', { value: s.substring(0, 30) });
    return s.toUpperCase();
  }
  function cleanName_(v) {
    var s = String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!s || s.length > 120) throw U.E('E_STD_NAME');
    return s;
  }

  function rosterOf_(courseId) {
    return Db.findRows('Students', 'course_id', courseId).sort(function (a, b) { return a.std_id < b.std_id ? -1 : (a.std_id > b.std_id ? 1 : 0); });
  }

  function list(user, courseId) {
    var c = Courses.require(user, courseId);
    var roster = rosterOf_(c.course_id);
    var ids = roster.map(function (s) { return s.std_id; });
    var st = Pin.statuses(ids), req = Pin.openRequestIds(c.course_id);
    var counts = { total: roster.length, set: 0, temp: 0, none: 0, requests: 0 };
    var students = roster.map(function (s) {
      var p = st[s.std_id];
      counts[p]++;
      if (req[s.std_id]) counts.requests++;
      return { stdId: s.std_id, name: s.name, pinStatus: p, resetRequested: !!req[s.std_id] };
    });
    return {
      course: { courseId: c.course_id, code: c.code, name: c.name, section: c.section, termId: c.term_id },
      students: students, counts: counts
    };
  }

  function add(user, a) {
    var c = Courses.require(user, a.courseId);
    var stdId = cleanId_(a.stdId), name = cleanName_(a.name);
    if (Db.byId('Students', key_(c.course_id, stdId))) throw U.E('E_STUDENT_DUP');
    Db.insert('Students', { row_key: key_(c.course_id, stdId), course_id: c.course_id, std_id: stdId, name: name, added_at: U.nowIso() });
    Courses.touch(c.course_id);
    Audit.log(user.email, 'student.add', c.course_id, stdId);
    return { stdId: stdId, name: name };
  }

  function update(user, a) {
    var c = Courses.require(user, a.courseId);
    var stdId = cleanId_(a.stdId), name = cleanName_(a.name);
    var r = Db.byId('Students', key_(c.course_id, stdId));
    if (!r) throw U.E('E_NOT_FOUND');
    Db.update('Students', r.row_key, { name: name });
    Courses.touch(c.course_id);
    return { stdId: stdId, name: name };
  }

  /**
   * a = { courseId, rows:[{stdId,name}], mode:'merge'|'replace', dryRun? }
   * คืน { added, updated, unchanged, removed, removedList:[{stdId,name}], skipped:[{row,stdId,why}], dryRun }
   */
  function importCsv(user, a) {
    var c = Courses.require(user, a.courseId);
    var mode = a.mode === undefined ? 'merge' : String(a.mode);
    if (mode !== 'merge' && mode !== 'replace') throw U.E('E_BAD_REQUEST', { why: 'mode' });
    var rows = a.rows;
    if (!Array.isArray(rows) || !rows.length) throw U.E('E_IMPORT', null, 'ไม่พบข้อมูลที่จะนำเข้า');
    if (rows.length > MAX_IMPORT) throw U.E('E_IMPORT', { max: MAX_IMPORT }, 'นำเข้าได้ครั้งละไม่เกิน ' + MAX_IMPORT + ' รายการ');

    var existing = {};
    rosterOf_(c.course_id).forEach(function (s) { existing[s.std_id] = s; });
    var seen = {}, valid = [], skipped = [];
    rows.forEach(function (r, i) {
      var rowNo = i + 1;
      try {
        if (!r || typeof r !== 'object') throw U.E('E_IMPORT');
        var id = cleanId_(r.stdId), nm = cleanName_(r.name);
        if (seen[id]) { skipped.push({ row: rowNo, stdId: id, why: 'รหัสซ้ำในไฟล์ (ใช้แถวแรก)' }); return; }
        seen[id] = true;
        valid.push({ stdId: id, name: nm });
      } catch (e) {
        var raw = (r && typeof r === 'object') ? String(r.stdId === undefined ? '' : r.stdId).substring(0, 30) : '';
        skipped.push({ row: rowNo, stdId: raw, why: e.code === 'E_STD_ID' ? 'รหัสนักศึกษาไม่ถูกต้อง' : (e.code === 'E_STD_NAME' ? 'ชื่อว่างหรือยาวเกิน' : 'ข้อมูลไม่ถูกต้อง') });
      }
    });
    // ไฟล์ที่ "ทุกแถวเสีย" + โหมดแทนที่ = ห้ามทำ (ไม่งั้นจะลบทั้งห้อง)
    if (mode === 'replace' && !valid.length) throw U.E('E_IMPORT', null, 'ไม่มีแถวที่ใช้ได้เลย จึงไม่แทนที่รายชื่อ');

    var toAdd = [], toUpdate = {}, unchanged = 0, updated = 0;
    valid.forEach(function (v) {
      var ex = existing[v.stdId];
      if (!ex) toAdd.push(v);
      else if (ex.name !== v.name) { toUpdate[ex._row] = { name: v.name }; updated++; }
      else unchanged++;
    });
    var removeIds = [];
    if (mode === 'replace') {
      Object.keys(existing).forEach(function (id) { if (!seen[id]) removeIds.push(id); });
    }
    var plan = {
      added: toAdd.length, updated: updated, unchanged: unchanged, removed: removeIds.length,
      removedList: removeIds.slice(0, 200).map(function (id) { return { stdId: id, name: existing[id].name }; }),
      skipped: skipped.slice(0, 200), skippedCount: skipped.length, dryRun: U.bool(a.dryRun)
    };
    if (plan.dryRun) return plan;

    var now = U.nowIso();
    // ลำดับสำคัญ: แก้ชื่อก่อน (ใช้เลขแถวที่อ่านไว้) → ลบ (ทำให้แถวเลื่อน) → เพิ่ม (ต่อท้ายตามแถวล่าสุดจริง)
    if (Object.keys(toUpdate).length) Db.bulkPatch('Students', toUpdate);
    if (removeIds.length) removeStudents_(c.course_id, removeIds);
    if (toAdd.length) {
      Db.insertMany('Students', toAdd.map(function (v) {
        return { row_key: key_(c.course_id, v.stdId), course_id: c.course_id, std_id: v.stdId, name: v.name, added_at: now };
      }));
    }
    Courses.touch(c.course_id);
    Audit.log(user.email, 'student.import', c.course_id, { mode: mode, added: plan.added, updated: plan.updated, removed: plan.removed, skipped: plan.skippedCount });
    return plan;
  }

  /** ลบนักศึกษา + ข้อมูลที่ผูกกับเขาในวิชานี้ (ไม่แตะ PIN: PIN เป็นของนักศึกษาทั้งระบบ ใช้ในวิชาอื่นต่อ) */
  function removeStudents_(courseId, stdIds) {
    var set = {};
    stdIds.forEach(function (id) { set[id] = true; });
    var deleted = {};
    STUDENT_CASCADE.forEach(function (p) { deleted[p.key] = p.remove(courseId, stdIds) || 0; });
    Db.removeWhere('Students', function (o) { return o.course_id === courseId && set[o.std_id] === true; });
    return deleted;
  }

  function impact(user, a) {
    var c = Courses.require(user, a.courseId);
    var stdId = cleanId_(a.stdId);
    var r = Db.byId('Students', key_(c.course_id, stdId));
    if (!r) throw U.E('E_NOT_FOUND');
    var items = STUDENT_CASCADE.map(function (p) { return { key: p.key, label: p.label, count: p.count(c.course_id, stdId) }; });
    return { stdId: stdId, name: r.name, items: items };
  }

  function remove(user, a) {
    var c = Courses.require(user, a.courseId);
    var stdId = cleanId_(a.stdId);
    if (!Db.byId('Students', key_(c.course_id, stdId))) throw U.E('E_NOT_FOUND');
    var deleted = removeStudents_(c.course_id, [stdId]);
    Courses.touch(c.course_id);
    Audit.log(user.email, 'student.remove', c.course_id, { stdId: stdId, deleted: deleted });
    return { deleted: deleted };
  }

  /** ใช้โดยโมดูลอื่น: นักศึกษาอยู่ในวิชานี้ไหม (คืนแถวหรือ null) */
  function find(courseId, stdId) { return Db.byId('Students', key_(courseId, String(stdId).toUpperCase())); }

  /** สำหรับหน้านักศึกษา (ไม่ล็อกอิน): รายชื่อในวิชา */
  function pubList(courseId) {
    var c = Db.byId('Courses', String(courseId || ''));
    var cur = Terms.current();
    if (!c || !cur || c.term_id !== cur.termId) return { students: [] };
    return { students: rosterOf_(c.course_id).map(function (s) { return { stdId: s.std_id, name: s.name }; }) };
  }

  return {
    list: list, add: add, update: update, importCsv: importCsv, impact: impact, remove: remove,
    find: find, roster: rosterOf_, pubList: pubList, cleanId: cleanId_
  };
})();
