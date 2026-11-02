/* HBT Core — ลบข้อมูลสิ้นภาคเรียน (ผู้ดูแลระบบ)
 * ลบ "ถาวร" ทีละวิชา: รายชื่อ · เช็คชื่อ · คะแนน · งานและไฟล์ใน Drive · ข้อสอบ/ผลสอบ/รูปในระบบสอบ
 * คำเตือนวิชาที่ยังไม่ได้สำรอง/สำรองไม่ทันข้อมูลล่าสุด (ผู้ดูแลยังกดลบต่อได้) · ลบค้างกลางทางทำต่อได้ */
HBT.page({ active: 'reset', need: 'admin', crumbs: [['ผู้ดูแล', 't/home.html'], ['ลบข้อมูลสิ้นภาคเรียน']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, $$ = HBT.$$, root = HBT.api.root();
  var terms = [], pv = null, termId = '', busy = false, queue = [];

  ctx.content.insertAdjacentHTML('beforeend',
    '<div class="page-h"><div class="stack-s"><h1>ลบข้อมูลสิ้นภาคเรียน</h1><p class="muted">ล้างข้อมูลวิชาที่จบแล้วเพื่อคืนพื้นที่และลดข้อมูลส่วนบุคคลที่ไม่จำเป็น</p></div></div>' +
    '<div class="callout bad"><b>การลบเป็นถาวร — ไม่มีถังขยะและกู้คืนไม่ได้</b><br>ไฟล์ใน Drive ถูกลบทิ้งจริง · ควรให้อาจารย์เจ้าของวิชากด “สำรองข้อมูล” ก่อนทุกครั้ง</div>' +
    '<section class="card stack"><div class="grid g3"><div class="field"><label for="rsTerm">ภาคเรียน</label><select id="rsTerm"></select></div></div>' +
    '<div id="rsBody"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div></section>' +
    '<section class="card stack" id="rsPinCard"><h3>PIN นักศึกษาที่ไม่เหลือในวิชาใด</h3>' +
    '<p class="small muted">PIN และเครื่องที่จำไว้ผูกกับรหัสนักศึกษา ไม่ถูกลบตอนลบวิชา (นักศึกษาคนเดิมเรียนวิชาอื่นต่อได้) · ใช้ปุ่มนี้ล้าง PIN ของคนที่ไม่เหลืออยู่ในวิชาใดเลย</p>' +
    '<div class="row"><button class="btn" type="button" id="pinDry">ตรวจจำนวน</button><button class="btn danger" type="button" id="pinDel" hidden>ลบ PIN ที่ไม่มีวิชา</button><span class="small" id="pinOut"></span></div></section>' +
    '<div class="modal" id="mDel" hidden role="dialog" aria-modal="true" aria-labelledby="mDelT"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="mDelT">ยืนยันการลบถาวร</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div id="mDelList" class="small"></div><div id="mDelWarn"></div>' +
    '<div class="field"><label for="rsConfirm" id="rsConfirmLbl">พิมพ์เพื่อยืนยัน</label><input id="rsConfirm" type="text" autocomplete="off"></div>' +
    '<div class="err" id="mDelErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn danger" type="button" id="rsGo" disabled>ลบถาวร</button></div></div></div>' +
    '<div class="modal" id="mTerm" hidden role="dialog" aria-modal="true" aria-labelledby="mTermT"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="mTermT">ลบภาคเรียนที่ว่างเปล่า</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="field"><label for="rtConfirm" id="rtLbl"></label><input id="rtConfirm" type="text" autocomplete="off"></div><div class="err" id="mTermErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn danger" type="button" id="rtGo">ลบภาคเรียน</button></div></div></div>');

  function stateOf(c) { return c.backupState; }
  var ST = { empty: ['ไม่มีข้อมูล', ''], none: ['ยังไม่สำรอง', 'bad'], stale: ['สำรองแล้วแต่มีแก้ไขภายหลัง', 'warn'], ok: ['สำรองครบ', 'good'] };
  function norm(s) { return String(s || '').replace(/\s+/g, '').toUpperCase(); }
  function ctext(c) { return (c.code + '-' + c.section); }
  function sel() { return pv.courses.filter(function (c) { return $('[data-pick="' + c.courseId + '"]') && $('[data-pick="' + c.courseId + '"]').checked; }); }

  /* ---------- ภาคเรียน ---------- */
  function loadTerms() {
    return HBT.api.call('term.list').then(function (r) {
      terms = r.terms;
      $('#rsTerm').innerHTML = terms.map(function (t) { return '<option value="' + esc(t.termId) + '"' + (t.isCurrent ? ' selected' : '') + '>' + esc(t.name) + (t.isCurrent ? ' (ปัจจุบัน)' : '') + '</option>'; }).join('');
      var cur = terms.filter(function (t) { return t.isCurrent; })[0];
      termId = (cur || terms[0] || {}).termId || '';
      return termId ? loadPreview() : ($('#rsBody').innerHTML = '<div class="callout warn">ยังไม่มีภาคเรียน</div>');
    }, function (e) { $('#rsBody').innerHTML = '<div class="callout bad">' + esc(HBT.errMsg(e)) + '</div>'; });
  }
  $('#rsTerm').addEventListener('change', function () { if (busy) { this.value = termId; return; } termId = this.value; loadPreview(); });

  function loadPreview() {
    $('#rsBody').innerHTML = '<div class="loading"><span class="spin"></span> กำลังโหลด…</div>';
    return HBT.api.call('reset.preview', { termId: termId }).then(function (r) { pv = r; renderBody(); }, function (e) {
      $('#rsBody').innerHTML = '<div class="callout bad">' + esc(HBT.errMsg(e)) + '</div><div class="row" style="margin-top:8px"><button class="btn" type="button" id="rsReload">ลองใหม่</button></div>';
      $('#rsReload').addEventListener('click', loadPreview);
    });
  }

  function examTxt(c) {
    var e = c.exam;
    if (!e) return pv.examConfigured ? '—' : 'ไม่ได้ใช้';
    return e.quizzes + ' ชุด · ' + e.rounds + ' รอบ · ' + e.attempts + ' ครั้งทำ' + (e.images ? ' · ' + e.images + ' รูป' : '');
  }

  function renderBody() {
    var cs = pv.courses;
    if (!cs.length) {
      $('#rsBody').innerHTML = '<p class="muted" id="rsEmpty">ภาคเรียน ' + esc(pv.term.name) + ' ไม่มีรายวิชา</p>' + termCard();
      bindTerm(); return;
    }
    $('#rsBody').innerHTML =
      (pv.term.isCurrent ? '<div class="callout warn small" id="rsCurNote"><b>นี่คือภาคเรียนปัจจุบัน</b> — การลบวิชาจะทำให้อาจารย์และนักศึกษาของวิชานั้นใช้งานต่อไม่ได้ทันที</div>' : '') +
      (pv.examError ? '<div class="callout bad small" id="rsExamErr"><b>ติดต่อระบบสอบออนไลน์ไม่ได้</b> (' + esc(pv.examError) + ') — การลบจะถูกปฏิเสธจนกว่าระบบสอบจะกลับมา เพื่อไม่ให้ข้อมูลฝั่งสอบตกค้าง</div>' : '') +
      '<div class="row"><button class="btn sm" type="button" id="pickOk">เลือกที่สำรองครบ</button><button class="btn sm" type="button" id="pickAll">เลือกทั้งหมด</button><button class="btn sm ghost" type="button" id="pickNone">ไม่เลือก</button></div>' +
      '<div class="scroll"><table id="rsTbl"><thead><tr><th></th><th>วิชา</th><th>อาจารย์</th><th>ข้อมูล</th><th>สอบออนไลน์</th><th>สำรอง</th></tr></thead><tbody>' +
      cs.map(function (c) {
        var s = ST[stateOf(c)] || ST.none;
        return '<tr data-course="' + esc(c.courseId) + '"><td><input type="checkbox" data-pick="' + esc(c.courseId) + '" aria-label="เลือก ' + esc(ctext(c)) + '"></td>' +
          '<td><b>' + esc(ctext(c)) + '</b><div class="small muted">' + esc(c.name) + '</div></td>' +
          '<td class="small">' + esc(c.ownerName || c.ownerEmail) + '</td>' +
          '<td class="small">' + c.students + ' นศ. · ' + c.attSessions + ' คาบ · ' + c.assignments + ' งาน (' + c.files + ' ไฟล์, ' + fmtSz(c.bytes) + ')</td>' +
          '<td class="small">' + esc(examTxt(c)) + '</td>' +
          '<td><span class="pill ' + s[1] + '" data-bk="' + esc(stateOf(c)) + '">' + esc(s[0]) + '</span>' +
          (c.backupAt ? '<div class="small muted">' + esc(HBT.fmtBE(c.backupAt, true)) + '</div>' : '') +
          (c.resetting ? '<div><span class="pill bad" data-resetting>ลบค้างอยู่ — ทำต่อได้</span></div>' : '') +
          '<div><a class="small" href="' + root + 't/backup.html?id=' + encodeURIComponent(c.courseId) + '">เปิดหน้าสำรอง</a></div></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<div id="rsWarn"></div>' +
      '<div class="row"><button class="btn danger" type="button" id="rsDelete" disabled>ลบวิชาที่เลือก…</button><span class="small muted" id="rsSelN">ยังไม่ได้เลือก</span></div>' +
      '<div id="rsLog" class="stack-s" aria-live="polite"></div>' + termCard();
    $$('[data-pick]').forEach(function (b) { b.addEventListener('change', onPick); });
    $('#pickAll').addEventListener('click', function () { $$('[data-pick]').forEach(function (b) { b.checked = true; }); onPick(); });
    $('#pickNone').addEventListener('click', function () { $$('[data-pick]').forEach(function (b) { b.checked = false; }); onPick(); });
    $('#pickOk').addEventListener('click', function () {
      pv.courses.forEach(function (c) { $('[data-pick="' + c.courseId + '"]').checked = (c.backupState === 'ok' || c.backupState === 'empty'); }); onPick();
    });
    $('#rsDelete').addEventListener('click', openConfirm);
    bindTerm();
  }
  function fmtSz(n) { n = Number(n) || 0; return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }

  function unsafe(list) { return list.filter(function (c) { return c.backupState === 'none' || c.backupState === 'stale'; }); }

  function onPick() {
    var l = sel(), bad = unsafe(l);
    $('#rsSelN').textContent = l.length ? 'เลือก ' + l.length + ' วิชา' : 'ยังไม่ได้เลือก';
    $('#rsDelete').disabled = busy || !l.length;
    $('#rsWarn').innerHTML = bad.length
      ? '<div class="callout warn" id="rsUnsafe"><b>ยังไม่ได้สำรอง/สำรองไม่ทันข้อมูลล่าสุด ' + bad.length + ' วิชา</b><ul style="margin:6px 0 0 18px">' +
        bad.map(function (c) { return '<li>' + esc(ctext(c)) + ' — ' + esc(c.ownerName || c.ownerEmail) + ' (' + (c.backupState === 'none' ? 'ยังไม่เคยสำรอง' : 'มีแก้ไขหลังสำรอง') + ')</li>'; }).join('') +
        '</ul><div class="small" style="margin-top:6px">ถ้าลบตอนนี้ ข้อมูลของวิชาเหล่านี้จะหายถาวร</div></div>' : '';
  }

  /* ---------- ยืนยันลบ ---------- */
  var expect = '';
  function openConfirm() {
    var l = sel(); if (!l.length) return;
    var bad = unsafe(l);
    expect = l.length === 1 ? ctext(l[0]) : pv.term.name;
    $('#mDelList').innerHTML = '<p>จะลบถาวร ' + l.length + ' วิชา:</p><ul style="margin:4px 0 0 18px">' + l.map(function (c) { return '<li>' + esc(ctext(c)) + ' — ' + esc(c.name) + '</li>'; }).join('') + '</ul>';
    $('#mDelWarn').innerHTML = bad.length ? '<div class="callout warn small"><b>' + bad.length + ' วิชายังไม่ได้สำรองครบ:</b> ' + bad.map(function (c) { return esc(ctext(c)); }).join(', ') + '</div>' : '';
    $('#rsConfirmLbl').innerHTML = (l.length === 1 ? 'พิมพ์รหัสวิชา-กลุ่ม ' : 'พิมพ์ชื่อภาคเรียน ') + '<b>' + esc(expect) + '</b> เพื่อยืนยัน';
    $('#rsConfirm').value = ''; $('#rsGo').disabled = true; $('#mDelErr').textContent = '';
    queue = l.map(function (c) { return { c: c, status: 'wait', note: '' }; });
    HBT.modal.open('mDel');
  }
  $('#rsConfirm').addEventListener('input', function () { $('#rsGo').disabled = norm(this.value) !== norm(expect); });
  $('#rsGo').addEventListener('click', function () { HBT.modal.close('mDel'); startRun(); });

  /* ---------- ลบทีละวิชา (ทำต่อได้) ---------- */
  function logHtml() {
    return '<h3>ความคืบหน้า</h3>' + queue.map(function (q, i) {
      var l = { wait: ['รอคิว', ''], run: ['กำลังลบ…', 'info'], done: ['ลบแล้ว', 'good'], err: ['ผิดพลาด', 'bad'] }[q.status];
      return '<div class="card stack-s" data-rs="' + esc(q.c.courseId) + '" data-rs-status="' + q.status + '"><div class="row sp"><b>' + esc(ctext(q.c)) + '</b><span class="pill ' + l[1] + '">' + l[0] + '</span></div>' +
        '<div class="small' + (q.status === 'err' ? '' : ' muted') + '">' + esc(q.note) + '</div></div>';
    }).join('') + '<div id="rsRetryBox"></div>';
  }
  var PH = { students: 'ลบรายชื่อ', exam: 'ลบข้อสอบและรูป', drive: 'ลบไฟล์งานใน Drive', rows: 'ลบข้อมูลในตาราง', done: 'เสร็จ' };

  function startRun() {
    busy = true; $('#rsDelete').disabled = true; $('#rsTerm').disabled = true;
    $('#rsLog').innerHTML = logHtml();
    runQueue();
  }
  function paintQ(q) {
    var el = $('[data-rs="' + q.c.courseId + '"]'); if (!el) return;
    var l = { wait: ['รอคิว', ''], run: ['กำลังลบ…', 'info'], done: ['ลบแล้ว', 'good'], err: ['ผิดพลาด', 'bad'] }[q.status];
    el.setAttribute('data-rs-status', q.status);
    var p = $('.pill', el); p.className = 'pill ' + l[1]; p.textContent = l[0];
    var n = $('.small', el); n.textContent = q.note; n.className = 'small' + (q.status === 'err' ? '' : ' muted');
  }
  function one(q, loops) {
    q.status = 'run'; paintQ(q);
    var conf = ctext(q.c);
    return HBT.api.call('reset.course', { courseId: q.c.courseId, confirm: conf }).then(function (r) {
      q.note = PH[r.phase] || r.phase; paintQ(q);
      q.drive = q.drive || { deleted: 0, trashed: 0 }; q.drive.deleted += r.drive.deleted; q.drive.trashed += r.drive.trashed;
      if (r.exam) { q.exam = q.exam || { images: 0, trashed: 0 }; q.exam.images += r.exam.images || 0; q.exam.trashed += r.exam.trashed || 0; }
      if (!r.done) { if (loops > 60) throw new Error('ใช้เวลานานผิดปกติ — กดลองต่อ'); return one(q, loops + 1); }
      q.status = 'done';
      var warn = [];
      if (q.drive.trashed || (q.exam && q.exam.trashed)) warn.push('⚠ ลบไม่ขาดอย่างถาวร ' + (q.drive.trashed + (q.exam ? q.exam.trashed : 0)) + ' รายการ (อยู่ในถังขยะ Drive — เปิด Drive advanced service แล้วลบซ้ำ หรือล้างถังขยะเอง)');
      q.note = 'ลบเรียบร้อย · ไฟล์ Drive ' + (q.drive.deleted + q.drive.trashed) + ' โฟลเดอร์' + (q.exam ? ' · รูปข้อสอบ ' + (q.exam.images) : '') + (warn.length ? ' · ' + warn.join(' ') : '');
      q.trashed = !!warn.length;
      paintQ(q);
    });
  }
  function runQueue() {
    var p = Promise.resolve(), failed = false;
    queue.forEach(function (q) {
      if (q.status === 'done') return;
      p = p.then(function () {
        if (failed) return;
        return one(q, 0).catch(function (e) {
          failed = true; q.status = 'err'; q.note = HBT.errMsg(e) + (e.code === 'E_EXAM_DOWN' ? ' — ยังไม่ได้ลบอะไรของวิชานี้' : ' — ข้อมูลที่ลบไปแล้วไม่กลับมา กดทำต่อเพื่อลบส่วนที่เหลือ'); paintQ(q);
        });
      });
    });
    return p.then(function () {
      var left = queue.filter(function (q) { return q.status !== 'done'; });
      if (left.length) {
        queue.forEach(function (q) { if (q.status === 'run') q.status = 'wait'; });
        $('#rsRetryBox').innerHTML = '<div class="row"><button class="btn primary" type="button" id="rsRetry">ทำต่อ (' + left.length + ' วิชาที่เหลือ)</button></div>';
        $('#rsRetry').addEventListener('click', function () { $('#rsRetryBox').innerHTML = ''; runQueue(); });
        return;
      }
      busy = false; $('#rsTerm').disabled = false;
      HBT.toast('ลบเรียบร้อย ' + queue.length + ' วิชา', 'good');
      var warnN = queue.filter(function (q) { return q.trashed; }).length;
      $('#rsRetryBox').innerHTML = '<div class="callout ' + (warnN ? 'warn' : 'good') + '" id="rsDoneBox"><b>ลบเสร็จ ' + queue.length + ' วิชา</b>' + (warnN ? ' — ' + warnN + ' วิชามีไฟล์ที่ค้างในถังขยะ Drive' : '') + '</div>' +
        '<div class="row"><button class="btn" type="button" id="rsRefresh">รีเฟรชรายการ</button></div>';
      $('#rsRefresh').addEventListener('click', function () { loadPreview().then(function () { }); });
    });
  }

  /* ---------- ลบภาคเรียนที่ว่าง ---------- */
  function termCard() {
    if (!pv || pv.term.isCurrent || pv.courses.length) return '';
    return '<div class="hint-box stack-s" id="rsTermCard"><b class="small">ภาคเรียนนี้ว่างเปล่าแล้ว</b><p class="small muted">ลบชื่อภาคเรียนออกจากรายการ (ภาคเรียนปัจจุบันลบไม่ได้)</p><div class="row"><button class="btn sm danger" type="button" id="rtOpen">ลบภาคเรียน ' + esc(pv.term.name) + '</button></div></div>';
  }
  function bindTerm() {
    var b = $('#rtOpen'); if (!b) return;
    b.addEventListener('click', function () {
      $('#rtLbl').innerHTML = 'พิมพ์ชื่อภาคเรียน <b>' + esc(pv.term.name) + '</b> เพื่อยืนยัน'; $('#rtConfirm').value = ''; $('#mTermErr').textContent = '';
      HBT.modal.open('mTerm');
    });
  }
  $('#rtGo').addEventListener('click', function () {
    var b = this;
    HBT.busy(b, function () {
      return HBT.api.call('reset.term', { termId: pv.term.termId, confirm: $('#rtConfirm').value.trim() }, {}).then(function () {
        HBT.modal.close('mTerm'); HBT.toast('ลบภาคเรียนแล้ว', 'good'); return loadTerms();
      });
    }).catch(function (e) { $('#mTermErr').textContent = HBT.errMsg(e); });
  });

  /* ---------- PIN ที่ไม่มีวิชา ---------- */
  $('#pinDry').addEventListener('click', function () {
    HBT.busy(this, function () {
      return HBT.api.call('reset.pins', { dryRun: true }).then(function (r) {
        $('#pinOut').textContent = r.orphans ? 'พบ PIN ของนักศึกษาที่ไม่มีวิชาแล้ว ' + r.orphans + ' คน' : 'ไม่มี PIN ที่ต้องลบ';
        $('#pinDel').hidden = !r.orphans; $('#pinDel').setAttribute('data-n', r.orphans);
      });
    }).catch(function (e) { $('#pinOut').textContent = HBT.errMsg(e); });
  });
  $('#pinDel').addEventListener('click', function () {
    var n = this.getAttribute('data-n');
    if (!window.confirm('ลบ PIN ของนักศึกษา ' + n + ' คนที่ไม่เหลืออยู่ในวิชาใดเลยถาวร?')) return;
    HBT.busy(this, function () {
      return HBT.api.call('reset.pins', {}).then(function (r) {
        $('#pinOut').textContent = 'ลบ PIN ' + r.removedPin + ' รายการ · เครื่องที่จำไว้ ' + r.removedDevices + ' รายการ';
        $('#pinDel').hidden = true;
      });
    }).catch(function (e) { $('#pinOut').textContent = HBT.errMsg(e); });
  });

  loadTerms();
});
