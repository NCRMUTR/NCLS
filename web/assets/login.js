/* HBT Core — login.js : เข้าสู่ระบบอาจารย์ด้วย Google Identity Services */
(function () {
  'use strict';
  var HBT = window.HBT, esc = HBT.esc;
  var C = window.HBT_CONFIG || {};
  var qs = new URLSearchParams(location.search);
  var msg = document.getElementById('msg');
  var gwrap = document.getElementById('gwrap');
  var DEST = 't/home.html';

  function dest() { return HBT.api.safeNext(qs.get('next')) || DEST; }
  function show(cls, title, text) {
    msg.innerHTML = '<div class="callout ' + cls + '"><b>' + esc(title) + '</b>' + (text ? '<br>' + esc(text) : '') + '</div>';
  }
  function clear() { msg.innerHTML = ''; }

  /* อ่านอีเมลจาก JWT "เพื่อแสดงผลเท่านั้น" — การตรวจสิทธิ์จริงทำที่ server */
  function emailOf(jwt) {
    try {
      var p = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      while (p.length % 4) p += '=';
      var o = JSON.parse(decodeURIComponent(escape(atob(p))));
      return String(o.email || '');
    } catch (e) { return ''; }
  }

  function onCredential(resp) {
    var jwt = resp && resp.credential;
    if (!jwt) { show('bad', 'ไม่ได้รับข้อมูลจาก Google', 'กรุณาลองใหม่อีกครั้ง'); return; }
    var who = emailOf(jwt);
    gwrap.hidden = true;
    msg.innerHTML = '<div class="loading" role="status"><span class="spin"></span> กำลังตรวจสอบบัญชี…</div>';
    HBT.api.login(jwt).then(function () {
      location.replace(HBT.api.root() + dest());
    }, function (e) {
      gwrap.hidden = false;
      var c = e.code;
      if (c === 'E_DOMAIN') show('bad', 'ใช้ได้เฉพาะบัญชีมหาวิทยาลัย (@rmutr.ac.th)', (who ? 'บัญชี ' + who + ' ไม่ได้รับอนุญาต ' : '') + 'ออกจากบัญชีนี้แล้วเลือกบัญชีมหาวิทยาลัย');
      else if (c === 'E_NOT_LISTED') show('warn', 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน', (who ? who + ' ไม่อยู่ในรายชื่อ ' : '') + 'ติดต่อผู้ดูแลระบบเพื่อเพิ่มสิทธิ์');
      else if (c === 'E_DISABLED') show('warn', 'บัญชีถูกปิดใช้งาน', 'ติดต่อผู้ดูแลระบบ');
      else if (c === 'E_BAD_TOKEN') show('bad', 'ยืนยันตัวตนกับ Google ไม่สำเร็จ', 'กรุณาลองใหม่อีกครั้ง');
      else if (c === 'E_NOT_SETUP') show('warn', 'ระบบยังตั้งค่าไม่เสร็จ', 'ผู้ดูแลต้องรัน setupCore ใน Apps Script ก่อน (ดู README)');
      else show('bad', 'เข้าสู่ระบบไม่สำเร็จ', HBT.errMsg(e));
    });
  }

  function initGoogle() {
    try {
      google.accounts.id.initialize({
        client_id: C.GOOGLE_CLIENT_ID, callback: onCredential, auto_select: false, cancel_on_tap_outside: true
      });
      google.accounts.id.renderButton(document.getElementById('gbtn'), {
        type: 'standard', theme: 'outline', size: 'large', shape: 'pill', text: 'signin_with', locale: 'th', width: 280
      });
    } catch (e) {
      show('bad', 'เริ่ม Google Sign-In ไม่สำเร็จ', 'ตรวจสอบ GOOGLE_CLIENT_ID และโดเมนของเว็บที่ลงทะเบียนไว้ใน Google Cloud');
    }
  }

  function loadGoogle() {
    var s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true; s.defer = true;
    s.onload = initGoogle;
    s.onerror = function () { show('bad', 'โหลด Google Sign-In ไม่ได้', 'ตรวจสอบอินเทอร์เน็ต (หรือตัวบล็อกโฆษณา) แล้วรีเฟรชหน้า'); };
    document.head.appendChild(s);
  }

  /* ---------- เริ่มต้น ---------- */
  if (!HBT.api.configured()) {
    gwrap.hidden = true;
    show('warn', 'ยังไม่ได้ตั้งค่าเว็บ', 'ไฟล์ assets/config.js ยังไม่มี GOOGLE_CLIENT_ID หรือ CORE_URL — ดูขั้นตอนใน README');
    return;
  }
  if (HBT.api.session()) { location.replace(HBT.api.root() + dest()); return; }

  var why = qs.get('why');
  if (why === 'expired') show('info', 'เซสชันหมดอายุ', 'กดลงชื่อเข้าใช้อีกครั้งเพื่อทำงานต่อ');
  else if (why === 'disabled') show('warn', 'บัญชีถูกปิดใช้งาน', 'ติดต่อผู้ดูแลระบบ');
  else if (why === 'bye') show('good', 'ออกจากระบบแล้ว', '');
  loadGoogle();
})();
