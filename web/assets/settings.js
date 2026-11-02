/* HBT Core — ตั้งค่าระบบ (admin): ภาคเรียน + ค่าตั้งค่าทั่วไป */
HBT.page({ active: 'settings', need: 'admin', crumbs: [['ผู้ดูแล', 't/home.html'], ['ตั้งค่าระบบ']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$;
  var terms = [], defs = [], orig = {};

  ctx.content.insertAdjacentHTML('beforeend',
    '<div class="page-h"><div class="stack-s"><h1>ตั้งค่าระบบ</h1><p class="muted">เวอร์ชันระบบ ' + esc(ctx.me.version) + '</p></div></div>' +
    '<section class="card stack" id="termCard"><h3>ภาคเรียน</h3><div id="termBody"><div class="loading"><span class="spin"></span></div></div></section>' +
    '<form id="setForm" class="stack" novalidate><div id="setBody" class="stack"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +
    '<div class="err" id="setErr" role="alert"></div>' +
    '<div class="row"><button class="btn primary" type="submit" id="setSave" disabled>บันทึกการตั้งค่า</button><span class="help" id="setHint"></span></div></form>');

  /* ---------- ภาคเรียน ---------- */
  function renderTerms() {
    var cur = terms.filter(function (t) { return t.isCurrent; })[0];
    var opts = terms.map(function (t) {
      return '<option value="' + esc(t.termId) + '"' + (t.isCurrent ? ' selected' : '') + '>' + esc(t.name) + (t.isCurrent ? ' (ปัจจุบัน)' : '') + '</option>';
    }).join('');
    $('#termBody').innerHTML =
      (terms.length
        ? '<div class="grid g3"><div class="field"><label for="tcur">ภาคเรียนปัจจุบัน</label><select id="tcur">' + opts + '</select></div>' +
          '<div class="field"><label>ช่วงเวลา</label><div class="small muted" id="tRange" style="padding-top:10px">' + range(cur) + '</div></div>' +
          '<div class="field" style="justify-content:flex-end"><button class="btn sm" type="button" id="tSet" disabled>ตั้งเป็นภาคเรียนปัจจุบัน</button></div></div>'
        : '<div class="callout warn"><b>ยังไม่มีภาคเรียน</b><br>เพิ่มภาคเรียนแรกด้านล่าง (จะถูกตั้งเป็นภาคเรียนปัจจุบันอัตโนมัติ)</div>') +
      '<div class="hint-box stack-s"><b class="small">เปิดภาคเรียนใหม่</b><div class="grid g3">' +
      '<div class="field"><label for="tnName">ชื่อ (เช่น 1/2569)</label><input id="tnName" type="text" maxlength="30"></div>' +
      '<div class="field"><label for="tnStart">เริ่ม</label><input id="tnStart" type="date"></div>' +
      '<div class="field"><label for="tnEnd">สิ้นสุด</label><input id="tnEnd" type="date"></div></div>' +
      '<div class="err" id="tnErr" role="alert"></div>' +
      '<div class="row"><button class="btn sm primary" type="button" id="tnAdd">เพิ่มภาคเรียน</button></div></div>';

    var sel = $('#tcur');
    if (sel) {
      sel.addEventListener('change', function () {
        var t = terms.filter(function (x) { return x.termId === sel.value; })[0];
        $('#tRange').textContent = rangeText(t);
        $('#tSet').disabled = !!(t && t.isCurrent);
      });
      $('#tSet').addEventListener('click', function () {
        HBT.busy(this, function () {
          return HBT.api.call('term.setCurrent', { termId: sel.value }, { write: true }).then(function (r) {
            terms = r.terms; renderTerms(); HBT.toast('ตั้งภาคเรียนปัจจุบันแล้ว', 'good');
          });
        }).catch(function (e) { HBT.toast(HBT.errMsg(e), 'bad'); });
      });
    }
    $('#tnAdd').addEventListener('click', function () {
      $('#tnErr').textContent = '';
      var name = $('#tnName').value.trim();
      if (!name) { $('#tnErr').textContent = 'กรุณาระบุชื่อภาคเรียน'; return; }
      var s = $('#tnStart').value, e2 = $('#tnEnd').value;
      if (s && e2 && e2 < s) { $('#tnErr').textContent = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม'; return; }
      HBT.busy(this, function () {
        return HBT.api.call('term.create', { name: name, startDate: s, endDate: e2 }, { write: true }).then(function (r) {
          terms = r.terms; renderTerms(); HBT.toast('เพิ่มภาคเรียนแล้ว', 'good');
        });
      }).catch(function (e) { $('#tnErr').textContent = HBT.errMsg(e); });
    });
  }
  function rangeText(t) {
    if (!t) return '—';
    if (!t.startDate && !t.endDate) return 'ยังไม่ระบุช่วงเวลา';
    return (HBT.fmtBE(t.startDate) || '?') + ' – ' + (HBT.fmtBE(t.endDate) || '?');
  }
  function range(t) { return esc(rangeText(t)); }

  /* ---------- ค่าตั้งค่า ---------- */
  function field(d) {
    var id = 'st_' + d.key;
    if (d.type === 'int') {
      return '<div class="field"><label for="' + id + '">' + esc(d.label) + '</label>' +
        '<input id="' + id + '" data-key="' + esc(d.key) + '" type="number" inputmode="numeric" min="' + d.min + '" max="' + d.max + '" step="1" value="' + esc(d.value) + '">' +
        '<span class="help">ช่วงที่ใช้ได้ ' + d.min + '–' + d.max + ' · ค่าเริ่มต้น ' + esc(d.def) + '</span></div>';
    }
    if (d.type === 'list') {
      var on = String(d.value).split(',');
      return '<div class="field"><span class="lbl">' + esc(d.label) + '</span><div class="row" data-key="' + esc(d.key) + '" data-list="1">' +
        d.options.map(function (o) {
          return '<label class="pill acc" style="cursor:pointer"><input type="checkbox" value="' + esc(o) + '"' + (on.indexOf(o) >= 0 ? ' checked' : '') +
            ' style="accent-color:var(--accent)"> ' + esc(o) + '</label>';
        }).join('') + '</div></div>';
    }
    return '';
  }
  function renderSettings() {
    var groups = [], by = {};
    defs.forEach(function (d) { if (!by[d.group]) { by[d.group] = []; groups.push(d.group); } by[d.group].push(d); });
    $('#setBody').innerHTML = groups.map(function (g) {
      var items = by[g];
      return '<section class="card stack"><h3>' + esc(g) + '</h3><div class="grid g2">' + items.filter(function (d) { return d.type === 'int'; }).map(field).join('') + '</div>' +
        items.filter(function (d) { return d.type !== 'int'; }).map(field).join('') + '</section>';
    }).join('');
    orig = {};
    defs.forEach(function (d) { orig[d.key] = String(d.value); });
    $('#setSave').disabled = true;
    $('#setHint').textContent = 'ยังไม่มีการเปลี่ยนแปลง';
  }
  function current() {
    var cur = {};
    HBT.$$('#setBody input[data-key]').forEach(function (i) { cur[i.getAttribute('data-key')] = i.value.trim(); });
    HBT.$$('#setBody [data-list]').forEach(function (w) {
      cur[w.getAttribute('data-key')] = HBT.$$('input:checked', w).map(function (c) { return c.value; }).join(',');
    });
    return cur;
  }
  function changes() {
    var cur = current(), out = {};
    Object.keys(cur).forEach(function (k) { if (cur[k] !== orig[k]) out[k] = cur[k]; });
    return out;
  }
  function dirty() {
    var n = Object.keys(changes()).length;
    $('#setSave').disabled = n === 0;
    $('#setHint').textContent = n ? 'มี ' + n + ' รายการที่เปลี่ยน' : 'ยังไม่มีการเปลี่ยนแปลง';
    $('#setErr').textContent = '';
  }
  $('#setBody').addEventListener('input', dirty);
  $('#setBody').addEventListener('change', dirty);

  $('#setForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var ch = changes(), keys = Object.keys(ch);
    if (!keys.length) return;
    var label = {};
    defs.forEach(function (d) { label[d.key] = d; });
    for (var i = 0; i < keys.length; i++) {            // ตรวจฝั่งหน้าเว็บก่อน (server ตรวจซ้ำอีกชั้น)
      var d = label[keys[i]], v = ch[keys[i]];
      if (d.type === 'int') {
        var n = Number(v);
        if (v === '' || !isFinite(n) || Math.floor(n) !== n || n < d.min || n > d.max) {
          $('#setErr').textContent = '“' + d.label + '” ต้องเป็นจำนวนเต็มระหว่าง ' + d.min + ' ถึง ' + d.max; return;
        }
      } else if (d.type === 'list' && !v) {
        $('#setErr').textContent = '“' + d.label + '” ต้องเลือกอย่างน้อย 1 รายการ'; return;
      }
    }
    HBT.busy($('#setSave'), function () {
      return HBT.api.call('settings.set', { changes: ch }, { write: true }).then(function (r) {
        defs = r.settings; renderSettings(); HBT.toast('บันทึกการตั้งค่าแล้ว', 'good');
      });
    }).then(dirty).catch(function (e) {
      var d = e.detail && e.detail.key && label[e.detail.key];
      $('#setErr').textContent = d ? '“' + d.label + '” ไม่ถูกต้อง' + (e.detail.min != null ? ' (ต้องอยู่ระหว่าง ' + e.detail.min + '–' + e.detail.max + ')' : '') : HBT.errMsg(e);
    });
  });

  /* ---------- โหลด ---------- */
  HBT.api.call('term.list').then(function (r) { terms = r.terms; renderTerms(); }, function (e) {
    $('#termBody').innerHTML = '<div class="callout bad">' + esc(HBT.errMsg(e)) + '</div>';
  });
  HBT.api.call('settings.get').then(function (r) { defs = r.settings; renderSettings(); }, function (e) {
    $('#setBody').innerHTML = '<div class="callout bad">' + esc(HBT.errMsg(e)) + '</div>';
  });
});
