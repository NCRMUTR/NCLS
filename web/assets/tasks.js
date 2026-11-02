/* HBT Core — หน้านักศึกษา: งานทั้งหมดของฉัน + สถานะการส่ง (เข้าด้วยชื่อ + PIN) */
(function () {
  'use strict';
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var app = document.getElementById('app');
  var S = HBT.stu;
  var st = { tid: '' };

  if (!HBT.api.configuredCore()) {
    app.innerHTML = '<div class="callout warn"><b>ยังไม่ได้ตั้งค่าเว็บ</b><br>ไฟล์ assets/config.js ยังไม่มี CORE_URL</div>';
    return;
  }
  function head(sub) {
    return '<div class="stack-s"><a class="brand" href="' + root + 'index.html"><span class="mark">H</span>HBT Teaching</a><h1>งานของฉัน</h1>' + (sub || '') + '</div>';
  }
  function foot() { return '<p class="small muted"><a href="' + root + 's/submit.html">ใส่รหัสงานเพื่อส่งงาน</a> · <a href="' + root + 'index.html">กลับหน้าแรก</a></p>'; }
  function fmt(t) { return t ? HBT.fmtBE(t, true) : ''; }

  /* ---------- เลือกอาจารย์ → วิชา → ชื่อ + PIN ---------- */
  function pick(msg) {
    app.innerHTML = head('<p class="muted">เลือกวิชาของคุณแล้วใส่ PIN เพื่อดูงานทั้งหมดและสถานะการส่ง</p>') +
      (msg ? '<div class="callout warn" id="msg">' + esc(msg) + '</div>' : '') +
      '<section class="card stack" id="pickCard">' +
      '<div class="field"><label for="selT">อาจารย์ผู้สอน</label><select id="selT"><option value="">กำลังโหลด…</option></select></div>' +
      '<div class="field"><label for="selC">รายวิชา</label><select id="selC" disabled><option value="">เลือกอาจารย์ก่อน</option></select></div>' +
      '<div id="lbox" class="stack" hidden></div><div class="err" id="perr" role="alert"></div></section>' + foot();
    HBT.api.call('pub.teachers', {}, { token: '' }).then(function (r) {
      var last = ''; try { last = localStorage.getItem('hbt.asg.tid') || ''; } catch (e) {}
      $('#selT').innerHTML = S.opt('', r.teachers.length ? '— เลือกอาจารย์ —' : 'ยังไม่มีรายวิชาในภาคเรียนนี้') + r.teachers.map(function (t) { return S.opt(t.tid, t.name); }).join('');
      if (last && r.teachers.some(function (t) { return t.tid === last; })) { $('#selT').value = last; onTeacher(); }
    }, function (e) { $('#selT').innerHTML = S.opt('', 'โหลดไม่สำเร็จ'); $('#perr').textContent = HBT.errMsg(e); });
    $('#selT').addEventListener('change', onTeacher);
    $('#selC').addEventListener('change', onCourse);
  }
  function onTeacher() {
    st.tid = $('#selT').value; $('#lbox').hidden = true; $('#perr').textContent = '';
    if (!st.tid) { $('#selC').disabled = true; $('#selC').innerHTML = S.opt('', 'เลือกอาจารย์ก่อน'); return; }
    try { localStorage.setItem('hbt.asg.tid', st.tid); } catch (e) {}
    $('#selC').disabled = true; $('#selC').innerHTML = S.opt('', 'กำลังโหลด…');
    HBT.api.call('pub.courses', { tid: st.tid }, { token: '' }).then(function (r) {
      $('#selC').innerHTML = S.opt('', r.courses.length ? '— เลือกรายวิชา —' : 'อาจารย์ท่านนี้ยังไม่มีรายวิชา') +
        r.courses.map(function (c) { return S.opt(c.courseId, c.code + ' กลุ่ม ' + c.section + ' — ' + c.name); }).join('');
      $('#selC').disabled = !r.courses.length;
      if (r.courses.length === 1) { $('#selC').value = r.courses[0].courseId; onCourse(); }
    }, function (e) { $('#perr').textContent = HBT.errMsg(e); });
  }
  function onCourse() {
    var cid = $('#selC').value; $('#perr').textContent = '';
    if (!cid) { $('#lbox').hidden = true; return; }
    $('#lbox').hidden = false;
    S.loginBox($('#lbox'), { courseId: cid, tid: st.tid, onDone: function () { list(); } });
  }

  /* ---------- รายการงาน ---------- */
  function pillOf(t) {
    if (t.needsGroup && t.phase !== 'closed') return '<span class="pill warn">ยังไม่มีกลุ่ม</span>';
    if (t.graded) return '<span class="pill good">ตรวจแล้ว' + (t.score !== null ? ' · ' + esc(t.score) + '/' + esc(t.maxScore) : '') + '</span>';
    if (t.submitted) return '<span class="pill good">ส่งแล้ว</span>' + (t.late ? ' <span class="pill warn">ส่งช้า</span>' : '');
    if (t.phase === 'closed') return '<span class="pill bad">ไม่ได้ส่ง · ปิดรับแล้ว</span>';
    if (t.phase === 'late') return '<span class="pill warn">เลยกำหนด · ยังรับช้า</span>';
    return '<span class="pill info">ยังไม่ส่ง</span>';
  }
  function list() {
    var s = S.sess(); if (!s) { pick(); return; }
    app.innerHTML = head() + '<div class="loading"><span class="spin"></span> กำลังโหลด…</div>';
    S.call('stu.tasks', {}).then(function (r) {
      var tid = s.tid || st.tid;
      function isOpen(t) { return t.phase !== 'closed' && !t.submitted && !t.graded; }
      function dueMs(t) { var m = String(t.dueAt || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/); return m ? new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 23), +(m[5] || 59)).getTime() : Infinity; }
      // งานค้างขึ้นก่อน เรียงตามกำหนดส่งที่ใกล้ที่สุด · ที่เหลือคงลำดับเดิม (ใหม่สุดก่อน)
      var tasks = r.tasks.map(function (t, i) { return { t: t, i: i }; }).sort(function (a, b) {
        var oa = isOpen(a.t) ? 0 : 1, ob = isOpen(b.t) ? 0 : 1;
        if (oa !== ob) return oa - ob;
        if (oa === 0 && dueMs(a.t) !== dueMs(b.t)) return dueMs(a.t) < dueMs(b.t) ? -1 : 1;
        return a.i - b.i;
      }).map(function (x) { return x.t; });
      var open = tasks.filter(isOpen);
      // a= เปิดงานได้ทันทีด้วยเซสชันนี้ (ไม่ต้องรู้รหัสอาจารย์) · t=/c= ไว้ให้เส้นทางที่ยังไม่ได้ล็อกอิน
      function hrefOf(t) { return root + 's/submit.html?a=' + encodeURIComponent(t.asgId) + '&t=' + encodeURIComponent(tid) + '&c=' + encodeURIComponent(t.code); }
      function leftTxt(t) {
        var d = dueMs(t); if (!isFinite(d) || t.phase === 'closed') return '';
        var diff = d - Date.now(), h = Math.round(Math.abs(diff) / 3600000);
        if (diff < 0) return 'เลยกำหนดมา ' + (h >= 48 ? Math.round(h / 24) + ' วัน' : h < 1 ? 'ไม่ถึงชั่วโมง' : h + ' ชม.');
        return 'เหลือ ' + (h >= 48 ? Math.round(h / 24) + ' วัน' : h < 1 ? 'ไม่ถึงชั่วโมง' : h + ' ชม.');
      }
      function actionOf(t) {
        if (!isOpen(t)) return '<span class="arrow">' + (t.phase === 'closed' || t.graded ? 'ดูรายละเอียด' : 'เปิด') + ' ›</span>';
        if (t.needsGroup) return '<span class="btn primary sm" data-go="' + esc(t.code) + '">สร้าง/เข้ากลุ่มก่อนส่ง ›</span>';
        return '<span class="btn primary sm" data-go="' + esc(t.code) + '">' + (t.phase === 'late' ? 'ส่งงาน (รับช้า)' : 'ส่งงาน') + ' ›</span>';
      }
      app.innerHTML = head('<p class="muted" id="who">' + esc(s.course.code) + ' กลุ่ม ' + esc(s.course.section) + ' — ' + esc(s.course.name) + '<br><b>' + esc(r.me.name) + '</b> (' + esc(r.me.stdId) + ')</p>') +
        (open.length ? '<a class="callout warn" id="todo" style="display:block" href="' + hrefOf(open[0]) + '"><b>ยังไม่ได้ส่ง ' + open.length + ' งาน</b><br>ทำเรื่องที่ใกล้กำหนดก่อน: ' + esc(open[0].title) +
          (leftTxt(open[0]) ? ' (' + esc(leftTxt(open[0])) + ')' : '') + ' — <u>กดเพื่อส่งงาน ›</u></a>' : '') +
        '<div class="stack" id="tlist">' + (tasks.length ? tasks.map(function (t) {
          var lt = isOpen(t) ? leftTxt(t) : '';
          return '<a class="card link-card" data-code="' + esc(t.code) + '" data-open="' + (isOpen(t) ? '1' : '0') + '" href="' + hrefOf(t) + '"><div class="row sp"><h3>' + esc(t.title) + '</h3>' + pillOf(t) + '</div>' +
            '<p class="small muted">' + (t.kind === 'group' ? 'งานกลุ่ม' : 'งานเดี่ยว') + (t.groupName ? ' · ' + esc(t.groupName) : '') + ' · เต็ม ' + esc(t.maxScore) +
            (t.dueAt ? ' · กำหนดส่ง ' + esc(fmt(t.dueAt)) : '') + (lt ? ' · <b>' + esc(lt) + '</b>' : '') + '</p>' + (t.submitted ? '<p class="small muted">ส่งล่าสุด ' + esc(fmt(t.updatedAt)) + '</p>' : '') + actionOf(t) + '</a>';
        }).join('') : '<div class="callout" id="noTasks">วิชานี้ยังไม่มีงาน</div>') + '</div>' +
        '<p class="small"><a href="#" id="bye">ออกจากระบบ</a></p>' + foot();
      $('#bye').addEventListener('click', function (e) { e.preventDefault(); S.clear(); pick(); });
    }, function (e) {
      if (e.code === 'E_AUTH') { pick('หมดเวลาเข้าใช้งาน (2 ชั่วโมง) — เลือกวิชาและใส่ PIN อีกครั้ง'); return; }
      app.innerHTML = head() + '<div class="callout bad"><b>โหลดไม่สำเร็จ</b><br>' + esc(HBT.errMsg(e)) + '</div><div class="row"><button class="btn" id="retry" type="button">ลองใหม่</button></div>' + foot();
      $('#retry').addEventListener('click', list);
    });
  }

  if (S.sess()) list(); else pick();
})();
