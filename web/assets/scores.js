/* HBT Core — คะแนน: ประเภท/น้ำหนัก · ตารางกรอก · วางจาก Excel · ส่งออก CSV */
HBT.page({ active: 'courses', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['คะแนน']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var id = HBT.qs('id');
  var tb = null;              // ผลจาก score.table
  var dirty = {};             // { typeId: { stdId: 'ข้อความที่กรอก' } }
  var editing = null;         // typeId ที่กำลังแก้ (null = เพิ่มใหม่)
  var pending = null;

  if (!id) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบรายวิชา</b></div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>');
    return;
  }
  var SRC = { MANUAL: 'กรอกเอง', ATT: 'จากเช็คชื่อ', EXAM: 'จากสอบออนไลน์', ASSIGN: 'จากงานที่ส่ง' };
  var NUM = /^\d+(\.\d+)?$/;

  ctx.content.insertAdjacentHTML('beforeend',
    '<div id="head"></div><div id="box"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +

    '<div class="modal" id="mType" hidden role="dialog" aria-modal="true" aria-labelledby="tTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="tTitle">เพิ่มประเภทคะแนน</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="field"><label for="tn">ชื่อ</label><input id="tn" type="text" maxlength="60" autocomplete="off" placeholder="เช่น สอบกลางภาค"></div>' +
    '<div class="row"><div class="field grow"><label for="tm">คะแนนเต็ม</label><input id="tm" type="text" inputmode="decimal" autocomplete="off" placeholder="เช่น 50"></div>' +
    '<div class="field grow"><label for="tp">น้ำหนัก (% ของคะแนนรวม)</label><input id="tp" type="text" inputmode="decimal" autocomplete="off" placeholder="เช่น 30"></div></div>' +
    '<span class="help" id="tHelp"></span>' +
    '<label class="check"><input type="checkbox" id="tv" checked><span>ให้นักศึกษาเห็นคะแนนประเภทนี้<br><span class="small muted">(ใช้เมื่อเปิดหน้าดูคะแนนของนักศึกษาในขั้นถัดไป)</span></span></label>' +
    '<div class="err" id="tErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="tSave">บันทึก</button></div></div></div>' +

    '<div class="modal" id="mPaste" hidden role="dialog" aria-modal="true" aria-labelledby="pTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="pTitle">วางคะแนนจาก Excel</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="field"><label for="pType">ประเภทคะแนน</label><select id="pType"></select></div>' +
    '<p class="small muted">คัดลอก 2 คอลัมน์จาก Excel — รหัสนักศึกษา และคะแนน — มาวาง · ช่องคะแนนว่าง = ล้างคะแนนคนนั้น · แถวที่ผิดจะถูกข้าม แถวอื่นยังบันทึก</p>' +
    '<div class="field"><label for="pText">ข้อมูล</label><textarea id="pText" rows="8" spellcheck="false" placeholder="6601001&#9;45"></textarea></div>' +
    '<div id="pRes"></div><div class="err" id="pErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ปิด</button><button class="btn primary" type="button" id="pGo">บันทึกคะแนน</button></div></div></div>' +

    '<div class="modal" id="mConf" hidden role="dialog" aria-modal="true" aria-labelledby="cTitle"><div class="mbox stack">' +
    '<h2 id="cTitle">ยืนยัน</h2><div id="cBody"></div><div class="err" id="cErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn danger" type="button" id="cGo">ยืนยัน</button></div></div></div>');

  function r2(n) { return Math.round(n * 100) / 100; }
  function dirtyCount() { var n = 0; Object.keys(dirty).forEach(function (t) { n += Object.keys(dirty[t]).length; }); return n; }
  function typeById(t) { return tb.types.filter(function (x) { return x.typeId === t; })[0]; }
  function cellText(v) { return v === null || v === undefined ? '' : String(v); }
  function validCell(txt, max) {
    txt = String(txt).trim();
    if (txt === '') return true;
    return NUM.test(txt) && Number(txt) <= max + 1e-9;
  }
  function rowTotal(s) {
    var t = 0;
    tb.types.forEach(function (ty) {
      var d = dirty[ty.typeId] && dirty[ty.typeId][s.stdId];
      var raw = d !== undefined ? d : s.scores[ty.typeId];
      var txt = cellText(raw).trim();
      if (txt !== '' && NUM.test(txt)) t += (Number(txt) / ty.max) * ty.pct;
    });
    return r2(t);
  }

  /* ---------- ส่วนหัว + ประเภท ---------- */
  function renderTypes() {
    var tot = tb.totalPct, remain = r2(100 - tot);
    var rows = tb.types.map(function (t) {
      var n = tb.students.filter(function (s) { return s.scores[t.typeId] !== null; }).length;
      return '<tr data-type="' + esc(t.typeId) + '"><td><b>' + esc(t.name) + '</b>' + (t.auto ? '<br><span class="pill info">' + esc(SRC[t.source] || t.source) + '</span>' : '') + '</td>' +
        '<td class="num">' + t.max + '</td><td class="num">' + t.pct + '%</td><td>' + (t.visible ? '<span class="pill good">นักศึกษาเห็น</span>' : '<span class="pill">ซ่อน</span>') + '</td>' +
        '<td class="num">' + n + '/' + tb.students.length + '</td>' +
        '<td><div class="tbl-actions"><button class="btn sm" type="button" data-act="edit">แก้ไข</button><button class="btn sm ghost" type="button" data-act="del">ลบ</button></div></td></tr>';
    }).join('');
    return '<section class="stack" id="typesSec"><div class="row sp"><h2>ประเภทคะแนนและน้ำหนัก</h2><button class="btn primary" type="button" id="addType">เพิ่มประเภท</button></div>' +
      '<div class="stack-s"><div class="bar-wrap' + (Math.abs(tot - 100) < 1e-9 ? ' full' : '') + '"><i style="width:' + Math.min(100, tot) + '%"></i></div>' +
      '<p class="small" id="pctLine">น้ำหนักรวม <b>' + tot + '%</b> · ' + (remain > 0 ? 'เหลืออีก <b>' + remain + '%</b> (ยังไม่ครบ 100%)' : '<b>ครบ 100%</b>') + '</p></div>' +
      (tb.types.length ? '<div class="scroll"><table id="typeTable"><thead><tr><th>ประเภท</th><th class="num">เต็ม</th><th class="num">น้ำหนัก</th><th>การแสดง</th><th class="num">กรอกแล้ว</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
        : '<div class="callout">ยังไม่มีประเภทคะแนน — กด “เพิ่มประเภท” เช่น สอบกลางภาค / รายงาน / เก็บคะแนนระหว่างเรียน</div>') + '</section>';
  }

  /* ---------- ตารางคะแนน ---------- */
  function renderGrid() {
    if (!tb.students.length) return '<section class="stack" id="gridSec"><h2>ตารางคะแนน</h2><div class="callout">ยังไม่มีนักศึกษาในรายวิชา — <a href="' + root + 't/students.html?id=' + encodeURIComponent(id) + '">นำเข้ารายชื่อก่อน</a></div></section>';
    if (!tb.types.length) return '';
    var head = '<tr><th class="sticky-c">รหัส</th><th>ชื่อ</th>' + tb.types.map(function (t) {
      return '<th class="num" title="' + esc(t.name) + '">' + esc(t.name) + '<br><span class="xs muted">/' + t.max + (t.auto ? ' · อัตโนมัติ' : '') + '</span></th>';
    }).join('') + '<th class="num">รวม (%)</th></tr>';
    var body = tb.students.map(function (s) {
      return '<tr data-std="' + esc(s.stdId) + '"><td class="sticky-c mono">' + esc(s.stdId) + '</td><td>' + esc(s.name) + '</td>' + tb.types.map(function (t) {
        var v = s.scores[t.typeId];
        if (t.auto) return '<td class="num">' + (v === null ? '<span class="muted">–</span>' : v) + '</td>';
        return '<td class="num"><input class="sc-in" type="text" inputmode="decimal" autocomplete="off" data-type="' + esc(t.typeId) + '" data-std="' + esc(s.stdId) +
          '" aria-label="' + esc(t.name + ' ของ ' + s.name) + '" value="' + esc(cellText(v)) + '"></td>';
      }).join('') + '<td class="num" data-total="' + esc(s.stdId) + '"><b>' + s.total + '</b></td></tr>';
    }).join('');
    var hasManual = tb.types.some(function (t) { return !t.auto; });
    return '<section class="stack" id="gridSec"><div class="row sp"><h2>ตารางคะแนน</h2><div class="row">' +
      (hasManual ? '<button class="btn" type="button" id="pasteBtn">วางจาก Excel</button>' : '') +
      '<button class="btn" type="button" id="expBtn">ส่งออก CSV</button>' +
      (hasManual ? '<button class="btn primary" type="button" id="saveAll" disabled>บันทึกคะแนน</button>' : '') + '</div></div>' +
      '<p class="small muted" id="dirtyLine"></p>' +
      '<div class="field" style="max-width:340px"><label class="sr" for="q">ค้นหา</label><input id="q" type="search" placeholder="ค้นหารหัสหรือชื่อ" autocomplete="off"></div>' +
      '<div class="scroll"><table id="scoreTable"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div></section>';
  }

  function render() {
    var c = tb.course;
    $('#head').innerHTML = '<div class="page-h"><div class="stack-s"><h1>คะแนน</h1><p>' + esc(c.code) + ' กลุ่ม ' + esc(c.section) + ' · ' + esc(c.name) + '</p></div>' +
      '<div class="row"><a class="btn sm" id="backCourse" href="' + root + 't/course.html?id=' + encodeURIComponent(id) + '">‹ กลับรายวิชา</a></div></div>';
    document.title = 'คะแนน ' + c.code + ' — HBT Teaching';
    $('#box').innerHTML = '<div class="stack">' + renderTypes() + renderGrid() + '</div>';
    refreshDirty();
  }

  function refreshDirty() {
    var n = dirtyCount(), sv = $('#saveAll'), dl = $('#dirtyLine');
    var bad = HBT.$$('.sc-in[aria-invalid=true]').length;
    if (sv) sv.disabled = !n || !!bad;
    if (dl) dl.textContent = bad ? 'มี ' + bad + ' ช่องที่คะแนนไม่ถูกต้อง (ต้องเป็นตัวเลขไม่ติดลบและไม่เกินคะแนนเต็ม)' : (n ? 'แก้ไขแล้ว ' + n + ' ช่อง — ยังไม่ได้บันทึก' : '');
  }

  function applyFilter() {
    var q = ($('#q') ? $('#q').value : '').trim().toLowerCase();
    HBT.$$('#scoreTable tbody tr').forEach(function (tr) {
      var s = tb.students.filter(function (x) { return x.stdId === tr.getAttribute('data-std'); })[0];
      tr.hidden = !!q && !(s.stdId.toLowerCase().indexOf(q) >= 0 || s.name.toLowerCase().indexOf(q) >= 0);
    });
  }

  function load() {
    return HBT.api.call('score.table', { courseId: id }).then(function (r) { tb = r; dirty = {}; render(); }, function (e) {
      var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN';
      $('#box').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบรายวิชานี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดคะแนนไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
        '<div class="row" style="margin-top:10px">' + (nf ? '' : '<button class="btn" type="button" id="reload">ลองใหม่</button>') + '<a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>';
      var rb = $('#reload'); if (rb) rb.addEventListener('click', load);
    });
  }

  /* ---------- กรอกในตาราง ---------- */
  ctx.content.addEventListener('input', function (e) {
    var el = e.target;
    if (el.id === 'q') { applyFilter(); return; }
    if (!el.classList || !el.classList.contains('sc-in')) return;
    var t = el.getAttribute('data-type'), sid = el.getAttribute('data-std'), ty = typeById(t);
    var s = tb.students.filter(function (x) { return x.stdId === sid; })[0];
    var orig = cellText(s.scores[t]), now = el.value.trim();
    if (now === orig) { if (dirty[t]) { delete dirty[t][sid]; if (!Object.keys(dirty[t]).length) delete dirty[t]; } el.classList.remove('dirty'); }
    else { (dirty[t] = dirty[t] || {})[sid] = now; el.classList.add('dirty'); }
    el.setAttribute('aria-invalid', validCell(now, ty.max) ? 'false' : 'true');
    var cell = $('[data-total="' + sid + '"]');
    if (cell) cell.innerHTML = '<b>' + rowTotal(s) + '</b>';
    refreshDirty();
  });

  function saveAll(btn) {
    var types = Object.keys(dirty);
    var skipped = [], saved = 0, cleared = 0;
    return HBT.busy(btn, function () {
      var chain = Promise.resolve();
      types.forEach(function (t) {
        chain = chain.then(function () {
          var rows = Object.keys(dirty[t]).map(function (sid) { return { stdId: sid, score: dirty[t][sid] }; });
          return HBT.api.call('score.saveBulk', { courseId: id, typeId: t, rows: rows }, { write: true }).then(function (r) {
            saved += r.saved; cleared += r.cleared; skipped = skipped.concat(r.skipped || []);
            delete dirty[t];
          });
        });
      });
      return chain;
    }).then(function () {
      HBT.toast('บันทึกแล้ว ' + (saved + cleared) + ' ช่อง' + (skipped.length ? ' · ข้าม ' + skipped.length : ''), skipped.length ? 'bad' : 'good');
      return load();
    }, function (er) { HBT.toast(HBT.errMsg(er) + ' (ที่ยังไม่บันทึกยังอยู่ในตาราง)', 'bad'); refreshDirty(); });
  }

  /* ---------- ประเภทคะแนน ---------- */
  function openType(t) {
    editing = t ? t.typeId : null;
    $('#tTitle').textContent = t ? 'แก้ไขประเภทคะแนน' : 'เพิ่มประเภทคะแนน';
    $('#tn').value = t ? t.name : ''; $('#tm').value = t ? t.max : ''; $('#tp').value = t ? t.pct : '';
    $('#tv').checked = t ? t.visible : true;
    $('#tn').disabled = $('#tm').disabled = !!(t && t.auto);
    var used = tb.totalPct - (t ? t.pct : 0);
    $('#tHelp').textContent = (t && t.auto ? 'ประเภทอัตโนมัติ: แก้ได้เฉพาะน้ำหนักและการแสดง · ' : '') + 'น้ำหนักประเภทนี้ใส่ได้ไม่เกิน ' + r2(100 - used) + '%';
    $('#tErr').textContent = '';
    HBT.modal.open('mType');
  }
  $('#box').addEventListener('click', function (e) {
    if (e.target.id === 'addType') { openType(null); return; }
    var b = e.target.closest('button[data-act]');
    if (b) {
      var t = typeById(b.closest('tr').getAttribute('data-type'));
      if (!t) return;
      if (b.getAttribute('data-act') === 'edit') { openType(t); return; }
      var n = tb.students.filter(function (s) { return s.scores[t.typeId] !== null; }).length;
      $('#cTitle').textContent = 'ลบประเภท “' + t.name + '”?';
      $('#cBody').innerHTML = '<p>การลบเป็น<b>ถาวร</b> คะแนนประเภทนี้ที่กรอกไว้ <b id="delCount">' + n + '</b> รายการจะหายทั้งหมด' +
        (t.auto ? ' (ประเภทอัตโนมัติจะถูกสร้างใหม่เมื่อระบบต้นทางส่งคะแนนมาอีก)' : '') + '</p>';
      $('#cErr').textContent = '';
      pending = function () {
        return HBT.api.call('score.deleteType', { courseId: id, typeId: t.typeId }, { write: true }).then(function () { HBT.toast('ลบแล้ว', 'good'); return load(); });
      };
      HBT.modal.open('mConf');
      return;
    }
    if (e.target.id === 'saveAll') { saveAll(e.target); return; }
    if (e.target.id === 'expBtn') {
      HBT.busy(e.target, function () {
        return HBT.api.call('score.exportCsv', { courseId: id }).then(function (r) { HBT.csv.download(r.filename, r.csv); });
      }).catch(function (er) { HBT.toast(HBT.errMsg(er), 'bad'); });
      return;
    }
    if (e.target.id === 'pasteBtn') { openPaste(); }
  });
  $('#cGo').addEventListener('click', function () {
    var fn = pending;
    if (!fn) return;
    HBT.busy(this, fn).then(function () { HBT.modal.close('mConf'); }).catch(function (er) { $('#cErr').textContent = HBT.errMsg(er); });
  });
  $('#tSave').addEventListener('click', function () {
    var b = this;
    var p = { courseId: id, name: $('#tn').value.trim(), max: $('#tm').value.trim(), pct: $('#tp').value.trim(), visible: $('#tv').checked };
    if (editing) p.typeId = editing;
    $('#tErr').textContent = '';
    if (!editing || !$('#tn').disabled) {
      if (!p.name) { $('#tErr').textContent = 'กรุณากรอกชื่อประเภทคะแนน'; return; }
      if (p.max === '') { $('#tErr').textContent = 'กรุณากรอกคะแนนเต็ม'; return; }
    }
    if (p.pct === '') { $('#tErr').textContent = 'กรุณากรอกน้ำหนัก (ใส่ 0 ได้ถ้ายังไม่นับรวม)'; return; }
    if (dirtyCount() && !window.confirm('มีคะแนนที่แก้ไว้แต่ยังไม่บันทึก — การบันทึกประเภทจะโหลดตารางใหม่และค่าที่ยังไม่บันทึกจะหาย ดำเนินการต่อ?')) return;
    HBT.busy(b, function () {
      return HBT.api.call('score.saveType', p, { write: true }).then(function () {
        HBT.modal.close('mType'); HBT.toast('บันทึกแล้ว', 'good'); return load();
      });
    }).catch(function (er) { $('#tErr').textContent = HBT.errMsg(er); });
  });

  /* ---------- วางจาก Excel ---------- */
  function openPaste() {
    var manual = tb.types.filter(function (t) { return !t.auto; });
    $('#pType').innerHTML = manual.map(function (t) { return '<option value="' + esc(t.typeId) + '">' + esc(t.name) + ' (เต็ม ' + t.max + ')</option>'; }).join('');
    $('#pText').value = ''; $('#pRes').innerHTML = ''; $('#pErr').textContent = '';
    HBT.modal.open('mPaste');
  }
  $('#pGo').addEventListener('click', function () {
    var b = this, pr = HBT.csv.parseScores($('#pText').value);
    $('#pErr').textContent = ''; $('#pRes').innerHTML = '';
    if (!pr.rows.length) { $('#pErr').textContent = 'ยังไม่มีข้อมูลที่วาง'; return; }
    if (pr.rows.length > 2000) { $('#pErr').textContent = 'วางได้ครั้งละไม่เกิน 2,000 แถว'; return; }
    if (dirtyCount() && !window.confirm('มีคะแนนที่แก้ไว้แต่ยังไม่บันทึก — จะหายเมื่อโหลดตารางใหม่ ดำเนินการต่อ?')) return;
    HBT.busy(b, function () {
      return HBT.api.call('score.saveBulk', { courseId: id, typeId: $('#pType').value, rows: pr.rows }, { write: true }).then(function (r) {
        $('#pRes').innerHTML = '<div class="callout" id="pSum"><b>บันทึกแล้ว</b><br>เพิ่ม/แก้ <b>' + r.saved + '</b> · ล้าง <b>' + r.cleared + '</b> · ไม่เปลี่ยน <b>' + r.unchanged + '</b>' + (r.skippedCount ? ' · ข้าม <b>' + r.skippedCount + '</b>' : '') + '</div>' +
          (r.skippedCount ? '<details open><summary class="small">แถวที่ข้าม</summary><ul class="small" id="pSkip">' + r.skipped.slice(0, 50).map(function (x) { return '<li>แถว ' + x.row + (x.stdId ? ' (' + esc(x.stdId) + ')' : '') + ': ' + esc(x.why) + '</li>'; }).join('') + '</ul></details>' : '');
        return load();
      });
    }).catch(function (er) { $('#pErr').textContent = HBT.errMsg(er); });
  });

  window.addEventListener('beforeunload', function (e) { if (dirtyCount()) { e.preventDefault(); e.returnValue = ''; } });
  load();
});
