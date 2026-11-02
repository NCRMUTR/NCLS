/* HBT Core — หน้าหลักอาจารย์ */
HBT.page({ active: 'home' }, function (ctx) {
  var esc = HBT.esc, u = ctx.user, root = HBT.api.root();
  var first = (u.name || u.email).replace(/^อ\.\s*/, '');
  var h = '<div class="page-h"><div class="stack-s"><h1>สวัสดี ' + esc(first) + '</h1><p class="muted" id="termLine">' +
    (ctx.term ? 'ภาคเรียน ' + esc(ctx.term.name) : 'ยังไม่ได้ตั้งภาคเรียนปัจจุบัน') + '</p></div></div>';

  var mine = ['att', 'exam', 'asg'].filter(function (s) { return u.role === 'admin' || u.systems.indexOf(s) >= 0; });

  if (u.role === 'admin' && !ctx.term) {
    h += '<div class="callout warn row sp" id="noTerm"><span><b>ยังไม่ได้ตั้งภาคเรียนปัจจุบัน</b> · ต้องมีก่อนเริ่มสร้างรายวิชา</span>' +
      '<a class="btn sm" href="' + root + 'a/settings.html">ไปตั้งค่า</a></div>';
  }
  if (u.role !== 'admin' && !mine.length) {
    h += '<div class="callout warn" id="noSys"><b>ยังไม่ได้รับสิทธิ์ใช้ระบบใดเลย</b><br>ติดต่อผู้ดูแลระบบเพื่อขอสิทธิ์เช็คชื่อ / สอบออนไลน์ / ส่งงาน</div>';
  }

  h += '<a class="card link-card" id="goCourses" href="' + root + 't/courses.html"><div class="row sp"><h3>รายวิชาของฉัน</h3><span class="pill acc">ข้อมูลกลาง</span></div>' +
    '<p class="small muted">สร้างรายวิชา นำเข้ารายชื่อนักศึกษา ออกรหัสให้ตั้ง PIN จัดการคะแนน</p><span class="arrow">เปิด ›</span></a>';
  h += '<div class="grid g3" id="sysCards">';
  ['att', 'exam', 'asg'].forEach(function (s) {
    var ok = mine.indexOf(s) >= 0;
    var live = ok;
    h += '<' + (live ? 'a href="' + root + 't/courses.html"' : 'div') + ' class="card link-card' + (ok ? '' : ' sys-off') + '" data-sys="' + s + '"><div class="row sp"><h3>' + esc(HBT.SYSTEM_NAMES[s]) + '</h3>' +
      (ok ? '<span class="pill good">มีสิทธิ์</span>' : '<span class="pill">ไม่มีสิทธิ์</span>') + '</div>' +
      '<p class="small muted">' + esc(HBT.SYSTEM_DESC[s]) + '</p>' +
      (live ? '<span class="arrow">' + ({ att: 'เลือกรายวิชาเพื่อเช็คชื่อ', exam: 'เลือกรายวิชาเพื่อจัดสอบ', asg: 'เลือกรายวิชาเพื่อสั่งงาน' }[s]) + ' ›</span>' : '') + '</' + (live ? 'a' : 'div') + '>';
  });
  h += '</div>';

  if (u.role === 'admin') {
    h += '<section class="card stack" id="admCard"><div class="card-head"><h2>ผู้ดูแลระบบ</h2><span class="pill adm">admin</span></div>' +
      '<div class="grid g2">' +
      '<a class="card flat link-card" href="' + root + 'a/users.html"><h3>ผู้ใช้และสิทธิ์</h3><p class="small muted">เพิ่มอีเมลอาจารย์ กำหนดระบบที่ใช้ได้ ปิดใช้งานบัญชี</p><span class="arrow">เปิด ›</span></a>' +
      '<a class="card flat link-card" href="' + root + 'a/settings.html"><h3>ตั้งค่าระบบ</h3><p class="small muted">ภาคเรียน ขนาดไฟล์ ค่าเริ่มต้นเช็คชื่อ PIN</p><span class="arrow">เปิด ›</span></a>' +
      '<a class="card flat link-card" id="goReset" href="' + root + 'a/reset.html"><h3>ลบข้อมูลสิ้นภาคเรียน</h3><p class="small muted">ลบข้อมูลวิชาที่จบแล้วถาวร (เตือนวิชาที่ยังไม่สำรอง)</p><span class="arrow">เปิด ›</span></a>' +
      '</div></section>';
  }
  ctx.content.insertAdjacentHTML('beforeend', h);
});
