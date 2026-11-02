/* HBT Core — layout.js : โครงหน้าอาจารย์/ผู้ดูแล (แถบบน + เมนูข้าง) และการตรวจสิทธิ์ก่อนแสดงหน้า
 *
 * ใช้ในแต่ละหน้า:
 *   <body data-root="../" data-page="a/users.html"><div id="app"></div>
 *   HBT.page({ active:'users', need:'admin', crumbs:[['ผู้ดูแล'],['ผู้ใช้และสิทธิ์']] }, function (ctx) {
 *       ctx.content.innerHTML = '...';     // ctx = { user, me, term, content }
 *   });
 * need: 'admin' | 'att' | 'exam' | 'asg' | ไม่ระบุ = ผู้ใช้ที่ล็อกอินแล้วทุกคน
 */
(function () {
  'use strict';
  var HBT = window.HBT = window.HBT || {};
  var esc = HBT.esc;

  function can(u, sys) { return u.role === 'admin' || u.systems.indexOf(sys) >= 0; }

  function navHtml(u, active, root) {
    function link(key, label, href) {
      return '<a class="' + (key === active ? 'on' : '') + '" href="' + root + href + '"' + (key === active ? ' aria-current="page"' : '') + '>' + esc(label) + '</a>';
    }
    var h = '<h4>ภาพรวม</h4>' + link('home', 'หน้าหลัก', 't/home.html') + link('courses', 'รายวิชาของฉัน', 't/courses.html');
    var mine = ['att', 'exam', 'asg'].filter(function (s) { return can(u, s); });
    if (mine.length) {
      h += '<h4>ระบบที่ใช้ได้</h4>';
      mine.forEach(function (s) {
        h += link(s, HBT.SYSTEM_NAMES[s], 't/courses.html');        // เช็คชื่อ/สอบออนไลน์/ส่งงานทำงานรายวิชา → เลือกวิชาก่อน
      });
    }
    if (u.role === 'admin') {
      h += '<h4>ผู้ดูแลระบบ</h4>' + link('users', 'ผู้ใช้และสิทธิ์', 'a/users.html') + link('settings', 'ตั้งค่าระบบ', 'a/settings.html') + link('reset', 'ลบข้อมูลสิ้นภาคเรียน', 'a/reset.html');
    }
    return h;
  }

  function shell(u, opt, root) {
    var adm = u.role === 'admin';
    var initial = esc((u.name || u.email || '?').replace(/^อ\.\s*/, '').charAt(0).toUpperCase());
    var crumbs = '';
    if (opt.crumbs && opt.crumbs.length) {
      crumbs = '<div class="crumbs">' + opt.crumbs.map(function (c, i) {
        var t = c[1] ? '<a href="' + root + esc(c[1]) + '">' + esc(c[0]) + '</a>' : '<span>' + esc(c[0]) + '</span>';
        return (i ? '<span>›</span> ' : '') + t;
      }).join(' ') + '</div>';
    }
    return '<header class="topbar"><div class="row">' +
      '<button class="btn sm menu-btn" type="button" id="menuBtn" aria-label="เมนู" aria-expanded="false" aria-controls="side">เมนู</button>' +
      '<a class="brand" href="' + root + 't/home.html"><span class="mark">H</span>HBT Teaching</a>' +
      '<span class="pill ' + (adm ? 'adm' : 'acc') + '">' + (adm ? 'ผู้ดูแลระบบ' : 'อาจารย์') + '</span></div>' +
      '<div class="row"><div class="who"><span class="avatar"' + (adm ? ' style="background:var(--adm-soft);color:var(--adm)"' : '') + '>' + initial + '</span>' +
      '<span class="small" id="whoEmail">' + esc(u.email) + '</span></div>' +
      '<button class="btn sm ghost" type="button" id="logoutBtn">ออกจากระบบ</button></div></header>' +
      '<div class="app"><aside class="side' + (adm ? ' adm' : '') + '" id="side" aria-label="เมนูหลัก">' + navHtml(u, opt.active, root) + '</aside>' +
      '<div class="main" id="content">' + crumbs + '</div></div>';
  }

  function bind() {
    var mb = document.getElementById('menuBtn'), side = document.getElementById('side');
    if (mb && side) mb.addEventListener('click', function () {
      var o = side.classList.toggle('open');
      mb.setAttribute('aria-expanded', o ? 'true' : 'false');
    });
    var lb = document.getElementById('logoutBtn');
    if (lb) lb.addEventListener('click', function () {
      lb.disabled = true;
      HBT.api.logout().then(function () {
        try { if (window.google && google.accounts && google.accounts.id) google.accounts.id.disableAutoSelect(); } catch (e) {}
        HBT.api.goLogin('bye');
      });
    });
  }

  function box(cls, title, text, extra) {
    return '<div class="s-main" style="margin-top:32px"><div class="callout ' + cls + '"><b>' + esc(title) + '</b><br>' + esc(text) + '</div>' + (extra || '') + '</div>';
  }

  HBT.page = function (opt, render) {
    opt = opt || {};
    var app = document.getElementById('app');
    var root = HBT.api.root();
    if (!HBT.api.configured()) {
      app.innerHTML = box('warn', 'ยังไม่ได้ตั้งค่าเว็บ', 'ไฟล์ assets/config.js ยังไม่มี GOOGLE_CLIENT_ID หรือ CORE_URL — ดูขั้นตอนใน README');
      return;
    }
    if (!HBT.api.session()) { HBT.api.goLogin('need'); return; }
    app.innerHTML = '<div class="loading" role="status"><span class="spin"></span> กำลังโหลด…</div>';

    function load() {
      HBT.api.call('auth.me').then(function (me) {
        var u = me.user;
        HBT.api.setUser(u);
        app.innerHTML = shell(u, opt, root);
        bind();
        var content = document.getElementById('content');
        var denied = (opt.need === 'admin' && u.role !== 'admin') ||
          (opt.need && opt.need !== 'admin' && !can(u, opt.need));
        if (denied) {
          content.insertAdjacentHTML('beforeend',
            '<div class="callout bad"><b>ไม่มีสิทธิ์ใช้งานส่วนนี้</b><br>ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์</div>' +
            '<div><a class="btn" href="' + root + 't/home.html">กลับหน้าหลัก</a></div>');
          return;
        }
        return render({ user: u, me: me, term: me.term, content: content });
      }).catch(function (e) {
        app.innerHTML = box('bad', 'โหลดหน้านี้ไม่สำเร็จ', HBT.errMsg(e),
          '<div class="row"><button class="btn primary" type="button" id="retryBtn">ลองใหม่</button></div>');
        var rb = document.getElementById('retryBtn');
        if (rb) rb.addEventListener('click', function () { app.innerHTML = '<div class="loading"><span class="spin"></span> กำลังโหลด…</div>'; load(); });
      });
    }
    load();
  };
})();
