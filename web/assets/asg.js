/* HBT Core — ส่งงาน (อาจารย์): รายการงานของรายวิชา · สั่งงาน/แก้ไข · คัดลอกข้อความแจ้งนักศึกษา */
HBT.page({ active: 'asg', need: 'asg', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['ส่งงาน']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var id = HBT.qs('id');
  var data = null, course = null, editing = null;

  if (!id) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบรายวิชา</b><br>เลือกรายวิชาก่อนจึงจะสั่งงานได้</div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>');
    return;
  }
  var q = encodeURIComponent(id);

  ctx.content.insertAdjacentHTML('beforeend', '<div id="box" class="stack"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +
    '<div class="modal" id="mEdit" hidden role="dialog" aria-modal="true" aria-labelledby="eTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="eTitle">สั่งงานใหม่</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="field"><label for="fT">ชื่องาน</label><input id="fT" type="text" maxlength="150" autocomplete="off"></div>' +
    '<div class="field"><label for="fD">รายละเอียด / คำสั่งงาน</label><textarea id="fD" rows="4" maxlength="4000"></textarea></div>' +
    '<div class="choice-row" role="radiogroup" aria-label="ประเภทงาน"><label class="choice"><input type="radio" name="fK" value="single" checked><span><b>งานเดี่ยว</b><br><span class="small muted">นักศึกษาส่งคนละชิ้น</span></span></label>' +
    '<label class="choice"><input type="radio" name="fK" value="group"><span><b>งานกลุ่ม</b><br><span class="small muted">ตัวแทนสร้างกลุ่มและส่งแทน</span></span></label></div>' +
    '<div class="err small" id="kNote"></div>' +
    '<div class="grid g2"><div class="field"><label for="fM">คะแนนเต็ม</label><input id="fM" type="number" inputmode="decimal" min="0.01" max="1000" step="any" value="10"></div>' +
    '<div class="field" id="gWrap" hidden><label for="fG">สมาชิกกลุ่มสูงสุด (คน)</label><input id="fG" type="number" inputmode="numeric" min="1" max="30" step="1" value="5"></div></div>' +
    '<div class="grid g2"><div class="field"><label for="fDue">กำหนดส่ง (ไม่บังคับ)</label><input id="fDue" type="datetime-local"></div>' +
    '<div class="field"><label for="fClose">ปิดรับ (ไม่บังคับ)</label><input id="fClose" type="datetime-local"></div></div>' +
    '<label class="check"><input type="checkbox" id="fLate"><span>รับงานที่ส่งช้า (เลยกำหนดส่งแต่ก่อนวันปิดรับ — บันทึกว่า “ส่งช้า”)</span></label>' +
    '<label class="check"><input type="checkbox" id="fShow" checked><span>ให้นักศึกษาเห็นคะแนนและความเห็นของตัวเอง</span></label>' +
    '<div class="field"><label for="fL">ลิงก์ประกอบงาน (ไม่บังคับ)</label><input id="fL" type="url" inputmode="url" maxlength="500" placeholder="https://" autocomplete="off"></div>' +
    '<div class="err" id="eErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="eSave">บันทึก</button></div></div></div>' +
    '<div class="modal" id="mMsg" hidden role="dialog" aria-modal="true" aria-labelledby="mgTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="mgTitle">ข้อความแจ้งนักศึกษา</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<p class="small muted">คัดลอกไปวางในกลุ่มไลน์/ห้องเรียนออนไลน์ นักศึกษากดลิงก์แล้วใส่ชื่อ + PIN ได้เลย</p>' +
    '<textarea id="msgTxt" rows="7" readonly></textarea><div class="row"><button class="btn primary" type="button" id="msgCopy">คัดลอก</button><a class="btn" id="msgOpen" target="_blank" rel="noopener" href="#">ลองเปิดลิงก์</a></div></div></div>');

  function fmt(t) { return t ? HBT.fmtBE(t, true) : ''; }
  function toInput(v) { return v ? String(v).replace(' ', 'T').substring(0, 16) : ''; }
  function fromInput(v) { return v ? String(v).replace('T', ' ') : ''; }
  function studentUrl(a, code) {
    var u = new URL(root + 's/submit.html', location.href);
    u.search = '?t=' + encodeURIComponent(data.tid) + '&c=' + encodeURIComponent(code || '');
    return u.toString();
  }
  function phasePill(p) { return p === 'closed' ? '<span class="pill bad">ปิดรับ</span>' : p === 'late' ? '<span class="pill warn">เลยกำหนด · รับช้า</span>' : '<span class="pill good">เปิดรับ</span>'; }

  function render() {
    var c = course;
    document.title = 'ส่งงาน ' + c.code + ' — HBT Teaching';
    var h = '<div class="page-h"><div class="stack-s"><h1>ส่งงาน <span class="muted">' + esc(c.code) + ' กลุ่ม ' + esc(c.section) + '</span></h1>' +
      '<p>' + esc(c.name) + ' · นักศึกษา ' + data.students + ' คน</p></div>' +
      '<div class="row"><button class="btn primary" type="button" id="newBtn">สั่งงานใหม่</button></div></div>';
    h += '<div class="callout info" id="howto">นักศึกษาเข้าส่งงานที่ลิงก์เดียวกันทุกงาน: <span class="mono">' + esc(new URL(root + 's/submit.html', location.href).toString()) + '</span> → เลือกอาจารย์ → ใส่ <b>รหัสงาน</b> → เลือกชื่อ → ใส่ PIN · ปุ่ม “แจ้งนักศึกษา” สร้างลิงก์ที่ใส่รหัสให้แล้ว</div>';
    if (data.students === 0) h += '<div class="callout warn" id="noStd"><b>วิชานี้ยังไม่มีนักศึกษา</b> — <a href="' + root + 't/students.html?id=' + q + '">นำเข้ารายชื่อ</a> ก่อนสั่งงาน</div>';
    if (!data.assignments.length) {
      h += '<div class="card stack-s" id="empty"><h3>ยังไม่มีงาน</h3><p class="small muted">กด “สั่งงานใหม่” เพื่อสร้างงานเดี่ยวหรืองานกลุ่ม ระบบจะออกรหัสงานให้</p></div>';
    } else {
      h += '<div class="stack" id="list">' + data.assignments.map(function (a) {
        var s = a.stats;
        return '<div class="card stack-s" data-asg="' + esc(a.asgId) + '"><div class="row sp"><h3>' + esc(a.title) + '</h3><div class="row"><span class="pill ' + (a.kind === 'group' ? 'info' : 'acc') + '">' + (a.kind === 'group' ? 'กลุ่ม' : 'เดี่ยว') + '</span>' + phasePill(a.phase) + '</div></div>' +
          '<p class="small muted">รหัสงาน <b class="mono">' + esc(a.code) + '</b> · เต็ม ' + esc(a.maxScore) + (a.dueAt ? ' · กำหนดส่ง ' + esc(fmt(a.dueAt)) : ' · ไม่กำหนดวันส่ง') + (a.closeAt ? ' · ปิดรับ ' + esc(fmt(a.closeAt)) : '') + '</p>' +
          '<div class="row small"><span class="pill ' + (s.submitted ? 'good' : '') + '">ส่งแล้ว ' + s.submitted + ' / ' + s.total + (a.kind === 'group' ? ' กลุ่ม' : '') + '</span>' +
          (s.toGrade ? '<span class="pill warn">รอตรวจ ' + s.toGrade + '</span>' : '') + (s.graded ? '<span class="pill info">ตรวจแล้ว ' + s.graded + '</span>' : '') +
          (s.late ? '<span class="pill warn">ส่งช้า ' + s.late + '</span>' : '') + (a.kind === 'group' && s.ungrouped ? '<span class="pill">ยังไม่มีกลุ่ม ' + s.ungrouped + ' คน</span>' : '') + '</div>' +
          '<div class="row"><a class="btn primary sm" href="' + root + 't/asg-detail.html?a=' + encodeURIComponent(a.asgId) + '">ตรวจงาน</a>' +
          '<button class="btn sm" type="button" data-msg="' + esc(a.asgId) + '">แจ้งนักศึกษา</button><button class="btn sm ghost" type="button" data-edit="' + esc(a.asgId) + '">แก้ไข</button></div></div>';
      }).join('') + '</div>';
    }
    $('#box').innerHTML = h;
    $('#newBtn').addEventListener('click', function () { openEdit(null); });
    HBT.$$('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { openEdit(b.getAttribute('data-edit')); }); });
    HBT.$$('[data-msg]').forEach(function (b) { b.addEventListener('click', function () { openMsg(b.getAttribute('data-msg')); }); });
  }

  function find(aid) { return data.assignments.filter(function (a) { return a.asgId === aid; })[0]; }

  function kindOf() { return (HBT.$('input[name=fK]:checked') || {}).value || 'single'; }
  function syncKind() { $('#gWrap').hidden = kindOf() !== 'group'; }
  HBT.$$('input[name=fK]').forEach(function (r) { r.addEventListener('change', syncKind); });

  function openEdit(aid) {
    editing = aid ? find(aid) : null;
    var a = editing;
    $('#eTitle').textContent = a ? 'แก้ไขงาน' : 'สั่งงานใหม่';
    $('#fT').value = a ? a.title : ''; $('#fD').value = a ? a.description : '';
    HBT.$$('input[name=fK]').forEach(function (r) { r.checked = r.value === (a ? a.kind : 'single'); });
    $('#fM').value = a ? a.maxScore : 10; $('#fG').value = a ? a.maxGroup : 5;
    $('#fDue').value = a ? toInput(a.dueAt) : ''; $('#fClose').value = a ? toInput(a.closeAt) : '';
    $('#fLate').checked = a ? a.lateOk : false; $('#fShow').checked = a ? a.showGrades : true; $('#fL').value = a ? a.linkUrl : '';
    var used = a && (a.stats.submitted > 0 || a.stats.ungrouped < data.students && a.kind === 'group');
    HBT.$$('input[name=fK]').forEach(function (r) { r.disabled = !!used; });
    $('#kNote').textContent = used ? 'เปลี่ยนประเภทงานไม่ได้แล้ว เพราะมีการส่งงานหรือมีกลุ่มแล้ว' : '';
    $('#eErr').textContent = ''; syncKind(); HBT.modal.open('mEdit');
  }
  $('#eSave').addEventListener('click', function () {
    var b = this, p = {
      title: $('#fT').value, description: $('#fD').value, kind: kindOf(), maxScore: $('#fM').value, maxGroup: $('#fG').value,
      dueAt: fromInput($('#fDue').value), closeAt: fromInput($('#fClose').value), lateOk: $('#fLate').checked, showGrades: $('#fShow').checked, linkUrl: $('#fL').value.trim()
    };
    $('#eErr').textContent = '';
    if (!p.title.trim()) { $('#eErr').textContent = 'กรุณากรอกชื่องาน'; return; }
    if (editing) p.asgId = editing.asgId; else p.courseId = id;
    HBT.busy(b, function () {
      return HBT.api.call('asg.save', p, { write: true }).then(function (r) {
        HBT.modal.close('mEdit'); HBT.toast(editing ? 'บันทึกแล้ว' : 'สั่งงานแล้ว รหัสงาน ' + r.code, 'good');
        return load().then(function () { if (!editing) openMsg(r.asgId); });
      });
    }).catch(function (e) { $('#eErr').textContent = HBT.errMsg(e); });
  });

  function openMsg(aid) {
    var a = find(aid), c = course;
    var url = studentUrl(a, a.code);
    var t = 'งาน: ' + a.title + '\nวิชา: ' + c.code + ' กลุ่ม ' + c.section + ' ' + c.name + (a.kind === 'group' ? '\nประเภท: งานกลุ่ม (ตัวแทนสร้างกลุ่มและส่งแทน)' : '') +
      (a.dueAt ? '\nกำหนดส่ง: ' + fmt(a.dueAt) : '') + '\nรหัสงาน: ' + a.code + '\nส่งงานที่: ' + url + '\n(ใช้ชื่อ + PIN 4 หลักของคุณ)';
    $('#msgTxt').value = t; $('#msgOpen').setAttribute('href', url); HBT.modal.open('mMsg');
  }
  $('#msgCopy').addEventListener('click', function () {
    var ta = $('#msgTxt'), done = function () { HBT.toast('คัดลอกแล้ว', 'good'); };
    ta.focus(); ta.select();
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, function () { try { document.execCommand('copy'); done(); } catch (e) { HBT.toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกดคัดลอกเอง', 'bad'); } });
    else { try { document.execCommand('copy'); done(); } catch (e) { HBT.toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกดคัดลอกเอง', 'bad'); } }
  });

  function load() {
    return Promise.all([HBT.api.call('asg.list', { courseId: id }), HBT.api.call('course.get', { courseId: id })]).then(function (r) {
      data = r[0]; course = r[1]; render();
      var ed = HBT.qs('edit'); if (ed && find(ed)) { openEdit(ed); }
    }, function (e) {
      var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN';
      $('#box').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบรายวิชานี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
        '<div class="row" style="margin-top:10px">' + (nf ? '' : '<button class="btn" type="button" id="reload">ลองใหม่</button>') + '<a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>';
      var rb = $('#reload'); if (rb) rb.addEventListener('click', load);
    });
  }
  load();
});
