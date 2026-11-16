/* HBT Core — สรุปคะแนนรายวิชา (อาจารย์): ทุกคน × ทุกประเภท · แก้ได้ทุกช่อง (รวมช่องที่ระบบคิดให้) · คะแนนปรับ +/- · เกรดตามเกณฑ์ · สถิติ · ส่งออก CSV */
HBT.page({ active: 'courses', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['สรุปคะแนน']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var id = HBT.qs('id');
  var D = null;                                  // ผลจาก score.summary
  var st = { q: '', sort: 'id' };
  var cell = null;                               // { stdId, typeId } ช่องที่กำลังแก้
  var adjStd = null;                             // stdId ที่กำลังแก้คะแนนปรับ
  var NUM = /^\d+(\.\d+)?$/, SIGNED = /^[+-]?\d+(\.\d+)?$/;

  if (!id) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบรายวิชา</b></div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>');
    return;
  }

  ctx.content.insertAdjacentHTML('beforeend',
    '<div id="head"></div><div id="box"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +

    /* แก้คะแนนช่องเดียว */
    '<div class="modal" id="mCell" hidden role="dialog" aria-modal="true" aria-labelledby="cTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="cTitle">แก้คะแนน</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<p class="small" id="cWho"></p><p class="small muted" id="cSys"></p>' +
    '<div class="field"><label for="cScore" id="cScoreLbl">คะแนนที่ได้</label><input id="cScore" type="text" inputmode="decimal" autocomplete="off"><span class="help" id="cHelp"></span></div>' +
    '<div class="field" id="cReasonWrap"><label for="cReason">เหตุผล (ไม่บังคับ)</label><input id="cReason" type="text" maxlength="200" autocomplete="off" placeholder="เช่น ส่งงานเพิ่มหลังกำหนด"></div>' +
    '<div class="err" id="cErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn" type="button" id="cRestore" hidden>คืนค่าระบบ</button><button class="btn primary" type="button" id="cSave">บันทึก</button></div></div></div>' +

    /* คะแนนปรับ */
    '<div class="modal" id="mAdj" hidden role="dialog" aria-modal="true" aria-labelledby="aTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="aTitle">คะแนนปรับ</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<p class="small" id="aWho"></p>' +
    '<p class="small muted">บวก/ลบเข้า <b>คะแนนรวม (% ของวิชา)</b> เช่น −5 กรณีไม่ช่วยงานกลุ่ม หรือ +3 โบนัส · นักศึกษาไม่เห็นเหตุผล</p>' +
    '<div class="field"><label for="aPts">คะแนนปรับ (+/−)</label><input id="aPts" type="text" inputmode="decimal" autocomplete="off" placeholder="เช่น -5 หรือ +3"><span class="help" id="aHelp"></span></div>' +
    '<div class="field"><label for="aReason">เหตุผล (ไม่บังคับ)</label><input id="aReason" type="text" maxlength="200" autocomplete="off"></div>' +
    '<div class="err" id="aErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn" type="button" id="aClear" hidden>ลบคะแนนปรับ</button><button class="btn primary" type="button" id="aSave">บันทึก</button></div></div></div>' +

    /* เกณฑ์เกรด */
    '<div class="modal" id="mScale" hidden role="dialog" aria-modal="true" aria-labelledby="sTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="sTitle">เกณฑ์เกรด</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<p class="small muted">คะแนนรวมตั้งแต่ค่าที่ระบุขึ้นไปได้เกรดนั้น (ต่ำกว่า D = F) · ต้องไล่จากมากไปน้อย</p>' +
    '<div class="grid g2" id="sFields"></div><div class="err" id="sErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn" type="button" id="sReset">คืนค่าเริ่มต้น</button><button class="btn primary" type="button" id="sSave">บันทึกเกณฑ์</button></div></div></div>');

  function r2(n) { return Math.round(n * 100) / 100; }
  function fmtN(v) { return v === null || v === undefined ? '–' : String(r2(v)); }
  /** ข้อมูลการลาของนักศึกษา (อนุมัติแล้ว) — แสดงอย่างเดียว ไม่เข้าสูตรคะแนน */
  function leaveTxt(l) {
    if (!l || (!l.sick.days && !l.personal.days)) return '<span class="muted">–</span>' + (l && l.pending ? ' <span class="pill warn" title="ใบลารออนุมัติ">รอ ' + l.pending + '</span>' : '');
    return esc(l.sick.days + '/' + l.personal.days) + (l.pending ? ' <span class="pill warn" title="ใบลารออนุมัติ">รอ ' + l.pending + '</span>' : '');
  }
  function leaveTip(l) { return l ? 'ลาป่วย ' + l.sick.count + ' ครั้ง ' + l.sick.days + ' วัน · ลากิจ ' + l.personal.count + ' ครั้ง ' + l.personal.days + ' วัน (เฉพาะที่อนุมัติ) · ไม่รวมในคะแนน' : 'ไม่มีใบลา'; }
  function typeOf(tid) { return D.types.filter(function (t) { return t.typeId === tid; })[0]; }
  function stdOf(sid) { return D.students.filter(function (s) { return s.stdId === sid; })[0]; }

  /* ---------- วาดหน้า ---------- */
  function statCard(label, val, sub) { return '<div class="card flat"><span class="small muted">' + esc(label) + '</span><h2>' + esc(val) + '</h2>' + (sub ? '<span class="xs muted">' + esc(sub) + '</span>' : '') + '</div>'; }

  function view() {
    var q = st.q.trim().toLowerCase();
    var rows = D.students.filter(function (s) { return !q || (s.stdId + ' ' + s.name).toLowerCase().indexOf(q) >= 0; });
    var by = {
      id: function (a, b) { return a.stdId < b.stdId ? -1 : 1; },
      name: function (a, b) { return a.name.localeCompare(b.name, 'th'); },
      hi: function (a, b) { return b.total - a.total || (a.stdId < b.stdId ? -1 : 1); },
      lo: function (a, b) { return a.total - b.total || (a.stdId < b.stdId ? -1 : 1); }
    }[st.sort] || null;
    if (by) rows = rows.slice().sort(by);
    return rows;
  }

  function render() {
    var c = D.course, S = D.stats;
    $('#head').innerHTML = '<div class="page-h"><div class="stack-s"><h1>สรุปคะแนน</h1><p>' + esc(c.code) + ' กลุ่ม ' + esc(c.section) + ' · ' + esc(c.name) + '</p></div>' +
      '<div class="row"><a class="btn sm" href="' + root + 't/scores.html?id=' + encodeURIComponent(id) + '">คะแนน (ตั้งสัดส่วน)</a><a class="btn sm" id="backCourse" href="' + root + 't/course.html?id=' + encodeURIComponent(id) + '">‹ กลับรายวิชา</a></div></div>';
    document.title = 'สรุปคะแนน ' + c.code + ' — HBT Learning System';
    if (!D.students.length) { $('#box').innerHTML = '<div class="callout">ยังไม่มีนักศึกษาในรายวิชา — <a href="' + root + 't/students.html?id=' + encodeURIComponent(id) + '">นำเข้ารายชื่อก่อน</a></div>'; return; }
    var warn = D.totalPct < 100 ? '<div class="callout warn" id="pctWarn">สัดส่วนรวมที่ตั้งไว้ <b>' + D.totalPct + '%</b> (ยังไม่ครบ 100%) — คะแนนรวมและเกรดจึงต่ำกว่าจริง · <a href="' + root + 't/scores.html?id=' + encodeURIComponent(id) + '">ตั้งสัดส่วน</a></div>' : '';
    var gr = D.scale.order.concat(['F']).map(function (g) { return '<span class="pill ' + (S.grades[g] ? 'info' : '') + '">' + esc(g) + ' ' + S.grades[g] + '</span>'; }).join(' ');
    $('#box').innerHTML = '<div class="stack">' + warn +
      '<div class="grid g4" id="stats">' + statCard('มีคะแนน', S.n + ' / ' + D.students.length + ' คน', S.ungraded ? 'ยังไม่มีคะแนนเลย ' + S.ungraded + ' คน' : '') + statCard('เฉลี่ย', fmtN(S.mean)) + statCard('สูงสุด', fmtN(S.max)) + statCard('ต่ำสุด', fmtN(S.min)) + '</div>' +
      '<div class="row" id="gradeDist"><span class="small muted">เกรด:</span>' + gr + '</div>' +
      '<div class="row sp"><div class="row"><div class="field" style="min-width:220px"><label class="sr" for="q">ค้นหา</label><input id="q" type="search" placeholder="ค้นหารหัสหรือชื่อ" autocomplete="off" value="' + esc(st.q) + '"></div>' +
      '<div class="field"><label class="sr" for="sortSel">เรียงตาม</label><select id="sortSel">' +
      [['id', 'รหัสนักศึกษา'], ['name', 'ชื่อ-นามสกุล'], ['hi', 'คะแนนรวม มาก→น้อย'], ['lo', 'คะแนนรวม น้อย→มาก']].map(function (o) { return '<option value="' + o[0] + '"' + (st.sort === o[0] ? ' selected' : '') + '>เรียงตาม: ' + o[1] + '</option>'; }).join('') + '</select></div></div>' +
      '<div class="row"><button class="btn" type="button" id="scaleBtn">เกณฑ์เกรด</button><button class="btn" type="button" id="expBtn">ส่งออก CSV</button></div></div>' +
      '<p class="small muted">คลิกที่ตัวเลขในช่องใดก็ได้เพื่อแก้ · ช่องที่ระบบคิดให้ (เช็คชื่อ/งาน/สอบ) ที่อาจารย์แก้ทับจะมี ✎ และระบบไม่ทับให้อีก (กด “คืนค่าระบบ” เพื่อเลิกแก้) · คะแนนปรับ +/− บวกเข้าคะแนนรวม · บรรทัดเล็กใต้ตัวเลข “= x%” คือ % ที่คิดได้ (คะแนนที่ได้ ÷ เต็ม × สัดส่วน) แก้ตรงนั้นไม่ได้ ให้แก้ที่คะแนน</p>' +
      '<div id="tbl"></div></div>';
    $('#q').addEventListener('input', function () { st.q = this.value; renderTable(); });
    $('#sortSel').addEventListener('change', function () { st.sort = this.value; renderTable(); });
    $('#scaleBtn').addEventListener('click', openScale);
    $('#expBtn').addEventListener('click', function () {
      HBT.busy(this, function () { return HBT.api.call('score.exportCsv', { courseId: id }).then(function (r) { HBT.csv.download(r.filename, r.csv); }); }).catch(function (e) { HBT.toast(HBT.errMsg(e), 'bad'); });
    });
    renderTable();
  }

  function renderTable() {
    var rows = view();
    var head = '<tr><th class="sticky-c">รหัส</th><th>ชื่อ</th>' + D.types.map(function (t) {
      return '<th class="num catcol cat-' + t.cat + '" title="' + esc(t.name) + '">' + esc(t.name) + '<br><span class="xs muted">เต็ม ' + t.max + ' · ' + t.pct + '%' + (t.auto ? ' · อัตโนมัติ' : '') + '</span></th>';
    }).join('') + '<th class="num" title="ข้อมูลการลาที่อนุมัติ — แสดงอย่างเดียว ไม่รวมในคะแนน">ลา<br><span class="xs muted">ป่วย/กิจ (วัน)</span></th><th class="num">รวม<br><span class="xs muted">ก่อนปรับ</span></th><th class="num">ปรับ<br><span class="xs muted">+/−</span></th><th class="num">รวมสุทธิ</th><th>เกรด</th></tr>';
    if (!rows.length) { $('#tbl').innerHTML = '<div class="callout">ไม่พบนักศึกษาตามที่ค้นหา</div>'; return; }
    var body = rows.map(function (s) {
      return '<tr data-std="' + esc(s.stdId) + '"><td class="sticky-c mono">' + esc(s.stdId) + '</td><td>' + esc(s.name) + '</td>' + D.types.map(function (t) {
        var c = s.cells[t.typeId], tip = c.locked ? 'อาจารย์แก้ทับ' + (c.auto !== null ? ' · ค่าระบบ ' + c.auto : ' · ระบบยังไม่มีค่า') + (c.reason ? ' · ' + c.reason : '') : 'คลิกเพื่อแก้';
        return '<td class="num"><button class="sm-cell' + (c.locked ? ' lk' : '') + '" type="button" data-cell="' + esc(t.typeId) + '" title="' + esc(tip) + '" aria-label="แก้ ' + esc(t.name) + ' ของ ' + esc(s.name) + '">' +
          (c.locked ? '✎ ' : '') + (c.v === null ? '<span class="muted">–</span>' : r2(c.v)) + '</button>' +
          /* % ที่คิดได้ (ได้/เต็ม × สัดส่วน) — แสดงอย่างเดียว แก้ไม่ได้ ต้องแก้ที่คะแนน */
          '<div class="sm-pct" title="คิดจาก ' + (c.v === null ? '–' : r2(c.v)) + ' / ' + t.max + ' × ' + t.pct + '% (แก้ไม่ได้ — แก้ที่คะแนนด้านบน)">' + (c.v === null || !(t.max > 0) ? '' : '= ' + r2(c.v / t.max * t.pct) + '%') + '</div></td>';
      }).join('') + '<td class="num sm-leave" title="' + esc(leaveTip(s.leave)) + '">' + leaveTxt(s.leave) + '</td><td class="num">' + fmtN(s.base) + '</td>' +
        '<td class="num"><button class="sm-cell' + (s.adjust ? ' lk' : '') + '" type="button" data-adj="1" title="' + esc(s.adjust ? (s.adjust.reason || 'คะแนนปรับ') : 'คลิกเพื่อเพิ่มคะแนนปรับ') + '" aria-label="คะแนนปรับของ ' + esc(s.name) + '">' +
        (s.adjust ? (s.adjust.points > 0 ? '+' : '') + s.adjust.points : '<span class="muted">+/−</span>') + '</button></td>' +
        '<td class="num"><b>' + (s.grade ? fmtN(s.total) : '<span class="muted">–</span>') + '</b></td><td><b class="gr">' + (s.grade ? esc(s.grade) : '<span class="muted">–</span>') + '</b></td></tr>';
    }).join('');
    function foot(label, key) {
      return '<tr class="tfoot"><td class="sticky-c"></td><td><b>' + label + '</b></td>' + D.types.map(function (t) { return '<td class="num">' + fmtN(t.stats[key]) + '</td>'; }).join('') + '<td colspan="5"></td></tr>';
    }
    $('#tbl').innerHTML = '<div class="scroll"><table id="sumTable"><thead>' + head + '</thead><tbody>' + body + '</tbody><tfoot>' +
      foot('เฉลี่ย', 'mean') + foot('สูงสุด', 'max') + foot('ต่ำสุด', 'min') + '<tr class="tfoot"><td class="sticky-c"></td><td><b>จำนวนที่มีคะแนน</b></td>' + D.types.map(function (t) { return '<td class="num">' + t.stats.n + '</td>'; }).join('') + '<td colspan="5"></td></tr>' +
      '</tfoot></table></div><p class="small muted">แสดง ' + rows.length + ' จาก ' + D.students.length + ' คน</p>';
  }

  $('#box').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var tr = b.closest('tr[data-std]'); if (!tr) return;
    var sid = tr.getAttribute('data-std');
    if (b.hasAttribute('data-cell')) openCell(sid, b.getAttribute('data-cell'));
    else if (b.hasAttribute('data-adj')) openAdj(sid);
  });

  /* ---------- แก้ช่องคะแนน ---------- */
  function openCell(sid, tid) {
    var s = stdOf(sid), t = typeOf(tid), c = s.cells[tid]; cell = { stdId: sid, typeId: tid };
    $('#cTitle').textContent = 'แก้คะแนน: ' + t.name;
    $('#cWho').innerHTML = '<b>' + esc(s.name) + '</b> <span class="mono">' + esc(sid) + '</span>';
    $('#cSys').textContent = t.auto ? (c.locked ? 'ตอนนี้เป็นค่าที่อาจารย์แก้ทับ · ค่าที่ระบบคิดให้ล่าสุด: ' + (c.auto === null ? '(ไม่มี)' : c.auto) : 'ค่าปัจจุบันมาจากระบบอัตโนมัติ — แก้แล้วระบบจะไม่ทับให้อีก' + (c.v !== null ? ' (ค่าระบบ ' + c.v + ')' : '')) : 'ประเภทที่กรอกเอง';
    $('#cScoreLbl').textContent = 'คะแนนที่ได้ (เต็ม ' + t.max + ')';
    $('#cScore').value = c.v === null ? '' : c.v; $('#cReason').value = c.locked ? c.reason : '';
    $('#cReasonWrap').hidden = !t.auto; $('#cRestore').hidden = !(t.auto && c.locked);
    $('#cHelp').textContent = t.auto ? 'เว้นว่างแล้วบันทึก = คืนค่าระบบ' : 'เว้นว่างแล้วบันทึก = ล้างคะแนน';
    $('#cErr').textContent = '';
    HBT.modal.open('mCell'); setTimeout(function () { $('#cScore').focus(); $('#cScore').select(); }, 50);
  }
  function saveCell(blank, btn) {
    var t = typeOf(cell.typeId), txt = blank ? '' : $('#cScore').value.trim();
    $('#cErr').textContent = '';
    if (txt !== '' && (!NUM.test(txt) || Number(txt) > t.max + 1e-9)) { $('#cErr').textContent = 'คะแนนต้องเป็นตัวเลข 0–' + t.max; return; }
    HBT.busy(btn, function () {
      return HBT.api.call('score.override', { courseId: id, typeId: cell.typeId, rows: [{ stdId: cell.stdId, score: txt, reason: t.auto ? $('#cReason').value : '' }] }, { write: true }).then(function (r) {
        if (r.skippedCount) throw Object.assign(new Error((r.skipped[0] && r.skipped[0].why) || 'บันทึกไม่ได้'), { code: 'LOCAL' });
        HBT.modal.close('mCell'); HBT.toast(blank && t.auto ? 'คืนค่าระบบแล้ว' : 'บันทึกแล้ว', 'good'); return load();
      });
    }).catch(function (er) { $('#cErr').textContent = er.code === 'LOCAL' ? er.message : HBT.errMsg(er); });
  }
  $('#cSave').addEventListener('click', function () { saveCell(false, this); });
  $('#cRestore').addEventListener('click', function () { saveCell(true, this); });
  $('#cScore').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#cSave').click(); } });

  /* ---------- คะแนนปรับ ---------- */
  function openAdj(sid) {
    var s = stdOf(sid); adjStd = sid;
    $('#aWho').innerHTML = '<b>' + esc(s.name) + '</b> <span class="mono">' + esc(sid) + '</span> · คะแนนรวมก่อนปรับ ' + fmtN(s.base);
    $('#aPts').value = s.adjust ? (s.adjust.points > 0 ? '+' : '') + s.adjust.points : ''; $('#aReason').value = s.adjust ? s.adjust.reason : '';
    $('#aClear').hidden = !s.adjust; $('#aErr').textContent = ''; $('#aHelp').textContent = ''; showAdjHelp();
    HBT.modal.open('mAdj'); setTimeout(function () { $('#aPts').focus(); $('#aPts').select(); }, 50);
  }
  function showAdjHelp() {
    var s = stdOf(adjStd), t = $('#aPts').value.trim();
    $('#aHelp').textContent = t && SIGNED.test(t) ? 'คะแนนรวมหลังปรับ = ' + r2(s.base + Number(t)) : '';
  }
  $('#aPts').addEventListener('input', showAdjHelp);
  function saveAdj(clear, btn) {
    var t = clear ? '' : $('#aPts').value.trim();
    $('#aErr').textContent = '';
    if (t !== '' && (!SIGNED.test(t) || Math.abs(Number(t)) > 100)) { $('#aErr').textContent = 'คะแนนปรับต้องเป็นตัวเลข −100 ถึง +100'; return; }
    HBT.busy(btn, function () {
      return HBT.api.call('score.adjust', { courseId: id, rows: [{ stdId: adjStd, points: t, reason: clear ? '' : $('#aReason').value }] }, { write: true }).then(function () {
        HBT.modal.close('mAdj'); HBT.toast(clear || t === '' ? 'ลบคะแนนปรับแล้ว' : 'บันทึกแล้ว', 'good'); return load();
      });
    }).catch(function (er) { $('#aErr').textContent = HBT.errMsg(er); });
  }
  $('#aSave').addEventListener('click', function () { saveAdj(false, this); });
  $('#aClear').addEventListener('click', function () { saveAdj(true, this); });
  $('#aPts').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#aSave').click(); } });

  /* ---------- เกณฑ์เกรด ---------- */
  function openScale() {
    $('#sFields').innerHTML = D.scale.order.map(function (g) {
      return '<div class="field"><label for="sc_' + esc(g) + '">เกรด ' + esc(g) + ' ตั้งแต่ (%)</label><input id="sc_' + esc(g) + '" data-g="' + esc(g) + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(D.scale.cuts[g]) + '"></div>';
    }).join('');
    $('#sErr').textContent = ''; HBT.modal.open('mScale');
  }
  function sendScale(cuts, btn, msg) {
    HBT.busy(btn, function () {
      return HBT.api.call('score.gradeScale', { courseId: id, cuts: cuts }, { write: true }).then(function () { HBT.modal.close('mScale'); HBT.toast(msg, 'good'); return load(); });
    }).catch(function (er) { $('#sErr').textContent = HBT.errMsg(er); });
  }
  $('#sSave').addEventListener('click', function () {
    var cuts = {}, bad = false;
    HBT.$$('#sFields input').forEach(function (i) { var v = i.value.trim(); if (!NUM.test(v) || Number(v) > 100) bad = true; cuts[i.getAttribute('data-g')] = v; });
    if (bad) { $('#sErr').textContent = 'เกณฑ์ต้องเป็นตัวเลข 0–100 และไล่จากมากไปน้อย'; return; }
    sendScale(cuts, this, 'บันทึกเกณฑ์เกรดแล้ว');
  });
  $('#sReset').addEventListener('click', function () { sendScale(null, this, 'คืนค่าเริ่มต้นแล้ว'); });

  /* ---------- โหลด ---------- */
  function load() {
    return HBT.api.call('score.summary', { courseId: id }).then(function (r) { D = r; render(); }, function (e) {
      var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN';
      $('#box').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบรายวิชานี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดสรุปคะแนนไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
        '<div class="row" style="margin-top:10px">' + (nf ? '' : '<button class="btn" type="button" id="reload">ลองใหม่</button>') + '<a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>';
      var rb = $('#reload'); if (rb) rb.addEventListener('click', load);
    });
  }
  load();
});
