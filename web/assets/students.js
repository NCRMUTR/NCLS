/* HBT Core — รายชื่อนักศึกษาในรายวิชา */
HBT.page({ active: 'courses', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['นักศึกษา']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var id = HBT.qs('id');
  var data = null;          // ผลจาก student.list
  var editing = null;       // stdId ที่กำลังแก้ชื่อ (null = เพิ่มใหม่)
  var pending = null;       // การกระทำที่รอยืนยัน
  var preview = null;       // ผลตรวจก่อนนำเข้าล่าสุด

  if (!id) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบรายวิชา</b></div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>');
    return;
  }
  var PIN_LABEL = { none: ['ยังไม่ตั้ง PIN', ''], temp: ['รอตั้งด้วยรหัสชั่วคราว', 'warn'], set: ['ตั้ง PIN แล้ว', 'good'] };

  ctx.content.insertAdjacentHTML('beforeend',
    '<div id="head"></div>' +
    '<div class="row sp" id="toolbar" hidden>' +
    '<div class="field grow" style="max-width:340px"><label class="sr" for="q">ค้นหา</label><input id="q" type="search" placeholder="ค้นหารหัสหรือชื่อ" autocomplete="off"></div>' +
    '<div class="row"><button class="btn" type="button" id="addBtn">เพิ่มนักศึกษา</button><button class="btn" type="button" id="impBtn">นำเข้า CSV</button>' +
    '<button class="btn primary" type="button" id="allBtn">ออกรหัสให้คนที่ยังไม่ตั้ง PIN</button></div></div>' +
    '<div id="listBox"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +

    /* เพิ่ม/แก้ไข */
    '<div class="modal" id="mStd" hidden role="dialog" aria-modal="true" aria-labelledby="sTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="sTitle">เพิ่มนักศึกษา</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="field"><label for="sid">รหัสนักศึกษา</label><input id="sid" type="text" maxlength="20" autocomplete="off" inputmode="text"><span class="help">ตัวอักษรอังกฤษ ตัวเลข หรือ - ยาว 4–20 ตัว</span></div>' +
    '<div class="field"><label for="snm">ชื่อ-นามสกุล</label><input id="snm" type="text" maxlength="120" autocomplete="off"></div>' +
    '<div class="err" id="sErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="sSave">บันทึก</button></div></div></div>' +

    /* นำเข้า */
    '<div class="modal" id="mImp" hidden role="dialog" aria-modal="true" aria-labelledby="iTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="iTitle">นำเข้ารายชื่อจาก CSV</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<p class="small muted">คอลัมน์แรก = รหัสนักศึกษา · คอลัมน์ถัดไป = ชื่อ (ถ้าแยกชื่อ/นามสกุลจะต่อกันให้) · แถวแรกเป็นหัวตารางได้ · คัดลอกจาก Excel มาวางได้เลย</p>' +
    '<div class="field"><label for="iFile">เลือกไฟล์ (.csv / .txt — แนะนำ UTF-8)</label><input id="iFile" type="file" accept=".csv,.txt,text/csv,text/plain"></div>' +
    '<div class="field"><label for="iText">หรือวางข้อมูลที่นี่</label><textarea id="iText" rows="6" spellcheck="false" placeholder="6601001&#9;สมชาย ใจดี"></textarea></div>' +
    '<div class="stack-s"><span class="lbl">วิธีนำเข้า</span>' +
    '<label class="check"><input type="radio" name="iMode" value="merge" checked><span><b>เพิ่มและอัปเดต</b><br><span class="small muted">เพิ่มคนใหม่ แก้ชื่อคนเดิม ไม่ลบใคร</span></span></label>' +
    '<label class="check"><input type="radio" name="iMode" value="replace"><span><b>แทนที่ทั้งรายชื่อ</b><br><span class="small muted">คนที่ไม่อยู่ในไฟล์จะถูกลบถาวร พร้อมคะแนนของเขาในวิชานี้</span></span></label></div>' +
    '<div id="iPrev"></div><div class="err" id="iErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ปิด</button>' +
    '<button class="btn" type="button" id="iCheck">ตรวจสอบก่อนนำเข้า</button><button class="btn primary" type="button" id="iGo" disabled>ยืนยันนำเข้า</button></div></div></div>' +

    /* รหัสชั่วคราว */
    '<div class="modal" id="mCodes" hidden role="dialog" aria-modal="true" aria-labelledby="kTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="kTitle">รหัสชั่วคราว</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="callout warn" id="kWarn"></div><div id="kBody"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn" type="button" id="kCsv">ดาวน์โหลด CSV</button><button class="btn primary" data-close type="button">เสร็จสิ้น</button></div></div></div>' +

    /* ยืนยัน */
    '<div class="modal" id="mConf" hidden role="dialog" aria-modal="true" aria-labelledby="cTitle"><div class="mbox stack">' +
    '<h2 id="cTitle">ยืนยัน</h2><div id="cBody"></div><div class="err" id="cErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn danger" type="button" id="cGo">ยืนยัน</button></div></div></div>');

  function counts() {
    var c = data.counts;
    return '<div class="row" id="counts"><span class="pill info">ทั้งหมด ' + c.total + ' คน</span><span class="pill good">ตั้ง PIN แล้ว ' + c.set + '</span>' +
      '<span class="pill warn">รอตั้งด้วยรหัสชั่วคราว ' + c.temp + '</span><span class="pill">ยังไม่ตั้ง ' + c.none + '</span>' +
      (c.requests ? '<span class="pill bad">ขอรีเซ็ต PIN ' + c.requests + '</span>' : '') + '</div>';
  }

  function renderHead() {
    var c = data.course;
    $('#head').innerHTML = '<div class="page-h"><div class="stack-s"><h1>นักศึกษา</h1><p>' + esc(c.code) + ' กลุ่ม ' + esc(c.section) + ' · ' + esc(c.name) + '</p></div>' +
      '<div class="row"><a class="btn sm" id="backCourse" href="' + root + 't/course.html?id=' + encodeURIComponent(id) + '">‹ กลับรายวิชา</a></div></div>' + counts();
    document.title = 'นักศึกษา ' + c.code + ' — HBT Teaching';
  }

  function renderList() {
    var q = $('#q').value.trim().toLowerCase();
    var rows = data.students.filter(function (s) { return !q || s.stdId.toLowerCase().indexOf(q) >= 0 || s.name.toLowerCase().indexOf(q) >= 0; });
    if (!data.students.length) {
      $('#listBox').innerHTML = '<div class="callout"><b>ยังไม่มีนักศึกษาในรายวิชานี้</b><br>กด “นำเข้า CSV” เพื่อนำเข้ารายชื่อทั้งห้อง หรือ “เพิ่มนักศึกษา” ทีละคน</div>';
      return;
    }
    if (!rows.length) { $('#listBox').innerHTML = '<div class="callout">ไม่พบรายชื่อที่ตรงกับ “' + esc($('#q').value) + '”</div>'; return; }
    $('#listBox').innerHTML = '<div class="scroll"><table id="stdTable"><thead><tr><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>PIN</th><th></th></tr></thead><tbody>' +
      rows.map(function (s) {
        var pl = PIN_LABEL[s.pinStatus] || PIN_LABEL.none;
        return '<tr data-std="' + esc(s.stdId) + '"><td class="mono">' + esc(s.stdId) + '</td><td>' + esc(s.name) + '</td>' +
          '<td><span class="pill ' + pl[1] + '">' + pl[0] + '</span>' + (s.resetRequested ? ' <span class="pill bad">ขอรีเซ็ต</span>' : '') + '</td>' +
          '<td><div class="tbl-actions"><button class="btn sm" type="button" data-act="edit">แก้ชื่อ</button>' +
          '<button class="btn sm" type="button" data-act="reset">' + (s.pinStatus === 'set' || s.pinStatus === 'temp' ? 'รีเซ็ต PIN' : 'ออกรหัส') + '</button>' +
          '<button class="btn sm ghost" type="button" data-act="del">ลบ</button></div></td></tr>';
      }).join('') + '</tbody></table></div>' +
      (rows.length !== data.students.length ? '<p class="help">แสดง ' + rows.length + ' จาก ' + data.students.length + ' คน</p>' : '');
  }

  function load() {
    return HBT.api.call('student.list', { courseId: id }).then(function (r) {
      data = r; $('#toolbar').hidden = false; renderHead(); renderList();
    }, function (e) {
      var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN';
      $('#listBox').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบรายวิชานี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดรายชื่อไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
        '<div class="row" style="margin-top:10px">' + (nf ? '' : '<button class="btn" type="button" id="reload">ลองใหม่</button>') + '<a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>';
      var rb = $('#reload'); if (rb) rb.addEventListener('click', load);
    });
  }

  /* ---------- เพิ่ม / แก้ชื่อ ---------- */
  function openStd(s) {
    editing = s ? s.stdId : null;
    $('#sTitle').textContent = s ? 'แก้ชื่อนักศึกษา' : 'เพิ่มนักศึกษา';
    $('#sid').value = s ? s.stdId : ''; $('#sid').disabled = !!s;
    $('#snm').value = s ? s.name : ''; $('#sErr').textContent = '';
    HBT.modal.open('mStd');
  }
  $('#addBtn').addEventListener('click', function () { openStd(null); });
  $('#sSave').addEventListener('click', function () {
    var b = this, stdId = $('#sid').value.trim(), name = $('#snm').value.trim();
    $('#sErr').textContent = '';
    if (!stdId) { $('#sErr').textContent = 'กรุณากรอกรหัสนักศึกษา'; return; }
    if (!name) { $('#sErr').textContent = 'กรุณากรอกชื่อ-นามสกุล'; return; }
    HBT.busy(b, function () {
      return HBT.api.call(editing ? 'student.update' : 'student.add', { courseId: id, stdId: stdId, name: name }, { write: true }).then(function () {
        HBT.modal.close('mStd'); HBT.toast(editing ? 'แก้ชื่อแล้ว' : 'เพิ่มนักศึกษาแล้ว', 'good'); return load();
      });
    }).catch(function (er) { $('#sErr').textContent = HBT.errMsg(er); });
  });

  /* ---------- ยืนยันทั่วไป ---------- */
  function confirmBox(title, html, label, danger, fn) {
    $('#cTitle').textContent = title; $('#cBody').innerHTML = html; $('#cErr').textContent = '';
    var g = $('#cGo'); g.textContent = label; g.className = 'btn ' + (danger ? 'danger' : 'primary');
    pending = fn;
    HBT.modal.open('mConf');
  }
  $('#cGo').addEventListener('click', function () {
    var b = this, fn = pending;
    if (!fn) return;
    HBT.busy(b, fn).then(function () { HBT.modal.close('mConf'); }).catch(function (er) { $('#cErr').textContent = HBT.errMsg(er); });
  });

  /* ---------- รหัสชั่วคราว ---------- */
  var lastCodes = null;
  function showCodes(r, title) {
    lastCodes = r;
    $('#kTitle').textContent = title || 'รหัสชั่วคราว';
    $('#kWarn').innerHTML = '<b>รหัสนี้แสดงครั้งเดียว</b> — ปิดหน้านี้แล้วดูซ้ำไม่ได้ (ระบบเก็บเฉพาะค่าแฮช) · ใช้ได้ครั้งเดียว หมดอายุ ' + esc(HBT.fmtBE(r.expiresAt, true)) +
      '<br>แจกให้นักศึกษาไปตั้ง PIN เองที่หน้า “ตั้ง/เปลี่ยน PIN”';
    $('#kBody').innerHTML = r.codes.length
      ? '<div class="scroll"><table id="codeTable"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>รหัสชั่วคราว</th></tr></thead><tbody>' +
        r.codes.map(function (c) { return '<tr><td class="mono">' + esc(c.stdId) + '</td><td>' + esc(c.name) + '</td><td class="mono"><b>' + esc(c.pin) + '</b></td></tr>'; }).join('') + '</tbody></table></div>' +
        (r.skipped ? '<p class="help">ข้าม ' + r.skipped + ' คนที่ตั้ง PIN แล้วหรือมีรหัสชั่วคราวที่ยังใช้ได้อยู่</p>' : '')
      : '<div class="callout">ไม่มีใครที่ต้องออกรหัส (ทุกคนตั้ง PIN แล้ว หรือมีรหัสชั่วคราวที่ยังใช้ได้อยู่)</div>';
    $('#kCsv').hidden = !r.codes.length;
    HBT.modal.open('mCodes');
  }
  $('#kCsv').addEventListener('click', function () {
    if (!lastCodes) return;
    var rows = [['รหัสนักศึกษา', 'ชื่อ-นามสกุล', 'รหัสชั่วคราว']].concat(lastCodes.codes.map(function (c) { return [c.stdId, c.name, c.pin]; }));
    HBT.csv.download('temp-pin-' + (data.course.code || 'course') + '.csv', HBT.csv.build(rows));
  });
  $('#allBtn').addEventListener('click', function () {
    var b = this;
    HBT.busy(b, function () {
      return HBT.api.call('pin.issueTemp', { courseId: id, all: true }, { write: true }).then(function (r) { showCodes(r, 'รหัสชั่วคราวทั้งห้อง'); return load(); });
    }).catch(function (er) { HBT.toast(HBT.errMsg(er), 'bad'); });
  });

  /* ---------- ตารางรายคน ---------- */
  $('#listBox').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var std = b.closest('tr').getAttribute('data-std');
    var s = data.students.filter(function (x) { return x.stdId === std; })[0];
    if (!s) return;
    var act = b.getAttribute('data-act');
    if (act === 'edit') { openStd(s); return; }
    if (act === 'reset') {
      var doIssue = function () {
        return HBT.api.call('pin.issueTemp', { courseId: id, stdId: s.stdId }, { write: true }).then(function (r) { showCodes(r, 'รหัสชั่วคราวของ ' + s.name); return load(); });
      };
      if (s.pinStatus === 'none') { HBT.busy(b, doIssue).catch(function (er) { HBT.toast(HBT.errMsg(er), 'bad'); }); return; }
      confirmBox('รีเซ็ต PIN ของ ' + s.name + '?',
        '<p>PIN เดิมจะใช้ไม่ได้ทันที และ PIN นี้ใช้ร่วมกับทุกวิชา/ทุกระบบของนักศึกษาคนนี้ ระบบจะออกรหัสชั่วคราวใหม่ให้ไปตั้ง PIN เอง</p>',
        'รีเซ็ต PIN', true, function () { return doIssue(); });
      return;
    }
    if (act === 'del') {
      HBT.busy(b, function () {
        return HBT.api.call('student.impact', { courseId: id, stdId: s.stdId }).then(function (im) {
          var lines = im.items.filter(function (i) { return i.count > 0; }).map(function (i) { return '<li>' + esc(i.label) + ' ' + i.count + ' รายการ</li>'; }).join('');
          confirmBox('ลบ ' + im.name + ' (' + im.stdId + ') ออกจากรายวิชา?',
            '<p>การลบเป็น<b>ถาวร</b> ไม่มีถังขยะ ข้อมูลของเขาในวิชานี้ที่จะหายไปด้วย:</p>' +
            (lines ? '<ul id="impactList">' + lines + '</ul>' : '<p class="muted" id="impactNone">ไม่มีข้อมูลอื่นผูกอยู่</p>') +
            '<p class="small muted">PIN ของนักศึกษาไม่ถูกลบ (ใช้ในวิชาอื่นต่อได้)</p>',
            'ลบถาวร', true, function () {
              return HBT.api.call('student.remove', { courseId: id, stdId: s.stdId }, { write: true }).then(function () { HBT.toast('ลบแล้ว', 'good'); return load(); });
            });
        });
      }).catch(function (er) { HBT.toast(HBT.errMsg(er), 'bad'); });
    }
  });
  $('#q').addEventListener('input', function () { if (data) renderList(); });

  /* ---------- นำเข้า CSV ---------- */
  function mode() { return HBT.$$('input[name=iMode]').filter(function (r) { return r.checked; })[0].value; }
  function resetPreview() { preview = null; $('#iPrev').innerHTML = ''; $('#iGo').disabled = true; $('#iErr').textContent = ''; }
  function parsed() { return HBT.csv.parseRoster($('#iText').value); }

  $('#impBtn').addEventListener('click', function () {
    $('#iText').value = ''; $('#iFile').value = ''; HBT.$$('input[name=iMode]')[0].checked = true; resetPreview();
    HBT.modal.open('mImp');
  });
  $('#iText').addEventListener('input', resetPreview);
  HBT.$$('input[name=iMode]').forEach(function (r) { r.addEventListener('change', resetPreview); });
  $('#iFile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { $('#iErr').textContent = 'ไฟล์ใหญ่เกิน 2 MB'; return; }
    var fr = new FileReader();
    fr.onload = function () { $('#iText').value = String(fr.result || ''); resetPreview(); if (/\uFFFD/.test($('#iText').value)) $('#iErr').textContent = 'พบตัวอักษรอ่านไม่ออก — บันทึกไฟล์เป็น CSV UTF-8 จาก Excel แล้วลองใหม่'; };
    fr.onerror = function () { $('#iErr').textContent = 'อ่านไฟล์ไม่สำเร็จ'; };
    fr.readAsText(f, 'utf-8');
  });

  function prevHtml(p, real) {
    var h = '<div class="callout" id="iSum"><b>' + (real ? 'นำเข้าแล้ว' : 'ผลการตรวจสอบ (ยังไม่บันทึก)') + '</b><br>' +
      'เพิ่มใหม่ <b>' + p.added + '</b> · แก้ชื่อ <b>' + p.updated + '</b> · ไม่เปลี่ยน <b>' + p.unchanged + '</b>' + (p.removed || mode() === 'replace' ? ' · ลบ <b>' + p.removed + '</b>' : '') +
      (p.skippedCount ? ' · ข้าม <b>' + p.skippedCount + '</b> แถว' : '') + '</div>';
    if (p.removed && !real) {
      h += '<div class="callout bad" id="iRem"><b>จะถูกลบถาวร ' + p.removed + ' คน</b> (พร้อมคะแนนในวิชานี้)<br><span class="small">' +
        p.removedList.slice(0, 30).map(function (x) { return esc(x.stdId + ' ' + x.name); }).join(' · ') + (p.removed > 30 ? ' … และอีก ' + (p.removed - 30) : '') + '</span></div>';
    }
    if (p.skippedCount) {
      h += '<details id="iSkip"><summary class="small">ดูแถวที่ข้าม (' + p.skippedCount + ')</summary><ul class="small">' +
        p.skipped.slice(0, 50).map(function (x) { return '<li>แถว ' + x.row + (x.stdId ? ' (' + esc(x.stdId) + ')' : '') + ': ' + esc(x.why) + '</li>'; }).join('') + '</ul></details>';
    }
    return h;
  }
  function importArgs(dry) {
    var pr = parsed();
    return { courseId: id, rows: pr.rows, mode: mode(), dryRun: dry };
  }
  $('#iCheck').addEventListener('click', function () {
    var b = this, pr = parsed();
    $('#iErr').textContent = '';
    if (!pr.rows.length) { $('#iErr').textContent = 'ยังไม่มีข้อมูล — เลือกไฟล์หรือวางข้อมูลก่อน'; return; }
    if (pr.rows.length > 1000) { $('#iErr').textContent = 'นำเข้าได้ครั้งละไม่เกิน 1,000 แถว (ไฟล์นี้มี ' + pr.rows.length + ')'; return; }
    HBT.busy(b, function () {
      return HBT.api.call('student.importCsv', importArgs(true)).then(function (p) {
        preview = p; $('#iPrev').innerHTML = prevHtml(p, false);
        var any = p.added + p.updated + p.removed > 0;
        $('#iGo').disabled = !any;
        $('#iGo').textContent = mode() === 'replace' && p.removed ? 'ยืนยัน — ลบ ' + p.removed + ' คน แล้วนำเข้า' : 'ยืนยันนำเข้า';
        if (!any) $('#iErr').textContent = 'ไม่มีอะไรต้องเปลี่ยน';
      });
    }).catch(function (er) { $('#iErr').textContent = HBT.errMsg(er); });
  });
  $('#iGo').addEventListener('click', function () {
    var b = this;
    if (!preview) return;
    HBT.busy(b, function () {
      return HBT.api.call('student.importCsv', importArgs(false), { write: true }).then(function (p) {
        $('#iPrev').innerHTML = prevHtml(p, true); $('#iGo').disabled = true; preview = null;
        HBT.toast('นำเข้าแล้ว', 'good'); return load();
      });
    }).catch(function (er) { $('#iErr').textContent = HBT.errMsg(er); });
  });

  load();
});
