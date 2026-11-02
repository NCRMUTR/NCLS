/* HBT Core — หน้านักศึกษา: ตั้ง / เปลี่ยน / ขอรีเซ็ต PIN (ไม่ต้องล็อกอิน) */
(function () {
  'use strict';
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var app = document.getElementById('app');
  var st = { teacher: '', course: '', students: [], std: '', tab: 'first' };

  if (!HBT.api.configuredCore()) {
    app.innerHTML = '<div class="callout warn"><b>ยังไม่ได้ตั้งค่าเว็บ</b><br>ไฟล์ assets/config.js ยังไม่มี CORE_URL</div>';
    return;
  }

  app.innerHTML =
    '<div class="stack-s"><a class="brand" href="' + root + 'index.html"><span class="mark">H</span>HBT Teaching</a>' +
    '<h1>ตั้ง / เปลี่ยน PIN</h1><p class="muted">PIN 4 หลักของคุณใช้ยืนยันตัวตนตอนเช็คชื่อ ส่งงาน และทำข้อสอบ — ใช้ร่วมกันทุกวิชา</p></div>' +
    '<section class="card stack" id="pick"><h2>คุณคือใคร</h2>' +
    '<div class="field"><label for="selT">อาจารย์ผู้สอน</label><select id="selT"><option value="">กำลังโหลด…</option></select></div>' +
    '<div class="field"><label for="selC">รายวิชา</label><select id="selC" disabled><option value="">เลือกอาจารย์ก่อน</option></select></div>' +
    '<div class="field"><label for="fq">ค้นหารหัสหรือชื่อของคุณ</label><input id="fq" type="search" autocomplete="off" disabled placeholder="พิมพ์รหัสหรือชื่อ"></div>' +
    '<div class="field"><label for="selS">ชื่อของคุณ</label><select id="selS" disabled><option value="">เลือกรายวิชาก่อน</option></select></div>' +
    '<div class="err" id="pickErr" role="alert"></div></section>' +
    '<section class="card stack" id="act" hidden>' +
    '<div class="tabs" role="tablist" aria-label="เลือกสิ่งที่ต้องการทำ">' +
    '<button type="button" role="tab" id="tab-first" data-tab="first" aria-selected="true">ตั้ง PIN ครั้งแรก</button>' +
    '<button type="button" role="tab" id="tab-change" data-tab="change" aria-selected="false">เปลี่ยน PIN</button>' +
    '<button type="button" role="tab" id="tab-forgot" data-tab="forgot" aria-selected="false">ลืม PIN</button></div>' +
    '<div id="p-first" class="stack"><p class="small muted">ขอ “รหัสชั่วคราว 4 หลัก” จากอาจารย์ แล้วใส่ที่นี่พร้อมตั้ง PIN ใหม่ของคุณ (ใช้ได้ครั้งเดียว มีอายุ 7 วัน)</p>' +
    '<div class="field"><label for="f-temp">รหัสชั่วคราวจากอาจารย์</label><input class="pin-in" id="f-temp" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"></div>' +
    '<div class="field"><label for="f-new">PIN ใหม่ (ตัวเลข 4 หลัก)</label><input class="pin-in" id="f-new" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password"></div>' +
    '<div class="field"><label for="f-new2">ยืนยัน PIN ใหม่</label><input class="pin-in" id="f-new2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password"></div>' +
    '<button class="btn primary block" type="button" id="goFirst">ตั้ง PIN</button></div>' +
    '<div id="p-change" class="stack" hidden><div class="field"><label for="c-old">PIN เดิม</label><input class="pin-in" id="c-old" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"></div>' +
    '<div class="field"><label for="c-new">PIN ใหม่ (ตัวเลข 4 หลัก)</label><input class="pin-in" id="c-new" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password"></div>' +
    '<div class="field"><label for="c-new2">ยืนยัน PIN ใหม่</label><input class="pin-in" id="c-new2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password"></div>' +
    '<button class="btn primary block" type="button" id="goChange">เปลี่ยน PIN</button></div>' +
    '<div id="p-forgot" class="stack" hidden><p class="small muted">ระบบเก็บ PIN แบบเข้ารหัส อาจารย์มองไม่เห็น PIN ของคุณ — ถ้าลืม ให้ส่งคำขอ แล้วรับ “รหัสชั่วคราว” ใหม่จากอาจารย์ไปตั้ง PIN ที่แท็บแรก</p>' +
    '<button class="btn primary block" type="button" id="goForgot">ส่งคำขอให้อาจารย์ออกรหัสใหม่</button></div>' +
    '<div class="err" id="actErr" role="alert"></div><div class="callout" id="actOk" hidden role="status"></div></section>' +
    '<p class="small muted">PIN ผิดหลายครั้งติดกัน ระบบจะล็อกชั่วคราวเพื่อป้องกันผู้อื่นเดา · <a href="' + root + 'index.html">กลับหน้าแรก</a></p>';

  function opt(v, t) { return '<option value="' + esc(v) + '">' + esc(t) + '</option>'; }
  function fail(el, e) { $(el).textContent = HBT.errMsg(e); }
  function clearMsgs() { $('#pickErr').textContent = ''; $('#actErr').textContent = ''; $('#actOk').hidden = true; }

  function fillStudents() {
    var q = $('#fq').value.trim().toLowerCase();
    var list = st.students.filter(function (s) { return !q || s.stdId.toLowerCase().indexOf(q) >= 0 || s.name.toLowerCase().indexOf(q) >= 0; });
    var cur = $('#selS').value;
    $('#selS').innerHTML = opt('', list.length ? '— เลือกชื่อของคุณ (' + list.length + ') —' : 'ไม่พบรายชื่อที่ค้นหา') +
      list.map(function (s) { return opt(s.stdId, s.stdId + ' — ' + s.name); }).join('');
    if (cur && list.some(function (s) { return s.stdId === cur; })) $('#selS').value = cur;
    else if (list.length === 1 && q) { $('#selS').value = list[0].stdId; }
    onStd();
  }
  function onStd() {
    st.std = $('#selS').value;
    $('#act').hidden = !st.std;
    clearMsgs();
  }

  HBT.api.call('pub.teachers').then(function (r) {
    $('#selT').innerHTML = opt('', r.teachers.length ? '— เลือกอาจารย์ —' : 'ยังไม่มีรายวิชาในภาคเรียนนี้') + r.teachers.map(function (t) { return opt(t.tid, t.name); }).join('');
  }, function (e) { $('#selT').innerHTML = opt('', 'โหลดไม่สำเร็จ'); fail('#pickErr', e); });

  $('#selT').addEventListener('change', function () {
    st.teacher = this.value; st.course = ''; st.students = []; clearMsgs();
    $('#selC').disabled = true; $('#selS').disabled = true; $('#fq').disabled = true; $('#fq').value = '';
    $('#selS').innerHTML = opt('', 'เลือกรายวิชาก่อน'); onStd();
    if (!st.teacher) { $('#selC').innerHTML = opt('', 'เลือกอาจารย์ก่อน'); return; }
    $('#selC').innerHTML = opt('', 'กำลังโหลด…');
    HBT.api.call('pub.courses', { tid: st.teacher }).then(function (r) {
      $('#selC').innerHTML = opt('', '— เลือกรายวิชา —') + r.courses.map(function (c) { return opt(c.courseId, c.code + ' กลุ่ม ' + c.section + ' — ' + c.name); }).join('');
      $('#selC').disabled = false;
    }, function (e) { fail('#pickErr', e); });
  });
  $('#selC').addEventListener('change', function () {
    st.course = this.value; st.students = []; clearMsgs(); $('#fq').value = '';
    $('#selS').disabled = true; $('#fq').disabled = true; $('#selS').innerHTML = opt('', 'เลือกรายวิชาก่อน'); onStd();
    if (!st.course) return;
    $('#selS').innerHTML = opt('', 'กำลังโหลด…');
    HBT.api.call('pub.students', { courseId: st.course }).then(function (r) {
      st.students = r.students; $('#selS').disabled = false; $('#fq').disabled = false; fillStudents();
    }, function (e) { fail('#pickErr', e); });
  });
  $('#fq').addEventListener('input', fillStudents);
  $('#selS').addEventListener('change', onStd);

  function setTab(t) {
    st.tab = t; clearMsgs();
    HBT.$$('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.getAttribute('data-tab') === t ? 'true' : 'false'); });
    ['first', 'change', 'forgot'].forEach(function (k) { $('#p-' + k).hidden = k !== t; });
  }
  HBT.$$('.tabs button').forEach(function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });

  HBT.$$('.pin-in').forEach(function (i) {
    i.addEventListener('input', function () { i.value = i.value.replace(/\D/g, '').slice(0, 4); });
  });

  function chk(v) { return /^\d{4}$/.test(v); }
  function done(msg) {
    $('#actOk').textContent = msg; $('#actOk').hidden = false; $('#actErr').textContent = '';
    HBT.$$('.pin-in').forEach(function (i) { i.value = ''; });
  }
  function base() { return { courseId: st.course, stdId: st.std }; }
  function name() { var s = st.students.filter(function (x) { return x.stdId === st.std; })[0]; return s ? s.name : ''; }

  $('#goFirst').addEventListener('click', function () {
    var t = $('#f-temp').value, n = $('#f-new').value, n2 = $('#f-new2').value;
    clearMsgs();
    if (!chk(t)) { $('#actErr').textContent = 'รหัสชั่วคราวต้องเป็นตัวเลข 4 หลัก'; return; }
    if (!chk(n)) { $('#actErr').textContent = 'PIN ใหม่ต้องเป็นตัวเลข 4 หลัก'; return; }
    if (n !== n2) { $('#actErr').textContent = 'PIN ใหม่ทั้งสองช่องไม่ตรงกัน'; return; }
    var a = base(); a.tempPin = t; a.newPin = n;
    HBT.busy(this, function () { return HBT.api.call('pin.setWithTemp', a).then(function () { done('ตั้ง PIN เรียบร้อยแล้ว ' + name() + ' — จำ PIN นี้ไว้ใช้ตอนเช็คชื่อ ส่งงาน และสอบ'); }); })
      .catch(function (e) { fail('#actErr', e); });
  });
  $('#goChange').addEventListener('click', function () {
    var o = $('#c-old').value, n = $('#c-new').value, n2 = $('#c-new2').value;
    clearMsgs();
    if (!chk(o)) { $('#actErr').textContent = 'PIN เดิมต้องเป็นตัวเลข 4 หลัก'; return; }
    if (!chk(n)) { $('#actErr').textContent = 'PIN ใหม่ต้องเป็นตัวเลข 4 หลัก'; return; }
    if (n !== n2) { $('#actErr').textContent = 'PIN ใหม่ทั้งสองช่องไม่ตรงกัน'; return; }
    var a = base(); a.oldPin = o; a.newPin = n;
    HBT.busy(this, function () { return HBT.api.call('pin.change', a).then(function () { done('เปลี่ยน PIN เรียบร้อยแล้ว'); }); })
      .catch(function (e) { fail('#actErr', e); });
  });
  $('#goForgot').addEventListener('click', function () {
    clearMsgs();
    HBT.busy(this, function () { return HBT.api.call('pin.request', base()).then(function () { done('ส่งคำขอแล้ว — แจ้งอาจารย์ให้ออกรหัสชั่วคราวใหม่ แล้วนำมาตั้ง PIN ที่แท็บ “ตั้ง PIN ครั้งแรก”'); }); })
      .catch(function (e) { fail('#actErr', e); });
  });
})();
