/* HBT Core — รายวิชาของฉัน */
HBT.page({ active: 'courses', crumbs: [['รายวิชาของฉัน']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var isAdmin = ctx.user.role === 'admin';
  var all = false;

  ctx.content.insertAdjacentHTML('beforeend',
    '<div class="page-h"><div class="stack-s"><h1>รายวิชาของฉัน</h1><p class="muted" id="termLine"></p></div>' +
    '<div class="row"><button class="btn primary" type="button" id="addBtn">เพิ่มรายวิชา</button></div></div>' +
    (isAdmin ? '<label class="check" style="padding:0"><input type="checkbox" id="allChk"><span>แสดงรายวิชาของทุกคน (ผู้ดูแล)</span></label>' : '') +
    '<div id="listBox"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +
    '<div class="modal" id="mCourse" hidden role="dialog" aria-modal="true" aria-labelledby="mTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="mTitle">เพิ่มรายวิชา</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="field"><label for="cc">รหัสวิชา</label><input id="cc" type="text" maxlength="20" autocomplete="off" placeholder="เช่น BIO101"></div>' +
    '<div class="field"><label for="cn">ชื่อวิชา</label><input id="cn" type="text" maxlength="150" autocomplete="off" placeholder="เช่น ชีววิทยาพื้นฐาน"></div>' +
    '<div class="field"><label for="cs">กลุ่มเรียน</label><input id="cs" type="text" maxlength="10" autocomplete="off" placeholder="เช่น 1"><span class="help">รหัสวิชา + กลุ่มเรียนต้องไม่ซ้ำกับวิชาอื่นของคุณในภาคเรียนเดียวกัน</span></div>' +
    '<div class="err" id="mErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="saveBtn">สร้างรายวิชา</button></div>' +
    '</div></div>');

  function render(r) {
    $('#termLine').textContent = r.term ? 'ภาคเรียน ' + r.term.name : 'ยังไม่ได้ตั้งภาคเรียนปัจจุบัน';
    if (!r.term) {
      $('#listBox').innerHTML = '<div class="callout warn"><b>ยังไม่ได้ตั้งภาคเรียนปัจจุบัน</b><br>' +
        (isAdmin ? 'ไปที่ <a href="' + root + 'a/settings.html">ตั้งค่าระบบ</a> เพื่อเพิ่มภาคเรียน' : 'แจ้งผู้ดูแลระบบให้ตั้งภาคเรียนก่อน จึงจะสร้างรายวิชาได้') + '</div>';
      $('#addBtn').disabled = true;
      return;
    }
    $('#addBtn').disabled = false;
    if (!r.courses.length) {
      $('#listBox').innerHTML = '<div class="callout"><b>ยังไม่มีรายวิชาในภาคเรียนนี้</b><br>กด “เพิ่มรายวิชา” เพื่อเริ่ม แล้วนำเข้ารายชื่อนักศึกษาจากไฟล์ CSV</div>';
      return;
    }
    $('#listBox').innerHTML = '<div class="grid g2" id="courseGrid">' + r.courses.map(function (c) {
      return '<a class="card link-card" data-id="' + esc(c.courseId) + '" href="' + root + 't/course.html?id=' + encodeURIComponent(c.courseId) + '">' +
        '<div class="row sp"><h3>' + esc(c.code) + ' <span class="muted">กลุ่ม ' + esc(c.section) + '</span></h3><span class="pill info">' + c.students + ' คน</span></div>' +
        '<p>' + esc(c.name) + '</p>' +
        (all && c.ownerEmail !== ctx.user.email ? '<p class="xs muted">เจ้าของ: ' + esc(c.ownerEmail) + '</p>' : '') +
        '<span class="arrow">เปิดรายวิชา ›</span></a>';
    }).join('') + '</div>';
  }

  function load() {
    return HBT.api.call('course.list', all ? { all: true } : {}).then(render, function (e) {
      $('#listBox').innerHTML = '<div class="callout bad"><b>โหลดรายวิชาไม่สำเร็จ</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn" type="button" id="reload">ลองใหม่</button></div>';
      $('#reload').addEventListener('click', load);
    });
  }

  $('#addBtn').addEventListener('click', function () {
    ['cc', 'cn', 'cs'].forEach(function (i) { $('#' + i).value = ''; });
    $('#mErr').textContent = '';
    HBT.modal.open('mCourse');
  });
  $('#saveBtn').addEventListener('click', function () {
    var b = this, p = { code: $('#cc').value.trim(), name: $('#cn').value.trim(), section: $('#cs').value.trim() };
    $('#mErr').textContent = '';
    if (!p.code) { $('#mErr').textContent = 'กรุณากรอกรหัสวิชา'; return; }
    if (!p.name) { $('#mErr').textContent = 'กรุณากรอกชื่อวิชา'; return; }
    if (!p.section) { $('#mErr').textContent = 'กรุณากรอกกลุ่มเรียน'; return; }
    HBT.busy(b, function () {
      return HBT.api.call('course.create', p, { write: true }).then(function (c) {
        location.href = root + 't/course.html?id=' + encodeURIComponent(c.courseId);
      });
    }).catch(function (er) { $('#mErr').textContent = HBT.errMsg(er); });
  });
  var chk = $('#allChk');
  if (chk) chk.addEventListener('change', function () { all = chk.checked; load(); });

  load();
});
