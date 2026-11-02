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
      '<div class="field"><label for="lpin">PIN 4 หลัก</label><input class="pin-in" id="lpin" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off"></div>' +
      '<div class="err" id="lerr" role="alert"></div>' +
      '<button class="btn primary block" type="button" id="lgo" style="min-height:50px;font-size:1.05rem">เข้าสู่ระบบ</button>' +
      '<p class="small muted">ยังไม่เคยตั้ง PIN หรือลืม PIN? <a href="' + HBT.api.root() + 's/pin.html">ตั้ง / เปลี่ยน PIN</a></p>';

    function fill() {
      var q = $('#lq', box).value.trim().toLowerCase();
      var list = students.filter(function (s) { return !q || s.stdId.toLowerCase().indexOf(q) >= 0 || s.name.toLowerCase().indexOf(q) >= 0; });
      var cur = $('#lsel', box).value;
      $('#lsel', box).innerHTML = opt('', list.length ? '— เลือกชื่อของคุณ (' + list.length + ') —' : 'ไม่พบรายชื่อที่ค้นหา') +
        list.map(function (s) { return opt(s.stdId, s.stdId + ' — ' + s.name); }).join('');
      if (cur && list.some(function (s) { return s.stdId === cur; })) $('#lsel', box).value = cur;
      else if (list.length === 1 && q) $('#lsel', box).value = list[0].stdId;
    }
    function submit() {
      var std = $('#lsel', box).value, pin = $('#lpin', box).value, err = $('#lerr', box), b = $('#lgo', box);
      err.textContent = '';
      if (!std) { err.textContent = 'กรุณาเลือกชื่อของคุณ'; return; }
      if (!/^\d{4}$/.test(pin)) { err.textContent = 'PIN ต้องเป็นตัวเลข 4 หลัก'; return; }
      if (busy) return; busy = true;
      HBT.busy(b, function () {
        b.textContent = 'กำลังตรวจสอบ…';
        return login(opts.courseId, std, pin, opts.tid).then(function (s) { $('#lpin', box).value = ''; opts.onDone(s); });
      }).catch(function (e) {
        $('#lpin', box).value = '';
        if (e.code === 'E_PIN_NONE') err.innerHTML = 'คุณยังไม่ได้ตั้ง PIN — ขอ “รหัสชั่วคราว” จากอาจารย์ แล้ว<a href="' + HBT.api.root() + 's/pin.html">ตั้ง PIN ที่หน้านี้</a>ก่อน';
        else err.textContent = HBT.errMsg(e);
      }).then(function () { busy = false; });
    }
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

  HBT.stu = { sess: sess, call: call, login: login, clear: clear, loginBox: loginBox, fmtSize: fmtSize, readB64: readB64, shrinkImage: shrinkImage, opt: opt };
})();
