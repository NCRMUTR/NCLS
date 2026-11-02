/* HBT Core — ตรวจงาน (อาจารย์): รายการส่ง · ดูไฟล์/ดาวน์โหลด · ให้คะแนนเดี่ยว/ทั้งกลุ่ม/รายคน · ปิด-เปิดรับ · ลบงาน */
HBT.page({ active: 'asg', need: 'asg', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['ส่งงาน'], ['ตรวจงาน']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var aid = HBT.qs('a');
  var R = null, A = null, filter = 'all', cur = null, GA = null;

  if (!aid) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบงาน</b></div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>');
    return;
  }

  ctx.content.insertAdjacentHTML('beforeend', '<div id="box" class="stack"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +
    '<div class="modal" id="mUnit" hidden role="dialog" aria-modal="true" aria-labelledby="uTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="uTitle">รายละเอียด</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div><div id="uBody" class="stack"></div></div></div>' +
    '<div class="modal" id="mDel" hidden role="dialog" aria-modal="true" aria-labelledby="dTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="dTitle">ลบงานนี้ถาวร?</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="callout bad" id="dWarn"></div><div class="field"><label for="dConfirm">พิมพ์ชื่องานเพื่อยืนยัน</label><input id="dConfirm" type="text" autocomplete="off"></div>' +
    '<div class="err" id="dErr" role="alert"></div><div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn danger" type="button" id="dGo">ลบถาวร</button></div></div></div>');

  function fmt(t) { return t ? HBT.fmtBE(t, true) : ''; }
  function ext(n) { return (String(n).split('.').pop() || '').toLowerCase(); }
  function unitById(k) { return R.units.filter(function (u) { return u.subKey === k; })[0]; }
  function status(u) {
    if (u.graded) return 'graded';
    if (u.submitted) return 'toGrade';
    return 'none';
  }
  function scoreText(u) {
    var sc = u.members.map(function (m) { return m.score; }).filter(function (v) { return v !== null; });
    if (!sc.length) return '—';
    var same = sc.every(function (v) { return v === sc[0]; });
    if (u.members.length === 1) return String(sc[0]);
    if (same && sc.length === u.members.length) return String(sc[0]);
    return same ? sc[0] + ' (' + sc.length + '/' + u.members.length + ' คน)' : 'ต่างกัน';
  }
  function pillOf(u) {
    if (u.graded) return '<span class="pill info">ตรวจแล้ว</span>';
    if (u.submitted) return '<span class="pill good">ส่งแล้ว</span>' + (u.late ? ' <span class="pill warn">ช้า</span>' : '');
    return '<span class="pill">ยังไม่ส่ง</span>';
  }

  function render() {
    A = R.assignment;
    var st = R.stats, group = A.kind === 'group';
    document.title = A.title + ' — ตรวจงาน';
    var h = '<div class="page-h"><div class="stack-s"><p class="small"><a href="' + root + 't/asg.html?id=' + encodeURIComponent(A.courseId) + '" id="backLink">‹ งานทั้งหมดของวิชา</a></p><h1 id="aTitle">' + esc(A.title) + '</h1>' +
      '<p class="small muted">รหัสงาน <b class="mono">' + esc(A.code) + '</b> · ' + (group ? 'งานกลุ่ม' : 'งานเดี่ยว') + ' · เต็ม ' + esc(A.maxScore) + (A.dueAt ? ' · กำหนดส่ง ' + esc(fmt(A.dueAt)) : '') + (A.closeAt ? ' · ปิดรับ ' + esc(fmt(A.closeAt)) : '') + '</p></div>' +
      '<div class="row"><span class="pill ' + (A.phase === 'closed' ? 'bad' : A.phase === 'late' ? 'warn' : 'good') + '" id="phase">' + (A.phase === 'closed' ? 'ปิดรับ' : A.phase === 'late' ? 'เลยกำหนด · รับช้า' : 'เปิดรับ') + '</span></div></div>';
    h += '<div class="row" id="acts"><button class="btn" type="button" id="togBtn">' + (A.status === 'closed' ? 'เปิดรับอีกครั้ง' : 'ปิดรับงานนี้') + '</button>' +
      '<a class="btn" href="' + root + 't/asg.html?id=' + encodeURIComponent(A.courseId) + '&edit=' + encodeURIComponent(A.asgId) + '">แก้ไขงาน</a>' +
      '<button class="btn" type="button" id="csvBtn">ส่งออก CSV</button><a class="btn ghost" href="' + root + 't/scores.html?id=' + encodeURIComponent(A.courseId) + '">ตารางคะแนน</a>' +
      '<button class="btn ghost" type="button" id="delBtn" style="color:var(--bad)">ลบงาน</button></div>';
    if (A.status !== 'closed' && A.phase === 'closed') h += '<div class="callout warn" id="autoClosed">งานนี้ปิดรับอัตโนมัติตามวันที่ที่ตั้งไว้ — แก้ไขงานเพื่อเลื่อนวันปิดรับ</div>';
    h += '<div class="grid g4 counts" id="counts">' +
      '<div class="count-box"><span class="small">' + (group ? 'กลุ่มทั้งหมด' : 'ทั้งหมด') + '</span><b class="num" id="cTotal">' + st.total + '</b></div>' +
      '<div class="count-box good"><span class="small">ส่งแล้ว</span><b class="num" id="cSub">' + st.submitted + '</b></div>' +
      '<div class="count-box warn"><span class="small">รอตรวจ</span><b class="num" id="cTo">' + st.toGrade + '</b></div>' +
      '<div class="count-box info"><span class="small">ตรวจแล้ว</span><b class="num" id="cGr">' + st.graded + '</b></div></div>';
    if (group && R.ungrouped.length) {
      h += '<details class="card flat" id="ungrp"><summary><b>ยังไม่มีกลุ่ม ' + R.ungrouped.length + ' คน</b></summary><p class="small" style="margin-top:8px">' + R.ungrouped.map(function (x) { return esc(x.stdId + ' ' + x.name); }).join(' · ') + '</p></details>';
    }
    var chips = [['all', 'ทั้งหมด'], ['none', 'ยังไม่ส่ง'], ['toGrade', 'รอตรวจ'], ['graded', 'ตรวจแล้ว'], ['late', 'ส่งช้า']];
    h += '<div class="row" id="chips" role="group" aria-label="กรอง">' + chips.map(function (c) { return '<button class="btn sm' + (filter === c[0] ? ' primary' : ' ghost') + '" type="button" data-f="' + c[0] + '">' + c[1] + '</button>'; }).join('') +
      '<input id="sq" type="search" placeholder="ค้นหาชื่อ/รหัส" autocomplete="off" style="max-width:220px;min-height:34px"></div>';
    h += '<div id="tbl"></div>';
    $('#box').innerHTML = h;
    HBT.$$('[data-f]').forEach(function (b) { b.addEventListener('click', function () { filter = b.getAttribute('data-f'); render(); }); });
    $('#sq').addEventListener('input', renderTable);
    $('#togBtn').addEventListener('click', function () {
      var b = this, closed = A.status !== 'closed';
      HBT.busy(b, function () { return HBT.api.call('asg.setStatus', { asgId: aid, closed: closed }, { write: true }).then(function () { HBT.toast(closed ? 'ปิดรับงานแล้ว' : 'เปิดรับงานแล้ว', 'good'); return load(); }); })
        .catch(function (e) { HBT.toast(HBT.errMsg(e), 'bad'); });
    });
    $('#csvBtn').addEventListener('click', exportCsv);
    $('#delBtn').addEventListener('click', openDel);
    renderTable();
  }

  function renderTable() {
    var q = ($('#sq') ? $('#sq').value : '').trim().toLowerCase();
    var rows = R.units.filter(function (u) {
      if (filter === 'none' && u.submitted) return false;
      if (filter === 'toGrade' && !(u.submitted && !u.graded)) return false;
      if (filter === 'graded' && !u.graded) return false;
      if (filter === 'late' && !u.late) return false;
      if (!q) return true;
      return (u.name + ' ' + u.members.map(function (m) { return m.stdId + ' ' + m.name; }).join(' ')).toLowerCase().indexOf(q) >= 0;
    });
    var group = A.kind === 'group';
    if (!rows.length) { $('#tbl').innerHTML = '<div class="callout" id="noRows">' + (R.units.length ? 'ไม่มีรายการตามตัวกรอง' : (group ? 'ยังไม่มีกลุ่ม — นักศึกษาต้องสร้างกลุ่มก่อนจึงจะส่งงานได้' : 'วิชานี้ยังไม่มีนักศึกษา')) + '</div>'; return; }
    $('#tbl').innerHTML = '<div class="scroll"><table id="subTbl"><thead><tr><th>' + (group ? 'กลุ่ม' : 'นักศึกษา') + '</th><th>สถานะ</th><th class="num">คะแนน</th></tr></thead><tbody>' +
      rows.map(function (u) {
        return '<tr data-u="' + esc(u.subKey) + '" style="cursor:pointer"><td><a href="#" data-open="' + esc(u.subKey) + '"><b>' + esc(u.name) + '</b></a>' +
          '<div class="small muted">' + (group ? esc(u.members.length + ' คน · ตัวแทน ' + (u.rep ? u.rep.name : '')) : esc(u.members[0].stdId)) + '</div></td>' +
          '<td>' + pillOf(u) + (u.submitted ? '<div class="small muted">' + esc(fmt(u.updatedAt)) + ' · ' + u.files.length + ' ไฟล์' + (u.link ? ' · ลิงก์' : '') + '</div>' : '') + '</td>' +
          '<td class="num"><b>' + esc(scoreText(u)) + '</b></td></tr>';
      }).join('') + '</tbody></table></div><p class="small muted">กดชื่อเพื่อดูงานที่ส่งและให้คะแนน · ' + rows.length + ' รายการ</p>';
    HBT.$$('[data-open]').forEach(function (a) { a.addEventListener('click', function (e) { e.preventDefault(); openUnit(a.getAttribute('data-open')); }); });
  }

  /* ---------- รายละเอียด + ให้คะแนน ---------- */
  function fileBtns(f) {
    var e = ext(f.name), viewable = /^(pdf|jpe?g|png)$/.test(e);
    return '<div class="filechip" data-fid="' + esc(f.fileId) + '"><span class="ext ' + (e === 'xlsx' ? 'x' : e === 'pptx' ? 'p' : /jpe?g|png/.test(e) ? 'i' : '') + '">' + esc(e.toUpperCase()) + '</span><span class="nm" title="' + esc(f.name) + '">' + esc(f.name) + '</span>' +
      '<span class="small muted">' + esc(size(f.size)) + '</span>' +
      (viewable ? '<button class="btn sm" type="button" data-view="' + esc(f.fileId) + '">เปิดดู</button>' : '') + '<button class="btn sm" type="button" data-dl="' + esc(f.fileId) + '">ดาวน์โหลด</button></div>';
  }
  function size(n) { n = Number(n) || 0; return n >= 1048576 ? (Math.round(n / 104857.6) / 10) + ' MB' : n >= 1024 ? Math.round(n / 1024) + ' KB' : n + ' B'; }
  function safeUrl(u) { return /^https?:\/\/[^\s]{3,}$/i.test(String(u || '')) ? u : ''; }

  function openUnit(k) {
    var u = unitById(k); if (!u) return;
    cur = u; var group = A.kind === 'group';
    $('#uTitle').textContent = u.name;
    var h = '<div class="small muted">' + (group ? 'สมาชิก ' + u.members.length + ' คน · ตัวแทนส่งงาน: ' + esc(u.rep ? u.rep.name + ' (' + u.rep.stdId + ')' : '') : esc(u.members[0].stdId)) + '</div>';
    if (u.submitted) {
      h += '<div class="callout ' + (u.late ? 'warn' : 'good') + '" id="uSub"><b>ส่งแล้ว</b> ' + esc(fmt(u.updatedAt)) + (u.late ? ' · <b>ส่งช้า</b>' : '') + (u.firstAt !== u.updatedAt ? '<br><span class="small">ส่งครั้งแรก ' + esc(fmt(u.firstAt)) + '</span>' : '') + '</div>';
      if (u.files.length) h += '<div class="stack-s" id="uFiles">' + u.files.map(fileBtns).join('') + '</div>';
      if (u.note) h += '<div><span class="small muted">ข้อความจากนักศึกษา</span><div style="white-space:pre-wrap" id="uNote">' + esc(u.note) + '</div></div>';
      if (u.link) h += '<div><span class="small muted">ลิงก์</span><br>' + (safeUrl(u.link) ? '<a href="' + esc(safeUrl(u.link)) + '" target="_blank" rel="noopener noreferrer">' + esc(u.link) + '</a>' : esc(u.link)) + '</div>';
    } else h += '<div class="callout" id="uSub">ยังไม่ได้ส่งงาน' + (group ? '' : '') + ' — ให้คะแนนได้ (เช่น 0 คะแนนกรณีไม่ส่ง)</div>';

    h += '<hr style="border:0;border-top:1px solid var(--line);width:100%"><h3>ให้คะแนน <span class="muted small">(เต็ม ' + esc(A.maxScore) + ')</span></h3>';
    var first = u.members[0], allSame = u.members.every(function (m) { return m.score === first.score && m.feedback === first.feedback; });
    h += '<div class="field"><label for="gScore">' + (group ? 'คะแนนทั้งกลุ่ม' : 'คะแนน') + '</label><input id="gScore" type="text" inputmode="decimal" autocomplete="off" value="' + esc(allSame && first.score !== null ? first.score : '') + '"></div>' +
      '<div class="field"><label for="gFb">ความเห็นถึงนักศึกษา (ไม่บังคับ)</label><textarea id="gFb" rows="2" maxlength="1000">' + esc(allSame ? first.feedback : '') + '</textarea></div>';
    if (group) {
      h += '<label class="check"><input type="checkbox" id="gEach"' + (allSame ? '' : ' checked') + '><span>ให้คะแนนสมาชิกแต่ละคนไม่เท่ากัน</span></label><div id="gMem" class="stack-s" ' + (allSame ? 'hidden' : '') + '>' +
        u.members.map(function (m) {
          return '<div class="row" data-m="' + esc(m.stdId) + '"><span class="grow small">' + esc(m.stdId) + ' ' + esc(m.name) + '</span><input class="sc-in" type="text" inputmode="decimal" aria-label="คะแนน ' + esc(m.name) + '" value="' + esc(m.score === null ? '' : m.score) + '"></div>';
        }).join('') + '</div>';
    }
    h += '<div class="err" id="gErr" role="alert"></div><div class="row"><button class="btn primary" type="button" id="gSave">บันทึกคะแนน</button><button class="btn ghost" type="button" id="gClear">ล้างคะแนน</button></div>' +
      '<p class="small muted">คะแนนซิงก์เข้า “ตารางคะแนน” ประเภทงานนี้ทันที (น้ำหนักตั้งที่หน้าคะแนน) · นักศึกษาจะแก้งานไม่ได้เมื่อมีคะแนนแล้ว</p>';
    $('#uBody').innerHTML = h;
    if (group) $('#gEach').addEventListener('change', function () { $('#gMem').hidden = !this.checked; });
    HBT.$$('[data-view]', $('#uBody')).forEach(function (b) { b.addEventListener('click', function () { getFile(b, b.getAttribute('data-view'), true); }); });
    HBT.$$('[data-dl]', $('#uBody')).forEach(function (b) { b.addEventListener('click', function () { getFile(b, b.getAttribute('data-dl'), false); }); });
    $('#gSave').addEventListener('click', function () { saveGrade(this, false); });
    $('#gClear').addEventListener('click', function () { saveGrade(this, true); });
    HBT.modal.open('mUnit');
  }

  function getFile(btn, fileId, view) {
    var w = null;
    if (view) { try { w = window.open('', '_blank'); } catch (e) { w = null; } }
    HBT.busy(btn, function () {
      return HBT.api.call('asg.fileGet', { fileId: fileId }).then(function (f) {
        var bin = atob(f.b64), arr = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        var url = URL.createObjectURL(new Blob([arr], { type: f.mime }));
        if (view && w) { w.location.href = url; }
        else {
          var a = document.createElement('a'); a.href = url; a.download = f.name; document.body.appendChild(a); a.click(); a.remove();
          if (view) HBT.toast('เบราว์เซอร์บล็อกหน้าต่างใหม่ — ดาวน์โหลดแทน');
        }
        setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
      });
    }).catch(function (e) { if (w) { try { w.close(); } catch (x) {} } HBT.toast(e.code === 'E_NOT_FOUND' ? 'ไม่พบไฟล์ใน Drive (อาจถูกลบ)' : HBT.errMsg(e), 'bad'); });
  }

  function parseScore(v) {
    v = String(v).trim().replace(/,/g, '');
    if (v === '') return '';
    var n = Number(v);
    if (isNaN(n) || n < 0 || n > Number(A.maxScore)) return null;
    return n;
  }
  function saveGrade(btn, clear) {
    var u = cur, err = $('#gErr'), rows = [], fb = $('#gFb').value.trim(), group = A.kind === 'group';
    err.textContent = '';
    if (clear) {
      if (!window.confirm('ล้างคะแนนและความเห็นของ ' + (group ? 'ทั้งกลุ่ม' : 'คนนี้') + '?')) return;
      rows = u.members.map(function (m) { return { stdId: m.stdId, score: '', feedback: '' }; });
    } else if (group && $('#gEach').checked) {
      var bad = false;
      HBT.$$('[data-m]', $('#gMem')).forEach(function (r) {
        var s = parseScore(r.querySelector('input').value); if (s === null) bad = true;
        rows.push({ stdId: r.getAttribute('data-m'), score: s === null ? '' : s, feedback: fb });
      });
      if (bad) { err.textContent = 'คะแนนต้องเป็นตัวเลข 0–' + A.maxScore; return; }
    } else {
      var s = parseScore($('#gScore').value);
      if (s === null) { err.textContent = 'คะแนนต้องเป็นตัวเลข 0–' + A.maxScore; return; }
      rows = u.members.map(function (m) { return { stdId: m.stdId, score: s, feedback: fb }; });
    }
    HBT.busy(btn, function () {
      return HBT.api.call('asg.grade', { asgId: aid, grades: rows }, { write: true }).then(function (r) {
        if (r.skippedCount) { err.textContent = 'บันทึกไม่ได้ ' + r.skippedCount + ' แถว: ' + r.skipped.map(function (x) { return x.stdId + ' ' + x.why; }).join(', '); }
        else { HBT.modal.close('mUnit'); HBT.toast(clear ? 'ล้างคะแนนแล้ว' : 'บันทึกคะแนนแล้ว', 'good'); }
        return load();
      });
    }).catch(function (e) { err.textContent = HBT.errMsg(e); });
  }

  /* ---------- CSV · ลบ ---------- */
  function exportCsv() {
    var rows = [['รหัสนักศึกษา', 'ชื่อ', 'กลุ่ม', 'สถานะ', 'ส่งล่าสุด', 'ส่งช้า', 'จำนวนไฟล์', 'ข้อความ', 'ลิงก์', 'คะแนน', 'ความเห็น']];
    R.units.forEach(function (u) {
      u.members.forEach(function (m) {
        rows.push([m.stdId, m.name, A.kind === 'group' ? u.name : '', u.submitted ? 'ส่งแล้ว' : 'ยังไม่ส่ง', u.updatedAt || '', u.late ? 'ช้า' : '', u.files.length, u.note || '', u.link || '', m.score === null ? '' : m.score, m.feedback || '']);
      });
    });
    R.ungrouped.forEach(function (x) { rows.push([x.stdId, x.name, '(ยังไม่มีกลุ่ม)', 'ยังไม่ส่ง', '', '', 0, '', '', '', '']); });
    HBT.csv.download((A.code + '-' + A.title).replace(/[\\\/:*?"<>|\s]+/g, '_') + '.csv', HBT.csv.build(rows));
  }
  function openDel() {
    var st = R.stats, nf = R.units.reduce(function (n, u) { return n + u.files.length; }, 0);
    $('#dWarn').innerHTML = '<b>ลบถาวร ย้อนกลับไม่ได้</b><br>จะลบ: งานที่นักศึกษาส่ง ' + st.submitted + ' รายการ · ไฟล์ ' + nf + ' ไฟล์ (ย้ายลงถังขยะ Google Drive) · คะแนนงานนี้ทั้งหมดในตารางคะแนน' + (A.kind === 'group' ? ' · กลุ่มที่นักศึกษาสร้างไว้' : '');
    $('#dConfirm').value = ''; $('#dErr').textContent = ''; HBT.modal.open('mDel');
  }
  $('#dGo').addEventListener('click', function () {
    if ($('#dConfirm').value.trim() !== A.title) { $('#dErr').textContent = 'ชื่องานที่พิมพ์ไม่ตรง'; return; }
    HBT.busy(this, function () {
      return HBT.api.call('asg.delete', { asgId: aid }, { write: true }).then(function () { location.replace(root + 't/asg.html?id=' + encodeURIComponent(A.courseId)); return new Promise(function () {}); });
    }).catch(function (e) { $('#dErr').textContent = HBT.errMsg(e); });
  });

  function load() {
    return HBT.api.call('asg.submissions', { asgId: aid }).then(function (r) { R = r; render(); }, function (e) {
      var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN';
      $('#box').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบงานนี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
        '<div class="row" style="margin-top:10px">' + (nf ? '' : '<button class="btn" type="button" id="reload">ลองใหม่</button>') + '<a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>';
      var rb = $('#reload'); if (rb) rb.addEventListener('click', load);
    });
  }
  load();
});
