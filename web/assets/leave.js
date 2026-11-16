/* HBT Core — ใบลานักศึกษา (อาจารย์): รายการ · อนุมัติ/ไม่อนุมัติ (+หมายเหตุ) · ดูไฟล์แนบ · บันทึกแทนนักศึกษา · ลบ · แท็บสรุปการลา + ธงขาดเกินเกณฑ์ · ส่งออก CSV
 * หมายเหตุ: ใบลาที่อนุมัติ "ไม่เปลี่ยนคะแนน" — แสดงเป็น “ล” ในรายงานเช็คชื่อให้คาบที่ไม่มีบันทึกเช็คชื่อและตรงวันลา */
HBT.page({ active: 'courses', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['ใบลานักศึกษา']], need: 'att' }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var id = HBT.qs('id');
  var data = null, sum = null, filter = 'all', tab = 'list', decideCtx = null, students = null;
  var ST = { pending: ['รออนุมัติ', 'warn'], approved: ['อนุมัติแล้ว', 'good'], rejected: ['ไม่อนุมัติ', 'bad'], cancelled: ['ยกเลิกแล้ว', ''] };
  var TYPE = { sick: 'ลาป่วย', personal: 'ลากิจ' };

  if (!id) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบรายวิชา</b></div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>');
    return;
  }

  ctx.content.insertAdjacentHTML('beforeend',
    '<div id="head"></div><div class="row" id="tabs" hidden></div><div class="row" id="chips" hidden></div><div id="lkBar" hidden></div>' +
    '<div id="listBox"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div><div id="sumBox" hidden></div>' +

    /* อนุมัติ / ไม่อนุมัติ (หมายเหตุไม่บังคับ) */
    '<div class="modal" id="mDec" hidden role="dialog" aria-modal="true" aria-labelledby="dTitle"><div class="mbox stack">' +
    '<h2 id="dTitle">ตัดสินใบลา</h2><div id="dBody" class="small"></div>' +
    '<div class="field"><label for="dNote">หมายเหตุถึงนักศึกษา (ไม่บังคับ)</label><input id="dNote" type="text" maxlength="300" autocomplete="off" placeholder="เช่น ใบรับรองแพทย์ไม่ชัด กรุณาส่งใหม่"></div>' +
    '<div class="err" id="dErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="dGo">ยืนยัน</button></div></div></div>' +

    /* ลบ */
    '<div class="modal" id="mDel" hidden role="dialog" aria-modal="true" aria-labelledby="xTitle"><div class="mbox stack">' +
    '<h2 id="xTitle">ลบใบลา?</h2><p>การลบเป็น<b>ถาวร</b> ไฟล์แนบ (ใบรับรองแพทย์ ฯลฯ) จะถูกลบออกจากระบบด้วย · คาบที่เคยแสดงเป็น “ล” จะกลับเป็น “ขาด”</p><div class="err" id="xErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn danger" type="button" id="xGo">ลบถาวร</button></div></div></div>' +

    /* บันทึกแทนนักศึกษา */
    '<div class="modal" id="mNew" hidden role="dialog" aria-modal="true" aria-labelledby="nTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="nTitle">บันทึกการลาแทนนักศึกษา</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<p class="small muted">ใช้กรณีนักศึกษาส่งใบลากระดาษหรือแจ้งทางอื่น · ไม่ต้องแนบไฟล์ · ไม่จำกัดช่วงวันที่ (ครั้งละไม่เกิน 60 วัน)</p>' +
    '<div class="field"><label for="nStd">นักศึกษา</label><select id="nStd"><option value="">กำลังโหลด…</option></select></div>' +
    '<div class="field"><label for="nType">ชนิดการลา</label><select id="nType"><option value="sick">ลาป่วย</option><option value="personal">ลากิจ</option></select></div>' +
    '<div class="grid g2"><div class="field"><label for="nFrom">ตั้งแต่วันที่</label><input id="nFrom" type="date"></div><div class="field"><label for="nTo">ถึงวันที่</label><input id="nTo" type="date"></div></div>' +
    '<div class="field"><label class="row" for="nAll" style="cursor:pointer"><input id="nAll" type="checkbox" checked style="accent-color:var(--accent)"> <span>ลาทั้งวัน</span></label></div>' +
    '<div class="grid g2" id="nTimes" hidden><div class="field"><label for="nTf">เวลาเริ่ม</label><input id="nTf" type="time" value="08:00"></div><div class="field"><label for="nTt">เวลาสิ้นสุด</label><input id="nTt" type="time" value="17:00"></div></div>' +
    '<div class="field"><label for="nReason">เหตุผล/หมายเหตุ</label><input id="nReason" type="text" maxlength="300" autocomplete="off"></div>' +
    '<div class="field"><label for="nStatus">สถานะ</label><select id="nStatus"><option value="approved">อนุมัติแล้ว</option><option value="pending">รออนุมัติ</option></select></div>' +
    '<div class="err" id="nErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="nGo">บันทึก</button></div></div></div>');

  var kit = HBT.listKit({
    id: function (l) { return l.leaveId; },
    search: function (l) { return l.stdId + ' ' + l.stdName + ' ' + (TYPE[l.type] || '') + ' ' + l.reason + ' ' + l.dateFrom + ' ' + l.teacherNote; },
    sorts: [
      { k: 'at', label: 'เวลาส่ง', fn: function (l) { return l.createdAt; } },
      { k: 'date', label: 'วันที่ลา', fn: function (l) { return l.dateFrom; } },
      { k: 'name', label: 'ชื่อนักศึกษา', fn: function (l) { return l.stdName; } },
      { k: 'st', label: 'สถานะ (รอก่อน)', fn: function (l) { return { pending: 0, approved: 1, rejected: 2, cancelled: 3 }[l.status]; } }
    ],
    sort: 'at', dir: -1, noun: 'ใบลา',
    bulk: [
      { label: 'อนุมัติที่เลือก', cls: 'primary', run: function () { openDecide('approved', kit.selected(data.leaves)); } },
      { label: 'ไม่อนุมัติที่เลือก', run: function () { openDecide('rejected', kit.selected(data.leaves)); } },
      { label: 'ลบที่เลือก', cls: 'danger', run: function () { openDelete(kit.selected(data.leaves)); } }
    ]
  });
  kit.mount($('#lkBar'), function () { if (data) renderList(); });
  kit.bindList($('#listBox'));

  /* ---------- ส่วนหัว/แท็บ ---------- */
  function renderHead() {
    var c = data.course, n = data.counts;
    $('#head').innerHTML = '<div class="page-h"><div class="stack-s"><h1>ใบลานักศึกษา</h1><p>' + esc(c.code) + ' กลุ่ม ' + esc(c.section) + ' · ' + esc(c.name) + '</p></div>' +
      '<div class="row"><button class="btn sm" type="button" id="newBtn">+ บันทึกการลาแทนนักศึกษา</button><a class="btn sm" id="backCourse" href="' + root + 't/course.html?id=' + encodeURIComponent(id) + '">‹ กลับรายวิชา</a></div></div>' +
      '<p class="small muted">ใบลาที่นักศึกษาส่งเข้าวิชานี้ · อนุมัติ/ไม่อนุมัติแล้วนักศึกษาเห็นผลในหน้าส่งใบลา · <b>ไม่เปลี่ยนคะแนนเช็คชื่อ</b> — คาบที่ไม่มีบันทึกเช็คชื่อและตรงวันลาที่อนุมัติ จะแสดงเป็น “ล” ในรายงานเช็คชื่อ ให้อาจารย์พิจารณาท้ายเทอม · ไฟล์แนบเห็นเฉพาะอาจารย์เจ้าของวิชา</p>';
    $('#newBtn').addEventListener('click', openNew);
    $('#tabs').hidden = false;
    $('#tabs').innerHTML = [['list', 'ใบลา ' + n.total], ['sum', 'สรุปการลา']].map(function (t) {
      return '<button class="btn sm ' + (tab === t[0] ? 'primary' : 'ghost') + '" type="button" data-tab="' + t[0] + '">' + esc(t[1]) + '</button>';
    }).join('');
    var chips = [['all', 'ทั้งหมด ' + n.total], ['pending', 'รออนุมัติ ' + n.pending], ['approved', 'อนุมัติ ' + n.approved], ['rejected', 'ไม่อนุมัติ ' + n.rejected], ['cancelled', 'ยกเลิก ' + n.cancelled]];
    $('#chips').hidden = tab !== 'list' || !n.total;
    $('#chips').innerHTML = chips.map(function (c2) { return '<button class="btn sm ' + (filter === c2[0] ? 'primary' : 'ghost') + '" type="button" data-f="' + c2[0] + '">' + esc(c2[1]) + '</button>'; }).join('');
  }
  $('#tabs').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tab]'); if (!b) return;
    tab = b.getAttribute('data-tab'); showTab();
  });
  $('#chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-f]'); if (!b) return;
    filter = b.getAttribute('data-f'); renderHead(); renderList();
  });
  function showTab() {
    renderHead();
    $('#listBox').hidden = tab !== 'list'; $('#lkBar').hidden = tab !== 'list' || !data.leaves.length; $('#sumBox').hidden = tab !== 'sum';
    if (tab === 'sum') loadSummary(); else renderList();
  }

  /* ---------- รายการใบลา ---------- */
  function fileBtn(l, slot, label) {
    var f = l[slot]; if (!f) return '';
    return '<span class="row" style="gap:4px"><span class="pill">' + esc(label) + ': ' + esc(f.name) + '</span>' +
      '<button class="btn sm ghost" type="button" data-file="' + slot + '" data-view="1">ดู</button><button class="btn sm ghost" type="button" data-file="' + slot + '">ดาวน์โหลด</button></span>';
  }
  function renderList() {
    $('#lkBar').hidden = tab !== 'list' || !data.leaves.length;
    var base = filter === 'all' ? data.leaves : data.leaves.filter(function (l) { return l.status === filter; });
    var rows = kit.view(base);
    kit.update(rows, data.leaves.length);
    if (!data.leaves.length) { $('#listBox').innerHTML = '<div class="callout" id="noLeave"><b>ยังไม่มีใบลา</b><br>นักศึกษาส่งใบลาได้ที่หน้านักศึกษา → “ส่งใบลา” (เลือกอาจารย์และวิชา) หรือกด “บันทึกการลาแทนนักศึกษา” กรณีใบกระดาษ</div>'; return; }
    if (!rows.length) { $('#listBox').innerHTML = '<div class="callout">ไม่พบใบลาตามตัวกรอง</div>'; return; }
    $('#listBox').innerHTML = '<div class="stack" id="leaveList">' + rows.map(function (l) {
      var t = ST[l.status] || ST.pending, range = l.dateFrom === l.dateTo ? HBT.fmtBE(l.dateFrom) : HBT.fmtBE(l.dateFrom) + ' – ' + HBT.fmtBE(l.dateTo);
      var cancelled = l.status === 'cancelled';
      return '<div class="card stack-s' + (kit.st.sel[l.leaveId] ? ' lk-on' : '') + '" data-leave="' + esc(l.leaveId) + '" data-status="' + esc(l.status) + '">' +
        '<div class="row sp"><div class="row">' + kit.cb(l, l.stdName) + '<b>' + esc(l.stdName) + '</b> <span class="small mono muted">' + esc(l.stdId) + '</span></div>' +
        '<div class="row"><span class="small muted">ส่ง ' + esc(HBT.fmtBE(l.createdAt, true)) + (l.source === 'TEACHER' ? ' · อาจารย์บันทึก' : '') + '</span><span class="pill ' + t[1] + '">' + esc(t[0]) + '</span></div></div>' +
        '<div class="row"><span class="pill ' + (l.type === 'sick' ? 'info' : 'acc') + '">' + esc(TYPE[l.type] || l.type) + '</span><b>' + esc(range) + '</b><span class="small muted">' + (l.allDay ? 'ทั้งวัน' : 'เวลา ' + esc(l.timeFrom) + '–' + esc(l.timeTo) + ' น.') + ' · ' + esc(l.days) + ' วัน</span></div>' +
        (l.reason ? '<div style="white-space:pre-wrap">' + esc(l.reason) + '</div>' : '') +
        '<div class="row">' + fileBtn(l, 'form', 'ฟอร์มลา') + fileBtn(l, 'extra', 'หลักฐานเพิ่ม') + (!l.form && !l.extra && !cancelled ? '<span class="small muted">ไม่มีไฟล์แนบ</span>' : '') + '</div>' +
        (l.teacherNote ? '<div class="callout small"><b>หมายเหตุอาจารย์:</b> ' + esc(l.teacherNote) + (l.decidedBy ? ' <span class="muted">· ' + esc(l.decidedBy) + '</span>' : '') + '</div>' : '') +
        '<div class="row">' + (cancelled ? '' : (l.status !== 'approved' ? '<button class="btn sm primary" type="button" data-dec="approved">อนุมัติ</button>' : '') + (l.status !== 'rejected' ? '<button class="btn sm" type="button" data-dec="rejected">ไม่อนุมัติ</button>' : '')) +
        '<button class="btn sm ghost danger" type="button" data-del="1">ลบ</button></div></div>';
    }).join('') + '</div>';
  }

  function load() {
    return HBT.api.call('leave.list', { courseId: id }).then(function (r) {
      data = r; kit.prune(r.leaves); sum = null; showTab();
    }, function (e) {
      var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN';
      $('#listBox').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบรายวิชานี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดใบลาไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
        '<div class="row" style="margin-top:10px">' + (nf ? '' : '<button class="btn" type="button" id="reload">ลองใหม่</button>') + '<a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>';
      var rb = $('#reload'); if (rb) rb.addEventListener('click', load);
    });
  }

  /* ---------- ดู/ดาวน์โหลดไฟล์แนบ ---------- */
  function getFile(btn, leaveId, slot, view) {
    var w = null;
    if (view) { try { w = window.open('', '_blank'); } catch (e) { w = null; } }
    HBT.busy(btn, function () {
      return HBT.api.call('leave.fileGet', { leaveId: leaveId, slot: slot }).then(function (f) {
        var viewable = /^(application\/pdf|image\/)/.test(f.mime);
        if (view && w && viewable) {
          var bin = atob(f.b64), arr = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          var url = URL.createObjectURL(new Blob([arr], { type: f.mime }));
          w.location.href = url; setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
        } else {
          if (w) { try { w.close(); } catch (x) {} }
          HBT.saveB64(f);
        }
      });
    }).catch(function (e) { if (w) { try { w.close(); } catch (x) {} } HBT.toast(e.code === 'E_NOT_FOUND' ? 'ไม่พบไฟล์ใน Drive (อาจถูกลบ)' : HBT.errMsg(e), 'bad'); });
  }

  /* ---------- อนุมัติ / ไม่อนุมัติ ---------- */
  function openDecide(status, list) {
    if (!list.length) return;
    decideCtx = { status: status, ids: list.map(function (l) { return l.leaveId; }) };
    $('#dTitle').textContent = (status === 'approved' ? 'อนุมัติ ' : 'ไม่อนุมัติ ') + list.length + ' ใบลา';
    $('#dBody').innerHTML = list.slice(0, 6).map(function (l) { return '<div>' + esc(l.stdName) + ' · ' + esc(TYPE[l.type] || l.type) + ' · ' + esc(HBT.fmtBE(l.dateFrom)) + (l.dateTo !== l.dateFrom ? ' – ' + esc(HBT.fmtBE(l.dateTo)) : '') + '</div>'; }).join('') +
      (list.length > 6 ? '<div class="muted">และอีก ' + (list.length - 6) + ' ใบ</div>' : '') +
      (status === 'approved' ? '<p class="muted" style="margin-top:8px">อนุมัติแล้วคาบที่ไม่มีบันทึกเช็คชื่อและตรงวันลาจะแสดงเป็น “ล” ในรายงานเช็คชื่อ (ไม่เปลี่ยนคะแนน)</p>' : '');
    $('#dNote').value = list.length === 1 && list[0].status !== 'pending' ? list[0].teacherNote : ''; $('#dErr').textContent = '';
    $('#dGo').className = 'btn ' + (status === 'approved' ? 'primary' : 'danger'); $('#dGo').textContent = status === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ';
    HBT.modal.open('mDec'); setTimeout(function () { $('#dNote').focus(); }, 50);
  }
  $('#dGo').addEventListener('click', function () {
    if (!decideCtx) return;
    HBT.busy(this, function () {
      return HBT.api.call('leave.decide', { courseId: id, leaveIds: decideCtx.ids, status: decideCtx.status, note: $('#dNote').value }, { write: true }).then(function (r) {
        HBT.modal.close('mDec'); kit.clear(); HBT.toast((decideCtx.status === 'approved' ? 'อนุมัติแล้ว ' : 'ไม่อนุมัติแล้ว ') + r.changed + ' ใบ' + (r.skipped ? ' (ข้าม ' + r.skipped + ' ใบที่ยกเลิกแล้ว)' : ''), 'good'); return load();
      });
    }).catch(function (er) { $('#dErr').textContent = HBT.errMsg(er); });
  });

  /* ---------- ลบ ---------- */
  var delIds = [];
  function openDelete(list) {
    if (!list.length) return;
    delIds = list.map(function (l) { return l.leaveId; }); $('#xTitle').textContent = 'ลบใบลา ' + list.length + ' ใบ?'; $('#xErr').textContent = '';
    HBT.modal.open('mDel');
  }
  $('#xGo').addEventListener('click', function () {
    HBT.busy(this, function () {
      return HBT.api.call('leave.delete', { courseId: id, leaveIds: delIds }, { write: true }).then(function (r) { HBT.modal.close('mDel'); kit.clear(); HBT.toast('ลบแล้ว ' + r.removed + ' ใบ', 'good'); return load(); });
    }).catch(function (er) { $('#xErr').textContent = HBT.errMsg(er); });
  });

  $('#listBox').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var card = b.closest('[data-leave]'); if (!card) return;
    var lid = card.getAttribute('data-leave'), l = data.leaves.filter(function (x) { return x.leaveId === lid; })[0]; if (!l) return;
    if (b.hasAttribute('data-file')) getFile(b, lid, b.getAttribute('data-file'), b.hasAttribute('data-view'));
    else if (b.hasAttribute('data-dec')) openDecide(b.getAttribute('data-dec'), [l]);
    else if (b.hasAttribute('data-del')) openDelete([l]);
  });

  /* ---------- บันทึกแทนนักศึกษา ---------- */
  function openNew() {
    $('#nErr').textContent = '';
    var t = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; }, today = t.getFullYear() + '-' + p(t.getMonth() + 1) + '-' + p(t.getDate());
    $('#nFrom').value = today; $('#nTo').value = today; $('#nReason').value = ''; $('#nAll').checked = true; $('#nTimes').hidden = true;
    HBT.modal.open('mNew');
    if (students) { fillStudents(); return; }
    HBT.api.call('student.list', { courseId: id }).then(function (r) { students = r.students; fillStudents(); }, function (e) { $('#nStd').innerHTML = '<option value="">โหลดรายชื่อไม่สำเร็จ</option>'; $('#nErr').textContent = HBT.errMsg(e); });
  }
  function fillStudents() {
    $('#nStd').innerHTML = '<option value="">— เลือกนักศึกษา (' + students.length + ') —</option>' + students.map(function (s) { return '<option value="' + esc(s.stdId) + '">' + esc(s.stdId) + ' — ' + esc(s.name) + '</option>'; }).join('');
  }
  $('#nAll').addEventListener('change', function () { $('#nTimes').hidden = this.checked; });
  $('#nFrom').addEventListener('change', function () { if ($('#nTo').value < this.value) $('#nTo').value = this.value; });
  $('#nGo').addEventListener('click', function () {
    var err = $('#nErr'); err.textContent = '';
    if (!$('#nStd').value) { err.textContent = 'กรุณาเลือกนักศึกษา'; return; }
    if (!$('#nFrom').value || !$('#nTo').value || $('#nTo').value < $('#nFrom').value) { err.textContent = 'ตรวจวันที่อีกครั้ง (วันสิ้นสุดต้องไม่ก่อนวันเริ่ม)'; return; }
    var all = $('#nAll').checked;
    if (!all && (!$('#nTf').value || !$('#nTt').value || $('#nTt').value <= $('#nTf').value)) { err.textContent = 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม'; return; }
    HBT.busy(this, function () {
      return HBT.api.call('leave.create', {
        courseId: id, stdId: $('#nStd').value, type: $('#nType').value, dateFrom: $('#nFrom').value, dateTo: $('#nTo').value, allDay: all,
        timeFrom: all ? '' : $('#nTf').value, timeTo: all ? '' : $('#nTt').value, reason: $('#nReason').value, status: $('#nStatus').value
      }, { write: true }).then(function () { HBT.modal.close('mNew'); HBT.toast('บันทึกการลาแล้ว', 'good'); return load(); });
    }).catch(function (er) { err.textContent = HBT.errMsg(er); });
  });

  /* ---------- แท็บสรุปการลา ---------- */
  var sq = '', sortK = 'id', onlyOver = false;
  function loadSummary() {
    if (sum) { renderSummary(); return; }
    $('#sumBox').innerHTML = '<div class="loading"><span class="spin"></span> กำลังโหลดสรุป…</div>';
    HBT.api.call('leave.summary', { courseId: id }).then(function (r) { sum = r; renderSummary(); }, function (e) {
      $('#sumBox').innerHTML = '<div class="callout bad"><b>โหลดสรุปไม่สำเร็จ</b><br>' + esc(HBT.errMsg(e)) + '</div><div class="row" style="margin-top:10px"><button class="btn" type="button" id="reSum">ลองใหม่</button></div>';
      $('#reSum').addEventListener('click', loadSummary);
    });
  }
  function renderSummary() {
    var overN = sum.students.filter(function (s) { return s.over; }).length;
    var rows = sum.students.filter(function (s) { return (!onlyOver || s.over) && (!sq || (s.stdId + ' ' + s.name).toLowerCase().indexOf(sq.toLowerCase()) >= 0); });
    var by = { id: function (a, b) { return a.stdId < b.stdId ? -1 : 1; }, name: function (a, b) { return a.name.localeCompare(b.name, 'th'); },
      leave: function (a, b) { return (b.sick.days + b.personal.days) - (a.sick.days + a.personal.days); }, absent: function (a, b) { return b.attend.absent - a.attend.absent; } }[sortK];
    rows = rows.slice().sort(by);
    function ld(x) { return x.count ? x.count + ' ครั้ง / ' + x.days + ' วัน' : '<span class="muted">–</span>'; }
    $('#sumBox').innerHTML = '<div class="stack">' +
      '<div class="callout' + (overN ? ' warn' : '') + ' small" id="overInfo">เกณฑ์เตือน: ขาดเกิน <b>' + esc(sum.warnAbsent) + '</b> ครั้ง (ไม่นับคาบที่ลาตามใบลาที่อนุมัติ) · คาบที่เช็คชื่อแล้ว ' + esc(sum.totalSessions) + ' คาบ · ' + (overN ? '<b>เกินเกณฑ์ ' + overN + ' คน</b>' : 'ยังไม่มีใครเกินเกณฑ์') + ' · ปรับเกณฑ์ได้ที่ผู้ดูแลระบบ → ตั้งค่าระบบ → เช็คชื่อ</div>' +
      '<div class="row sp"><div class="row"><div class="field" style="min-width:220px"><label class="sr" for="sq">ค้นหา</label><input id="sq" type="search" placeholder="ค้นหารหัสหรือชื่อ" autocomplete="off" value="' + esc(sq) + '"></div>' +
      '<div class="field"><label class="sr" for="ssort">เรียงตาม</label><select id="ssort">' + [['id', 'รหัสนักศึกษา'], ['name', 'ชื่อ-นามสกุล'], ['leave', 'วันลามาก→น้อย'], ['absent', 'ขาดมาก→น้อย']].map(function (o) { return '<option value="' + o[0] + '"' + (sortK === o[0] ? ' selected' : '') + '>เรียงตาม: ' + o[1] + '</option>'; }).join('') + '</select></div>' +
      '<label class="row" style="cursor:pointer"><input id="sover" type="checkbox"' + (onlyOver ? ' checked' : '') + ' style="accent-color:var(--accent)"> <span class="small">เฉพาะขาดเกินเกณฑ์</span></label></div>' +
      '<button class="btn" type="button" id="sCsv">ส่งออก CSV</button></div>' +
      (rows.length ? '<div class="scroll"><table id="leaveSum"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>ลาป่วย (อนุมัติ)</th><th>ลากิจ (อนุมัติ)</th><th class="num">รออนุมัติ</th><th class="num">ไม่อนุมัติ</th><th class="num">ขาด</th><th class="num">เข้าเรียน %</th></tr></thead><tbody>' +
        rows.map(function (s) {
          return '<tr data-std="' + esc(s.stdId) + '"><td class="mono">' + esc(s.stdId) + '</td><td>' + esc(s.name) + '</td><td>' + ld(s.sick) + '</td><td>' + ld(s.personal) + '</td><td class="num">' + (s.pending || '<span class="muted">–</span>') + '</td><td class="num">' + (s.rejected || '<span class="muted">–</span>') + '</td>' +
            '<td class="num">' + (s.over ? '<span class="pill bad" title="ขาดเกินเกณฑ์">' + s.attend.absent + ' ⚠</span>' : s.attend.absent) + '</td><td class="num">' + (s.attend.percent === null ? '<span class="muted">–</span>' : esc(s.attend.percent)) + '</td></tr>';
        }).join('') + '</tbody></table></div><p class="small muted">แสดง ' + rows.length + ' จาก ' + sum.students.length + ' คน · ครั้ง/วันนับเฉพาะใบลาที่อนุมัติ · ผลนี้ใช้ประกอบการพิจารณาของอาจารย์ท้ายเทอม ไม่ได้ตัดคะแนนอัตโนมัติ</p>'
        : '<div class="callout">ไม่พบนักศึกษาตามที่ค้นหา</div>') + '</div>';
    $('#sq').addEventListener('input', function () { sq = this.value; var p = this.selectionStart; renderSummary(); var n = $('#sq'); n.focus(); try { n.setSelectionRange(p, p); } catch (e) {} });
    $('#ssort').addEventListener('change', function () { sortK = this.value; renderSummary(); });
    $('#sover').addEventListener('change', function () { onlyOver = this.checked; renderSummary(); });
    $('#sCsv').addEventListener('click', function () {
      HBT.busy(this, function () { return HBT.api.call('leave.exportCsv', { courseId: id }).then(function (r) { HBT.csv.download(r.filename, r.csv); }); }).catch(function (e) { HBT.toast(HBT.errMsg(e), 'bad'); });
    });
  }

  load();
});
