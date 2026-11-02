/* HBT Core — รายงานเข้าเรียนทั้งรายวิชา (ตารางคาบ × นักศึกษา) */
HBT.page({ active: 'att', need: 'att', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['เช็คชื่อ'], ['รายงาน']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var id = HBT.qs('id');
  var rep = null;
  var SH = { normal: ['✓', 'good', 'ปกติ'], late: ['ส', 'warn', 'สาย'], leave: ['ล', 'info', 'ลา'], absent: ['ข', 'bad', 'ขาด'] };

  if (!id) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบรายวิชา</b></div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>');
    return;
  }
  var q = encodeURIComponent(id);

  ctx.content.insertAdjacentHTML('beforeend', '<div id="box" class="stack"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +
    '<div class="modal" id="mDet" hidden role="dialog" aria-modal="true" aria-labelledby="dTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="dTitle">รายคาบ</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div><div id="dBody"></div></div></div>');

  function render() {
    var r = rep, c = r.course;
    document.title = 'รายงานเข้าเรียน ' + c.code + ' — HBT Teaching';
    var h = '<div class="page-h"><div class="stack-s"><h1>รายงานเข้าเรียน <span class="muted">' + esc(c.code) + ' กลุ่ม ' + esc(c.section) + '</span></h1>' +
      '<p>' + esc(c.name) + ' · ' + r.totalSessions + ' คาบที่ปิดแล้ว · นักศึกษา ' + r.students.length + ' คน</p></div>' +
      '<div class="row"><button class="btn" type="button" id="csvBtn">ส่งออก CSV</button><a class="btn" href="' + root + 't/att.html?id=' + q + '">ประวัติคาบ</a></div></div>';
    h += '<div class="callout" id="wBox">คะแนนเช็คชื่อ = ปกติ 1 · สาย 0.5 · ลา 1 · ขาด 0 เฉลี่ยทุกคาบที่ปิด แล้วคิดเป็น 100 คะแนน · ' +
      (r.weightPct ? 'น้ำหนักในคะแนนรวม <b>' + r.weightPct + '%</b>' : '<b>ยังไม่ได้กำหนดน้ำหนัก</b> (ตอนนี้ 0% จึงยังไม่รวมในคะแนนรวม)') +
      ' · <a href="' + root + 't/scores.html?id=' + q + '">ตั้งน้ำหนักที่หน้าคะแนน</a></div>';
    if (!r.totalSessions) {
      h += '<div class="callout" id="noRep">ยังไม่มีคาบที่ปิดแล้ว — เมื่อปิดคาบหรือนำเข้าข้อมูลย้อนหลัง รายงานจะแสดงที่นี่</div>';
      $('#box').innerHTML = h; $('#csvBtn').disabled = true; return;
    }
    h += '<div class="scroll"><table id="repTbl"><thead><tr><th class="sticky-c">รหัส</th><th>ชื่อ</th>' +
      r.sessions.map(function (s) { return '<th class="c" title="' + esc(HBT.fmtBE(s.date)) + '">' + esc(String(s.date).substring(5).replace('-', '/')) + (s.kind === 'manual' ? '*' : '') + '</th>'; }).join('') +
      '<th class="num">ปกติ</th><th class="num">สาย</th><th class="num">ลา</th><th class="num">ขาด</th><th class="num">%</th></tr></thead><tbody>' +
      r.students.map(function (s) {
        return '<tr data-std="' + esc(s.stdId) + '"><td class="mono sticky-c">' + esc(s.stdId) + '</td><td><a href="#" data-det="' + esc(s.stdId) + '">' + esc(s.name) + '</a></td>' +
          s.records.map(function (x) { var m = SH[x]; return '<td class="c"><span class="pill ' + m[1] + '" title="' + m[2] + '">' + m[0] + '</span></td>'; }).join('') +
          '<td class="num">' + s.counts.normal + '</td><td class="num">' + s.counts.late + '</td><td class="num">' + s.counts.leave + '</td><td class="num">' + s.counts.absent + '</td>' +
          '<td class="num"><b>' + (s.percent === null ? '' : s.percent) + '</b></td></tr>';
      }).join('') + '</tbody></table></div>' +
      '<p class="small muted">✓ ปกติ · ส สาย · ล ลา · ข ขาด · * คาบที่นำเข้าย้อนหลัง · กดชื่อเพื่อดูรายคาบ · แก้สถานะได้ที่หน้าเช็คชื่อสดของแต่ละคาบ (ประวัติคาบ → เปิดดู)</p>';
    $('#box').innerHTML = h;
    $('#csvBtn').addEventListener('click', function () {
      var b = this;
      HBT.busy(b, function () { return HBT.api.call('att.exportCsv', { courseId: id }).then(function (x) { HBT.csv.download(x.filename, x.csv); }); })
        .catch(function (e) { HBT.toast(HBT.errMsg(e), 'bad'); });
    });
    HBT.$$('[data-det]', $('#box')).forEach(function (a) {
      a.addEventListener('click', function (ev) { ev.preventDefault(); detail(a.getAttribute('data-det')); });
    });
  }

  function detail(std) {
    $('#dBody').innerHTML = '<div class="loading"><span class="spin"></span> กำลังโหลด…</div>'; $('#dTitle').textContent = 'รายคาบ'; HBT.modal.open('mDet');
    HBT.api.call('att.studentDetail', { courseId: id, stdId: std }).then(function (d) {
      $('#dTitle').textContent = d.name + ' (' + d.stdId + ')';
      $('#dBody').innerHTML = d.sessions.length ? '<div class="scroll"><table><thead><tr><th>วันที่</th><th>สถานะ</th><th>เวลา</th><th>หมายเหตุ</th></tr></thead><tbody>' +
        d.sessions.map(function (s) {
          var m = SH[s.status];
          return '<tr><td class="mono">' + esc(HBT.fmtBE(s.date)) + '</td><td><span class="pill ' + m[1] + '">' + m[2] + '</span></td><td class="mono">' + esc(s.at ? String(s.at).substring(11, 16) : '') + '</td><td>' + esc(s.note) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">ยังไม่มีคาบ</p>';
    }, function (e) { $('#dBody').innerHTML = '<div class="callout bad">' + esc(HBT.errMsg(e)) + '</div>'; });
  }

  function load() {
    return HBT.api.call('att.report', { courseId: id }).then(function (r) { rep = r; render(); }, function (e) {
      var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN';
      $('#box').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบรายวิชานี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
        '<div class="row" style="margin-top:10px">' + (nf ? '' : '<button class="btn" type="button" id="reload">ลองใหม่</button>') + '<a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>';
      var rb = $('#reload'); if (rb) rb.addEventListener('click', load);
    });
  }
  load();
});
