/**************************************************************
 * File: Sync.gs  (HBT Exam API v0.5.0) — ส่งคะแนนรอบสอบเข้าตารางคะแนนกลางของ Core (ประเภท EXAM)
 *
 * คะแนนของนักศึกษา 1 รอบ = course_score ของ "ครั้งที่ได้สูงสุด" ในบรรดาฉบับที่จบแล้ว
 * ส่งทั้งรอบเป็นชุดเดียว (Core เขียนทับ/ล้างคนที่ไม่มีคะแนนแล้วให้เอง) → ทำซ้ำกี่ครั้งก็ได้ผลเท่ากัน
 * เมื่อไหร่: ปิดรอบ · แก้เกณฑ์คะแนนของรอบ · กดซิงก์เอง · ตัวจับเวลา (รอบที่ปิดเอง/ซิงก์ค้าง)
 * ล้มเหลว (Core ล่ม) ไม่ทำให้งานหลักล้ม — บันทึกสถานะ ERR ไว้ให้หน้าเว็บเตือนและกดลองใหม่ได้
 * ห้ามเรียกขณะถือ lock (ดู CoreLink.gs)
 **************************************************************/

var Sync = {

  label: function (s) {
    var t = String(s.title || '').trim() || (s.mode === 'TEST' ? 'สอบ' : 'ฝึกทำ');
    return U.clip((s.mode === 'TEST' ? 'สอบ: ' : 'ฝึกทำ: ') + t, 60);
  },

  /** [{stdId, score}] — ครั้งที่ได้คะแนนเก็บสูงสุดของแต่ละคน */
  rowsOf: function (sessionId) {
    var best = {};
    Db.findRows('Attempts', 'session_id', sessionId).forEach(function (a) {
      if (a.status === 'IN_PROGRESS' || a.course_score === '') return;
      var v = U.num(a.course_score);
      if (best[a.std_id] === undefined || v > best[a.std_id]) best[a.std_id] = v;
    });
    return Object.keys(best).sort().map(function (id) { return { stdId: id, score: best[id] }; });
  },

  note_: function (sessionId, state, note) {
    try {
      U.lock(function () {
        Db.flush();
        var s = Db.byId('Rounds', sessionId);
        if (s && s.status !== 'DELETED') Db.update('Rounds', sessionId, { sync_state: state, sync_at: U.nowIso(), sync_note: U.clip(note, 250) });
        Op.invalidate(sessionId, s ? s.token : '');
      }, 30000);
    } catch (e) { /* บันทึกสถานะไม่ได้ก็ไม่เป็นไร */ }
  },

  /** ส่งคะแนนของรอบเข้า Core · คืน { state:'OK'|'SKIP'|'ERR', note } เสมอ (ไม่โยน error) */
  push: function (sessionId) {
    var out;
    try {
      var row = Db.byId('Rounds', sessionId);
      if (!row || row.status === 'DELETED') return { state: 'SKIP', note: 'ไม่พบรอบ' };
      var s = Op.clean(row);
      if ((s.score_mode || 'NONE') === 'NONE' || !(U.num(s.score_value) > 0)) {
        Core.removeRound(s.course_id, s.session_id);         // เคยตั้งไว้แล้วเปลี่ยนเป็นไม่บันทึก → เอาประเภทคะแนนออกจากวิชา
        out = { state: 'SKIP', note: 'ไม่ได้ตั้งให้บันทึกคะแนนเข้ารายวิชา' };
      } else {
        var rows = Sync.rowsOf(s.session_id);
        var r = Core.syncScores({ courseId: s.course_id, sessionId: s.session_id, name: Sync.label(s), max: U.num(s.score_value), rows: rows });
        out = { state: 'OK', note: 'บันทึกคะแนน ' + rows.length + ' คน' + (r && r.skippedCount ? ' (ข้าม ' + r.skippedCount + ')' : '') };
      }
    } catch (e) {
      out = { state: 'ERR', note: (e && e.message) ? String(e.message) : 'ส่งคะแนนไม่สำเร็จ' };
    }
    Sync.note_(sessionId, out.state, out.note);
    return out;
  },

  /** เอาประเภทคะแนนของรอบออกจาก Core (ลบรอบ) · คืน true เมื่อสำเร็จ */
  remove: function (courseId, sessionId) {
    try { Core.removeRound(courseId, sessionId); return true; } catch (e) {
      Audit.log('system', 'sync.removeFail', sessionId, String(e && e.message || e));
      return false;
    }
  }
};

/** ทำงานตามเวลา (ทุก 5 นาที): ปิดรอบที่เลยเวลา + ส่งคะแนนที่ยังค้าง */
function tick_() {
  var t0 = Date.now(), closed = [];
  try {
    closed = U.lock(function () { Db.flush(); return Op.autoCloseEnded(null, 10); }, 60000);
  } catch (e) { Audit.log('system', 'tick.closeFail', '', String(e && e.message || e)); }
  closed.forEach(function (id) { if (Date.now() - t0 < 240000) Sync.push(id); });
  var retry = Db.all('Rounds').filter(function (s) {
    return s.status === 'CLOSED' && s.sync_state === 'ERR' && closed.indexOf(s.session_id) < 0;
  }).slice(0, 5);
  retry.forEach(function (s) { if (Date.now() - t0 < 240000) Sync.push(s.session_id); });
  return { closed: closed.length, retried: retry.length };
}
