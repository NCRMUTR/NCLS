/* HBT Core — ui.js : ตัวช่วยหน้าเว็บ (escape, toast, modal, ปุ่มกำลังทำงาน, วันที่ พ.ศ.) */
(function () {
  'use strict';
  var HBT = window.HBT = window.HBT || {};

  HBT.esc = function (s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  HBT.$ = function (sel, root) { return (root || document).querySelector(sel); };
  HBT.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- toast ---------- */
  HBT.toast = function (msg, kind) {
    var box = document.getElementById('toasts');
    if (!box) {
      box = document.createElement('div');
      box.id = 'toasts'; box.className = 'toasts';
      box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite');
      document.body.appendChild(box);
    }
    var t = document.createElement('div');
    t.className = 'toast' + (kind ? ' ' + kind : '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, kind === 'bad' ? 6000 : 3200);
  };

  /* ---------- ข้อความ error ---------- */
  HBT.errMsg = function (e) {
    if (!e) return 'เกิดข้อผิดพลาด';
    return e.message || e.code || 'เกิดข้อผิดพลาด';
  };

  /* ---------- ปุ่มกำลังทำงาน: กันกดซ้ำ ---------- */
  HBT.busy = function (btn, fn) {
    if (btn.disabled) return Promise.resolve();
    var old = btn.textContent;
    btn.disabled = true; btn.textContent = 'กำลังบันทึก…';
    return Promise.resolve().then(fn).then(function (r) {
      btn.disabled = false; btn.textContent = old; return r;
    }, function (e) {
      btn.disabled = false; btn.textContent = old; throw e;
    });
  };

  /* ---------- modal ---------- */
  var lastFocus = null;
  HBT.modal = {
    open: function (id) {
      var m = document.getElementById(id);
      if (!m) return;
      lastFocus = document.activeElement;
      m.hidden = false;
      var f = m.querySelector('input:not([disabled]),select,textarea,button');
      if (f) setTimeout(function () { try { f.focus(); } catch (e) {} }, 30);
    },
    close: function (id) {
      var m = typeof id === 'string' ? document.getElementById(id) : id;
      if (!m) return;
      m.hidden = true;
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    }
  };
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    HBT.$$('.modal').forEach(function (m) { if (!m.hidden) HBT.modal.close(m); });
  });
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (t && t.classList && t.classList.contains('modal')) HBT.modal.close(t);       // คลิกพื้นหลัง
    var c = t && t.closest ? t.closest('[data-close]') : null;
    if (c) { var m = c.closest('.modal'); if (m) HBT.modal.close(m); }
  });

  /* ---------- วันที่ ---------- */
  var MON = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  /** '2026-08-11' หรือ '2026-08-11 09:30:00' → '11 ส.ค. 2569' (เก็บเป็น ค.ศ. แสดงเป็น พ.ศ.) */
  HBT.fmtBE = function (iso, withTime) {
    var m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
    if (!m) return '';
    var s = Number(m[3]) + ' ' + MON[Number(m[2]) - 1] + ' ' + (Number(m[1]) + 543);
    return withTime && m[4] ? s + ' ' + m[4] + ':' + m[5] : s;
  };

  HBT.SYSTEM_NAMES = { att: 'เช็คชื่อ', exam: 'สอบออนไลน์', asg: 'ส่งงาน' };
  HBT.SYSTEM_DESC = {
    att: 'QR + GPS คาบเรียน รายงานเข้าเรียน',
    exam: 'แบบทดสอบ รอบสอบ ผลคะแนน',
    asg: 'สั่งงาน ตรวจ ให้คะแนน'
  };
})();
