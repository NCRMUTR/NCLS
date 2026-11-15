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
    '<div class="row"><button class="btn" type="button" id="addBtn">เพิ่มนักศึกษา</button><button class="btn" type="button" id="impBtn">นำเข้า CSV</button>' +
    '<button class="btn primary" type="button" id="allBtn">ออกรหัสให้คนที่ยังไม่ตั้ง PIN</button></div></div>' +
    '<div class="row" id="tabs" role="tablist" hidden><button class="btn sm primary" type="button" role="tab" data-tab="list" id="tabList">รายชื่อ</button><button class="btn sm ghost" type="button" role="tab" data-tab="groups" id="tabGroups">กลุ่ม</button></div>' +
    '<div id="lkBar" hidden></div><div class="row" id="gfBar" hidden></div>' +
    '<div id="listBox"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +
    '<div id="grpBox" class="stack" hidden></div>' +

    /* ใส่เข้ากลุ่ม */
    '<div class="modal" id="mGrp" hidden role="dialog" aria-modal="true" aria-labelledby="gTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="gTitle">ใส่เข้ากลุ่ม</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<p class="small" id="gSel"></p>' +
    '<div class="field"><label for="gSelGroup">เลือกกลุ่ม</label><select id="gSelGroup"></select></div>' +
    '<div class="field" id="gNewWrap" hidden><label for="gNewName">ชื่อกลุ่มใหม่ (ไม่บังคับ)</label><input id="gNewName" type="text" maxlength="60" autocomplete="off"><span class="help">ลำดับกลุ่มระบบเติมให้เอง</span></div>' +
    '<div class="err" id="gErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="gGo">ใส่เข้ากลุ่ม</button></div></div></div>' +

    /* แบ่งกลุ่มอัตโนมัติ */
    '<div class="modal" id="mAuto" hidden role="dialog" aria-modal="true" aria-labelledby="aTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="aTitle">แบ่งกลุ่มอัตโนมัติ</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="field"><label for="aSize">จำนวนคนต่อกลุ่ม (ประมาณ)</label><input id="aSize" type="number" inputmode="numeric" min="1" max="100" step="1" value="5"><span class="help" id="aHelp"></span></div>' +
    '<div class="stack-s"><span class="lbl">วิธีเรียงคน</span>' +
    '<label class="check"><input type="radio" name="aOrder" value="id" checked><span>เรียงตามรหัสนักศึกษา</span></label>' +
    '<label class="check"><input type="radio" name="aOrder" value="random"><span>สุ่ม</span></label></div>' +
    '<div class="stack-s"><span class="lbl">ใครบ้าง</span>' +
    '<label class="check"><input type="radio" name="aScope" value="ungrouped" checked><span><b>เฉพาะคนที่ยังไม่มีกลุ่ม</b><br><span class="small muted">กลุ่มที่จัดไว้แล้วไม่ถูกแตะ — สร้างกลุ่มใหม่ต่อท้าย</span></span></label>' +
    '<label class="check"><input type="radio" name="aScope" value="all"><span><b>ทั้งห้อง (ล้างกลุ่มเดิมก่อน)</b><br><span class="small muted">ทำไม่ได้ถ้ามีกลุ่มที่ส่งงานแล้ว</span></span></label></div>' +
    '<div class="err" id="aErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="aGo">แบ่งกลุ่ม</button></div></div></div>' +

    /* วางกลุ่มจาก Excel */
    '<div class="modal" id="mGImp" hidden role="dialog" aria-modal="true" aria-labelledby="giTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="giTitle">วางรายชื่อกลุ่มจาก Excel</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<p class="small muted">คอลัมน์: <b>รหัสนักศึกษา · ลำดับกลุ่ม · ชื่อกลุ่ม (ไม่บังคับ)</b> — คัดลอกจาก Excel มาวางได้เลย (แถวหัวตารางข้ามให้) · กลุ่มที่ยังไม่มีระบบสร้างให้</p>' +
    '<div class="field"><label for="giText">วางข้อมูลที่นี่</label><textarea id="giText" rows="7" spellcheck="false" placeholder="6601001&#9;1&#9;ทีมสตาร์ท"></textarea></div>' +
    '<div id="giPrev"></div><div class="err" id="giErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ปิด</button>' +
    '<button class="btn" type="button" id="giCheck">ตรวจสอบก่อน</button><button class="btn primary" type="button" id="giGo" disabled>ยืนยัน</button></div></div></div>' +

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

  var PIN_ORD = { none: 1, temp: 2, set: 3 };
  var kit = HBT.listKit({
    id: function (s) { return s.stdId; },
    search: function (s) { return s.stdId + ' ' + s.name; },
    sorts: [
      { k: 'id', label: 'รหัสนักศึกษา', fn: function (s) { return s.stdId; } },
      { k: 'name', label: 'ชื่อ-นามสกุล', fn: function (s) { return s.name; } },
      { k: 'pin', label: 'สถานะ PIN (ยังไม่ตั้งก่อน)', fn: function (s) { return s.resetRequested ? 0 : (PIN_ORD[s.pinStatus] === undefined ? 1 : PIN_ORD[s.pinStatus]); } },
      { k: 'group', label: 'กลุ่ม (ยังไม่มีกลุ่มท้ายสุด)', fn: function (s) { return s.groupNo || 100000; } }
    ],
    sort: 'id', noun: 'คน',
    bulk: [
      { label: 'ใส่เข้ากลุ่ม…', cls: 'primary', run: function () { bulkGroup(); } },
      { label: 'นำออกจากกลุ่ม', run: function () { bulkUngroup(); } },
      { label: 'ออกรหัสชั่วคราวที่เลือก', run: function () { bulkIssue(); } },
      { label: 'ลบที่เลือก', cls: 'danger', run: function () { bulkDelete(); } }
    ]
  });
  kit.mount($('#lkBar'), function () { if (data) renderList(); });
  kit.bindList($('#listBox'));

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
    document.title = 'นักศึกษา ' + c.code + ' — HBT Learning System';
  }

  var tab = 'list', gf = 'all';          // แท็บที่เปิด · ตัวกรองกลุ่ม (all | none = ยังไม่มีกลุ่ม)
  function gInfo(no) { return no ? (data.groups.filter(function (g) { return g.groupNo === no; })[0] || null) : null; }
  function gLabel(no) { var g = gInfo(no); return g ? 'กลุ่ม ' + g.groupNo + (g.name ? ' · ' + g.name : '') : ''; }
  function ungrouped() { return data.students.filter(function (s) { return !s.groupNo; }); }

  function renderGf() {
    var n = ungrouped().length, show = tab === 'list' && data.groups.length > 0 && data.students.length > 0;
    $('#gfBar').hidden = !show;
    if (!show) return;
    $('#gfBar').innerHTML = '<span class="small muted">กลุ่ม:</span><button class="btn sm ' + (gf === 'all' ? 'primary' : 'ghost') + '" type="button" data-gf="all">ทั้งหมด</button>' +
      '<button class="btn sm ' + (gf === 'none' ? 'primary' : 'ghost') + '" type="button" data-gf="none">ยังไม่มีกลุ่ม ' + n + ' คน</button>';
  }
  $('#gfBar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-gf]'); if (!b) return;
    gf = b.getAttribute('data-gf'); renderGf(); renderList();
  });

  function renderList() {
    $('#lkBar').hidden = tab !== 'list' || !data.students.length;
    $('#listBox').hidden = tab !== 'list';
    renderGf();
    if (gf === 'none' && !ungrouped().length) gf = 'all';
    var rows = kit.view(gf === 'none' ? ungrouped() : data.students);
    if (!data.students.length) {
      $('#listBox').innerHTML = '<div class="callout"><b>ยังไม่มีนักศึกษาในรายวิชานี้</b><br>กด “นำเข้า CSV” เพื่อนำเข้ารายชื่อทั้งห้อง หรือ “เพิ่มนักศึกษา” ทีละคน</div>';
      kit.update([], 0);
      return;
    }
    kit.update(rows, data.students.length);
    if (!rows.length) { $('#listBox').innerHTML = '<div class="callout">ไม่พบรายชื่อที่ตรงกับ “' + esc(kit.st.q) + '”</div>'; return; }
    $('#listBox').innerHTML = '<div class="scroll"><table id="stdTable"><thead><tr><th class="lk-w"></th><th>รหัส</th><th>ชื่อ-นามสกุล</th><th>กลุ่ม</th><th>PIN</th><th></th></tr></thead><tbody>' +
      rows.map(function (s) {
        var pl = PIN_LABEL[s.pinStatus] || PIN_LABEL.none;
        return '<tr data-std="' + esc(s.stdId) + '"' + (kit.st.sel[s.stdId] ? ' class="lk-on"' : '') + '><td class="lk-w">' + kit.cb(s, s.name) + '</td><td class="mono">' + esc(s.stdId) + '</td><td>' + esc(s.name) + '</td>' +
          '<td>' + (s.groupNo ? '<span class="pill info">' + esc(gLabel(s.groupNo)) + '</span>' : '<span class="small muted">—</span>') + '</td>' +
          '<td><span class="pill ' + pl[1] + '">' + pl[0] + '</span>' + (s.resetRequested ? ' <span class="pill bad">ขอรีเซ็ต</span>' : '') + '</td>' +
          '<td><div class="tbl-actions"><button class="btn sm" type="button" data-act="edit">แก้ชื่อ</button>' +
          '<button class="btn sm" type="button" data-act="reset">' + (s.pinStatus === 'set' || s.pinStatus === 'temp' ? 'รีเซ็ต PIN' : 'ออกรหัส') + '</button>' +
          '<button class="btn sm ghost" type="button" data-act="del">ลบ</button></div></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '';
  }

  function load() {
    return HBT.api.call('student.list', { courseId: id }).then(function (r) {
      data = r; kit.prune(r.students); $('#toolbar').hidden = tab !== 'list'; $('#tabs').hidden = !r.students.length; renderHead(); renderList(); renderGroups();
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
        '<p>PIN เดิมจะใช้ไม่ได้ทันที และ PIN นี้ใช้ร่วมกับทุกวิชา/ทุกระบบของนักศึกษาคนนี้ในภาคเรียนนี้ ระบบจะออกรหัสชั่วคราวใหม่ให้ไปตั้ง PIN เอง</p>',
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

  /* ---------- คำสั่งกลุ่ม (ที่เลือกไว้) ---------- */
  function bulkIssue() {
    var sel = kit.selected(data.students); if (!sel.length) return;
    var had = sel.filter(function (s) { return s.pinStatus === 'set' || s.pinStatus === 'temp'; }).length;
    confirmBox('ออกรหัสชั่วคราวให้ ' + sel.length + ' คน?',
      '<p>ระบบจะออกรหัสชั่วคราวให้นักศึกษาที่เลือก ' + sel.length + ' คน' + (had ? ' — <b>' + had + ' คนมี PIN อยู่แล้ว จะถูกรีเซ็ต</b> (PIN เดิมใช้ไม่ได้ทันที)' : '') + '</p>',
      'ออกรหัส', !!had, function () {
        return HBT.api.call('pin.issueTemp', { courseId: id, stdIds: sel.map(function (s) { return s.stdId; }) }, { write: true }).then(function (r) {
          HBT.modal.close('mConf'); kit.clear(); showCodes(r, 'รหัสชั่วคราวของที่เลือก ' + sel.length + ' คน'); return load();
        });
      });
  }
  function bulkDelete() {
    var sel = kit.selected(data.students); if (!sel.length) return;
    var ids = sel.map(function (s) { return s.stdId; });
    HBT.busy($('#lkBar').querySelector('[data-lk-bulk="1"]'), function () {
      return HBT.api.call('student.impactMany', { courseId: id, stdIds: ids }).then(function (im) {
        var lines = im.items.filter(function (i) { return i.count === null || i.count > 0; }).map(function (i) { return '<li>' + esc(i.label) + (i.count === null ? ' (ถ้ามี)' : ' ' + i.count + ' รายการ') + '</li>'; }).join('');
        var names = sel.slice(0, 8).map(function (s) { return esc(s.stdId + ' ' + s.name); }).join('<br>') + (sel.length > 8 ? '<br>… และอีก ' + (sel.length - 8) + ' คน' : '');
        confirmBox('ลบนักศึกษา ' + im.count + ' คนออกจากรายวิชา?',
          '<p>การลบเป็น<b>ถาวร</b> ไม่มีถังขยะ</p><p class="small">' + names + '</p>' +
          '<p>ข้อมูลของพวกเขาในวิชานี้ที่จะหายไปด้วย:</p>' + (lines ? '<ul id="impactList">' + lines + '</ul>' : '<p class="muted" id="impactNone">ไม่มีข้อมูลอื่นผูกอยู่</p>') +
          '<p class="small muted">PIN ของนักศึกษาไม่ถูกลบ (ใช้ในวิชาอื่นต่อได้)</p>',
          'ลบถาวร ' + im.count + ' คน', true, function () {
            return HBT.api.call('student.removeMany', { courseId: id, stdIds: ids }, { write: true }).then(function (r) { kit.clear(); HBT.toast('ลบแล้ว ' + r.removed + ' คน', 'good'); return load(); });
          });
      });
    }).catch(function (er) { HBT.toast(HBT.errMsg(er), 'bad'); });
  }

  /* ---------- กลุ่ม (อาจารย์จัด) ---------- */
  function setTab(t) {
    tab = t;
    $('#tabList').className = 'btn sm ' + (t === 'list' ? 'primary' : 'ghost');
    $('#tabGroups').className = 'btn sm ' + (t === 'groups' ? 'primary' : 'ghost');
    $('#tabList').setAttribute('aria-selected', t === 'list'); $('#tabGroups').setAttribute('aria-selected', t === 'groups');
    $('#toolbar').hidden = t !== 'list'; $('#grpBox').hidden = t !== 'groups';
    if (data) { renderList(); renderGroups(); }
  }
  $('#tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) setTab(b.getAttribute('data-tab')); });

  function renderGroups() {
    var box = $('#grpBox'); box.hidden = tab !== 'groups';
    if (!data || tab !== 'groups') return;
    var gs = data.groups, un = ungrouped();
    var h = '<div class="row sp"><div class="row"><button class="btn primary" type="button" id="gNew">+ กลุ่มใหม่</button><button class="btn" type="button" id="gAuto">แบ่งกลุ่มอัตโนมัติ…</button><button class="btn" type="button" id="gImp">วางจาก Excel…</button></div>' +
      '<span class="small muted" id="gSum">' + gs.length + ' กลุ่ม · ยังไม่มีกลุ่ม ' + un.length + ' คน</span></div>';
    if (!gs.length) h += '<div class="callout" id="noGroups"><b>ยังไม่มีกลุ่ม</b><br>กด “+ กลุ่มใหม่” แล้วเพิ่มสมาชิก หรือ “แบ่งกลุ่มอัตโนมัติ” เพื่อแบ่งทั้งห้องในครั้งเดียว · หรือไปแท็บ “รายชื่อ” ติ๊กนักศึกษาหลายคนแล้วกด “ใส่เข้ากลุ่ม…”</div>';
    gs.forEach(function (g) {
      var mem = data.students.filter(function (s) { return s.groupNo === g.groupNo; });
      h += '<div class="card stack-s" data-gno="' + g.groupNo + '">' +
        '<div class="row sp"><div class="row"><b>กลุ่ม ' + g.groupNo + '</b><input class="gname" type="text" maxlength="60" placeholder="ชื่อกลุ่ม (ไม่บังคับ)" value="' + esc(g.name) + '" aria-label="ชื่อกลุ่ม ' + g.groupNo + '"><button class="btn sm" type="button" data-g="rename">บันทึกชื่อ</button></div>' +
        '<div class="row"><span class="pill info">' + mem.length + ' คน</span><button class="btn sm ghost" type="button" data-g="del">ลบกลุ่ม</button></div></div>' +
        '<div class="row" style="flex-wrap:wrap">' + (mem.length ? mem.map(function (s) {
          var isRep = g.repStd === s.stdId;
          return '<span class="pill' + (isRep ? ' acc' : '') + '" data-std="' + esc(s.stdId) + '">' + esc(s.name) + ' <span class="small mono">' + esc(s.stdId) + '</span> ' +
            '<button class="btn sm ghost" type="button" data-g="rep" title="' + (isRep ? 'เอาออกจากตัวแทน' : 'ตั้งเป็นตัวแทน/ผู้ประสานงาน') + '" aria-label="' + (isRep ? 'เอา ' : 'ตั้ง ') + esc(s.name) + (isRep ? ' ออกจากตัวแทน' : ' เป็นตัวแทน') + '">' + (isRep ? '★' : '☆') + '</button>' +
            '<button class="btn sm ghost" type="button" data-g="out" aria-label="นำ ' + esc(s.name) + ' ออกจากกลุ่ม">✕</button></span>';
        }).join('') : '<span class="small muted">ยังไม่มีสมาชิก</span>') + '</div>' +
        (un.length ? '<div class="row"><select class="gadd" aria-label="เพิ่มสมาชิกเข้ากลุ่ม ' + g.groupNo + '"><option value="">+ เพิ่มสมาชิก (เลือกจากคนที่ยังไม่มีกลุ่ม)…</option>' +
          un.map(function (s) { return '<option value="' + esc(s.stdId) + '">' + esc(s.stdId + ' ' + s.name) + '</option>'; }).join('') + '</select></div>' : '') + '</div>';
    });
    box.innerHTML = h;
  }
  function gCall(action, args, okMsg, btn) {
    var run = function () { return HBT.api.call(action, Object.assign({ courseId: id }, args), { write: true }).then(function (r) { if (okMsg) HBT.toast(okMsg, 'good'); return load().then(function () { return r; }); }); };
    return (btn ? HBT.busy(btn, run) : run()).catch(function (er) { HBT.toast(HBT.errMsg(er), 'bad'); });
  }
  $('#grpBox').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    if (b.id === 'gNew') { gCall('group.save', {}, 'สร้างกลุ่มแล้ว', b); return; }
    if (b.id === 'gAuto') { openAuto(); return; }
    if (b.id === 'gImp') { openGImp(); return; }
    var act = b.getAttribute('data-g'), card = b.closest('[data-gno]');
    if (!act || !card) return;
    var no = Number(card.getAttribute('data-gno')), pill = b.closest('[data-std]'), std = pill ? pill.getAttribute('data-std') : '';
    if (act === 'rename') { gCall('group.save', { groupNo: no, name: card.querySelector('.gname').value }, 'บันทึกชื่อแล้ว', b); return; }
    if (act === 'out') { gCall('group.unassign', { stdIds: [std] }, '', b); return; }
    if (act === 'rep') { var g = gInfo(no); gCall('group.setRep', { groupNo: no, stdId: g && g.repStd === std ? '' : std }, '', b); return; }
    if (act === 'del') {
      var g2 = gInfo(no);
      confirmBox('ลบกลุ่ม ' + no + (g2 && g2.name ? ' · ' + esc(g2.name) : '') + '?',
        '<p>สมาชิก ' + (g2 ? g2.count : 0) + ' คนจะกลับเป็น “ยังไม่มีกลุ่ม” (ไม่ได้ลบนักศึกษา) · ถ้ากลุ่มนี้มีงานที่ส่งแล้ว ระบบไม่ให้ลบ</p>', 'ลบกลุ่ม', true, function () {
          return HBT.api.call('group.delete', { courseId: id, groupNo: no }, { write: true }).then(function () { HBT.toast('ลบกลุ่มแล้ว', 'good'); return load(); });
        });
    }
  });
  $('#grpBox').addEventListener('change', function (e) {
    var sl = e.target.closest('.gadd'); if (!sl || !sl.value) return;
    var no = Number(sl.closest('[data-gno]').getAttribute('data-gno'));
    gCall('group.assign', { stdIds: [sl.value], groupNo: no }, 'เพิ่มเข้ากลุ่มแล้ว');
  });
  $('#grpBox').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('gname')) { e.preventDefault(); var btn = e.target.closest('[data-gno]').querySelector('[data-g="rename"]'); if (btn) btn.click(); }
  });

  /* ใส่ที่เลือกเข้ากลุ่ม (จากแท็บรายชื่อ) */
  var grpIds = [];
  function nextGroupNo() { return data.groups.reduce(function (m, g) { return Math.max(m, g.groupNo); }, 0) + 1; }
  function bulkGroup() {
    var sel = kit.selected(data.students); if (!sel.length) return;
    grpIds = sel.map(function (s) { return s.stdId; });
    var moved = sel.filter(function (s) { return s.groupNo; }).length;
    $('#gSel').innerHTML = 'นักศึกษาที่เลือก <b>' + sel.length + '</b> คน' + (moved ? ' — <span class="muted">' + moved + ' คนอยู่กลุ่มอื่นอยู่แล้ว จะถูกย้ายมากลุ่มนี้</span>' : '');
    $('#gSelGroup').innerHTML = data.groups.map(function (g) { return '<option value="' + g.groupNo + '">' + esc(gLabel(g.groupNo)) + ' (' + g.count + ' คน)</option>'; }).join('') +
      '<option value="new">+ กลุ่มใหม่ (ลำดับ ' + nextGroupNo() + ')</option>';
    $('#gSelGroup').value = data.groups.length ? String(data.groups[data.groups.length - 1].groupNo) : 'new';
    $('#gNewName').value = ''; $('#gNewWrap').hidden = $('#gSelGroup').value !== 'new'; $('#gErr').textContent = '';
    HBT.modal.open('mGrp');
  }
  $('#gSelGroup').addEventListener('change', function () { $('#gNewWrap').hidden = this.value !== 'new'; });
  $('#gGo').addEventListener('click', function () {
    var b = this, v = $('#gSelGroup').value, args = { courseId: id, stdIds: grpIds };
    if (v === 'new') args.newGroup = { name: $('#gNewName').value }; else args.groupNo = Number(v);
    $('#gErr').textContent = '';
    HBT.busy(b, function () {
      return HBT.api.call('group.assign', args, { write: true }).then(function (r) {
        HBT.modal.close('mGrp'); kit.clear(); HBT.toast('ใส่เข้ากลุ่ม ' + r.groupNo + ' แล้ว ' + r.moved + ' คน', 'good'); return load();
      });
    }).catch(function (er) { $('#gErr').textContent = HBT.errMsg(er); });
  });
  function bulkUngroup() {
    var sel = kit.selected(data.students).filter(function (s) { return s.groupNo; });
    if (!sel.length) { HBT.toast('คนที่เลือกยังไม่มีกลุ่มอยู่แล้ว', 'warn'); return; }
    gCall('group.unassign', { stdIds: sel.map(function (s) { return s.stdId; }) }, 'นำออกจากกลุ่มแล้ว ' + sel.length + ' คน', $('#lkBar').querySelector('[data-lk-bulk="1"]')).then(function () { kit.clear(); renderList(); });
  }

  /* แบ่งกลุ่มอัตโนมัติ */
  function aScope() { return HBT.$$('input[name=aScope]').filter(function (r) { return r.checked; })[0].value; }
  function aHelp() {
    var n = aScope() === 'all' ? data.students.length : ungrouped().length, sz = Number($('#aSize').value) || 0;
    $('#aHelp').textContent = sz >= 1 ? 'จะแบ่ง ' + n + ' คน ได้ประมาณ ' + Math.ceil(n / sz) + ' กลุ่ม' : '';
  }
  function openAuto() {
    $('#aErr').textContent = ''; HBT.$$('input[name=aScope]')[0].checked = true; HBT.$$('input[name=aOrder]')[0].checked = true; aHelp();
    HBT.modal.open('mAuto');
  }
  $('#aSize').addEventListener('input', aHelp);
  HBT.$$('input[name=aScope]').forEach(function (r) { r.addEventListener('change', aHelp); });
  $('#aGo').addEventListener('click', function () {
    var b = this, order = HBT.$$('input[name=aOrder]').filter(function (r) { return r.checked; })[0].value, scope = aScope();
    $('#aErr').textContent = '';
    if (scope === 'all' && data.groups.length && !window.confirm('ล้างกลุ่มเดิมทั้งหมดแล้วแบ่งใหม่ทั้งห้อง?')) return;
    HBT.busy(b, function () {
      return HBT.api.call('group.auto', { courseId: id, size: $('#aSize').value, order: order, scope: scope }, { write: true }).then(function (r) {
        HBT.modal.close('mAuto'); HBT.toast('แบ่งแล้ว ' + r.groups + ' กลุ่ม (' + r.students + ' คน)', 'good'); return load();
      });
    }).catch(function (er) { $('#aErr').textContent = HBT.errMsg(er); });
  });

  /* วางจาก Excel: รหัส · ลำดับกลุ่ม · ชื่อกลุ่ม */
  var giPrev = null;
  function parseGroupRows(text) {
    var rows = [];
    String(text || '').split(/\r?\n/).forEach(function (line) {
      if (!line.trim()) return;
      var p = (line.indexOf('\t') >= 0 ? line.split('\t') : line.split(',')).map(function (x) { return x.trim().replace(/^"|"$/g, ''); });
      if (!rows.length && p.length > 1 && !/^\d+$/.test(p[1])) return;                 // แถวหัวตาราง
      rows.push({ stdId: p[0] || '', groupNo: p[1] || '', name: p[2] || '' });
    });
    return rows;
  }
  function openGImp() { $('#giText').value = ''; $('#giPrev').innerHTML = ''; $('#giErr').textContent = ''; $('#giGo').disabled = true; giPrev = null; HBT.modal.open('mGImp'); }
  $('#giText').addEventListener('input', function () { giPrev = null; $('#giPrev').innerHTML = ''; $('#giGo').disabled = true; $('#giErr').textContent = ''; });
  function giHtml(p, real) {
    return '<div class="callout" id="giSum"><b>' + (real ? 'บันทึกแล้ว' : 'ผลการตรวจสอบ (ยังไม่บันทึก)') + '</b><br>จัดเข้ากลุ่ม <b>' + p.assigned + '</b> คน · สร้างกลุ่มใหม่ <b>' + p.created + '</b> · แก้ชื่อกลุ่ม <b>' + p.renamed + '</b>' + (p.skippedCount ? ' · ข้าม <b>' + p.skippedCount + '</b> แถว' : '') + '</div>' +
      (p.skippedCount ? '<details open><summary class="small">แถวที่ข้าม</summary><ul class="small">' + p.skipped.slice(0, 50).map(function (x) { return '<li>แถว ' + x.row + (x.stdId ? ' (' + esc(x.stdId) + ')' : '') + ': ' + esc(x.why) + '</li>'; }).join('') + '</ul></details>' : '');
  }
  $('#giCheck').addEventListener('click', function () {
    var b = this, rows = parseGroupRows($('#giText').value); $('#giErr').textContent = '';
    if (!rows.length) { $('#giErr').textContent = 'ยังไม่มีข้อมูล — วางจาก Excel ก่อน'; return; }
    HBT.busy(b, function () {
      return HBT.api.call('group.import', { courseId: id, rows: rows, dryRun: true }).then(function (p) { giPrev = rows; $('#giPrev').innerHTML = giHtml(p, false); $('#giGo').disabled = !p.assigned; if (!p.assigned) $('#giErr').textContent = 'ไม่มีแถวที่ใช้ได้'; });
    }).catch(function (er) { $('#giErr').textContent = HBT.errMsg(er); });
  });
  $('#giGo').addEventListener('click', function () {
    var b = this; if (!giPrev) return;
    HBT.busy(b, function () {
      return HBT.api.call('group.import', { courseId: id, rows: giPrev }, { write: true }).then(function (p) {
        $('#giPrev').innerHTML = giHtml(p, true); $('#giGo').disabled = true; giPrev = null; HBT.toast('จัดกลุ่มแล้ว', 'good'); return load();
      });
    }).catch(function (er) { $('#giErr').textContent = HBT.errMsg(er); });
  });

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
