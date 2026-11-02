/**************************************************************
 * File: Report.gs  (HBT Exam API v0.5.0) — รายงานผลรายรอบ + ส่งออก CSV
 * (ภาพรวมทั้งวิชา/ตารางคะแนนรวมอยู่ที่หน้าคะแนนของ Core — ที่นี่ดูเฉพาะผลของแต่ละรอบ)
 **************************************************************/

var Report = {

  round: function (actor, a) {
    var s = Gate.round(actor, a.sessionId);
    var quiz = Db.byId('Quizzes', s.quiz_id);
    var paper = Paper.get(s.quiz_id);
    var atts = Db.findRows('Attempts', 'session_id', s.session_id).sort(function (x, y) {
      return x.std_id < y.std_id ? -1 : (x.std_id > y.std_id ? 1 : (x.started_at < y.started_at ? -1 : 1));
    });
    var stats = Op.computeStats(s.session_id);
    var bestOf = {};
    atts.forEach(function (x) {
      if (x.status === 'IN_PROGRESS' || x.course_score === '') return;
      var v = U.num(x.course_score);
      if (bestOf[x.std_id] === undefined || v > bestOf[x.std_id].v) bestOf[x.std_id] = { v: v, id: x.attempt_id };
    });
    return {
      round: Op.toClient(Op.clean(s), { attempts: stats.attempts, submitted: stats.submitted }, quiz ? quiz.title : ''),
      stats: { attempts: stats.attempts, submitted: stats.submitted, avgPct: stats.avgPct, medianPct: stats.medianPct, minPct: stats.minPct, maxPct: stats.maxPct, hist: stats.hist },
      perQuestion: paper.map(function (q) {
        var e = stats.perQ[q.question_id] || { n: 0, ok: 0 };
        return { questionId: q.question_id, qNo: q.q_no, text: (q.q_text || '[รูปภาพ]').substring(0, 90), answered: e.n, correct: e.ok, pct: e.n ? Math.round(e.ok / e.n * 100) : null };
      }),
      attempts: atts.map(function (x) {
        var pct = U.num(x.max_score) ? Math.round(U.num(x.total_score) / U.num(x.max_score) * 1000) / 10 : 0;
        return {
          attemptId: x.attempt_id, stdId: x.std_id, name: x.student_name, status: x.status,
          startedAt: x.started_at, submittedAt: x.submitted_at, durationSec: U.num(x.duration_sec),
          totalScore: U.num(x.total_score), maxScore: U.num(x.max_score), pct: pct,
          correct: U.num(x.correct_count), wrong: U.num(x.wrong_count), unanswered: U.num(x.unanswered_count),
          violations: U.num(x.violations),
          courseScore: x.course_score === '' ? null : U.num(x.course_score), courseMax: x.course_max === '' ? null : U.num(x.course_max),
          counted: !!(bestOf[x.std_id] && bestOf[x.std_id].id === x.attempt_id)
        };
      })
    };
  },

  /** CSV ของรอบเดียว · detail = เพิ่มคอลัมน์คะแนนรายข้อ */
  exportCsv: function (actor, a) {
    var s = Gate.round(actor, a.sessionId);
    var c = Core.course(s.course_id, false).course;
    var paper = Paper.get(s.quiz_id);
    var atts = Db.findRows('Attempts', 'session_id', s.session_id).sort(function (x, y) {
      return x.std_id < y.std_id ? -1 : (x.std_id > y.std_id ? 1 : (x.started_at < y.started_at ? -1 : 1));
    });
    var head = ['รหัสวิชา', 'ชื่อวิชา', 'รอบ', 'ประเภท', 'รหัสนักศึกษา', 'ชื่อ-นามสกุล', 'สถานะ', 'เริ่มทำ', 'ส่งเมื่อ', 'ใช้เวลา(วินาที)',
      'คะแนนที่ได้', 'คะแนนเต็ม', 'เปอร์เซ็นต์', 'คะแนนเก็บ', 'คะแนนเก็บเต็ม', 'ถูก', 'ผิด', 'ไม่ได้ตอบ', 'ออกนอกหน้าจอ'];
    if (U.bool(a.detail)) paper.forEach(function (q) { head.push('ข้อ ' + q.q_no); });
    var rows = [head];
    atts.forEach(function (x) {
      var pct = U.num(x.max_score) ? Math.round(U.num(x.total_score) / U.num(x.max_score) * 1000) / 10 : 0;
      var r = [c.code, c.name, s.title || s.mode, s.mode === 'TEST' ? 'สอบ' : 'ฝึกทำ', x.std_id, x.student_name, x.status, x.started_at, x.submitted_at, U.num(x.duration_sec),
        U.num(x.total_score), U.num(x.max_score), pct, x.course_score === '' ? '' : U.num(x.course_score), x.course_max === '' ? '' : U.num(x.course_max),
        U.num(x.correct_count), U.num(x.wrong_count), U.num(x.unanswered_count), U.num(x.violations)];
      if (U.bool(a.detail)) {
        var ans = U.parse(x.answers_json, {});
        paper.forEach(function (q) { var e = ans[q.question_id]; r.push(e ? U.num(e.g) : ''); });
      }
      rows.push(r);
    });
    var safe = (c.code + '-' + String(s.title || s.mode)).replace(/[^A-Za-z0-9ก-๙._-]+/g, '_').substring(0, 80);
    Audit.log(actor.email, 'round.exportCsv', s.session_id, { rows: atts.length });
    return { filename: safe + '-results.csv', csv: U.toCsv(rows) };
  }
};
