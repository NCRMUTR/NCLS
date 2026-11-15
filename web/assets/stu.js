/* HBT Core — stu.js : ตัวช่วยหน้านักศึกษา (เข้าด้วยชื่อ + PIN → token ชนิด s อายุ 2 ชม. เก็บใน sessionStorage ของแท็บนี้)
 * ไม่ใช้เซสชันอาจารย์ · ไม่มีบัญชี Google · PIN ไม่ถูกเก็บไว้ที่ใดเลย (ส่งตอนเข้าครั้งเดียว) */
(function () {
  'use strict';
  var HBT = window.HBT = window.HBT || {};
  var esc = HBT.esc, $ = HBT.$;
  var KEY = 'hbt.stu';
  var mem = null;

  function rd() { try { var v = sessionStorage.getItem(KEY); return v ? JSON.parse(v) : mem; } catch (e) { return mem; } }
  function wr(v) { mem = v; try { if (v) sessionStorage.setItem(KEY, JSON.stringify(v)); else sessionStorage.removeItem(KEY); } catch (e) {} }
  function sess() {
    var s = rd();
    if (!s || !s.token || !s.expiresAt || s.expiresAt < Date.now() + 30000) { if (s) wr(null); return null; }
    return s;
  }
  function lsGet(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /** เรียก API ด้วย token นักศึกษา · E_AUTH → ล้างเซสชันแล้วโยน error ให้หน้าแสดงฟอร์มเข้าใหม่ (ไม่ย้ายหน้า) */
  function call(action, args, opt) {
    var s = sess();
    return HBT.api.call(action, args, Object.assign({ token: s ? s.token : '' }, opt || {})).catch(function (e) {
      if (e && e.code === 'E_AUTH') wr(null);
      throw e;
    });
  }
  function login(courseId, stdId, pin, tid) {
    return HBT.api.call('stu.login', { courseId: courseId, stdId: stdId, pin: pin }, { token: '' }).then(function (r) {
      var s = { token: r.token, expiresAt: r.expiresAt, courseId: r.course.courseId, stdId: r.stdId, name: r.name, course: r.course, tid: tid || '' };
      wr(s); lsSet('hbt.asg.std.' + s.courseId, s.stdId);
      return s;
    });
  }
  function clear() { wr(null); }

  function opt(v, t) { return '<option value="' + esc(v) + '">' + esc(t) + '</option>'; }
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (Math.round(n / 104857.6) / 10) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  /** ฟอร์ม “คุณคือใคร + PIN” ของวิชาที่ทราบแล้ว
   *  opts = { courseId, tid, note?, onDone(sess) }  → คืน { destroy() } */
  function loginBox(box, opts) {
    var students = [], busy = false;
    box.innerHTML =
      '<div class="field"><label for="lq">ค้นหารหัสหรือชื่อของคุณ</label><input id="lq" type="search" autocomplete="off" placeholder="พิมพ์รหัสหรือชื่อ"></div>' +
      '<div class="field"><label for="lsel">ชื่อของคุณ</label><select id="lsel"><option value="">กำลังโหลด…</option></select></div>' +
      '<div class="field"><label for="lpin" id="lpinLbl">PIN 4 หลัก</label><input class="pin-in" id="lpin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"></div>' +
      '<div class="field" id="lpin2Box" hidden><label for="lpin2">ยืนยัน PIN ใหม่อีกครั้ง</label><input class="pin-in" id="lpin2" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="new-password"></div>' +
      '<div class="callout warn small" id="lfirst" hidden><b>เข้าครั้งแรกของภาคเรียนนี้</b> — ยังไม่มี PIN ของคุณ ตั้งได้เลย: ใส่ PIN 4 หลักที่ต้องการในช่องบน แล้วยืนยันอีกครั้งในช่องนี้ จำไว้ใช้ตลอดภาคเรียน (ถ้าไม่ใช่คุณที่ไม่เคยตั้ง แต่ระบบให้ตั้ง PIN ใหม่ แจ้งอาจารย์)</div>' +
      '<div class="err" id="lerr" role="alert"></div>' +
      '<button class="btn primary block" type="button" id="lgo" style="min-height:50px;font-size:1.05rem">เข้าสู่ระบบ</button>' +
      '<p class="small muted">ลืม PIN? <a href="' + HBT.api.root() + 's/pin.html">เปลี่ยน PIN / ขอรหัสชั่วคราว</a></p>';

    function fill() {
      var q = $('#lq', box).value.trim().toLowerCase();
      var list = students.filter(function (s) { return !q || s.stdId.toLowerCase().indexOf(q) >= 0 || s.name.toLowerCase().indexOf(q) >= 0; });
      var cur = $('#lsel', box).value;
      $('#lsel', box).innerHTML = opt('', list.length ? '— เลือกชื่อของคุณ (' + list.length + ') —' : 'ไม่พบรายชื่อที่ค้นหา') +
        list.map(function (s) { return opt(s.stdId, s.stdId + ' — ' + s.name); }).join('');
      if (cur && list.some(function (s) { return s.stdId === cur; })) $('#lsel', box).value = cur;
      else if (list.length === 1 && q) $('#lsel', box).value = list[0].stdId;
    }
    var firstMode = false;      // true = ยังไม่มี PIN ของภาคเรียนนี้ → ตั้งเองตอนเข้าครั้งแรก (ต้องใส่ยืนยัน)
    function setFirstMode(on) {
      firstMode = on; $('#lpin2Box', box).hidden = !on; $('#lfirst', box).hidden = !on;
      $('#lpinLbl', box).textContent = on ? 'PIN ใหม่ (ตัวเลข 4 หลัก)' : 'PIN 4 หลัก';
      $('#lgo', box).textContent = on ? 'ตั้ง PIN และเข้าสู่ระบบ' : 'เข้าสู่ระบบ';
      if (!on) $('#lpin2', box).value = '';
    }
    function submit() {
      var std = $('#lsel', box).value, pin = $('#lpin', box).value, pin2 = $('#lpin2', box).value, err = $('#lerr', box), b = $('#lgo', box);
      err.textContent = '';
      if (!std) { err.textContent = 'กรุณาเลือกชื่อของคุณ'; return; }
      if (!/^\d{4}$/.test(pin)) { err.textContent = 'PIN ต้องเป็นตัวเลข 4 หลัก'; return; }
      if (firstMode && pin !== pin2) { err.textContent = 'PIN ใหม่ทั้งสองช่องไม่ตรงกัน'; return; }
      if (busy) return; busy = true;
      var label = b.textContent;
      HBT.busy(b, function () {
        b.textContent = 'กำลังตรวจสอบ…';
        var pre = firstMode ? HBT.api.call('pin.setFirst', { courseId: opts.courseId, stdId: std, newPin: pin }, { token: '' }) : Promise.resolve();
        return pre.then(function () { return login(opts.courseId, std, pin, opts.tid); }).then(function (s) { $('#lpin', box).value = ''; $('#lpin2', box).value = ''; opts.onDone(s); });
      }).catch(function (e) {
        b.textContent = label;
        if (e.code === 'E_PIN_NONE') { setFirstMode(true); $('#lpin2', box).value = ''; $('#lpin2', box).focus(); return; }   // เก็บ PIN ที่พิมพ์ไว้ ให้แค่ยืนยัน
        $('#lpin', box).value = ''; $('#lpin2', box).value = '';
        if (e.code === 'E_PIN_EXISTS') { setFirstMode(false); err.textContent = HBT.errMsg(e); }
        else if (e.code === 'E_PIN_NEEDTEMP') { setFirstMode(false); err.innerHTML = 'อาจารย์ออกรหัสชั่วคราวให้คุณแล้ว — <a href="' + HBT.api.root() + 's/pin.html">ตั้ง PIN ใหม่ด้วยรหัสชั่วคราวที่หน้านี้</a>ก่อน'; }
        else err.textContent = HBT.errMsg(e);
      }).then(function () { busy = false; });
    }
    $('#lsel', box).addEventListener('change', function () { setFirstMode(false); });
    $('#lpin2', box).addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 4); });
    $('#lpin2', box).addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });
    $('#lq', box).addEventListener('input', fill);
    $('#lgo', box).addEventListener('click', submit);
    $('#lpin', box).addEventListener('input', function () { this.value = this.value.replace(/\D/g, '').slice(0, 4); });
    $('#lpin', box).addEventListener('keydown', function (e) { if (e.key === 'Enter') submit(); });

    HBT.api.call('pub.students', { courseId: opts.courseId }, { token: '' }).then(function (r) {
      students = r.students; fill();
      var last = lsGet('hbt.asg.std.' + opts.courseId);
      if (last && students.some(function (s) { return s.stdId === last; })) { $('#lsel', box).value = last; $('#lpin', box).focus(); }
    }, function (e) { $('#lerr', box).textContent = HBT.errMsg(e); $('#lsel', box).innerHTML = opt('', 'โหลดรายชื่อไม่สำเร็จ'); });
    return { focus: function () { var q = $('#lq', box); if (q) q.focus(); } };
  }

  /** อ่านไฟล์เป็น base64 (ไม่มี prefix data:) */
  function readB64(blob) {
    return new Promise(function (res, rej) {
      var r = new FileReader();
      r.onload = function () { var s = String(r.result || ''), i = s.indexOf(','); res(i >= 0 ? s.substring(i + 1) : ''); };
      r.onerror = function () { rej(new Error('อ่านไฟล์ไม่ได้')); };
      r.readAsDataURL(blob);
    });
  }

  /** ย่อรูป jpg/png ที่ใหญ่เกินกำหนดให้ลงขนาดที่รับได้ (คืน File ใหม่ .jpg) · ไฟล์อื่น/ไม่ต้องย่อ คืนตัวเดิม */
  function shrinkImage(file, maxBytes) {
    var isImg = /\.(jpe?g|png)$/i.test(file.name);
    if (!isImg || file.size <= maxBytes) return Promise.resolve(file);
    function load() {
      if (window.createImageBitmap) return createImageBitmap(file);
      return new Promise(function (res, rej) {
        var u = URL.createObjectURL(file), im = new Image();
        im.onload = function () { URL.revokeObjectURL(u); res(im); };
        im.onerror = function () { URL.revokeObjectURL(u); rej(new Error('เปิดรูปไม่ได้')); };
        im.src = u;
      });
    }
    return load().then(function (im) {
      var w = im.width, h = im.height, scale = Math.min(1, 2400 / Math.max(w, h)), q = 0.85, tries = 0;
      function once() {
        var c = document.createElement('canvas'); c.width = Math.max(1, Math.round(w * scale)); c.height = Math.max(1, Math.round(h * scale));
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
        return new Promise(function (res) { c.toBlob(res, 'image/jpeg', q); }).then(function (b) {
          if (!b) throw new Error('ย่อรูปไม่สำเร็จ');
          if (b.size <= maxBytes || tries >= 6) return b;
          tries++; q = Math.max(0.5, q - 0.1); scale *= 0.8; return once();
        });
      }
      return once();
    }).then(function (b) {
      if (b.size > maxBytes) throw new Error('รูปใหญ่เกินไปแม้ย่อแล้ว');
      return new File([b], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
    });
  }

  /**
   * ปุ่ม “แจ้งอาจารย์” (กล่องข้อความถึงอาจารย์) ใช้ร่วมกันทุกหน้านักศึกษา
   * o = { me: รหัสตัวเอง, asgId?, asgTitle?, members?: [{stdId,name}] }  (members = เพื่อนในกลุ่ม ให้เลือกว่าเรื่องนี้เกี่ยวกับใคร)
   */
  var ST_TH = { new: 'ส่งแล้ว (อาจารย์ยังไม่อ่าน)', read: 'อาจารย์อ่านแล้ว', done: 'อาจารย์จัดการแล้ว' };
  function inboxOpen(o) {
    var m = document.getElementById('mInbox');
    if (!m) {
      m = document.createElement('div'); m.className = 'modal'; m.id = 'mInbox'; m.hidden = true;
      m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true'); m.setAttribute('aria-labelledby', 'ibTitle');
      document.body.appendChild(m);
    }
    var friends = (o.members || []).filter(function (x) { return x.stdId !== o.me; });
    m.innerHTML = '<div class="mbox stack"><div class="row sp"><h2 id="ibTitle">แจ้งอาจารย์</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
      '<p class="small muted">ข้อความนี้ถึงอาจารย์ผู้สอนเท่านั้น เพื่อนที่ถูกกล่าวถึงจะไม่เห็น · ส่งได้วันละไม่เกิน 10 ข้อความ · ยังไม่มีการตอบกลับในระบบ ถ้าด่วนให้แจ้งอาจารย์โดยตรง</p>' +
      (o.asgTitle ? '<p class="small">เกี่ยวกับงาน: <b>' + esc(o.asgTitle) + '</b></p>' : '') +
      (friends.length ? '<div class="field"><label for="ibAbout">เรื่องนี้เกี่ยวกับเพื่อนในกลุ่มคนไหน (ไม่บังคับ)</label><select id="ibAbout"><option value="">— ไม่ระบุ / เรื่องทั่วไป —</option>' +
        friends.map(function (f) { return opt(f.stdId, f.name + ' (' + f.stdId + ')'); }).join('') + '</select></div>' : '') +
      '<div class="field"><label for="ibMsg">ข้อความ</label><textarea id="ibMsg" rows="4" maxlength="500" placeholder="เช่น เพื่อนไม่ได้มาช่วยทำงานเลยตั้งแต่ต้น"></textarea><span class="help" id="ibCnt">0 / 500</span></div>' +
      '<div class="err" id="ibErr" role="alert"></div>' +
      '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="ibGo">ส่งถึงอาจารย์</button></div>' +
      '<details id="ibMineBox"><summary class="small">ข้อความที่ฉันเคยส่ง</summary><div id="ibMine" class="stack-s small" style="margin-top:8px"><span class="muted">กำลังโหลด…</span></div></details></div>';
    var ta = m.querySelector('#ibMsg');
    ta.addEventListener('input', function () { m.querySelector('#ibCnt').textContent = ta.value.length + ' / 500'; });
    m.querySelector('#ibGo').addEventListener('click', function () {
      var b = this, err = m.querySelector('#ibErr'), ab = m.querySelector('#ibAbout');
      err.textContent = '';
      if (!ta.value.trim()) { err.textContent = 'กรุณาพิมพ์ข้อความ'; return; }
      HBT.busy(b, function () {
        return call('stu.inboxSend', { message: ta.value, asgId: o.asgId || '', aboutStd: ab ? ab.value : '' }).then(function () { HBT.modal.close('mInbox'); HBT.toast('ส่งถึงอาจารย์แล้ว', 'good'); });
      }).catch(function (e) { err.textContent = HBT.errMsg(e); });
    });
    call('stu.inboxMine', {}).then(function (r) {
      var box = m.querySelector('#ibMine'); if (!box) return;
      box.innerHTML = r.messages.length ? r.messages.map(function (x) {
        return '<div class="card flat"><div class="muted">' + esc(HBT.fmtBE(x.createdAt, true)) + ' · <b>' + esc(ST_TH[x.status] || x.status) + '</b>' + (x.asgTitle ? ' · งาน ' + esc(x.asgTitle) : '') + (x.aboutName ? ' · เกี่ยวกับ ' + esc(x.aboutName) : '') + '</div><div style="white-space:pre-wrap">' + esc(x.message) + '</div></div>';
      }).join('') : '<span class="muted">ยังไม่เคยส่งข้อความ</span>';
    }, function () { var box = m.querySelector('#ibMine'); if (box) box.innerHTML = '<span class="muted">โหลดไม่สำเร็จ</span>'; });
    HBT.modal.open('mInbox');
  }

  HBT.stu = { inboxOpen: inboxOpen, sess: sess, call: call, login: login, clear: clear, loginBox: loginBox, fmtSize: fmtSize, readB64: readB64, shrinkImage: shrinkImage, opt: opt };
})();
