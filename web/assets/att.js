/* HBT Core — เช็คชื่อ: เปิดคาบ · ประวัติคาบ · นำเข้าย้อนหลัง · ลบ */
HBT.page({ active: 'att', need: 'att', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['เช็คชื่อ']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var id = HBT.qs('id');
  var course = null, cur = null, sessions = [], loc = null, locBusy = false, pendingConfirm = null;
  var KIND = { live: 'สแกน', manual: 'นำเข้า' };
  var ST = { open: ['เปิดอยู่', 'good'], paused: ['พักอยู่', 'warn'], closed: ['ปิดแล้ว', ''] };

  if (!id) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบรายวิชา</b><br>เลือกรายวิชาก่อน แล้วกด “เช็คชื่อ”</div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>');
    return;
  }
  var q = encodeURIComponent(id);

  ctx.content.insertAdjacentHTML('beforeend', '<div id="box" class="stack"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +
    /* นำเข้าย้อนหลัง */
    '<div class="modal" id="mImp" hidden role="dialog" aria-modal="true" aria-labelledby="iTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="iTitle">นำเข้าการเข้าเรียนย้อนหลัง</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<p class="small muted">1 ไฟล์ = 1 คาบ · คอลัมน์แรกคือรหัสนักศึกษา คอลัมน์ที่สองคือ 1 (ปกติ) · 0.5 (สาย) · 0 (ขาด) หรือเขียนว่า ปกติ / สาย / ลา / ขาด · วางจาก Excel ได้เลย</p>' +
    '<div class="field"><label for="iDate">วันที่ของคาบ</label><input id="iDate" type="date"></div>' +
    '<div class="field"><label for="iFile">เลือกไฟล์ (.csv / .txt)</label><input id="iFile" type="file" accept=".csv,.txt,text/csv,text/plain"></div>' +
    '<div class="field"><label for="iText">หรือวางข้อมูลที่นี่</label><textarea id="iText" rows="6" class="mono" placeholder="660001&#9;1&#10;660002&#9;ลา"></textarea></div>' +
    '<div class="err" id="iErr" role="alert"></div><div id="iPrev" class="stack-s" role="status"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn" type="button" id="iCheck">ตรวจสอบก่อน</button><button class="btn primary" type="button" id="iGo" disabled>นำเข้า</button></div>' +
    '</div></div>' +
    /* ยืนยัน */
    '<div class="modal" id="mConf" hidden role="dialog" aria-modal="true" aria-labelledby="cTitle"><div class="mbox stack">' +
    '<h2 id="cTitle">ยืนยัน</h2><p id="cText"></p><div class="err" id="cErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn danger" type="button" id="cOk">ยืนยัน</button></div>' +
    '</div></div>');

  function confirmBox(title, text, okLabel, fn) {
    $('#cTitle').textContent = title; $('#cText').textContent = text; $('#cOk').textContent = okLabel; $('#cErr').textContent = '';
    pendingConfirm = fn; HBT.modal.open('mConf');
  }
  $('#cOk').addEventListener('click', function () {
    var b = this;
    if (!pendingConfirm) return;
    HBT.busy(b, function () { return pendingConfirm(); }).then(function () { HBT.modal.close('mConf'); }, function (e) { $('#cErr').textContent = HBT.errMsg(e); });
  });

  function two(n) { return n < 10 ? '0' + n : '' + n; }
  function hhmm(d) { return two(d.getHours()) + ':' + two(d.getMinutes()); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); }

  function render() {
    var c = course;
    document.title = 'เช็คชื่อ ' + c.code + ' — HBT Teaching';
    var h = '<div class="page-h"><div class="stack-s"><h1>เช็คชื่อ <span class="muted">' + esc(c.code) + ' กลุ่ม ' + esc(c.section) + '</span></h1><p>' + esc(c.name) + ' · นักศึกษา ' + c.students + ' คน</p></div>' +
      '<div class="row"><a class="btn" id="goReport" href="' + root + 't/att-report.html?id=' + q + '">รายงานเข้าเรียน</a><a class="btn" href="' + root + 't/course.html?id=' + q + '">กลับหน้าวิชา</a></div></div>';

    if (!c.students) {
      h += '<div class="callout warn" id="noStd"><b>ยังไม่มีรายชื่อนักศึกษาในวิชานี้</b><br>นำเข้ารายชื่อก่อน นักศึกษาจึงจะเลือกชื่อตัวเองเพื่อเช็คชื่อได้ · <a href="' + root + 't/students.html?id=' + q + '">ไปหน้ารายชื่อ</a></div>';
    }

    if (cur) {
      var st = ST[cur.status] || ST.open;
      h += '<section class="card stack" id="liveCard"><div class="row sp"><h2>มีคาบที่' + (cur.status === 'paused' ? 'พักอยู่' : 'เปิดอยู่') + '</h2><span class="pill ' + st[1] + '">' + st[0] + '</span></div>' +
        '<p class="small muted">เริ่ม ' + esc(HBT.fmtBE(cur.startAt, true)) + ' · ปกติ ' + cur.normalMin + ' นาที · ปิดรับ ' + cur.closeMin + ' นาทีหลังเริ่ม' + (cur.hasLocation ? ' · จำกัดตำแหน่ง ' + cur.radiusM + ' ม.' : ' · ไม่จำกัดตำแหน่ง') + '</p>' +
        '<div><a class="btn primary" id="goLive" href="' + root + 't/att-live.html?s=' + encodeURIComponent(cur.sessionId) + '">ไปหน้าเช็คชื่อสด</a></div></section>';
    } else {
      h += '<section class="card stack" id="openCard"><h2>เปิดเช็คชื่อ</h2>' +
        '<div class="field"><label class="check" style="padding:0"><input type="checkbox" id="useLoc" checked><span>จำกัดตำแหน่ง (ต้องอยู่ในห้องเรียน)</span></label>' +
        '<span class="help">นักศึกษาต้องเปิด GPS ในมือถือ · ระบบเช็คตำแหน่งจากเครื่องนักศึกษา จึงลดการเช็คแทนได้แต่ไม่ได้ป้องกัน 100%</span></div>' +
        '<div id="locBox" class="stack-s"><div class="row"><button class="btn" type="button" id="getLoc">ใช้ตำแหน่งปัจจุบันของฉัน</button><span class="small muted" id="locState">ยังไม่ได้ระบุตำแหน่ง (ยืนในห้องเรียนแล้วกดปุ่ม)</span></div>' +
        '<div class="field" style="max-width:220px"><label for="radius">รัศมี (เมตร)</label><input id="radius" type="number" inputmode="numeric" min="10" max="5000" placeholder="ค่าเริ่มต้นของระบบ"></div></div>' +
        '<details class="field"><summary class="small">ตั้งเวลา (ไม่บังคับ)</summary><div class="grid g3" style="margin-top:10px">' +
        '<div class="field"><label for="nMin">นับเป็น “ปกติ” (นาทีหลังเริ่ม)</label><input id="nMin" type="number" inputmode="numeric" min="0" max="599" placeholder="ค่าเริ่มต้น"></div>' +
        '<div class="field"><label for="cMin">ปิดรับ (นาทีหลังเริ่ม)</label><input id="cMin" type="number" inputmode="numeric" min="1" max="600" placeholder="ค่าเริ่มต้น"></div>' +
        '<div class="field"><label for="sAt">เวลาเริ่มคาบ (วันนี้)</label><input id="sAt" type="time"><span class="help">ว่าง = เริ่มนับตอนนี้ · ใช้เมื่อเปิดไว้ก่อนเวลาเรียน</span></div></div>' +
        '<span class="help">ช่องที่เว้นว่างจะใช้ค่าเริ่มต้นที่ผู้ดูแลตั้งไว้ในระบบ</span></details>' +
        '<div class="err" id="openErr" role="alert"></div>' +
        '<div><button class="btn primary" type="button" id="openBtn"' + (c.students ? '' : ' disabled') + '>เปิดเช็คชื่อ</button></div></section>';
    }

    h += '<section class="stack"><div class="row sp"><h2>ประวัติคาบ</h2><div class="row">' +
      '<button class="btn sm" type="button" id="impBtn">นำเข้าย้อนหลัง</button>' +
      '<button class="btn sm" type="button" id="csvBtn">ส่งออก CSV</button>' +
      '<button class="btn sm ghost" type="button" id="emptyBtn">ลบคาบที่ไม่มีคนเช็ค</button></div></div><div id="histBox"></div></section>';
    $('#box').innerHTML = h;
    renderHist();
    bind();
  }

  function renderHist() {
    var box = $('#histBox');
    if (!sessions.length) { box.innerHTML = '<div class="callout" id="noSess">ยังไม่มีคาบ — เปิดเช็คชื่อด้านบน หรือนำเข้าข้อมูลย้อนหลัง</div>'; return; }
    box.innerHTML = '<div class="scroll"><table id="histTbl"><thead><tr><th>คาบ</th><th>สถานะ</th><th class="r">เช็คแล้ว</th><th></th></tr></thead><tbody>' +
      sessions.map(function (s) {
        var st = ST[s.status] || ST.closed, closed = s.status === 'closed';
        return '<tr data-sid="' + esc(s.sessionId) + '"><td><span class="mono">' + esc(HBT.fmtBE(s.date)) + '</span>' +
          '<br><span class="xs muted">' + esc(s.startAt ? String(s.startAt).substring(11, 16) + ' น. · ' : '') + esc(KIND[s.kind] || s.kind) + '</span></td>' +
          '<td><span class="pill ' + st[1] + '">' + st[0] + '</span></td><td class="num">' + s.checkIns + '</td>' +
          '<td><div class="tbl-actions">' +
          (s.kind === 'live' ? '<a class="btn sm" href="' + root + 't/att-live.html?s=' + encodeURIComponent(s.sessionId) + '">เปิดดู</a>' : '') +
          (closed ? '<button class="btn sm ghost" type="button" data-del="' + esc(s.sessionId) + '">ลบ</button>' : '') +
          '</div></td></tr>';
      }).join('') + '</tbody></table></div>';
    HBT.$$('[data-del]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var sid = b.getAttribute('data-del'), s = sessions.filter(function (x) { return x.sessionId === sid; })[0];
        confirmBox('ลบคาบนี้?', 'คาบวันที่ ' + HBT.fmtBE(s.date) + ' และการเช็คชื่อ ' + s.checkIns + ' รายการจะถูกลบถาวร กู้คืนไม่ได้ · คะแนนเช็คชื่อจะถูกคำนวณใหม่', 'ลบถาวร', function () {
          return HBT.api.call('att.deleteSession', { sessionId: sid }, { write: true }).then(function () { HBT.toast('ลบคาบแล้ว', 'good'); return load(); });
        });
      });
    });
  }

  function bind() {
    var ul = $('#useLoc');
    if (ul) {
      ul.addEventListener('change', function () { $('#locBox').hidden = !ul.checked; });
      $('#getLoc').addEventListener('click', getLoc);
      $('#openBtn').addEventListener('click', doOpen);
    }
    $('#impBtn').addEventListener('click', function () {
      $('#iDate').value = today(); $('#iText').value = ''; $('#iFile').value = ''; $('#iErr').textContent = ''; $('#iPrev').innerHTML = ''; $('#iGo').disabled = true;
      HBT.modal.open('mImp');
    });
    $('#csvBtn').addEventListener('click', function () {
      var b = this;
      HBT.busy(b, function () { return HBT.api.call('att.exportCsv', { courseId: id }).then(function (r) { HBT.csv.download(r.filename, r.csv); }); })
        .catch(function (e) { HBT.toast(HBT.errMsg(e), 'bad'); });
    });
    $('#emptyBtn').addEventListener('click', function () {
      confirmBox('ลบคาบที่ไม่มีใครเช็คชื่อ?', 'ลบเฉพาะคาบที่ปิดแล้วและไม่มีรายการเช็คชื่อเลย (เช่น เปิดทดสอบแล้วลืมปิด) กู้คืนไม่ได้', 'ลบ', function () {
        return HBT.api.call('att.deleteEmpty', { courseId: id }, { write: true }).then(function (r) {
          HBT.toast(r.deleted ? 'ลบ ' + r.deleted + ' คาบ' : 'ไม่มีคาบที่ต้องลบ', 'good'); return load();
        });
      });
    });
  }

  /* ---------- ตำแหน่ง ---------- */
  function getLoc() {
    var st = $('#locState');
    if (locBusy) return;
    if (!navigator.geolocation) { st.textContent = 'เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง'; return; }
    locBusy = true; st.textContent = 'กำลังหาตำแหน่ง…'; $('#getLoc').disabled = true;
    navigator.geolocation.getCurrentPosition(function (p) {
      locBusy = false; $('#getLoc').disabled = false;
      loc = { lat: p.coords.latitude, lng: p.coords.longitude, acc: Math.round(p.coords.accuracy || 0) };
      st.textContent = 'ได้ตำแหน่งแล้ว ' + loc.lat.toFixed(5) + ', ' + loc.lng.toFixed(5) + ' (คลาดเคลื่อนประมาณ ' + loc.acc + ' ม.)' +
        (loc.acc > 100 ? ' — สัญญาณไม่แม่นยำ ลองกดใหม่ใกล้หน้าต่าง' : '');
      $('#openErr').textContent = '';
    }, function (e) {
      locBusy = false; $('#getLoc').disabled = false;
      st.textContent = e && e.code === 1 ? 'ถูกปฏิเสธ — อนุญาตการเข้าถึงตำแหน่งของเว็บนี้ในเบราว์เซอร์ แล้วกดใหม่' : 'หาตำแหน่งไม่ได้ ลองใหม่ (เปิด GPS แล้วหรือยัง)';
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  function doOpen() {
    var b = this, err = $('#openErr'), p = { courseId: id };
    err.textContent = '';
    if ($('#useLoc').checked) {
      if (!loc) { err.textContent = 'ยังไม่ได้ระบุตำแหน่งห้องเรียน — กด “ใช้ตำแหน่งปัจจุบันของฉัน” หรือยกเลิกการจำกัดตำแหน่ง'; return; }
      p.lat = loc.lat; p.lng = loc.lng;
      if ($('#radius').value.trim() !== '') p.radiusM = Number($('#radius').value);
    }
    if ($('#nMin').value.trim() !== '') p.normalMin = Number($('#nMin').value);
    if ($('#cMin').value.trim() !== '') p.closeMin = Number($('#cMin').value);
    if ($('#sAt').value) p.startAt = today() + ' ' + $('#sAt').value;
    HBT.busy(b, function () {
      return HBT.api.call('att.open', p, { write: true }).then(function (s) {
        location.href = root + 't/att-live.html?s=' + encodeURIComponent(s.sessionId);
      });
    }).catch(function (e) {
      if (e.code === 'E_ATT_OPEN_EXISTS') { load(); return; }
      err.textContent = HBT.errMsg(e);
    });
  }

  /* ---------- นำเข้า ---------- */
  function impRows() { return HBT.csv.parseScores($('#iText').value).rows; }
  function impArgs(dry) { return { courseId: id, date: $('#iDate').value, rows: impRows(), dryRun: dry }; }
  $('#iFile').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    if (f.size > 1000000) { $('#iErr').textContent = 'ไฟล์ใหญ่เกินไป (เกิน 1 MB)'; return; }
    var fr = new FileReader();
    fr.onload = function () {
      $('#iText').value = String(fr.result || ''); $('#iGo').disabled = true; $('#iPrev').innerHTML = '';
      $('#iErr').textContent = /\uFFFD/.test($('#iText').value) ? 'พบตัวอักษรอ่านไม่ออก — บันทึกไฟล์เป็น UTF-8 แล้วลองใหม่' : '';
    };
    fr.readAsText(f, 'utf-8');
  });
  $('#iText').addEventListener('input', function () { $('#iGo').disabled = true; $('#iPrev').innerHTML = ''; });
  $('#iDate').addEventListener('input', function () { $('#iGo').disabled = true; });
  $('#iCheck').addEventListener('click', function () {
    var b = this; $('#iErr').textContent = '';
    if (!$('#iDate').value) { $('#iErr').textContent = 'เลือกวันที่ของคาบ'; return; }
    if (!impRows().length) { $('#iErr').textContent = 'ยังไม่มีข้อมูล — เลือกไฟล์หรือวางข้อมูลก่อน'; return; }
    HBT.busy(b, function () {
      return HBT.api.call('att.import', impArgs(true)).then(function (r) {
        var sk = r.skipped.slice(0, 8).map(function (x) { return '<li>แถว ' + x.row + ' ' + esc(x.stdId) + ' — ' + esc(x.why) + '</li>'; }).join('');
        $('#iPrev').innerHTML = '<div class="callout good"><b>พร้อมนำเข้า ' + r.imported + ' คน</b> วันที่ ' + esc(HBT.fmtBE(r.date)) + '<br>ปกติ ' + r.normal + ' · สาย ' + r.late + ' · ลา ' + r.leave + ' · ขาด ' + r.absent + '</div>' +
          (r.skippedCount ? '<div class="callout warn"><b>ข้าม ' + r.skippedCount + ' แถว</b><ul style="margin:6px 0 0;padding-left:18px">' + sk + '</ul>' + (r.skippedCount > 8 ? '<span class="small">…และอื่นๆ</span>' : '') + '</div>' : '');
        $('#iGo').disabled = false;
      });
    }).catch(function (e) { $('#iErr').textContent = HBT.errMsg(e); $('#iGo').disabled = true; });
  });
  $('#iGo').addEventListener('click', function () {
    var b = this;
    HBT.busy(b, function () {
      return HBT.api.call('att.import', impArgs(false), { write: true }).then(function (r) {
        HBT.modal.close('mImp'); HBT.toast('นำเข้า ' + r.imported + ' คนแล้ว', 'good'); return load();
      });
    }).catch(function (e) { $('#iErr').textContent = HBT.errMsg(e); });
  });

  function load() {
    return Promise.all([
      HBT.api.call('course.get', { courseId: id }),
      HBT.api.call('att.current', { courseId: id }),
      HBT.api.call('att.sessions', { courseId: id })
    ]).then(function (r) { course = r[0]; cur = r[1].session; sessions = r[2].sessions; render(); }, function (e) {
      var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN';
      $('#box').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบรายวิชานี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
        '<div class="row" style="margin-top:10px">' + (nf ? '' : '<button class="btn" type="button" id="reload">ลองใหม่</button>') + '<a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>';
      var rb = $('#reload'); if (rb) rb.addEventListener('click', load);
    });
  }
  load();
});
