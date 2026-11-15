/* HBT Core — กล่องข้อความจากนักศึกษา (อาจารย์): ค้นหา · เรียง · กรองสถานะ · ทำเครื่องหมาย อ่านแล้ว/จัดการแล้ว · ลบที่เลือก */
HBT.page({ active: 'courses', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['กล่องข้อความ']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var id = HBT.qs('id');
  var data = null, filter = 'all', pending = null;
  var ST = { new: ['ใหม่', 'bad'], read: ['อ่านแล้ว', 'info'], done: ['จัดการแล้ว', 'good'] };

  if (!id) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบรายวิชา</b></div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>');
    return;
  }

  ctx.content.insertAdjacentHTML('beforeend',
    '<div id="head"></div><div class="row" id="chips" hidden></div><div id="lkBar" hidden></div>' +
    '<div id="listBox"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +
    '<div class="modal" id="mConf" hidden role="dialog" aria-modal="true" aria-labelledby="cTitle"><div class="mbox stack">' +
    '<h2 id="cTitle">ยืนยัน</h2><div id="cBody"></div><div class="err" id="cErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn danger" type="button" id="cGo">ยืนยัน</button></div></div></div>');

  var kit = HBT.listKit({
    id: function (m) { return m.msgId; },
    search: function (m) { return m.fromStd + ' ' + m.fromName + ' ' + m.aboutName + ' ' + m.asgTitle + ' ' + m.message; },
    sorts: [
      { k: 'at', label: 'เวลาส่ง', fn: function (m) { return m.createdAt; } },
      { k: 'from', label: 'ผู้ส่ง', fn: function (m) { return m.fromName; } },
      { k: 'st', label: 'สถานะ (ใหม่ก่อน)', fn: function (m) { return { new: 0, read: 1, done: 2 }[m.status]; } }
    ],
    sort: 'at', dir: -1, noun: 'ข้อความ',
    bulk: [
      { label: 'ทำเครื่องหมายอ่านแล้ว', run: function () { mark('read'); } },
      { label: 'จัดการแล้ว', cls: 'primary', run: function () { mark('done'); } },
      { label: 'ตั้งเป็นใหม่', run: function () { mark('new'); } },
      { label: 'ลบที่เลือก', cls: 'danger', run: function () { del(); } }
    ]
  });
  kit.mount($('#lkBar'), function () { if (data) renderList(); });
  kit.bindList($('#listBox'));

  function renderHead() {
    var c = data.course, n = data.counts;
    $('#head').innerHTML = '<div class="page-h"><div class="stack-s"><h1>กล่องข้อความ</h1><p>' + esc(c.code) + ' กลุ่ม ' + esc(c.section) + ' · ' + esc(c.name) + '</p></div>' +
      '<div class="row"><a class="btn sm" id="backCourse" href="' + root + 't/course.html?id=' + encodeURIComponent(id) + '">‹ กลับรายวิชา</a></div></div>' +
      '<p class="small muted">ข้อความที่นักศึกษาแจ้งอาจารย์ · เพื่อนที่ถูกกล่าวถึงไม่เห็นข้อความ · ระบบไม่มีการตอบกลับ — ติดต่อนักศึกษานอกระบบ แล้วกด “จัดการแล้ว”</p>';
    var chips = [['all', 'ทั้งหมด ' + n.total], ['new', 'ใหม่ ' + n.new], ['read', 'อ่านแล้ว ' + n.read], ['done', 'จัดการแล้ว ' + n.done]];
    $('#chips').hidden = !n.total;
    $('#chips').innerHTML = chips.map(function (c2) { return '<button class="btn sm ' + (filter === c2[0] ? 'primary' : 'ghost') + '" type="button" data-f="' + c2[0] + '">' + esc(c2[1]) + '</button>'; }).join('');
  }
  $('#chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-f]'); if (!b) return;
    filter = b.getAttribute('data-f'); renderHead(); renderList();
  });

  function renderList() {
    $('#lkBar').hidden = !data.messages.length;
    var base = filter === 'all' ? data.messages : data.messages.filter(function (m) { return m.status === filter; });
    var rows = kit.view(base);
    kit.update(rows, data.messages.length);
    if (!data.messages.length) { $('#listBox').innerHTML = '<div class="callout" id="noMsg"><b>ยังไม่มีข้อความจากนักศึกษา</b><br>นักศึกษากดปุ่ม “แจ้งอาจารย์” ที่หน้างานของตัวเองได้</div>'; return; }
    if (!rows.length) { $('#listBox').innerHTML = '<div class="callout">ไม่พบข้อความตามตัวกรอง</div>'; return; }
    $('#listBox').innerHTML = '<div class="stack" id="msgList">' + rows.map(function (m) {
      var st = ST[m.status] || ST.new;
      return '<div class="card stack-s' + (kit.st.sel[m.msgId] ? ' lk-on' : '') + '" data-msg="' + esc(m.msgId) + '">' +
        '<div class="row sp"><div class="row">' + kit.cb(m, m.fromName) + '<b>' + esc(m.fromName) + '</b> <span class="small mono muted">' + esc(m.fromStd) + '</span></div>' +
        '<div class="row"><span class="small muted">' + esc(HBT.fmtBE(m.createdAt, true)) + '</span><span class="pill ' + st[1] + '">' + st[0] + '</span></div></div>' +
        (m.aboutName || m.asgTitle ? '<div class="row small">' + (m.asgTitle ? '<span class="pill">งาน: ' + esc(m.asgTitle) + '</span>' : '') + (m.aboutName ? '<span class="pill warn">เกี่ยวกับ: ' + esc(m.aboutName) + ' (' + esc(m.aboutStd) + ')</span>' : '') + '</div>' : '') +
        '<div style="white-space:pre-wrap">' + esc(m.message) + '</div>' +
        '<div class="row">' + (m.status !== 'done' ? '<button class="btn sm" type="button" data-one="done">จัดการแล้ว</button>' : '') +
        (m.status === 'new' ? '<button class="btn sm ghost" type="button" data-one="read">อ่านแล้ว</button>' : '') + (m.status !== 'new' ? '<button class="btn sm ghost" type="button" data-one="new">ตั้งเป็นใหม่</button>' : '') +
        (m.asgId ? '<a class="btn sm ghost" href="' + root + 't/asg-detail.html?a=' + encodeURIComponent(m.asgId) + '">เปิดหน้าตรวจงาน</a>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  function load() {
    return HBT.api.call('inbox.list', { courseId: id }).then(function (r) {
      data = r; kit.prune(r.messages); renderHead(); renderList();
    }, function (e) {
      var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN';
      $('#listBox').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบรายวิชานี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดข้อความไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
        '<div class="row" style="margin-top:10px">' + (nf ? '' : '<button class="btn" type="button" id="reload">ลองใหม่</button>') + '<a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>';
      var rb = $('#reload'); if (rb) rb.addEventListener('click', load);
    });
  }

  function setStatus(ids, status, okMsg, btn) {
    var run = function () { return HBT.api.call('inbox.mark', { courseId: id, msgIds: ids, status: status }, { write: true }).then(function () { if (okMsg) HBT.toast(okMsg, 'good'); return load(); }); };
    return (btn ? HBT.busy(btn, run) : run()).catch(function (er) { HBT.toast(HBT.errMsg(er), 'bad'); });
  }
  function mark(status) {
    var sel = kit.selected(data.messages); if (!sel.length) return;
    setStatus(sel.map(function (m) { return m.msgId; }), status, 'เปลี่ยนสถานะ ' + sel.length + ' ข้อความแล้ว').then(function () { kit.clear(); renderList(); });
  }
  function del() {
    var sel = kit.selected(data.messages); if (!sel.length) return;
    $('#cTitle').textContent = 'ลบข้อความ ' + sel.length + ' รายการ?';
    $('#cBody').innerHTML = '<p>การลบเป็น<b>ถาวร</b> ไม่มีถังขยะ ข้อความที่ลบจะหายจากหน้านักศึกษาด้วย</p>'; $('#cErr').textContent = '';
    pending = function () {
      return HBT.api.call('inbox.delete', { courseId: id, msgIds: sel.map(function (m) { return m.msgId; }) }, { write: true }).then(function (r) { kit.clear(); HBT.toast('ลบแล้ว ' + r.removed + ' ข้อความ', 'good'); return load(); });
    };
    HBT.modal.open('mConf');
  }
  $('#cGo').addEventListener('click', function () {
    var fn = pending; if (!fn) return;
    HBT.busy(this, fn).then(function () { HBT.modal.close('mConf'); }).catch(function (er) { $('#cErr').textContent = HBT.errMsg(er); });
  });
  $('#listBox').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-one]'); if (!b) return;
    var mid = b.closest('[data-msg]').getAttribute('data-msg');
    setStatus([mid], b.getAttribute('data-one'), '', b);
  });

  load();
});
