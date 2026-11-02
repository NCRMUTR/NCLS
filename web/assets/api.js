/* HBT Core — api.js : เรียก Core API + เก็บเซสชัน
 * คำขอ POST แบบ text/plain (ไม่เกิด CORS preflight) → { ok, data } | { ok:false, error:{code,msg,detail} }
 * คำสั่งเขียน (write:true) แนบ opId — ส่งซ้ำด้วย opId เดิมเมื่อเน็ตหลุด server จะไม่ทำซ้ำ */
(function () {
  'use strict';
  var HBT = window.HBT = window.HBT || {};
  var C = window.HBT_CONFIG || {};
  var KEY = 'hbt.session';
  var mem = null;          // สำรองไว้เมื่อเบราว์เซอร์ปิดการใช้ sessionStorage

  function rd() {
    try { var v = sessionStorage.getItem(KEY); return v ? JSON.parse(v) : mem; } catch (e) { return mem; }
  }
  function wr(v) {
    mem = v;
    try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY); } catch (e) {}
  }
  function session() {
    var s = rd();
    if (!s || !s.token) return null;
    if (!s.expiresAt || s.expiresAt < Date.now()) { wr(null); return null; }
    return s;
  }
  function configured() { return !!(C.GOOGLE_CLIENT_ID && C.CORE_URL); }
  function configuredCore() { return !!C.CORE_URL; }          // หน้านักศึกษาใช้แค่ URL (ไม่ล็อกอิน Google)
  function configuredExam() { return !!C.EXAM_URL; }          // ระบบสอบเป็น Web App แยก (Exam API)

  function ApiError(code, msg, detail) {
    var e = new Error(msg || code);
    e.code = code; e.detail = detail || null;
    return e;
  }
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function newOpId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function root() { return document.body ? (document.body.getAttribute('data-root') || '') : ''; }

  /** รับเฉพาะพาธภายในเว็บ (กัน open redirect): a/b.html */
  function safeNext(n) {
    return (typeof n === 'string' && /^[a-z0-9_\-]+(\/[a-z0-9_\-]+)*\.html$/i.test(n)) ? n : '';
  }
  function goLogin(why) {
    var page = document.body ? document.body.getAttribute('data-page') : '';
    var q = '?why=' + encodeURIComponent(why || 'need') + (why !== 'bye' && safeNext(page) ? '&next=' + encodeURIComponent(page) : '');
    location.replace(root() + 't/login.html' + q);
  }

  function post(url, body) {
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body), redirect: 'follow', cache: 'no-store'
    }).then(function (r) { return r.text(); }, function () {
      throw ApiError('E_NETWORK', 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่');
    }).then(function (t) {
      var j;
      try { j = JSON.parse(t); } catch (e) { throw ApiError('E_NETWORK', 'เซิร์ฟเวอร์ตอบกลับไม่ถูกต้อง ลองใหม่อีกครั้ง'); }
      return j;
    });
  }

  /** call(action, args, {write, opId, noRedirect, token, api:'exam'}) → Promise<data>
   *  api:'exam' = เรียก Exam API (EXAM_URL) แทน Core · token: ส่งโทเค็นของตัวเอง (นักศึกษา s / ผู้ทำข้อสอบ a) ไม่ใช้เซสชันอาจารย์ */
  function call(action, args, opt) {
    opt = opt || {};
    var url = opt.api === 'exam' ? C.EXAM_URL : C.CORE_URL;
    if (!url) return Promise.reject(ApiError('E_NOT_SETUP', opt.api === 'exam' ? 'ยังไม่ได้ตั้งค่า EXAM_URL ใน assets/config.js (ระบบสอบออนไลน์)' : 'ยังไม่ได้ตั้งค่า CORE_URL'));
    var s = session();
    var own = typeof opt.token === 'string';          // หน้านักศึกษาส่ง token ของตัวเอง (ชนิด s) — ไม่ใช้เซสชันอาจารย์
    var body = { action: action, token: own ? opt.token : (s ? s.token : ''), args: args || {} };   // action ต้องอยู่หน้าสุด (server ใช้ตรวจ body ใหญ่ของ stu.upload)
    if (opt.write) body.opId = opt.opId || newOpId();
    var n = 0;
    function attempt() {
      n++;
      return post(url, body).then(function (j) {
        if (j && j.ok) return j.data;
        var er = (j && j.error) || {};
        throw ApiError(er.code || 'E_UNKNOWN', er.msg, er.detail);
      }).catch(function (e) {
        if ((e.code === 'E_NETWORK' || e.code === 'E_BUSY') && n < 3) return sleep(600 * n).then(attempt);
        throw e;
      });
    }
    return attempt().catch(function (e) {
      if (!opt.noRedirect && !own && (e.code === 'E_AUTH' || e.code === 'E_DISABLED') && action !== 'auth.login') {
        wr(null);
        goLogin(e.code === 'E_DISABLED' ? 'disabled' : 'expired');
        return new Promise(function () {});     // กำลังย้ายหน้า — ไม่ให้หน้านี้แสดง error ซ้อน
      }
      throw e;
    });
  }

  function login(idToken) {
    return call('auth.login', { idToken: idToken }, { noRedirect: true }).then(function (r) {
      wr({ token: r.token, expiresAt: r.expiresAt, user: r.user });
      return r;
    });
  }
  function logout() {
    var done = function () { wr(null); };
    if (!session()) { done(); return Promise.resolve(); }
    return call('auth.logout', {}, { noRedirect: true }).then(done, done);
  }
  function setUser(u) {
    var s = rd();
    if (s) { s.user = u; wr(s); }
  }

  HBT.api = {
    call: call, login: login, logout: logout, session: session, setUser: setUser,
    configured: configured, configuredCore: configuredCore, configuredExam: configuredExam, goLogin: goLogin, safeNext: safeNext, root: root, ApiError: ApiError
  };
})();
