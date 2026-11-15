/* HBT — listkit.js : ตัวช่วยรายการจำนวนมาก (ใช้ซ้ำทุกหน้า)
 * ค้นหา · เรียงลำดับ · เลือกหลายรายการ (เลือกทั้งหมดที่แสดง) · แถบคำสั่งกลุ่ม (เช่น ลบที่เลือก) · ลบ/ทำทีละรายการพร้อมสรุปผล
 *
 *   var kit = HBT.listKit({
 *     id:     function (row) { return row.stdId; },
 *     search: function (row) { return row.stdId + ' ' + row.name; },
 *     sorts:  [{ k: 'id', label: 'รหัส', fn: function (row) { return row.stdId; } }, ...],      // fn คืนค่าที่ใช้เทียบ (ข้อความ/ตัวเลข)
 *     sort: 'id', dir: 1,                                                                          // ค่าเริ่มต้น (dir: 1 น้อย→มาก, -1 มาก→น้อย)
 *     noun: 'คน',                                                                                  // หน่วยที่แสดง “เลือก N คน”
 *     bulk: [{ label: 'ลบที่เลือก', cls: 'danger', run: function (ids, rows) { ... } }]            // ปุ่มคำสั่งกลุ่ม
 *   });
 *   kit.mount(el, onChange)       วางแถบเครื่องมือ (ครั้งเดียว) · onChange() ถูกเรียกเมื่อค้นหา/เรียง/เลือก → หน้าวาดรายการใหม่
 *   var rows = kit.view(all)      กรอง + เรียง (ใช้วาดรายการ)
 *   kit.cb(row)                   HTML ช่องติ๊กของแถว  ·  kit.bindList(listEl) ผูกเหตุการณ์ติ๊ก (ใส่ที่กล่องรายการ ครั้งเดียว)
 *   kit.update(viewRows, total)   อัปเดตตัวนับ/ปุ่ม/ช่อง “เลือกทั้งหมด” หลังวาดรายการ
 *   kit.selected(all)             แถวที่ถูกเลือก (เฉพาะที่ยังอยู่ในข้อมูล) · kit.clear() ล้างการเลือก
 *   HBT.listKit.batch(ids, fn)    ทำทีละรายการ (ต่อกัน) → Promise<{ ok:n, failed:[{id, err}] }>
 */
(function () {
  'use strict';
  var HBT = window.HBT = window.HBT || {};
  var esc = HBT.esc, seq = 0;

  function cmp(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    a = a === undefined || a === null ? '' : a; b = b === undefined || b === null ? '' : b;
    return String(a).localeCompare(String(b), 'th', { numeric: true, sensitivity: 'base' });
  }

  function listKit(o) {
    var uid = 'lk' + (++seq);
    var st = { sel: {}, q: '', sort: o.sort || (o.sorts[0] && o.sorts[0].k), dir: o.dir || 1 };
    var el = null, onChange = function () {}, lastView = [];

    function sortDef() { return o.sorts.filter(function (s) { return s.k === st.sort; })[0] || o.sorts[0]; }

    function view(all) {
      var q = st.q.trim().toLowerCase();
      var rows = all.filter(function (r) { return !q || String(o.search(r)).toLowerCase().indexOf(q) >= 0; });
      var sd = sortDef();
      if (sd) rows = rows.map(function (r, i) { return { r: r, i: i }; }).sort(function (x, y) { return (cmp(sd.fn(x.r), sd.fn(y.r)) * st.dir) || (x.i - y.i); }).map(function (x) { return x.r; });
      return rows;
    }

    function mount(box, change) {
      el = box; onChange = change || onChange;
      el.className = (el.className ? el.className + ' ' : '') + 'lk-bar';
      el.innerHTML =
        '<div class="row lk-row"><div class="field grow" style="max-width:320px"><label class="sr" for="' + uid + 'q">ค้นหา</label><input id="' + uid + 'q" type="search" placeholder="ค้นหา…" autocomplete="off"></div>' +
        (o.sorts.length ? '<div class="field"><label class="sr" for="' + uid + 's">เรียงตาม</label><select id="' + uid + 's">' + o.sorts.map(function (s) { return '<option value="' + esc(s.k) + '"' + (s.k === st.sort ? ' selected' : '') + '>เรียงตาม: ' + esc(s.label) + '</option>'; }).join('') + '</select></div>' +
          '<button class="btn sm" type="button" id="' + uid + 'd" aria-label="สลับทิศทางการเรียง" title="สลับทิศทางการเรียง">' + (st.dir > 0 ? '↑ น้อย→มาก' : '↓ มาก→น้อย') + '</button>' : '') + '</div>' +
        '<div class="row lk-row"><label class="check lk-all" style="padding:0"><input type="checkbox" id="' + uid + 'a"><span>เลือกทั้งหมดที่แสดง</span></label>' +
        '<span class="small muted" id="' + uid + 'n" aria-live="polite"></span>' +
        '<span class="lk-actions">' + (o.bulk || []).map(function (b, i) { return '<button class="btn sm ' + esc(b.cls || '') + '" type="button" data-lk-bulk="' + i + '" disabled>' + esc(b.label) + '</button>'; }).join('') +
        '<button class="btn sm ghost" type="button" id="' + uid + 'c" hidden>ล้างที่เลือก</button></span></div>';
      var q = el.querySelector('#' + uid + 'q');
      q.value = st.q;                                        // วาดแถบใหม่ (เช่น สลับแท็บ) ให้คงคำค้นเดิม
      q.addEventListener('input', function () { st.q = q.value; onChange('q'); });
      var s = el.querySelector('#' + uid + 's');
      if (s) s.addEventListener('change', function () { st.sort = s.value; onChange('sort'); });
      var d = el.querySelector('#' + uid + 'd');
      if (d) d.addEventListener('click', function () { st.dir = -st.dir; d.textContent = st.dir > 0 ? '↑ น้อย→มาก' : '↓ มาก→น้อย'; onChange('sort'); });
      el.querySelector('#' + uid + 'a').addEventListener('change', function () {
        var on = this.checked;
        lastView.forEach(function (r) { if (on) st.sel[o.id(r)] = 1; else delete st.sel[o.id(r)]; });
        onChange('sel');
      });
      el.querySelector('#' + uid + 'c').addEventListener('click', function () { st.sel = {}; onChange('sel'); });
      Array.prototype.forEach.call(el.querySelectorAll('[data-lk-bulk]'), function (b) {
        b.addEventListener('click', function () {
          var ids = Object.keys(st.sel);
          if (ids.length) (o.bulk[Number(b.getAttribute('data-lk-bulk'))].run)(ids, st);
        });
      });
    }

    function cb(r, label) {
      var id = o.id(r);
      return '<input type="checkbox" data-lk-pick="' + esc(id) + '" aria-label="เลือก ' + esc(label || id) + '"' + (st.sel[id] ? ' checked' : '') + '>';
    }

    function bindList(listEl) {
      listEl.addEventListener('change', function (e) {
        var c = e.target.closest ? e.target.closest('[data-lk-pick]') : null;
        if (!c) return;
        var id = c.getAttribute('data-lk-pick');
        if (c.checked) st.sel[id] = 1; else delete st.sel[id];
        onChange('sel');
      });
    }

    /** หลังวาดรายการใหม่: อัปเดตตัวนับ/ปุ่มกลุ่ม/ช่องเลือกทั้งหมด */
    function update(viewRows, total) {
      lastView = viewRows || [];
      if (!el) return;
      var n = Object.keys(st.sel).length, shown = lastView.length;
      var a = el.querySelector('#' + uid + 'a');
      var inView = lastView.filter(function (r) { return st.sel[o.id(r)]; }).length;
      a.checked = shown > 0 && inView === shown; a.indeterminate = inView > 0 && inView < shown; a.disabled = !shown;
      el.querySelector('#' + uid + 'n').textContent = (n ? 'เลือก ' + n + ' ' + (o.noun || 'รายการ') + ' · ' : '') + 'แสดง ' + shown + (total !== undefined && total !== shown ? ' จาก ' + total : '') + ' ' + (o.noun || 'รายการ');
      Array.prototype.forEach.call(el.querySelectorAll('[data-lk-bulk]'), function (b) { b.disabled = !n; });
      el.querySelector('#' + uid + 'c').hidden = !n;
    }

    function selected(all) { return all.filter(function (r) { return st.sel[o.id(r)]; }); }
    function clear() { st.sel = {}; }
    /** ตัดรายการที่ไม่มีแล้วออกจากที่เลือก (หลังโหลดข้อมูลใหม่) */
    function prune(all) { var have = {}; all.forEach(function (r) { have[o.id(r)] = 1; }); Object.keys(st.sel).forEach(function (k) { if (!have[k]) delete st.sel[k]; }); }

    return { st: st, mount: mount, view: view, cb: cb, bindList: bindList, update: update, selected: selected, clear: clear, prune: prune };
  }

  /** ทำทีละรายการต่อกัน (กันชนกันที่ server) · ไม่หยุดเมื่อบางรายการล้ม → สรุปผล */
  listKit.batch = function (ids, fn, onProgress) {
    var ok = 0, failed = [], p = Promise.resolve();
    ids.forEach(function (id, i) {
      p = p.then(function () { return fn(id); }).then(function () { ok++; }, function (e) { failed.push({ id: id, err: e }); }).then(function () { if (onProgress) onProgress(i + 1, ids.length); });
    });
    return p.then(function () { return { ok: ok, failed: failed }; });
  };

  HBT.listKit = listKit;
})();
