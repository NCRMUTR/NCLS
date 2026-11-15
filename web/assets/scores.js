/* HBT Core — คะแนน: เลือกประเภท 5 แบบ · แถบสัดส่วนแบ่งสี · ตารางแสดงเป็น % · วางสอบกลางภาค/ปลายภาคจาก Excel · ส่งออก CSV */
HBT.page({ active: 'courses', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['คะแนน']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var id = HBT.qs('id');
  var tb = null;              // ผลจาก score.table
  var dirty = {};             // { typeId: { stdId: 'ข้อความที่กรอก' } }  (เฉพาะประเภทที่กรอกเอง = กลางภาค/ปลายภาค)
  var editing = null;         // typeId ที่กำลังแก้ (null = เพิ่มใหม่)
  var creating = null;        // 'mid' | 'final' ตอนเพิ่มประเภทใหม่
  var pending = null;
  var cat = 'all';            // ประเภทที่เลือกดู

  if (!id) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบรายวิชา</b></div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>');
    return;
  }
  /* ประเภทคะแนน 5 แบบ (สีใช้ตัวแปร --c-* ใน app.css) */
  var CATS = [
    { k: 'att', name: 'เข้าเรียน', src: 'จากระบบเช็คชื่อ' },
    { k: 'asg', name: 'คะแนนเก็บ', src: 'จากระบบส่งงาน' },
    { k: 'exam', name: 'คะแนนทดสอบ', src: 'จากระบบสอบ' },
    { k: 'mid', name: 'สอบกลางภาค', src: 'อาจารย์ import เอง' },
    { k: 'final', name: 'สอบปลายภาค', src: 'อาจารย์ import เอง' }
  ];
  var OTHER = { k: 'other', name: 'อื่นๆ', src: 'กรอกเอง' };
  var NUM = /^\d+(\.\d+)?$/;

  ctx.content.insertAdjacentHTML('beforeend',
    '<div id="head"></div><div id="box"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +

    '<div class="modal" id="mType" hidden role="dialog" aria-modal="true" aria-labelledby="tTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="tTitle">ตั้งสัดส่วนคะแนน</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<p class="small muted" id="tName"></p>' +
    '<div class="field"><label for="tp">สัดส่วน (% ของคะแนนรวมวิชา)</label><input id="tp" type="text" inputmode="decimal" autocomplete="off" placeholder="เช่น 20"></div>' +
    '<span class="help" id="tHelp"></span>' +
    '<label class="check"><input type="checkbox" id="tv"><span>ให้นักศึกษาเห็นคะแนนประเภทนี้<br><span class="small muted">(ค่าเริ่มต้น: ไม่แสดง · ใช้เมื่อเปิดหน้าดูคะแนนของนักศึกษาในขั้นถัดไป)</span></span></label>' +
    '<div class="err" id="tErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="tSave">บันทึก</button></div></div></div>' +

    '<div class="modal" id="mPaste" hidden role="dialog" aria-modal="true" aria-labelledby="pTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="pTitle">วางคะแนนจาก Excel</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="field"><label for="pType">ประเภทคะแนน</label><select id="pType"></select></div>' +
    '<p class="small muted">คัดลอก 2 คอลัมน์จาก Excel — รหัสนักศึกษา และ <b>คะแนนเป็น % (0–100)</b> — มาวาง · ช่องคะแนนว่าง = ล้างคะแนนคนนั้น · แถวที่ผิดจะถูกข้าม แถวอื่นยังบันทึก</p>' +
    '<div class="field"><label for="pText">ข้อมูล</label><textarea id="pText" rows="8" spellcheck="false" placeholder="6601001&#9;76.5"></textarea></div>' +
    '<div id="pRes"></div><div class="err" id="pErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ปิด</button><button class="btn primary" type="button" id="pGo">บันทึกคะแนน</button></div></div></div>' +

    '<div class="modal" id="mConf" hidden role="dialog" aria-modal="true" aria-labelledby="cTitle"><div class="mbox stack">' +
    '<h2 id="cTitle">ยืนยัน</h2><div id="cBody"></div><div class="err" id="cErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn danger" type="button" id="cGo">ยืนยัน</button></div></div></div>');

  function r2(n) { return Math.round(n * 100) / 100; }
  function dirtyCount() { var n = 0; Object.keys(dirty).forEach(function (t) { n += Object.keys(dirty[t]).length; }); return n; }
  function typeById(t) { return tb.types.filter(function (x) { return x.typeId === t; })[0]; }
  function cellText(v) { return v === null || v === undefined ? '' : String(v); }
  function catInfo(k) { return CATS.filter(function (c) { return c.k === k; })[0] || OTHER; }
  function validCell(txt, max) {
    txt = String(txt).trim();
    if (txt === '') return true;
    return NUM.test(txt) && Number(txt) <= max + 1e-9;
  }
  /** ประเภทที่แสดง: กลางภาค/ปลายภาคเสมอ · เข้าเรียน/คะแนนเก็บ/ทดสอบ เฉพาะเมื่อมีสิทธิ์ระบบนั้น (หรือมีรายการอยู่แล้ว) */
  function shownCats() {
    var u = ctx.user;
    return CATS.filter(function (c) {
      return !{ att: 1, asg: 1, exam: 1 }[c.k] || u.role === 'admin' || u.systems.indexOf(c.k) >= 0 || tb.types.some(function (t) { return t.cat === c.k; });
    });
  }
  function typesIn(k) { return tb.types.filter(function (t) { return k === 'all' || t.cat === k; }); }
  function catPct(k) { var n = 0; tb.types.forEach(function (t) { if (t.cat === k) n += t.pct; }); return r2(n); }
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

  /* ---------- แถบสัดส่วนแบ่งสี ---------- */
  function renderBar() {
    var tot = tb.totalPct, remain = r2(100 - tot);
    var all = shownCats().concat([OTHER]);
    var segs = all.map(function (c) {
      var p = catPct(c.k);
      return p > 0 ? '<i class="cat-' + c.k + '" style="width:' + p + '%;background:var(--c)" title="' + esc(c.name + ' ' + p + '%') + '"></i>' : '';
    }).join('');
    var legend = all.filter(function (c) { return c.k !== 'other' || catPct('other') > 0; }).map(function (c) {
      return '<span class="lg cat-' + c.k + '"><span class="dot" style="background:var(--c)"></span>' + esc(c.name) + ' <b>' + catPct(c.k) + '%</b></span>';
    }).join('');
    return '<div class="stack-s"><div class="bar-stack" id="pctBar" role="img" aria-label="สัดส่วนคะแนนรวม ' + tot + '%">' + segs + '</div>' +
      '<div class="legend" id="legend">' + legend + '</div>' +
      '<p class="small" id="pctLine">สัดส่วนรวม <b>' + tot + '%</b> · ' + (remain > 0 ? 'เหลืออีก <b>' + remain + '%</b> (ยังไม่ครบ 100%)' : '<b>ครบ 100%</b>') + '</p></div>';
  }

  /* ---------- รายการในประเภทที่เลือก ---------- */
  function hintOf(k) {
    var back = '<a href="' + root + 't/course.html?id=' + encodeURIComponent(id) + '">หน้ารายวิชา</a>';
    if (k === 'att') return 'คำนวณให้อัตโนมัติจากระบบเช็คชื่อ = จำนวนครั้งที่เข้า ÷ จำนวนคาบที่ปิดแล้ว × 100 (ปกติ นับ 1 · สาย นับ 0.5 · ลา/ขาด นับ 0) · ' + back + ' → เช็คชื่อ';
    if (k === 'asg') return 'แต่ละงานตั้งคะแนนเต็มและสัดส่วนที่หน้า <a href="' + root + 't/asg.html?id=' + encodeURIComponent(id) + '">ส่งงาน</a> · อาจารย์กรอกคะแนนที่หน้าตรวจงาน ระบบคำนวณเป็น % ให้ · หน้านี้แสดงเป็น % ของแต่ละงาน';
    if (k === 'exam') return 'เก็บจากระบบสอบ (ตั้งว่าจะเก็บคะแนนที่หน้า <a href="' + root + 't/exam.html?id=' + encodeURIComponent(id) + '">สอบออนไลน์</a>) · กำหนดแค่สัดส่วนของแต่ละรอบ · หน้านี้แสดงเป็น % ของแต่ละรอบ';
    if (k === 'mid' || k === 'final') return 'อาจารย์ import เอง: กด “วางจาก Excel” แล้ววาง รหัสนักศึกษา + คะแนนเป็น % (0–100)';
    return '';
  }
  function renderTypes() {
    var list = typesIn(cat);
    var rows = list.map(function (t) {
      var ci = catInfo(t.cat), n = tb.students.filter(function (s) { return s.scores[t.typeId] !== null; }).length;
      return '<tr data-type="' + esc(t.typeId) + '"><td><b>' + esc(t.name) + '</b>' + (cat === 'all' ? '<br><span class="catpill cat-' + ci.k + '">' + esc(ci.name) + '</span>' : '') + '</td>' +
        '<td class="num"><b>' + t.pct + '%</b></td><td>' + (t.visible ? '<span class="pill good">นักศึกษาเห็น</span>' : '<span class="pill">ซ่อน</span>') + '</td>' +
        '<td class="num">' + n + '/' + tb.students.length + '</td>' +
        '<td><div class="tbl-actions"><button class="btn sm" type="button" data-act="edit">ตั้งสัดส่วน</button>' + (t.auto ? '' : '<button class="btn sm ghost" type="button" data-act="del">ลบ</button>') + '</div></td></tr>';
    }).join('');
    var add = '';
    if (cat === 'mid' || cat === 'final') {
      if (!list.length) add = '<div class="callout">ยังไม่ได้ตั้ง' + esc(catInfo(cat).name) + ' — <button class="btn sm primary" type="button" data-add="' + cat + '">ตั้งสัดส่วน' + esc(catInfo(cat).name) + '</button></div>';
    } else if (cat === 'all') {
      var miss = ['mid', 'final'].filter(function (k) { return !typesIn(k).length; });
      if (miss.length) add = '<div class="row small">' + miss.map(function (k) { return '<button class="btn sm" type="button" data-add="' + k + '">+ ตั้งสัดส่วน' + esc(catInfo(k).name) + '</button>'; }).join('') + '</div>';
    } else if (!list.length) {
      add = '<div class="callout">ยังไม่มีรายการในประเภทนี้ — ' + (cat === 'att' ? 'จะสร้างให้อัตโนมัติเมื่อปิดคาบเช็คชื่อคาบแรก' : cat === 'asg' ? 'จะสร้างให้อัตโนมัติเมื่อสั่งงาน' : 'จะสร้างให้อัตโนมัติเมื่อรอบสอบส่งคะแนนเข้ารายวิชา') + '</div>';
    }
    var hint = cat === 'all' ? '' : '<p class="small muted" id="catHint">' + hintOf(cat) + '</p>';
    return '<section class="stack" id="typesSec"><h2>' + (cat === 'all' ? 'สัดส่วนคะแนนทุกประเภท' : esc(catInfo(cat).name) + ' <span class="muted small">' + esc(catInfo(cat).src) + ' · รวม ' + catPct(cat) + '%</span>') + '</h2>' + hint +
      (list.length ? '<div class="scroll"><table id="typeTable"><thead><tr><th>' + (cat === 'asg' ? 'งาน' : cat === 'exam' ? 'รอบสอบ' : 'รายการ') + '</th><th class="num">สัดส่วน</th><th>การแสดง</th><th class="num">มีคะแนนแล้ว</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>' : '') + add + '</section>';
  }

  /* ---------- ตารางคะแนน ---------- */
  function renderGrid() {
    if (!tb.students.length) return '<section class="stack" id="gridSec"><h2>ตารางคะแนน</h2><div class="callout">ยังไม่มีนักศึกษาในรายวิชา — <a href="' + root + 't/students.html?id=' + encodeURIComponent(id) + '">นำเข้ารายชื่อก่อน</a></div></section>';
    var cols = typesIn(cat);
    if (!cols.length) return '';
    var head = '<tr><th class="sticky-c">รหัส</th><th>ชื่อ</th>' + cols.map(function (t) {
      return '<th class="num catcol cat-' + t.cat + '" title="' + esc(t.name) + '">' + esc(t.name) + '<br><span class="xs muted">% · สัดส่วน ' + t.pct + '%' + (t.auto ? ' · อัตโนมัติ' : '') + '</span></th>';
    }).join('') + '<th class="num">รวม (%)</th></tr>';
    var body = tb.students.map(function (s) {
      return '<tr data-std="' + esc(s.stdId) + '"><td class="sticky-c mono">' + esc(s.stdId) + '</td><td>' + esc(s.name) + '</td>' + cols.map(function (t) {
        var v = s.scores[t.typeId];
        if (t.auto) { var p = s.pcts[t.typeId]; return '<td class="num">' + (p === null ? '<span class="muted">–</span>' : p) + '</td>'; }
        var d = dirty[t.typeId] && dirty[t.typeId][s.stdId];
        var shown = d !== undefined ? d : cellText(v);
        return '<td class="num"><input class="sc-in' + (d !== undefined ? ' dirty' : '') + '" type="text" inputmode="decimal" autocomplete="off" data-type="' + esc(t.typeId) + '" data-std="' + esc(s.stdId) +
          '" aria-label="' + esc(t.name + ' ของ ' + s.name) + '" aria-invalid="' + (validCell(shown, t.max) ? 'false' : 'true') + '" value="' + esc(shown) + '"></td>';
      }).join('') + '<td class="num" data-total="' + esc(s.stdId) + '"><b>' + rowTotal(s) + '</b></td></tr>';
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

  function renderSel() {
    return '<div class="field" style="max-width:340px"><label for="catSel">ประเภทคะแนน</label><select id="catSel">' +
      '<option value="all"' + (cat === 'all' ? ' selected' : '') + '>ทั้งหมด (ภาพรวม)</option>' +
      shownCats().map(function (c) { return '<option value="' + c.k + '"' + (cat === c.k ? ' selected' : '') + '>' + esc(c.name) + ' (' + esc(c.src) + ')</option>'; }).join('') + '</select></div>';
  }

  function render() {
    var c = tb.course;
    $('#head').innerHTML = '<div class="page-h"><div class="stack-s"><h1>คะแนน</h1><p>' + esc(c.code) + ' กลุ่ม ' + esc(c.section) + ' · ' + esc(c.name) + '</p></div>' +
      '<div class="row"><a class="btn sm" id="backCourse" href="' + root + 't/course.html?id=' + encodeURIComponent(id) + '">‹ กลับรายวิชา</a></div></div>';
    document.title = 'คะแนน ' + c.code + ' — HBT Learning System';
    $('#box').innerHTML = '<div class="stack">' + renderBar() + renderSel() + renderTypes() + renderGrid() + '</div>';
    refreshDirty();
  }

  function refreshDirty() {
    var n = dirtyCount(), sv = $('#saveAll'), dl = $('#dirtyLine');
    var bad = HBT.$$('.sc-in[aria-invalid=true]').length;
    if (sv) sv.disabled = !n || !!bad;
    if (dl) dl.textContent = bad ? 'มี ' + bad + ' ช่องที่คะแนนไม่ถูกต้อง (ต้องเป็นตัวเลข % ไม่ติดลบและไม่เกิน 100)' : (n ? 'แก้ไขแล้ว ' + n + ' ช่อง — ยังไม่ได้บันทึก' : '');
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

  /* ---------- เลือกประเภท / กรอกในตาราง ---------- */
  ctx.content.addEventListener('change', function (e) {
    if (e.target.id === 'catSel') { cat = e.target.value; render(); }
  });
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

  /* ---------- สัดส่วนของประเภท (ระบุแค่ % + การแสดง) ---------- */
  function openType(t, newCat) {
    editing = t ? t.typeId : null; creating = t ? null : newCat;
    var nm = t ? t.name : catInfo(newCat).name;
    $('#tTitle').textContent = t ? 'ตั้งสัดส่วนคะแนน' : 'เพิ่ม' + nm;
    $('#tName').innerHTML = '<b>' + esc(nm) + '</b>' + (t && t.cat === 'asg' ? ' <span class="muted">(คะแนนเต็มของงานตั้งที่หน้า ส่งงาน)</span>' : '');
    $('#tp').value = t ? t.pct : '';
    $('#tv').checked = t ? t.visible : false;
    var used = tb.totalPct - (t ? t.pct : 0);
    $('#tHelp').textContent = 'สัดส่วนรายการนี้ใส่ได้ไม่เกิน ' + r2(100 - used) + '% (ใส่ 0 = ยังไม่นับรวม)';
    $('#tErr').textContent = '';
    HBT.modal.open('mType');
  }
  $('#box').addEventListener('click', function (e) {
    var ad = e.target.closest('button[data-add]');
    if (ad) { openType(null, ad.getAttribute('data-add')); return; }
    var b = e.target.closest('button[data-act]');
    if (b) {
      var t = typeById(b.closest('tr').getAttribute('data-type'));
      if (!t) return;
      if (b.getAttribute('data-act') === 'edit') { openType(t); return; }
      var n = tb.students.filter(function (s) { return s.scores[t.typeId] !== null; }).length;
      $('#cTitle').textContent = 'ลบ “' + t.name + '”?';
      $('#cBody').innerHTML = '<p>การลบเป็น<b>ถาวร</b> คะแนนประเภทนี้ที่กรอกไว้ <b id="delCount">' + n + '</b> รายการจะหายทั้งหมด</p>';
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
    var b = this, t = editing ? typeById(editing) : null;
    var p = { courseId: id, pct: $('#tp').value.trim(), visible: $('#tv').checked };
    if (t) { p.typeId = t.typeId; p.name = t.name; p.max = t.max; } else p.cat = creating;
    $('#tErr').textContent = '';
    if (p.pct === '') { $('#tErr').textContent = 'กรุณากรอกสัดส่วน % (ใส่ 0 ได้ถ้ายังไม่นับรวม)'; return; }
    if (dirtyCount() && !window.confirm('มีคะแนนที่แก้ไว้แต่ยังไม่บันทึก — การบันทึกจะโหลดตารางใหม่และค่าที่ยังไม่บันทึกจะหาย ดำเนินการต่อ?')) return;
    HBT.busy(b, function () {
      return HBT.api.call('score.saveType', p, { write: true }).then(function () {
        HBT.modal.close('mType'); HBT.toast('บันทึกแล้ว', 'good'); return load();
      });
    }).catch(function (er) { $('#tErr').textContent = HBT.errMsg(er); });
  });

  /* ---------- วางจาก Excel (สอบกลางภาค/ปลายภาค) ---------- */
  function openPaste() {
    var manual = tb.types.filter(function (t) { return !t.auto; });
    if (!manual.length) { HBT.toast('ตั้งสัดส่วนสอบกลางภาค/ปลายภาคก่อน จึงจะวางคะแนนได้', 'bad'); return; }
    $('#pType').innerHTML = manual.map(function (t) {
      return '<option value="' + esc(t.typeId) + '"' + (t.cat === cat ? ' selected' : '') + '>' + esc(t.name) + (t.max === 100 ? '' : ' (เต็ม ' + t.max + ')') + '</option>';
    }).join('');
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
