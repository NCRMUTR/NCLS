/* HBT Core — สำรองข้อมูลวิชา (อาจารย์เจ้าของวิชา/ผู้ดูแล)
 * ชุดสรุปวิชา 1 ไฟล์ + ไฟล์งานแยก Zip ต่องาน (ใหญ่แบ่งเป็นหลายส่วน) — ประกอบในเบราว์เซอร์ด้วย JSZip
 * เมื่อทุกรายการสำเร็จครบ จึงบันทึก "สำรองเมื่อ…" (backup.mark) ให้หน้าลบข้อมูลของผู้ดูแลใช้เตือน */
HBT.page({ active: 'courses', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['สำรองข้อมูล']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root(), B = HBT.backup;
  var id = HBT.qs('id');
  var course = null, man = null, items = [], running = false;

  if (!id) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบรายวิชา</b><br>กลับไปเลือกรายวิชาก่อน</div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>');
    return;
  }
  ctx.content.insertAdjacentHTML('beforeend', '<div id="box"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>');

  var STATE = {
    empty: ['ยังไม่มีข้อมูลให้สำรอง', ''], none: ['ยังไม่เคยสำรอง', 'warn'],
    stale: ['มีการแก้ไขหลังสำรองล่าสุด', 'warn'], ok: ['สำรองครบแล้ว (ข้อมูลไม่เปลี่ยนหลังสำรอง)', 'good']
  };

  function when(iso) { return iso ? HBT.fmtBE(iso, true) : ''; }

  function buildItems() {
    items = [{ key: 'summary', title: 'สรุปวิชา (CSV)', desc: 'รายชื่อ · คะแนน · เช็คชื่อ · คะแนนงาน · ข้อสอบและผลสอบ', status: 'idle', parts: 1, msg: '' }];
    man.assignments.forEach(function (a) {
      items.push({
        key: 'asg:' + a.asgId, asg: a, title: 'งาน: ' + a.title, status: 'idle', msg: '', plan: null,
        desc: a.files ? a.files + ' ไฟล์ · ' + B.fmtSize(a.bytes) + ' · ส่งแล้ว ' + a.submitted + ' คน' : 'ไม่มีไฟล์แนบ (มีเฉพาะรายการส่ง/คะแนน — อยู่ในชุดสรุปวิชา)',
        parts: 0, skip: !a.files
      });
    });
  }

  function render() {
    var c = course, st = STATE[man.state] || STATE.none, q = encodeURIComponent(id);
    document.title = 'สำรองข้อมูล ' + c.code + ' — HBT Teaching';
    var done = items.filter(function (i) { return i.status === 'done' || i.skip; }).length;
    $('#box').innerHTML =
      '<div class="page-h"><div class="stack-s"><h1>สำรองข้อมูลวิชา</h1><p>' + esc(c.code) + ' กลุ่ม ' + esc(c.section) + ' — ' + esc(c.name) + '</p>' +
      '<p class="small muted">ภาคเรียน ' + esc(c.termName) + '</p></div><div class="row"><a class="btn" href="' + root + 't/course.html?id=' + q + '">กลับไปวิชา</a></div></div>' +
      '<section class="card stack"><div class="row sp"><b>สถานะการสำรอง</b><span class="pill ' + st[1] + '" id="bkState" data-state="' + esc(man.state) + '">' + esc(st[0]) + '</span></div>' +
      '<p class="small muted" id="bkWhen">' + (man.backupAt ? 'สำรองครั้งล่าสุด ' + esc(when(man.backupAt)) : 'ยังไม่เคยบันทึกว่าสำรองครบ') + '</p>' +
      '<div class="callout info small">ไฟล์ถูกประกอบ “ในเครื่องของคุณ” แล้วดาวน์โหลดทีละชุด · ให้เก็บไว้ในที่ปลอดภัย (มีรายชื่อและคะแนนนักศึกษา) · ระบบจะบันทึกว่า “สำรองครบ” ก็ต่อเมื่อทุกรายการด้านล่างสำเร็จ' +
      (HBT.api.configuredExam && HBT.api.configuredExam() ? '' : ' · ระบบสอบออนไลน์ยังไม่ได้ตั้งค่า จึงไม่มีข้อสอบในชุดสรุป') + '</div>' +
      '<div class="callout warn small">รูปประกอบข้อสอบไม่รวมในการสำรอง · ถ้าผู้ดูแลลบข้อมูลวิชา รูปเหล่านี้จะถูกลบถาวรด้วย</div>' +
      '<div class="row"><button class="btn primary" type="button" id="backupAll"' + (man.state === 'empty' || running ? ' disabled' : '') + '>ดาวน์โหลดทั้งหมด (' + (items.length) + ' รายการ)</button>' +
      '<span class="small muted" id="bkProg">' + done + ' / ' + items.length + ' รายการเสร็จ</span></div>' +
      '<div class="err" id="bkMsg" role="alert"></div></section>' +
      '<section class="stack" id="bkList">' + items.map(itemHtml).join('') + '</section>';
    $('#backupAll').addEventListener('click', runAll);
    HBT.$$('[data-dl]').forEach(function (b) { b.addEventListener('click', function () { runOne(b.getAttribute('data-dl')); }); });
  }

  var LAB = { idle: ['รอดำเนินการ', ''], running: ['กำลังทำ…', 'info'], done: ['เสร็จแล้ว', 'good'], partial: ['ไม่ครบ', 'warn'], error: ['ผิดพลาด', 'bad'], skip: ['ไม่มีไฟล์', ''] };
  function itemHtml(it) {
    var s = it.skip ? 'skip' : it.status, l = LAB[s];
    return '<div class="card stack-s" data-item="' + esc(it.key) + '" data-status="' + s + '">' +
      '<div class="row sp"><b>' + esc(it.title) + '</b><span class="pill ' + l[1] + '">' + l[0] + '</span></div>' +
      '<p class="small muted">' + esc(it.desc) + (it.parts > 1 ? ' · แบ่งเป็น ' + it.parts + ' ส่วน' : '') + '</p>' +
      '<div class="small" data-msg>' + esc(it.msg) + '</div>' +
      (it.skip ? '' : '<div class="row"><button class="btn sm" type="button" data-dl="' + esc(it.key) + '"' + (running ? ' disabled' : '') + '>' +
        (it.status === 'done' ? 'ดาวน์โหลดอีกครั้ง' : it.status === 'idle' ? 'ดาวน์โหลด' : 'ลองใหม่') + '</button></div>') + '</div>';
  }

  function paint(it) {
    var el = $('[data-item="' + it.key.replace(/"/g, '') + '"]');
    if (!el) return;
    var s = it.skip ? 'skip' : it.status, l = LAB[s];
    el.setAttribute('data-status', s);
    var p = $('.pill', el); p.className = 'pill ' + l[1]; p.textContent = l[0];
    $('[data-msg]', el).textContent = it.msg;
    var db = $('[data-dl]', el);
    if (db) db.textContent = it.status === 'done' ? 'ดาวน์โหลดอีกครั้ง' : (it.status === 'idle' || it.status === 'running') ? 'ดาวน์โหลด' : 'ลองใหม่';
    var done = items.filter(function (i) { return i.status === 'done' || i.skip; }).length;
    $('#bkProg').textContent = done + ' / ' + items.length + ' รายการเสร็จ';
  }
  function lock(on) {
    running = on;
    HBT.$$('[data-dl]').forEach(function (b) { b.disabled = on; });
    var a = $('#backupAll'); if (a) a.disabled = on || man.state === 'empty';
  }

  function pause(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function runItem(it) {
    it.status = 'running'; it.msg = 'กำลังเตรียม…'; paint(it);
    if (it.key === 'summary') {
      return B.buildSummary(course, { assignments: man.assignments }, function (t) { it.msg = 'กำลังรวม: ' + t + '…'; paint(it); }).then(function (r) {
        B.save(r.blob, r.name);
        it.status = 'done'; it.msg = r.name + ' (' + B.fmtSize(r.blob.size) + ')' + (r.skipped.length ? ' · ข้าม ' + r.skipped.length + ' ส่วน (ดู README ในไฟล์)' : '');
        paint(it);
      });
    }
    return B.planAssignment(course, it.asg).then(function (plan) {
      it.plan = plan; it.parts = plan.count;
      var bad = 0, i = 0, names = [];
      function next() {
        if (i >= plan.count) return null;
        var k = i++;
        return plan.build(k, function (n, tot) { it.msg = 'ส่วน ' + (k + 1) + '/' + plan.count + ' · ดึงไฟล์ ' + n + '/' + tot; paint(it); }).then(function (r) {
          B.save(r.blob, r.name); names.push(r.name); bad += r.errors.length;
          it.msg = 'ส่วน ' + (k + 1) + '/' + plan.count + ' ดาวน์โหลดแล้ว'; paint(it);
          return pause(plan.count > 1 ? 700 : 0).then(next);
        });
      }
      return Promise.resolve(next()).then(function () {
        if (bad) { it.status = 'partial'; it.msg = 'ดึงไฟล์ไม่สำเร็จ ' + bad + ' ไฟล์ (ดู README ในไฟล์) — กดลองใหม่'; }
        else { it.status = 'done'; it.msg = names.length + ' ไฟล์ Zip (' + plan.files + ' ไฟล์งาน, ' + B.fmtSize(plan.bytes) + ')'; }
        paint(it);
      });
    });
  }

  function fail(it, e) { it.status = 'error'; it.msg = HBT.errMsg(e); paint(it); }

  function afterRun() {
    var all = items.every(function (i) { return i.status === 'done' || i.skip; });
    if (!all) return Promise.resolve(false);
    var parts = items.reduce(function (s, i) { return s + (i.parts || 1); }, 0);
    return HBT.api.call('backup.mark', { courseId: id, parts: parts }, { write: true }).then(function (r) {
      man.backupAt = r.backupAt; man.state = 'ok';
      var st = STATE.ok, pill = $('#bkState');
      pill.className = 'pill ' + st[1]; pill.textContent = st[0]; pill.setAttribute('data-state', 'ok');
      $('#bkWhen').textContent = 'สำรองครั้งล่าสุด ' + when(r.backupAt);
      HBT.toast('บันทึกแล้วว่าสำรองครบ', 'good');
      return true;
    }, function (e) { $('#bkMsg').textContent = 'ดาวน์โหลดครบแล้ว แต่บันทึกสถานะไม่สำเร็จ: ' + HBT.errMsg(e) + ' — กด “ดาวน์โหลดทั้งหมด” อีกครั้งเพื่อบันทึกใหม่'; return false; });
  }

  function runList(list) {
    if (running) return Promise.resolve();
    $('#bkMsg').textContent = '';
    lock(true);
    var p = Promise.resolve();
    list.forEach(function (it) { p = p.then(function () { return runItem(it).catch(function (e) { fail(it, e); }); }); });
    return p.then(afterRun).then(function () { lock(false); });
  }
  function runAll() {
    // รายการที่เสร็จแล้วในรอบนี้ข้ามได้ (กดอีกครั้ง = ทำเฉพาะที่ค้าง) · ครบหมดแล้ว = ทำใหม่ทั้งหมด
    var todo = items.filter(function (i) { return !i.skip && i.status !== 'done'; });
    if (!todo.length) { items.forEach(function (i) { if (!i.skip) i.status = 'idle'; }); todo = items.filter(function (i) { return !i.skip; }); }
    return runList(todo);
  }
  function runOne(key) {
    var it = items.filter(function (i) { return i.key === key; })[0];
    if (it) runList([it]);
  }

  function load() {
    return Promise.all([HBT.api.call('course.get', { courseId: id }), HBT.api.call('backup.manifest', { courseId: id })]).then(function (r) {
      course = r[0]; man = r[1]; man.course = man.course || {};
      buildItems(); render();
    }, function (e) {
      var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN' || e.code === 'E_COURSE_RESETTING';
      $('#box').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบรายวิชานี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
        '<div class="row" style="margin-top:10px">' + (nf ? '' : '<button class="btn" type="button" id="reload">ลองใหม่</button>') + '<a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>';
      var rb = $('#reload'); if (rb) rb.addEventListener('click', load);
    });
  }
  load();
});
