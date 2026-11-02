/* HBT Core — หน้าเช็คชื่อสด: QR · นับถอยหลัง · พัก/ต่อ/ปิด · อนุมัติใช้เครื่องร่วม · แก้สถานะรายคน */
HBT.page({ active: 'att', need: 'att', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['เช็คชื่อ']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var sid = HBT.qs('s');
  var POLL_MS = 8000;
  var data = null, course = null, fetchedAt = 0, timer = null, tick = null, polling = false, failN = 0, filter = '', stFilter = '', scanUrl = '';
  var LBL = { normal: 'ปกติ', late: 'สาย', leave: 'ลา', absent: 'ขาด', waiting: 'รอเช็ค' };
  var CLS = { normal: 'good', late: 'warn', leave: 'info', absent: 'bad', waiting: '' };
  var SRC = { SCAN: 'สแกน', MANUAL: 'อาจารย์แก้', IMPORT: 'นำเข้า' };

  if (!sid) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบคาบ</b><br>เปิดจากหน้าเช็คชื่อของรายวิชา</div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>');
    return;
  }

  ctx.content.insertAdjacentHTML('beforeend', '<div id="box" class="stack"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +
    '<div class="modal" id="mQr" hidden role="dialog" aria-modal="true" aria-label="QR สำหรับเช็คชื่อ"><div class="mbox stack" style="text-align:center">' +
    '<div class="row sp"><h2>สแกนเพื่อเช็คชื่อ</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div id="bigQr" style="width:min(80vw,420px);margin:0 auto;background:#fff;padding:12px;border-radius:12px"></div><p class="small muted mono" id="bigUrl" style="word-break:break-all"></p></div></div>' +
    '<div class="modal" id="mConf" hidden role="dialog" aria-modal="true" aria-labelledby="cTitle"><div class="mbox stack">' +
    '<h2 id="cTitle">ปิดการเช็คชื่อ?</h2><p id="cText">หลังปิดแล้วนักศึกษาจะเช็คชื่อไม่ได้ และคะแนนเช็คชื่อจะถูกคำนวณ · คนที่ยังไม่ได้เช็คจะนับเป็นขาด (แก้ภายหลังได้)</p><div class="err" id="cErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn danger" type="button" id="cOk">ปิดคาบ</button></div></div></div>');

  function two(n) { return n < 10 ? '0' + n : '' + n; }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); return two(Math.floor(sec / 60)) + ':' + two(sec % 60); }

  /* ---------- วาด ---------- */
  function qrSvg(url, px) {
    try {
      var q = qrcode(0, 'M'); q.addData(url); q.make();
      return q.createSvgTag({ cellSize: 4, margin: 0, scalable: true });
    } catch (e) { return '<p class="small">สร้าง QR ไม่สำเร็จ ใช้ลิงก์ด้านล่างแทน</p>'; }
  }

  function skeleton() {
    var s = data.session, c = course;
    scanUrl = new URL('../s/scan.html?s=' + encodeURIComponent(s.sessionId), location.href).href;
    document.title = 'เช็คชื่อสด ' + (c ? c.code : '') + ' — HBT Teaching';
    $('#box').innerHTML =
      '<div class="page-h"><div class="stack-s"><h1 id="lvTitle">เช็คชื่อ ' + (c ? esc(c.code) + ' <span class="muted">กลุ่ม ' + esc(c.section) + '</span>' : '') + '</h1>' +
      '<p class="small muted">' + (c ? esc(c.name) + ' · ' : '') + 'คาบวันที่ ' + esc(HBT.fmtBE(s.date)) + '</p></div>' +
      '<div class="row"><a class="btn sm" href="' + root + 't/att.html?id=' + encodeURIComponent(s.courseId) + '">ประวัติคาบ</a>' +
      '<a class="btn sm" href="' + root + 't/att-report.html?id=' + encodeURIComponent(s.courseId) + '">รายงาน</a></div></div>' +
      '<div class="callout warn" id="netWarn" hidden role="status">เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ชั่วคราว กำลังลองใหม่…</div>' +
      '<section class="card stack" id="ctl"></section>' +
      '<section class="card stack" id="shareCard"></section>' +
      '<section class="stack" id="apprBox" hidden></section>' +
      '<section class="stack"><div class="row sp"><h2>รายชื่อ</h2><span class="small muted" id="cnt"></span></div>' +
      '<div class="row"><input id="fq" type="search" placeholder="ค้นหารหัสหรือชื่อ" style="flex:1 1 180px;min-width:0" autocomplete="off"><select id="fst" aria-label="กรองตามสถานะ">' +
      '<option value="">ทุกสถานะ</option><option value="waiting">รอเช็ค</option><option value="normal">ปกติ</option><option value="late">สาย</option><option value="leave">ลา</option><option value="absent">ขาด</option></select></div>' +
      '<div id="tblBox"></div></section>';
    $('#fq').addEventListener('input', function () { filter = this.value.trim().toLowerCase(); renderTable(); });
    $('#fst').addEventListener('change', function () { stFilter = this.value; renderTable(); });
  }

  function phaseText(s, left) {
    if (s.status === 'closed') return ['ปิดแล้ว', ''];
    if (s.status === 'paused') return ['พักอยู่ (เวลาหยุดเดิน)', 'warn'];
    if (!s.hasTimeConfig) return ['เปิดอยู่', 'good'];
    if (s.phase === 'normal') return ['ปกติ · นับสาย/ปิดใน ' + mmss(left.normal), 'good'];
    return ['สาย · ปิดรับใน ' + mmss(left.close), 'warn'];
  }

  function leftNow() {
    var s = data.session, dt = (Date.now() - fetchedAt) / 1000, run = s.status === 'open';
    return {
      normal: s.normalRemainingSeconds === null ? 0 : s.normalRemainingSeconds - (run ? dt : 0),
      close: s.remainingSeconds === null ? 0 : s.remainingSeconds - (run ? dt : 0)
    };
  }

  function renderCtl() {
    var s = data.session, left = leftNow(), pt = phaseText(s, left), live = s.status !== 'closed';
    $('#ctl').innerHTML =
      '<div class="row sp"><span class="pill ' + pt[1] + '" id="phase" style="font-size:.95rem;padding:4px 14px">' + esc(pt[0]) + '</span>' +
      '<span class="small muted">เริ่ม ' + esc(HBT.fmtBE(s.startAt, true)) + (s.hasLocation ? ' · รัศมี ' + s.radiusM + ' ม.' : ' · ไม่จำกัดตำแหน่ง') + '</span></div>' +
      '<div class="grid g4 counts" id="counts">' +
      ['normal', 'late', 'leave', live ? 'waiting' : 'absent'].map(function (k) {
        return '<div class="count-box ' + CLS[k] + '"><span class="small">' + LBL[k] + '</span><b class="num" data-k="' + k + '">' + data.counts[k] + '</b></div>';
      }).join('') + '</div>' +
      (live ? '<div class="row" id="btns">' +
        (s.status === 'open' ? '<button class="btn" type="button" id="pauseBtn">พักการเช็คชื่อ</button>' : '<button class="btn primary" type="button" id="resumeBtn">ดำเนินการต่อ</button>') +
        '<button class="btn danger" type="button" id="closeBtn">ปิดคาบ</button></div>' : '<p class="small muted">คาบนี้ปิดแล้ว · ยังแก้สถานะรายคนด้านล่างได้ คะแนนจะคำนวณใหม่ให้เอง</p>');
    var pb = $('#pauseBtn'), rb = $('#resumeBtn'), cb = $('#closeBtn');
    if (pb) pb.addEventListener('click', function () { act(this, 'att.pause'); });
    if (rb) rb.addEventListener('click', function () { act(this, 'att.resume'); });
    if (cb) cb.addEventListener('click', function () { $('#cErr').textContent = ''; HBT.modal.open('mConf'); });
  }

  function renderShare() {
    var s = data.session, box = $('#shareCard');
    if (s.status === 'closed') { box.hidden = true; return; }
    box.hidden = false;
    if (box.getAttribute('data-sid') === s.sessionId) return;      // QR ไม่ต้องวาดใหม่ทุกรอบ poll
    box.setAttribute('data-sid', s.sessionId);
    box.innerHTML = '<div class="row" style="align-items:flex-start;gap:16px"><div class="qr" id="qrBox" role="img" aria-label="QR สำหรับเช็คชื่อ">' + qrSvg(scanUrl) + '</div>' +
      '<div class="stack-s grow" style="min-width:200px"><h3>ให้นักศึกษาสแกนหรือเปิดลิงก์</h3>' +
      '<p class="small mono" id="scanUrl" style="word-break:break-all">' + esc(scanUrl) + '</p>' +
      '<div class="row"><button class="btn sm" type="button" id="copyBtn">คัดลอกลิงก์</button><button class="btn sm" type="button" id="bigBtn">แสดง QR เต็มจอ</button></div>' +
      '<p class="small muted">QR นี้ใช้ได้เฉพาะคาบนี้ — ปิดคาบแล้วสแกนไม่ได้</p></div></div>';
    $('#copyBtn').addEventListener('click', function () {
      var done = function () { HBT.toast('คัดลอกลิงก์แล้ว', 'good'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(scanUrl).then(done, function () { HBT.toast('คัดลอกไม่ได้ กดค้างที่ลิงก์เพื่อคัดลอกเอง', 'bad'); });
      else HBT.toast('คัดลอกไม่ได้ กดค้างที่ลิงก์เพื่อคัดลอกเอง', 'bad');
    });
    $('#bigBtn').addEventListener('click', function () {
      $('#bigQr').innerHTML = qrSvg(scanUrl); $('#bigUrl').textContent = scanUrl; HBT.modal.open('mQr');
    });
  }

  function renderAppr() {
    var box = $('#apprBox'), list = data.approvals || [];
    if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
    box.hidden = false;
    box.innerHTML = '<h2>ขออนุมัติใช้เครื่องร่วม <span class="pill warn">' + list.length + '</span></h2>' +
      list.map(function (a) {
        return '<div class="card row sp appr" data-req="' + esc(a.requestId) + '"><div class="stack-s grow" style="min-width:200px"><b>' + esc(a.name) + ' <span class="muted mono">' + esc(a.stdId) + '</span></b>' +
          '<span class="small muted">ขอเช็คชื่อด้วยเครื่องที่ ' + (a.usedByName ? esc(a.usedByName) + ' ใช้เช็คชื่อไปแล้ว' : 'ถูกใช้ไปแล้ว') + ' · หมดอายุใน ' + a.secondsLeft + ' วิ</span></div>' +
          '<div class="row"><button class="btn sm primary" type="button" data-yes="' + esc(a.requestId) + '">อนุมัติ</button><button class="btn sm" type="button" data-no="' + esc(a.requestId) + '">ปฏิเสธ</button></div></div>';
      }).join('') + '<p class="small muted">อนุมัติเฉพาะเมื่อรู้ว่าสองคนใช้มือถือเครื่องเดียวกันจริง (เช่น มือถือเสีย ยืมเพื่อน)</p>';
    HBT.$$('[data-yes],[data-no]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var yes = b.hasAttribute('data-yes'), rid = b.getAttribute(yes ? 'data-yes' : 'data-no');
        HBT.busy(b, function () {
          return HBT.api.call('att.decide', { requestId: rid, approve: yes }, { write: true }).then(function () { HBT.toast(yes ? 'อนุมัติแล้ว นักศึกษากดเช็คชื่อได้เลย' : 'ปฏิเสธแล้ว', 'good'); return refresh(); });
        }).catch(function (e) { HBT.toast(HBT.errMsg(e), 'bad'); refresh(); });
      });
    });
  }

  function renderTable() {
    var rows = data.students.filter(function (r) {
      if (stFilter && r.status !== stFilter) return false;
      return !filter || r.stdId.toLowerCase().indexOf(filter) >= 0 || r.name.toLowerCase().indexOf(filter) >= 0;
    });
    $('#cnt').textContent = 'ทั้งหมด ' + data.counts.total + ' คน' + (rows.length !== data.students.length ? ' · แสดง ' + rows.length : '');
    if (!data.students.length) { $('#tblBox').innerHTML = '<div class="callout">วิชานี้ยังไม่มีรายชื่อนักศึกษา</div>'; return; }
    if (!rows.length) { $('#tblBox').innerHTML = '<div class="callout">ไม่พบรายชื่อตามที่กรอง</div>'; return; }
    $('#tblBox').innerHTML = '<div class="scroll"><table id="stTbl"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>สถานะ</th><th>เวลา</th><th>แก้ไข</th></tr></thead><tbody>' +
      rows.map(function (r) {
        var opts = ['normal', 'late', 'leave', 'absent'].map(function (k) {
          var sel = r.status === k ? ' selected' : '';
          return '<option value="' + k + '"' + sel + '>' + LBL[k] + '</option>';
        }).join('');
        return '<tr data-std="' + esc(r.stdId) + '"' + (r.isNew ? ' class="is-new"' : '') + '><td class="mono">' + esc(r.stdId) + '</td><td>' + esc(r.name) + '</td>' +
          '<td><span class="pill ' + CLS[r.status] + '">' + LBL[r.status] + '</span>' + (r.source && r.source !== 'SCAN' ? ' <span class="xs muted">' + esc(SRC[r.source] || r.source) + '</span>' : '') + '</td>' +
          '<td class="mono">' + esc(r.at ? String(r.at).substring(11, 16) : '') + '</td>' +
          '<td><select class="st-sel" data-std="' + esc(r.stdId) + '" aria-label="แก้สถานะ ' + esc(r.name) + '">' + (r.status === 'waiting' ? '<option value="" selected>— ยังไม่เช็ค —</option>' : '') + opts + '</select></td></tr>';
      }).join('') + '</tbody></table></div>';
    HBT.$$('.st-sel', $('#tblBox')).forEach(function (sel) {
      sel.addEventListener('change', function () {
        var std = sel.getAttribute('data-std'), v = sel.value; if (!v) return;
        sel.disabled = true;
        HBT.api.call('att.setStatus', { sessionId: sid, stdId: std, status: v }, { write: true })
          .then(function () { HBT.toast('แก้สถานะแล้ว', 'good'); return refresh(); })
          .catch(function (e) { HBT.toast(HBT.errMsg(e), 'bad'); return refresh(); });
      });
    });
  }

  function renderAll() { renderCtl(); renderShare(); renderAppr(); renderTable(); }

  /* ---------- ดึงข้อมูล ---------- */
  function act(btn, action) {
    HBT.busy(btn, function () { return HBT.api.call(action, { sessionId: sid }, { write: true }).then(function () { return refresh(); }); })
      .catch(function (e) { HBT.toast(HBT.errMsg(e), 'bad'); refresh(); });
  }
  $('#cOk').addEventListener('click', function () {
    var b = this;
    HBT.busy(b, function () { return HBT.api.call('att.close', { sessionId: sid }, { write: true }); })
      .then(function () { HBT.modal.close('mConf'); HBT.toast('ปิดคาบแล้ว', 'good'); return refresh(); })
      .catch(function (e) { $('#cErr').textContent = HBT.errMsg(e); });
  });

  function refresh() {
    if (polling) return Promise.resolve();
    polling = true;
    return HBT.api.call('att.live', { sessionId: sid }).then(function (d) {
      polling = false; failN = 0; if ($('#netWarn')) $('#netWarn').hidden = true;
      var first = !data;
      data = d; fetchedAt = Date.now();
      if (first || !course) {
        return HBT.api.call('course.get', { courseId: d.session.courseId }).then(function (c) { course = c; }, function () {}).then(function () { skeleton(); renderAll(); schedule(); });
      }
      renderAll(); schedule();
    }, function (e) {
      polling = false;
      if (!data) {
        var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN';
        $('#box').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบคาบนี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
          '<div class="row" style="margin-top:10px">' + (nf ? '' : '<button class="btn" type="button" id="reload">ลองใหม่</button>') + '<a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>';
        var rb = $('#reload'); if (rb) rb.addEventListener('click', refresh);
        return;
      }
      failN++; if ($('#netWarn')) $('#netWarn').hidden = false;
      schedule();
    });
  }

  function schedule() {
    clearTimeout(timer);
    if (!data || data.session.status === 'closed') return;      // ปิดแล้วไม่ต้อง poll
    timer = setTimeout(function () { if (document.hidden) { schedule(); return; } refresh(); }, POLL_MS + Math.min(failN, 5) * 4000);
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && data && data.session.status !== 'closed') refresh(); });

  // นับถอยหลังบนหน้าจอ (คำนวณจากเวลาที่เหลือที่ server บอก ไม่ใช้นาฬิกาเครื่องเทียบเวลาเริ่ม)
  tick = setInterval(function () {
    if (!data) return;
    var s = data.session, ph = $('#phase');
    if (!ph || s.status !== 'open' || !s.hasTimeConfig) return;
    var left = leftNow();
    if (left.close <= 0) { if (Date.now() - fetchedAt > 3000) refresh(); return; }
    var t = phaseText(s.phase === 'normal' && left.normal <= 0 ? Object.assign({}, s, { phase: 'late' }) : s, left);
    ph.textContent = t[0]; ph.className = 'pill ' + t[1];
  }, 1000);

  refresh();
});
