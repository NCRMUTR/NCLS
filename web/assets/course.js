/* HBT Core — ภาพรวมรายวิชา */
HBT.page({ active: 'courses', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['รายวิชา']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var id = HBT.qs('id');
  var course = null;

  if (!id) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบรายวิชา</b><br>กลับไปเลือกรายวิชาจากหน้ารายวิชาของฉัน</div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>');
    return;
  }

  ctx.content.insertAdjacentHTML('beforeend', '<div id="box"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +
    '<div class="modal" id="mEdit" hidden role="dialog" aria-modal="true" aria-labelledby="mTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="mTitle">แก้ไขรายวิชา</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="field"><label for="cc">รหัสวิชา</label><input id="cc" type="text" maxlength="20" autocomplete="off"></div>' +
    '<div class="field"><label for="cn">ชื่อวิชา</label><input id="cn" type="text" maxlength="150" autocomplete="off"></div>' +
    '<div class="field"><label for="cs">กลุ่มเรียน</label><input id="cs" type="text" maxlength="10" autocomplete="off"></div>' +
    '<div class="err" id="mErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="saveBtn">บันทึก</button></div>' +
    '</div></div>' +
    '<div class="modal" id="mDel" hidden role="dialog" aria-modal="true" aria-labelledby="mDelT"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="mDelT">ลบรายวิชา</h2><button class="btn sm ghost" data-close type="button" id="delX">ปิด</button></div>' +
    '<div class="callout bad"><b>ลบถาวร — ไม่มีถังขยะ กู้คืนไม่ได้</b><br>รายชื่อนักศึกษา · เช็คชื่อ · คะแนน · งานและไฟล์ใน Drive · ข้อสอบ ผลสอบ และรูป จะหายทั้งหมด และนักศึกษาจะเข้าวิชานี้ไม่ได้ทันที</div>' +
    '<div id="delInfo"></div>' +
    '<div class="field"><label for="delConfirm" id="delLbl">พิมพ์เพื่อยืนยัน</label><input id="delConfirm" type="text" autocomplete="off"></div>' +
    '<div class="small muted" id="delProg" aria-live="polite"></div>' +
    '<div class="err" id="delErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button" id="delCancel">ยกเลิก</button><button class="btn danger" type="button" id="delGo" disabled>ลบรายวิชาถาวร</button></div>' +
    '</div></div>');

  function backupPill(c) {
    if (!c.backupAt) return '<span class="pill warn" id="bkPill">ยังไม่เคยสำรอง</span>';
    var stale = String(c.lastChangeAt || '') > String(c.backupAt);
    return '<span class="pill ' + (stale ? 'warn' : 'good') + '" id="bkPill">' + (stale ? 'มีแก้ไขหลังสำรอง' : 'สำรองแล้ว') + ' · ' + esc(HBT.fmtBE(c.backupAt, true)) + '</span>';
  }

  function render() {
    var c = course, q = encodeURIComponent(c.courseId);
    document.title = c.code + ' — HBT Learning System';
    $('#box').innerHTML =
      '<div class="page-h"><div class="stack-s"><h1 id="cTitle">' + esc(c.code) + ' <span class="muted">กลุ่ม ' + esc(c.section) + '</span></h1>' +
      '<p>' + esc(c.name) + '</p><p class="small muted">ภาคเรียน ' + esc(c.termName) + (c.ownerEmail !== ctx.user.email ? ' · เจ้าของ ' + esc(c.ownerEmail) : '') + '</p></div>' +
      '<div class="row"><button class="btn" type="button" id="editBtn">แก้ไขข้อมูลวิชา</button></div></div>' +
      '<div class="grid g3" id="stats">' +
      '<div class="card"><span class="small muted">นักศึกษา</span><h2 id="stStudents">' + c.students + '</h2></div>' +
      '<div class="card"><span class="small muted">ตั้ง PIN แล้ว</span><h2 id="stPin">' + c.pinSet + ' / ' + c.students + '</h2></div>' +
      '<div class="card"><span class="small muted">ประเภทคะแนน</span><h2 id="stTypes">' + c.scoreTypes + '</h2></div></div>' +
      '<div class="grid g3">' +
      '<a class="card link-card" id="goStudents" href="' + root + 't/students.html?id=' + q + '"><h3>รายชื่อนักศึกษา</h3><p class="small muted">เพิ่ม/นำเข้าจาก CSV · ออกรหัสชั่วคราวให้ตั้ง PIN · ลบนักศึกษา</p><span class="arrow">เปิด ›</span></a>' +
      '<a class="card link-card" id="goScores" href="' + root + 't/scores.html?id=' + q + '"><h3>คะแนน</h3><p class="small muted">กำหนดประเภทคะแนนและน้ำหนัก · กรอก/วางจาก Excel · ส่งออก CSV</p><span class="arrow">เปิด ›</span></a>' +
      '<a class="card link-card" id="goBackup" href="' + root + 't/backup.html?id=' + q + '"><div class="row sp"><h3>สำรองข้อมูลวิชา</h3>' + backupPill(c) + '</div><p class="small muted">ดาวน์โหลดรายชื่อ คะแนน เช็คชื่อ ข้อสอบ และไฟล์งานของนักศึกษาเก็บไว้ก่อนสิ้นภาคเรียน</p><span class="arrow">เปิด ›</span></a>' +
      '</div>' +
      '<section class="stack"><h3>ระบบประจำวิชา</h3><div class="grid g3">' +
      ['att', 'exam', 'asg'].map(function (s) {
        var has = ctx.user.role === 'admin' || ctx.user.systems.indexOf(s) >= 0;
        if (has) {
          var gid = { att: 'goAtt', exam: 'goExam', asg: 'goAsg' }[s], page = { att: 't/att.html', exam: 't/exam.html', asg: 't/asg.html' }[s];
          return '<a class="card link-card" id="' + gid + '" href="' + root + page + '?id=' + q + '"><div class="row sp"><b>' + esc(HBT.SYSTEM_NAMES[s]) + '</b><span class="pill good">เปิดใช้</span></div><p class="small muted">' + esc(HBT.SYSTEM_DESC[s]) + '</p><span class="arrow">เปิด ›</span></a>';
        }
        return '<div class="card sys-off"><div class="row sp"><b>' + esc(HBT.SYSTEM_NAMES[s]) + '</b><span class="pill">ไม่มีสิทธิ์</span></div><p class="small muted">' + esc(HBT.SYSTEM_DESC[s]) + '</p></div>';
      }).join('') + '</div></section>' +
      '<section class="hint-box stack-s" id="dangerZone"><b class="small">ลบรายวิชา</b><p class="small muted">ใช้เมื่อสร้างผิดหรือไม่ใช้แล้ว · ควร “สำรองข้อมูลวิชา” ก่อน เพราะลบแล้วกู้คืนไม่ได้</p>' +
      '<div class="row"><button class="btn sm danger" type="button" id="delBtn">ลบรายวิชานี้…</button></div></section>';
    $('#delBtn').addEventListener('click', openDelete);
    $('#editBtn').addEventListener('click', function () {
      $('#cc').value = c.code; $('#cn').value = c.name; $('#cs').value = c.section; $('#mErr').textContent = '';
      HBT.modal.open('mEdit');
    });
  }

  /* ---------- ลบรายวิชา (ถาวร · ทีละช่วง · ทำต่อได้) ---------- */
  var delBusy = false, expect = '';
  function norm(s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); }
  function openDelete() {
    var c = course; expect = c.code + '-' + c.section;
    var stale = c.backupAt && String(c.lastChangeAt || '') > String(c.backupAt);
    $('#delInfo').innerHTML = '<p>จะลบ <b>' + esc(expect) + '</b> — ' + esc(c.name) + ' (นักศึกษา ' + c.students + ' คน)</p>' +
      (!c.backupAt ? '<div class="callout warn small" id="delNoBackup"><b>ยังไม่เคยสำรองข้อมูลวิชานี้</b> — <a href="' + root + 't/backup.html?id=' + encodeURIComponent(c.courseId) + '">ไปสำรองก่อน</a></div>'
        : stale ? '<div class="callout warn small" id="delStale"><b>มีการแก้ไขหลังสำรองครั้งล่าสุด</b> — <a href="' + root + 't/backup.html?id=' + encodeURIComponent(c.courseId) + '">สำรองใหม่</a></div>' : '');
    $('#delLbl').innerHTML = 'พิมพ์รหัสวิชา-กลุ่ม <b>' + esc(expect) + '</b> เพื่อยืนยัน';
    $('#delConfirm').value = ''; $('#delGo').disabled = true; $('#delErr').textContent = ''; $('#delProg').textContent = '';
    HBT.modal.open('mDel');
  }
  $('#delConfirm').addEventListener('input', function () { $('#delGo').disabled = delBusy || norm(this.value) !== norm(expect); });
  var PH = { students: 'ลบรายชื่อนักศึกษา…', exam: 'ลบข้อสอบและรูป…', drive: 'ลบไฟล์งานใน Drive…', rows: 'ลบข้อมูลในตาราง…', done: 'เสร็จ' };
  function delStep(loops) {
    return HBT.api.call('course.delete', { courseId: id, confirm: $('#delConfirm').value.trim() }).then(function (r) {
      $('#delProg').textContent = PH[r.phase] || r.phase || '';
      if (r.done) return r;
      if (loops > 60) throw new Error('ใช้เวลานานผิดปกติ — กดลบอีกครั้งเพื่อทำต่อ');
      return delStep(loops + 1);
    });
  }
  $('#delGo').addEventListener('click', function () {
    var b = this; if (delBusy) return;
    delBusy = true; $('#delConfirm').disabled = true; $('#delErr').textContent = ''; $('#delProg').textContent = 'กำลังลบ…';
    var old = b.textContent; b.disabled = true; b.textContent = 'กำลังลบ…';
    delStep(0).then(function () {
      HBT.toast('ลบรายวิชาแล้ว', 'good');
      location.replace(root + 't/courses.html');
    }).catch(function (e) {
      delBusy = false; b.textContent = old; $('#delProg').textContent = ''; $('#delConfirm').disabled = false; $('#delGo').disabled = norm($('#delConfirm').value) !== norm(expect);
      $('#delErr').textContent = HBT.errMsg(e) + (e.code === 'E_EXAM_DOWN' ? ' — ยังไม่ได้ลบอะไร' : e.code === 'E_RESET_CONFIRM' ? '' : ' — ข้อมูลที่ลบไปแล้วไม่กลับมา กดลบอีกครั้งเพื่อทำต่อ');
    });
  });

  function load() {
    return HBT.api.call('course.get', { courseId: id }).then(function (c) { course = c; render(); }, function (e) {
      var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN';
      $('#box').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบรายวิชานี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
        '<div class="row" style="margin-top:10px">' + (nf ? '' : '<button class="btn" type="button" id="reload">ลองใหม่</button>') +
        '<a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>';
      var rb = $('#reload'); if (rb) rb.addEventListener('click', load);
    });
  }

  $('#saveBtn').addEventListener('click', function () {
    var b = this, p = { courseId: id, code: $('#cc').value.trim(), name: $('#cn').value.trim(), section: $('#cs').value.trim() };
    $('#mErr').textContent = '';
    if (!p.code || !p.name || !p.section) { $('#mErr').textContent = 'กรุณากรอกให้ครบทุกช่อง'; return; }
    HBT.busy(b, function () {
      return HBT.api.call('course.update', p, { write: true }).then(function () {
        HBT.modal.close('mEdit'); HBT.toast('บันทึกแล้ว', 'good'); return load();
      });
    }).catch(function (er) { $('#mErr').textContent = HBT.errMsg(er); });
  });

  load();
});
