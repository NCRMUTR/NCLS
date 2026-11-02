/* HBT Core — หน้านักศึกษา: เช็คชื่อ (ไม่ต้องล็อกอิน) · เลือกชื่อ + GPS + PIN เมื่อใช้เครื่องใหม่ · ขออนุมัติเมื่อเครื่องชน */
(function () {
  'use strict';
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var app = document.getElementById('app');
  var sid = HBT.qs('s');
  var LBL = { normal: 'ปกติ', late: 'สาย', leave: 'ลา' };
  var st = { info: null, students: [], std: '', mode: '', busy: false, pos: null, posAt: 0, req: null, poll: null, tickT: null, fetchedAt: 0 };

  if (!HBT.api.configuredCore()) {
    app.innerHTML = '<div class="callout warn"><b>ยังไม่ได้ตั้งค่าเว็บ</b><br>ไฟล์ assets/config.js ยังไม่มี CORE_URL</div>';
    return;
  }
  if (!sid) {
    app.innerHTML = head() + '<div class="callout bad" id="noSid"><b>ลิงก์ไม่ถูกต้อง</b><br>สแกน QR จากหน้าจอของอาจารย์อีกครั้ง</div>';
    return;
  }

  /* ---------- เครื่องนี้ ---------- */
  function deviceId() {
    var k = 'hbt.device', v = '';
    try { v = localStorage.getItem(k) || ''; } catch (e) {}
    if (/^[A-Za-z0-9\-]{8,64}$/.test(v)) return v;
    var a = new Uint8Array(16), hex = '';
    try { crypto.getRandomValues(a); } catch (e) { for (var i = 0; i < 16; i++) a[i] = Math.floor(Math.random() * 256); }
    for (var j = 0; j < 16; j++) hex += (a[j] < 16 ? '0' : '') + a[j].toString(16);
    v = 'd-' + hex;
    try { localStorage.setItem(k, v); } catch (e) {}
    return v;
  }
  function lastStd(c, set) {
    var k = 'hbt.att.std.' + c;
    try { if (set) localStorage.setItem(k, set); else return localStorage.getItem(k) || ''; } catch (e) {}
    return '';
  }

  function head() {
    return '<div class="stack-s"><a class="brand" href="' + root + 'index.html"><span class="mark">H</span>HBT Teaching</a><h1>เช็คชื่อเข้าเรียน</h1></div>';
  }
  function opt(v, t) { return '<option value="' + esc(v) + '">' + esc(t) + '</option>'; }
  function mmss(sec) { sec = Math.max(0, Math.round(sec)); return (sec < 600 ? '0' : '') + Math.floor(sec / 60) + ':' + (sec % 60 < 10 ? '0' : '') + (sec % 60); }

  /* ---------- หน้าจอ ---------- */
  function build() {
    var i = st.info;
    app.innerHTML = head() +
      '<p class="muted" id="crs">' + esc(i.course.code) + ' กลุ่ม ' + esc(i.course.section) + ' — ' + esc(i.course.name) + '</p>' +
      '<div class="callout" id="stBanner" role="status"></div>' +
      '<section class="card stack" id="form">' +
      '<div class="field"><label for="fq">ค้นหารหัสหรือชื่อของคุณ</label><input id="fq" type="search" autocomplete="off" placeholder="พิมพ์รหัสหรือชื่อ"></div>' +
      '<div class="field"><label for="selS">ชื่อของคุณ</label><select id="selS"><option value="">กำลังโหลด…</option></select></div>' +
      '<div id="pinBox" class="stack" hidden></div>' +
      '<div class="err" id="err" role="alert"></div>' +
      '<div id="conflict" class="callout warn stack-s" hidden></div>' +
      '<button class="btn primary block" type="button" id="go" style="min-height:50px;font-size:1.05rem">เช็คชื่อ</button>' +
      (i.hasLocation ? '<p class="small muted">คาบนี้ตรวจตำแหน่ง — เบราว์เซอร์จะขอสิทธิ์ใช้ตำแหน่ง ให้กด “อนุญาต”</p>' : '') +
      '</section>' +
      '<div id="done" class="callout good stack-s" hidden role="status"></div>' +
      '<p class="small muted">ยังไม่เคยตั้ง PIN หรือลืม PIN? <a href="' + root + 's/pin.html">ตั้ง / เปลี่ยน PIN</a> · <a href="' + root + 'index.html">กลับหน้าแรก</a></p>';
    banner();
    $('#fq').addEventListener('input', fill);
    $('#selS').addEventListener('change', onStd);
    $('#go').addEventListener('click', function () { submit(); });
    HBT.api.call('pub.students', { courseId: i.course.courseId }).then(function (r) {
      st.students = r.students; fill();
      var last = lastStd(i.course.courseId);
      if (last && st.students.some(function (s) { return s.stdId === last; })) { $('#selS').value = last; onStd(); }
    }, function (e) { $('#err').textContent = HBT.errMsg(e); $('#selS').innerHTML = opt('', 'โหลดรายชื่อไม่สำเร็จ'); });
  }

  function banner() {
    var i = st.info, b = $('#stBanner'); if (!b) return;
    var go = $('#go');
    var left = i.remainingSeconds === null ? null : i.remainingSeconds - (i.status === 'open' ? (Date.now() - st.fetchedAt) / 1000 : 0);
    if (i.status === 'closed') { b.className = 'callout bad'; b.innerHTML = '<b>คาบนี้ปิดรับเช็คชื่อแล้ว</b><br>หากมาเรียนแต่เช็คไม่ทัน แจ้งอาจารย์เพื่อแก้สถานะ'; if (go) go.disabled = true; return; }
    if (i.status === 'paused') { b.className = 'callout warn'; b.innerHTML = '<b>อาจารย์พักการเช็คชื่อชั่วคราว</b><br>รอสักครู่แล้วกด “ตรวจสอบอีกครั้ง” <button class="btn sm" type="button" id="recheck">ตรวจสอบอีกครั้ง</button>'; if (go) go.disabled = true; var rc = $('#recheck'); if (rc) rc.addEventListener('click', reloadInfo); return; }
    if (go && !st.busy) go.disabled = false;
    if (i.phase === 'late') { b.className = 'callout warn'; b.innerHTML = '<b>เลยเวลาปกติแล้ว — เช็คตอนนี้จะนับเป็น “สาย”</b>' + (left !== null ? '<br>ปิดรับใน ' + mmss(left) + ' นาที' : ''); }
    else { b.className = 'callout good'; b.innerHTML = '<b>เปิดรับเช็คชื่อ</b>' + (left !== null ? '<br>ปิดรับใน ' + mmss(left) + ' นาที' : ''); }
  }

  function reloadInfo() {
    return HBT.api.call('att.info', { sessionId: sid }).then(function (i) { st.info = i; st.fetchedAt = Date.now(); banner(); });
  }

  function fill() {
    var q = $('#fq').value.trim().toLowerCase();
    var list = st.students.filter(function (s) { return !q || s.stdId.toLowerCase().indexOf(q) >= 0 || s.name.toLowerCase().indexOf(q) >= 0; });
    var cur = $('#selS').value;
    $('#selS').innerHTML = opt('', list.length ? '— เลือกชื่อของคุณ (' + list.length + ') —' : 'ไม่พบรายชื่อที่ค้นหา') +
      list.map(function (s) { return opt(s.stdId, s.stdId + ' — ' + s.name); }).join('');
    if (cur && list.some(function (s) { return s.stdId === cur; })) $('#selS').value = cur;
    else if (list.length === 1 && q) $('#selS').value = list[0].stdId;
    onStd();
  }
  function onStd() {
    var v = $('#selS').value;
    if (v !== st.std) { st.std = v; setMode(''); cancelReq(); $('#err').textContent = ''; $('#done').hidden = true; $('#conflict').hidden = true; }
  }

  /* ---------- PIN ---------- */
  function pinField(id, label, auto) {
    return '<div class="field"><label for="' + id + '">' + label + '</label><input class="pin-in" id="' + id + '" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="' + (auto || 'off') + '"></div>';
  }
  function setMode(m) {
    st.mode = m;
    var box = $('#pinBox');
    if (!m) { box.hidden = true; box.innerHTML = ''; return; }
    var h = '';
    if (m === 'enter') h = '<p class="small"><b>เครื่องนี้ยังไม่เคยยืนยันตัวตน</b> — ใส่ PIN 4 หลักของคุณ</p>' + pinField('pin', 'PIN ของคุณ');
    else if (m === 'set') h = '<p class="small"><b>ตั้ง PIN ครั้งแรก</b> — เลือกตัวเลข 4 หลักที่จำได้ ใช้ร่วมกันทุกวิชา เก็บเป็นความลับ<br>ถ้าคุณไม่เคยตั้ง PIN แต่ระบบให้ใส่ PIN เดิม แจ้งอาจารย์ทันที</p>' + pinField('npin', 'PIN ใหม่ (ตัวเลข 4 หลัก)', 'new-password') + pinField('npin2', 'ยืนยัน PIN ใหม่', 'new-password');
    else if (m === 'temp') h = '<p class="small"><b>ตั้ง PIN ใหม่ด้วยรหัสชั่วคราว</b> — ขอรหัสชั่วคราว 4 หลักจากอาจารย์</p>' + pinField('tpin', 'รหัสชั่วคราวจากอาจารย์') + pinField('npin', 'PIN ใหม่ (ตัวเลข 4 หลัก)', 'new-password') + pinField('npin2', 'ยืนยัน PIN ใหม่', 'new-password');
    box.innerHTML = h; box.hidden = false;
    HBT.$$('.pin-in', box).forEach(function (i) { i.addEventListener('input', function () { i.value = i.value.replace(/\D/g, '').slice(0, 4); }); });
    var f = box.querySelector('input'); if (f) f.focus();
  }

  /* ---------- ตำแหน่ง ---------- */
  function getPos() {
    if (!st.info.hasLocation) return Promise.resolve(null);
    if (st.pos && Date.now() - st.posAt < 60000) return Promise.resolve(st.pos);
    return new Promise(function (res, rej) {
      if (!navigator.geolocation) { rej({ code: 'E_GPS', message: 'เบราว์เซอร์นี้ไม่รองรับการระบุตำแหน่ง ลองเปิดลิงก์ด้วย Chrome หรือ Safari' }); return; }
      navigator.geolocation.getCurrentPosition(function (p) {
        st.pos = { lat: p.coords.latitude, lng: p.coords.longitude }; st.posAt = Date.now(); res(st.pos);
      }, function (e) {
        rej({ code: 'E_GPS', message: e && e.code === 1 ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิดสิทธิ์ตำแหน่งของเว็บนี้ในการตั้งค่าเบราว์เซอร์/มือถือ แล้วกดเช็คชื่ออีกครั้ง' : 'หาตำแหน่งไม่ได้ — เปิด GPS ของมือถือ ออกไปใกล้หน้าต่าง แล้วลองอีกครั้ง' });
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
    });
  }

  /* ---------- ส่ง ---------- */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  /** เช็คชื่อซ้ำได้ปลอดภัย (server กันซ้ำ) จึงรอคิว/ลองใหม่ได้เมื่อ server ยุ่งหรือเน็ตสะดุด */
  function callRetry(action, args) {
    var n = 0;
    function go() {
      n++;
      return HBT.api.call(action, args).catch(function (e) {
        if ((e.code === 'E_BUSY' || e.code === 'E_NETWORK') && n < 5) {
          $('#err').textContent = 'กำลังรอคิว… (ครั้งที่ ' + (n + 1) + ')';
          return sleep(900 + Math.random() * 1600).then(go);
        }
        throw e;
      });
    }
    return go();
  }

  function setBusy(b) { st.busy = b; var g = $('#go'); if (g) { g.disabled = b || st.info.status !== 'open'; g.textContent = b ? 'กำลังเช็คชื่อ…' : 'เช็คชื่อ'; } }

  function submit() {
    if (st.busy) return;
    var err = $('#err'); err.textContent = ''; $('#conflict').hidden = true;
    if (!st.std) { err.textContent = 'เลือกชื่อของคุณก่อน'; return; }
    var a = { sessionId: sid, stdId: st.std, deviceId: deviceId() };
    var v = function (id) { var e = $('#' + id); return e ? e.value : ''; };
    var chk = function (x) { return /^\d{4}$/.test(x); };
    if (st.mode === 'enter') { if (!chk(v('pin'))) { err.textContent = 'PIN ต้องเป็นตัวเลข 4 หลัก'; return; } a.pin = v('pin'); }
    if (st.mode === 'set' || st.mode === 'temp') {
      if (st.mode === 'temp') { if (!chk(v('tpin'))) { err.textContent = 'รหัสชั่วคราวต้องเป็นตัวเลข 4 หลัก'; return; } a.tempPin = v('tpin'); }
      if (!chk(v('npin'))) { err.textContent = 'PIN ใหม่ต้องเป็นตัวเลข 4 หลัก'; return; }
      if (v('npin') !== v('npin2')) { err.textContent = 'PIN ใหม่ทั้งสองช่องไม่ตรงกัน'; return; }
      a.newPin = v('npin');
    }
    setBusy(true);
    getPos().then(function (p) {
      if (p) { a.lat = p.lat; a.lng = p.lng; }
      return callRetry('att.checkIn', a);
    }).then(function (r) {
      setBusy(false); success(r);
    }, function (e) {
      setBusy(false); fail(e);
    });
  }

  function success(r) {
    cancelReq(); lastStd(st.info.course.courseId, st.std);
    $('#form').hidden = true; $('#stBanner').hidden = true;
    var d = $('#done'); d.hidden = false;
    d.innerHTML = '<h2 id="okTitle">' + (r.already ? 'คุณเช็คชื่อไว้แล้ว' : 'เช็คชื่อสำเร็จ') + '</h2><p><b>' + esc(r.name) + '</b></p>' +
      '<p>สถานะ: <span class="pill ' + (r.status === 'late' ? 'warn' : 'good') + '" id="okStatus">' + esc(LBL[r.status] || r.status) + '</span></p>' +
      (r.pinJustSet ? '<p class="small"><b>ตั้ง PIN แล้ว</b> — จำไว้ ใช้ยืนยันตัวตนเมื่อเปลี่ยนเครื่อง</p>' : '') +
      '<p class="small muted">ปิดหน้านี้ได้เลย · ถ้าสถานะไม่ถูกต้อง แจ้งอาจารย์</p>';
  }

  function fail(e) {
    var c = e.code, err = $('#err');
    if (c === 'E_ATT_PIN_REQUIRED') {
      var m = e.detail && e.detail.mode; setMode(m || 'enter'); err.textContent = ''; return;
    }
    if (c === 'E_ATT_DEVICE_CONFLICT') {
      var who = e.detail && e.detail.usedByName ? e.detail.usedByName : 'คนอื่น';
      var box = $('#conflict'); box.hidden = false;
      box.innerHTML = '<b>เครื่องนี้ถูกใช้เช็คชื่อให้ ' + esc(who) + ' แล้ว</b><span class="small">1 เครื่องเช็คชื่อได้ 1 คนต่อคาบ · ถ้ามือถือคุณใช้ไม่ได้จริงๆ ขอให้อาจารย์อนุมัติได้</span>' +
        '<div class="row"><button class="btn sm primary" type="button" id="askBtn">ขออนุมัติจากอาจารย์</button></div>';
      $('#askBtn').addEventListener('click', ask);
      return;
    }
    if (c === 'E_ATT_OUT_OF_RANGE') {
      var d = e.detail || {};
      err.textContent = 'คุณอยู่นอกพื้นที่ห้องเรียน (ห่างประมาณ ' + d.distance + ' ม. ต้องไม่เกิน ' + d.radius + ' ม.) — เข้าใกล้ห้องเรียนหรือรอสัญญาณ GPS นิ่งแล้วกดอีกครั้ง';
      st.pos = null; return;
    }
    if (c === 'E_ATT_CLOSED' || c === 'E_ATT_PAUSED') { err.textContent = HBT.errMsg(e); reloadInfo(); return; }
    if (c === 'E_GPS') { err.textContent = e.message; return; }
    if (c === 'E_PIN_BAD' || c === 'E_PIN_LOCKED' || c === 'E_PIN_TEMP' || c === 'E_PIN_FORMAT') { err.textContent = HBT.errMsg(e); return; }
    err.textContent = HBT.errMsg(e);
  }

  /* ---------- ขออนุมัติเครื่องร่วม ---------- */
  function cancelReq() { clearTimeout(st.poll); st.req = null; }
  function ask() {
    var box = $('#conflict'), b = $('#askBtn');
    HBT.busy(b, function () { return HBT.api.call('att.requestOverride', { sessionId: sid, stdId: st.std, deviceId: deviceId() }); }).then(function (r) {
      st.req = { id: r.requestId, until: Date.now() + 125000 };
      box.innerHTML = '<b>ส่งคำขอถึงอาจารย์แล้ว</b><span class="small" id="waitTxt">รออาจารย์อนุมัติ… อย่าปิดหน้านี้</span><div class="row"><button class="btn sm" type="button" id="cancelBtn">ยกเลิกคำขอ</button></div>';
      $('#cancelBtn').addEventListener('click', function () { cancelReq(); box.hidden = true; });
      pollReq();
    }).catch(function (e) { $('#err').textContent = HBT.errMsg(e); });
  }
  function pollReq() {
    var r = st.req; if (!r) return;
    if (Date.now() > r.until) { $('#conflict').innerHTML = '<b>หมดเวลารออนุมัติ</b><span class="small">อาจารย์ยังไม่ตอบ ลองส่งคำขอใหม่ หรือเดินไปบอกอาจารย์</span><div class="row"><button class="btn sm primary" type="button" id="askBtn">ขออีกครั้ง</button></div>'; $('#askBtn').addEventListener('click', ask); st.req = null; return; }
    HBT.api.call('att.approvalStatus', { requestId: r.id }, { noRedirect: true }).then(function (x) {
      if (st.req !== r) return;
      if (x.status === 'approved') { st.req = null; $('#conflict').hidden = true; submit(); return; }
      if (x.status === 'denied') { st.req = null; $('#conflict').innerHTML = '<b>อาจารย์ไม่อนุมัติ</b><span class="small">ใช้มือถือของตัวเองเช็คชื่อ หรือแจ้งอาจารย์</span>'; return; }
      if (x.status === 'expired' || x.status === 'used') { st.req = null; $('#conflict').innerHTML = '<b>คำขอหมดอายุ</b><div class="row"><button class="btn sm primary" type="button" id="askBtn">ขออีกครั้ง</button></div>'; $('#askBtn').addEventListener('click', ask); return; }
      st.poll = setTimeout(pollReq, 3000);
    }, function () { st.poll = setTimeout(pollReq, 5000); });
  }

  /* ---------- เริ่ม ---------- */
  app.innerHTML = head() + '<div class="loading" role="status"><span class="spin"></span> กำลังโหลด…</div>';
  HBT.api.call('att.info', { sessionId: sid }).then(function (i) {
    st.info = i; st.fetchedAt = Date.now(); build();
    st.tickT = setInterval(banner, 1000);
  }, function (e) {
    var nf = e.code === 'E_NOT_FOUND';
    app.innerHTML = head() + '<div class="callout bad" id="infoErr"><b>' + (nf ? 'ไม่พบคาบเช็คชื่อนี้' : 'โหลดไม่สำเร็จ') + '</b><br>' + esc(nf ? 'ลิงก์อาจผิดหรือถูกลบแล้ว สแกน QR จากหน้าจออาจารย์อีกครั้ง' : HBT.errMsg(e)) + '</div>' +
      (nf ? '' : '<div><button class="btn" type="button" id="retry">ลองใหม่</button></div>');
    var rb = $('#retry'); if (rb) rb.addEventListener('click', function () { location.reload(); });
  });
})();
