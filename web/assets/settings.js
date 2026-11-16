/* HBT Core — ตั้งค่าระบบ (admin): ภาคเรียน + ค่าตั้งค่าทั่วไป */
HBT.page({ active: 'settings', need: 'admin', crumbs: [['ผู้ดูแล', 't/home.html'], ['ตั้งค่าระบบ']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$;
  var terms = [], defs = [], orig = {};

  ctx.content.insertAdjacentHTML('beforeend',
    '<div class="page-h"><div class="stack-s"><h1>ตั้งค่าระบบ</h1><p class="muted">เวอร์ชันระบบ ' + esc(ctx.me.version) + '</p></div></div>' +
    '<section class="card stack" id="termCard"><h3>ภาคเรียน</h3><div id="termBody"><div class="loading"><span class="spin"></span></div></div></section>' +
    '<section class="card stack" id="leaveFormCard"><h3>แบบฟอร์มใบลา</h3><div id="lfBody"><div class="loading"><span class="spin"></span></div></div></section>' +
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
    if (d.type === 'int' || d.type === 'num') {
      return '<div class="field"><label for="' + id + '">' + esc(d.label) + '</label>' +
        '<input id="' + id + '" data-key="' + esc(d.key) + '" type="number" inputmode="' + (d.type === 'num' ? 'decimal' : 'numeric') + '" min="' + d.min + '" max="' + d.max + '" step="' + (d.type === 'num' ? '0.05' : '1') + '" value="' + esc(d.value) + '">' +
        '<span class="help">ช่วงที่ใช้ได้ ' + d.min + '–' + d.max + ' · ค่าเริ่มต้น ' + esc(d.def) + '</span></div>';
    }
    if (d.type === 'bool') {
      return '<div class="field"><label class="row" for="' + id + '" style="cursor:pointer"><input id="' + id + '" data-key="' + esc(d.key) + '" type="checkbox"' +
        (String(d.value) === '1' ? ' checked' : '') + ' style="accent-color:var(--accent)"> <span>' + esc(d.label) + '</span></label></div>';
    }
    if (d.type === 'list') {
      var on =String(d.value).split(',');
      return '<div class="field"><span class="lbl">' + esc(d.label) + '</span><div class="row" data-key="' + esc(d.key) + '" data-list="1">' +
        d.options.map(function (o) {
          return '<label class="pill acc" style="cursor:pointer"><input type="checkbox" value="' + esc(o) + '"' + (on.indexOf(o) >= 0 ? ' checked' : '') +
            ' style="accent-color:var(--accent)"> ' + esc(o) + '</label>';
        }).join('') + '</div></div>';
    }
    if (d.type === 'text') {
      return '<div class="field"><label for="' + id + '">' + esc(d.label) + '</label><textarea id="' + id + '" data-key="' + esc(d.key) + '" rows="7" maxlength="' + d.max + '">' + esc(d.value) + '</textarea>' +
        '<span class="help">ไม่เกิน ' + d.max + ' ตัวอักษร · ขึ้นบรรทัดใหม่ได้ · ว่างไว้ = ไม่แสดงคำชี้แจง</span></div>';
    }
    return '';
  }
  function renderSettings() {
    var groups = [], by = {};
    defs.forEach(function (d) { if (!by[d.group]) { by[d.group] = []; groups.push(d.group); } by[d.group].push(d); });
    $('#setBody').innerHTML = groups.map(function (g) {
      var items = by[g];
      return '<section class="card stack"><h3>' + esc(g) + '</h3><div class="grid g2">' + items.filter(function (d) { return d.type === 'int' || d.type === 'num'; }).map(field).join('') + '</div>' +
        items.filter(function (d) { return d.type !== 'int' && d.type !== 'num'; }).map(field).join('') + '</section>';
    }).join('');
    orig = {};
    defs.forEach(function (d) { orig[d.key] = String(d.value); });
    $('#setSave').disabled = true;
    $('#setHint').textContent = 'ยังไม่มีการเปลี่ยนแปลง';
  }
  function current() {
    var cur = {};
    HBT.$$('#setBody input[data-key]').forEach(function (i) {
      cur[i.getAttribute('data-key')] = i.type === 'checkbox' ? (i.checked ? '1' : '0') : i.value.trim();
    });
    HBT.$$('#setBody textarea[data-key]').forEach(function (t) { cur[t.getAttribute('data-key')] = t.value.replace(/\r\n?/g, '\n').trim(); });
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
      } else if (d.type === 'num') {
        var x = Number(v);
        if (v === '' || !isFinite(x) || x < d.min || x > d.max) { $('#setErr').textContent = '“' + d.label + '” ต้องเป็นตัวเลขระหว่าง ' + d.min + ' ถึง ' + d.max; return; }
      } else if (d.type === 'text' && v.length > d.max) {
        $('#setErr').textContent = '“' + d.label + '” ยาวเกิน ' + d.max + ' ตัวอักษร'; return;
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

  /* ---------- แบบฟอร์มใบลา (อัปโหลดแยกจากปุ่มบันทึกการตั้งค่า: ทำทันที) ---------- */
  var lf = null;
  function mb(n) { n = Number(n) || 0; return n >= 1048576 ? (Math.round(n / 104857.6) / 10) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function renderLeaveForm() {
    var has = lf.hasForm, acc = lf.types.map(function (t) { return '.' + t; }).join(',') + (lf.types.indexOf('jpg') >= 0 ? ',.jpeg' : '');
    $('#lfBody').innerHTML =
      (has ? '<div class="row sp"><div class="stack-s"><b id="lfName">' + esc(lf.formName) + '</b><span class="small muted">' + esc(mb(lf.formSize)) + (lf.formAt ? ' · อัปโหลดเมื่อ ' + esc(HBT.fmtBE(lf.formAt, true)) : '') + '</span></div>' +
        '<div class="row"><button class="btn sm" type="button" id="lfDl">ดาวน์โหลด</button><button class="btn sm danger" type="button" id="lfDel">ลบแบบฟอร์ม</button></div></div>'
        : '<div class="callout warn small" id="lfNone"><b>ยังไม่ได้อัปโหลดแบบฟอร์ม</b> — นักศึกษาจะยังไม่มีปุ่มดาวน์โหลดแบบฟอร์มการลาในหน้าส่งใบลา</div>') +
      '<div class="field"><label for="lfFile">' + (has ? 'แทนที่ด้วยไฟล์ใหม่' : 'เลือกไฟล์แบบฟอร์ม') + '</label><input id="lfFile" type="file" accept="' + esc(acc) + '">' +
      '<span class="help">ชนิดไฟล์ที่รับ: ' + esc(lf.types.join(', ')) + ' · ไม่เกิน ' + esc(lf.maxMb) + ' MB (ตามตั้งค่า “ไฟล์งานนักศึกษา”) · คำชี้แจงการลาตั้งได้ที่หมวด “ใบลา” ด้านล่าง</span></div>' +
      '<div class="err" id="lfErr" role="alert"></div><div class="row"><button class="btn primary" type="button" id="lfUp">' + (has ? 'แทนที่แบบฟอร์ม' : 'อัปโหลดแบบฟอร์ม') + '</button></div>';
    $('#lfUp').addEventListener('click', function () {
      var f = $('#lfFile').files[0]; $('#lfErr').textContent = '';
      if (!f) { $('#lfErr').textContent = 'กรุณาเลือกไฟล์ก่อน'; return; }
      if (f.size > lf.maxMb * 1048576) { $('#lfErr').textContent = 'ไฟล์ใหญ่เกิน ' + lf.maxMb + ' MB'; return; }
      HBT.busy(this, function () {
        return new Promise(function (res, rej) {
          var r = new FileReader();
          r.onload = function () { var s = String(r.result || ''), i = s.indexOf(','); res(i >= 0 ? s.substring(i + 1) : ''); };
          r.onerror = function () { rej(new Error('อ่านไฟล์ไม่ได้')); };
          r.readAsDataURL(f);
        }).then(function (b64) { return HBT.api.call('leave.formSet', { name: f.name, b64: b64 }, { write: true }); })
          .then(function (r) { lf = r; renderLeaveForm(); HBT.toast('อัปโหลดแบบฟอร์มแล้ว', 'good'); });
      }).catch(function (e) { $('#lfErr').textContent = HBT.errMsg(e); });
    });
    if (has) {
      $('#lfDl').addEventListener('click', function () {
        HBT.busy(this, function () { return HBT.api.call('pub.leaveForm', {}).then(HBT.saveB64); }).catch(function (e) { HBT.toast(HBT.errMsg(e), 'bad'); });
      });
      $('#lfDel').addEventListener('click', function () {
        if (!window.confirm('ลบแบบฟอร์มใบลาที่อัปโหลดไว้? (นักศึกษาจะดาวน์โหลดไม่ได้จนกว่าจะอัปโหลดใหม่)')) return;
        HBT.busy(this, function () { return HBT.api.call('leave.formDelete', {}, { write: true }).then(function (r) { lf = r; renderLeaveForm(); HBT.toast('ลบแบบฟอร์มแล้ว', 'good'); }); })
          .catch(function (e) { HBT.toast(HBT.errMsg(e), 'bad'); });
      });
    }
  }
  HBT.api.call('pub.leaveInfo', {}).then(function (r) { lf = r; renderLeaveForm(); }, function (e) {
    $('#lfBody').innerHTML = '<div class="callout bad">' + esc(HBT.errMsg(e)) + '</div>';
  });

  /* ---------- โหลด ---------- */
  HBT.api.call('term.list').then(function (r) { terms = r.terms; renderTerms(); }, function (e) {
    $('#termBody').innerHTML = '<div class="callout bad">' + esc(HBT.errMsg(e)) + '</div>';
  });
  HBT.api.call('settings.get').then(function (r) { defs = r.settings; renderSettings(); }, function (e) {
    $('#setBody').innerHTML = '<div class="callout bad">' + esc(HBT.errMsg(e)) + '</div>';
  });
});
