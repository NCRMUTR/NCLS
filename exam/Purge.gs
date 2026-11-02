/**************************************************************
 * File: Purge.gs  (HBT Exam API v0.6.0)
 * ลบข้อมูลสอบของรายวิชาแบบถาวร (เรียกจาก Core ตอน admin รีเซ็ตวิชา — token บริการ 'core')
 *
 *   svc.ping          Core ตรวจว่า Exam ตอบอยู่ก่อนเริ่มลบอะไรเลย
 *   svc.countCourses  จำนวนข้อมูลสอบต่อวิชา (ให้หน้ารีเซ็ตแสดงว่าจะหายอะไรบ้าง)
 *   svc.purgeImages   ลบรูปข้อสอบใน Drive แบบถาวร ทีละช่วงตามงบเวลา (ทำซ้ำได้จนกว่า done)
 *   svc.purgeCourse   ลบแถวทั้งหมดของวิชา (ใน lock) — ทำเมื่อไม่เหลือรูปแล้วเท่านั้น
 * ลบรูปก่อนแถวเสมอ: ถ้าแถวหายก่อน จะไม่เหลือ id ให้ตามลบรูปใน Drive
 **************************************************************/

var Purge = {

  IMG_COLS: { Questions: ['q_image_id', 'explain_image_id'], Choices: ['c_image_id'] },

  /** รายการรูปที่ยังอ้างอยู่ของวิชา: [{ table, row, col, id }] */
  pendingImages: function (courseId) {
    var out = [];
    Object.keys(Purge.IMG_COLS).forEach(function (t) {
      Db.findRows(t, 'course_id', courseId).forEach(function (r) {
        Purge.IMG_COLS[t].forEach(function (c) { if (r[c]) out.push({ table: t, row: r._row, col: c, id: r[c] }); });
      });
    });
    return out;
  },

  counts: function (courseIds) {
    var out = {};
    courseIds.forEach(function (cid) {
      cid = String(cid);
      var quizzes = Db.findRows('Quizzes', 'course_id', cid);
      var qs = Db.findRows('Questions', 'course_id', cid);
      var rounds = Db.findRows('Rounds', 'course_id', cid);
      out[cid] = {
        quizzes: quizzes.filter(function (z) { return z.status !== 'DELETED'; }).length,
        questions: qs.filter(function (q) { return q.status !== 'DELETED'; }).length,
        rounds: rounds.filter(function (s) { return s.status !== 'DELETED'; }).length,
        attempts: Db.findRows('Attempts', 'course_id', cid).length,
        images: Purge.pendingImages(cid).length
      };
    });
    return { counts: out };
  },

  /** ลบรูปจนหมดเวลา (budgetMs) แล้วเคลียร์ id ในแถว · คืน { done, deleted, remaining, permanent, trashed } */
  images: function (a) {
    var cid = String(a.courseId || '');
    if (!cid) throw U.E('E_REQUIRED', { field: 'courseId' });
    var budget = Math.max(0, Math.min(Number(a.budgetMs) || 25000, 40000));
    var t0 = Date.now();
    var list = Purge.pendingImages(cid), perm = 0, trashed = 0, n = 0, patches = { Questions: {}, Choices: {} };
    for (var i = 0; i < list.length; i++) {
      if (n > 0 && Date.now() - t0 >= budget) break;
      var x = list[i];
      if (Img.purge(x.id) === 'trashed') trashed++; else perm++;
      patches[x.table][x.row] = patches[x.table][x.row] || {};
      patches[x.table][x.row][x.col] = '';
      n++;
    }
    if (n) {
      U.lock(function () {
        Db.flush();
        Object.keys(patches).forEach(function (t) { Db.bulkPatch(t, patches[t]); });
        Db.flush();
      });
      Quiz.live(cid).forEach(function (z) { Paper.invalidate(z.quiz_id); });
    }
    return { done: n >= list.length, deleted: n, remaining: list.length - n, permanent: perm, trashed: trashed };
  },

  /** ลบแถวทั้งหมดของวิชา (เรียกใน lock) · ถ้ายังมีรูปค้างอยู่ = ไม่ลบ คืน done:false */
  course: function (a) {
    var cid = String(a.courseId || '');
    if (!cid) throw U.E('E_REQUIRED', { field: 'courseId' });
    if (Purge.pendingImages(cid).length) return { done: false, removed: {} };
    var quizzes = Db.findRows('Quizzes', 'course_id', cid);
    var rounds = Db.findRows('Rounds', 'course_id', cid);
    var attempts = Db.findRows('Attempts', 'course_id', cid);
    var removed = {};
    ['Answers', 'Attempts', 'Choices', 'Questions', 'Rounds', 'Quizzes'].forEach(function (t) {
      removed[t] = Db.removeWhere(t, function (o) { return o.course_id === cid; });
    });
    Db.flush();
    quizzes.forEach(function (z) { Paper.invalidate(z.quiz_id); });
    rounds.forEach(function (s) { Op.invalidate(s.session_id, s.token); });
    attempts.forEach(function (x) { U.cDel('HB_' + x.attempt_id); U.cDel('ARW_' + x.attempt_id); });
    U.cDel('CRS_' + cid); U.cDel('ROS_' + cid);
    Audit.log('core', 'purge.course', cid, removed);
    return { done: true, removed: removed };
  }
};
