/* HBT Core — หน้านักศึกษา: ส่งงาน (ลิงก์ถาวร s/submit.html?t=อาจารย์&c=รหัสงาน) */
(function () {
  'use strict';
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var app = document.getElementById('app');
  var S = HBT.stu;
  var st = { tid: HBT.qs('t') || '', code: HBT.qs('c') || '', res: null, T: null, log: [], uploading: false, draft: { note: '', link: '' }, editGroup: false };
  var WHY = {
    E_ASG_CLOSED: 'งานนี้ปิดรับแล้ว', E_ASG_GRADED: 'อาจารย์ตรวจและให้คะแนนแล้ว จึงแก้ไขไม่ได้',
    E_ASG_NO_GROUP: 'งานกลุ่ม — ต้องมีกลุ่มก่อนจึงจะส่งได้', E_ASG_NOT_REP: 'งานกลุ่ม — ส่งงานได้เฉพาะตัวแทนกลุ่ม'
  };

  if (!HBT.api.configuredCore()) {
    app.innerHTML = '<div class="callout warn"><b>ยังไม่ได้ตั้งค่าเว็บ</b><br>ไฟล์ assets/config.js ยังไม่มี CORE_URL</div>';
    return;
  }

  function head(sub) {
    return '<div class="stack-s"><a class="brand" href="' + root + 'index.html"><span class="mark">H</span>HBT Teaching</a><h1>ส่งงาน</h1>' + (sub || '') + '</div>';
  }
  function foot() {
    var s = S.sess();
    return '<p class="small muted">' + (s ? '<a href="' + root + 's/tasks.html">งานทั้งหมดของฉัน</a> · <a href="#" id="bye">ออกจากระบบ</a> · ' : '') +
      '<a href="' + root + 'index.html">กลับหน้าแรก</a></p>';
  }
  function bindFoot() {
    var b = $('#bye');
    if (b) b.addEventListener('click', function (e) { e.preventDefault(); S.clear(); st.T = null; start(); });
  }
  function fmt(t) { return t ? HBT.fmtBE(t, true) : ''; }

  /* ---------- 1) หางาน: อาจารย์ + รหัสงาน ---------- */
  function find(msg) {
    app.innerHTML = head('<p class="muted">เลือกอาจารย์ผู้สอนและใส่รหัสงานที่ได้รับ (เช่น <span class="mono">K7M-4PQ</span>)</p>') +
      '<section class="card stack" id="findCard">' +
      '<div class="field"><label for="selT">อาจารย์ผู้สอน</label><select id="selT"><option value="">กำลังโหลด…</option></select></div>' +
      '<div class="field"><label for="code">รหัสงาน</label><input id="code" class="mono" type="text" maxlength="8" autocomplete="off" autocapitalize="characters" placeholder="XXX-XXX" style="font-size:1.2rem;letter-spacing:.12em"></div>' +
      '<div class="err" id="ferr" role="alert">' + esc(msg || '') + '</div>' +
      '<button class="btn primary block" type="button" id="fgo" style="min-height:50px;font-size:1.05rem">ค้นหางาน</button></section>' + foot();
    bindFoot();
    $('#code').value = st.code;
    HBT.api.call('pub.teachers', {}, { token: '' }).then(function (r) {
      var last = ''; try { last = localStorage.getItem('hbt.asg.tid') || ''; } catch (e) {}
      $('#selT').innerHTML = S.opt('', r.teachers.length ? '— เลือกอาจารย์ —' : 'ยังไม่มีรายวิชาในภาคเรียนนี้') + r.teachers.map(function (t) { return S.opt(t.tid, t.name); }).join('');
      var want = st.tid || last;
      if (want && r.teachers.some(function (t) { return t.tid === want; })) $('#selT').value = want;
    }, function (e) { $('#selT').innerHTML = S.opt('', 'โหลดไม่สำเร็จ'); $('#ferr').textContent = HBT.errMsg(e); });
    function go() {
      var tid = $('#selT').value, code = $('#code').value.trim();
      $('#ferr').textContent = '';
      if (!tid) { $('#ferr').textContent = 'กรุณาเลือกอาจารย์'; return; }
      if (code.replace(/[^A-Za-z0-9]/g, '').length !== 6) { $('#ferr').textContent = 'รหัสงานมี 6 ตัวอักษร เช่น K7M-4PQ'; return; }
      st.tid = tid; st.code = code;
      try { localStorage.setItem('hbt.asg.tid', tid); } catch (e) {}
      HBT.busy($('#fgo'), resolve).catch(function (e) {
        $('#ferr').textContent = e.code === 'E_NOT_FOUND' ? 'ไม่พบงานนี้ — ตรวจสอบอาจารย์และรหัสงานอีกครั้ง' : HBT.errMsg(e);
      });
    }
    $('#fgo').addEventListener('click', go);
    $('#code').addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    $('#code').addEventListener('input', function () { this.value = this.value.toUpperCase().replace(/[^A-Z0-9\-]/g, ''); });
  }

  function resolve() {
    return HBT.api.call('asg.resolve', { tid: st.tid, code: st.code }, { token: '' }).then(function (r) {
      st.res = r;
      var s = S.sess();
      if (s && s.courseId === r.courseId) return loadTask();
      loginScreen();
    });
  }

  /* ---------- 2) ยืนยันตัวตน ---------- */
  function loginScreen(msg) {
    var r = st.res;
    app.innerHTML = head() +
      '<section class="card stack-s" id="taskHint"><span class="small muted">' + esc(r.course.code) + ' กลุ่ม ' + esc(r.course.section) + ' — ' + esc(r.course.name) + '</span>' +
      '<h2 id="hTitle">' + esc(r.title) + '</h2><div class="row"><span class="pill ' + (r.kind === 'group' ? 'info' : 'acc') + '">' + (r.kind === 'group' ? 'งานกลุ่ม' : 'งานเดี่ยว') + '</span>' +
      phasePill(r.phase) + '</div></section>' +
      (msg ? '<div class="callout warn" id="lmsg">' + esc(msg) + '</div>' : '') +
      '<section class="card stack" id="loginCard"><h3>ยืนยันตัวตน</h3><div id="lbox" class="stack"></div></section>' +
      '<p class="small"><a href="#" id="other">ไม่ใช่งานนี้? เปลี่ยนอาจารย์/รหัสงาน</a></p>' + foot();
    bindFoot();
    $('#other').addEventListener('click', function (e) { e.preventDefault(); find(); });
    S.loginBox($('#lbox'), { courseId: r.courseId, tid: st.tid, onDone: function () { loadTask(); } });
  }

  function phasePill(p) {
    return p === 'closed' ? '<span class="pill bad">ปิดรับแล้ว</span>' : p === 'late' ? '<span class="pill warn">เลยกำหนด (ยังรับช้า)</span>' : '<span class="pill good">เปิดรับ</span>';
  }

  /* ---------- 3) หน้างาน ---------- */
  function loadTask() {
    var s = S.sess(); if (!s) { loginScreen(); return Promise.resolve(); }
    var asgId = st.res.asgId;
    return S.call('stu.task', { asgId: asgId }).then(function (t) {
      st.T = t;
      if (!st.uploading) { st.draft.note = t.sub ? t.sub.note : ''; st.draft.link = t.sub ? t.sub.link : ''; }
      view();
    }, function (e) {
      if (e.code === 'E_AUTH') { loginScreen('หมดเวลาเข้าใช้งาน (2 ชั่วโมง) — ใส่ PIN อีกครั้งเพื่อทำต่อ'); return; }
      app.innerHTML = head() + '<div class="callout bad"><b>โหลดงานไม่สำเร็จ</b><br>' + esc(HBT.errMsg(e)) + '</div><div class="row"><button class="btn" id="retry" type="button">ลองใหม่</button><button class="btn ghost" id="other2" type="button">เปลี่ยนงาน</button></div>' + foot();
      $('#retry').addEventListener('click', loadTask); $('#other2').addEventListener('click', function () { find(); });
      bindFoot();
    });
  }

  function dueText(a) {
    var p = [];
    if (a.dueAt) p.push('กำหนดส่ง <b>' + esc(fmt(a.dueAt)) + '</b>');
    if (a.closeAt) p.push('ปิดรับ <b>' + esc(fmt(a.closeAt)) + '</b>');
    if (!a.dueAt && !a.closeAt) p.push('ไม่ได้กำหนดวันส่ง');
    if (a.dueAt && !a.lateOk) p.push('ไม่รับงานช้า');
    else if (a.dueAt && a.lateOk) p.push('รับงานช้าได้ (บันทึกว่าส่งช้า)');
    return p.join(' · ');
  }
  function safeUrl(u) { return /^https?:\/\/[^\s]{3,}$/i.test(String(u || '')) ? u : ''; }

  function statusBanner(t) {
    var a = t.asg, h;
    if (t.graded) h = '<div class="callout good" id="stBanner"><b>อาจารย์ตรวจแล้ว</b>' + (t.grade ? ' — คะแนน <b class="num">' + esc(t.grade.score) + '</b> / ' + esc(a.maxScore) + (t.grade.feedback ? '<br>ความเห็น: ' + esc(t.grade.feedback) : '') : ' (อาจารย์ยังไม่เปิดให้ดูคะแนน)') + '</div>';
    else if (a.phase === 'closed') h = '<div class="callout bad" id="stBanner"><b>ปิดรับงานแล้ว</b>' + (t.sub ? '<br>งานที่ส่งไว้ยังอยู่ครบ' : '<br>คุณยังไม่ได้ส่งงานนี้ — แจ้งอาจารย์หากมีเหตุจำเป็น') + '</div>';
    else if (t.sub) h = '<div class="callout good" id="stBanner"><b>ส่งแล้ว</b> เมื่อ ' + esc(fmt(t.sub.updatedAt)) + (t.sub.late ? ' <span class="pill warn">ส่งช้า</span>' : '') + (t.canEdit ? '<br>แก้ไข/เพิ่ม/ลบไฟล์ได้จนกว่างานจะปิดหรืออาจารย์ให้คะแนน' : '') + '</div>';
    else if (a.phase === 'late') h = '<div class="callout warn" id="stBanner"><b>เลยกำหนดส่งแล้ว</b> — ส่งตอนนี้ระบบจะบันทึกว่า “ส่งช้า”</div>';
    else h = '<div class="callout" id="stBanner">ยังไม่ได้ส่งงาน</div>';
    return h;
  }

  function view() {
    var t = st.T, a = t.asg, me = t.me;
    document.title = a.title + ' — ส่งงาน';
    app.innerHTML = head() +
      '<section class="card stack-s" id="taskCard"><span class="small muted">' + esc(st.res.course.code) + ' กลุ่ม ' + esc(st.res.course.section) + ' — ' + esc(st.res.course.name) + '</span>' +
      '<h2 id="hTitle">' + esc(a.title) + '</h2>' +
      '<div class="row"><span class="pill ' + (a.kind === 'group' ? 'info' : 'acc') + '">' + (a.kind === 'group' ? 'งานกลุ่ม' : 'งานเดี่ยว') + '</span>' + phasePill(a.phase) +
      '<span class="pill">เต็ม ' + esc(a.maxScore) + ' คะแนน</span><span class="pill mono">' + esc(a.code) + '</span></div>' +
      '<p class="small" id="dueLine">' + dueText(a) + '</p>' +
      (a.description ? '<div id="desc" style="white-space:pre-wrap">' + esc(a.description) + '</div>' : '') +
      (safeUrl(a.linkUrl) ? '<p class="small">ลิงก์จากอาจารย์: <a href="' + esc(safeUrl(a.linkUrl)) + '" target="_blank" rel="noopener noreferrer">' + esc(a.linkUrl) + '</a></p>' : '') +
      '<p class="small muted">ผู้ส่ง: <b>' + esc(me.name) + '</b> (' + esc(me.stdId) + ')</p></section>' +
      '<div id="status">' + statusBanner(t) + '</div>' +
      (a.kind === 'group' ? '<section class="card stack" id="groupCard"></section>' : '') +
      '<section class="card stack" id="subCard"></section>' + foot();
    bindFoot();
    if (a.kind === 'group') renderGroup();
    renderSub();
  }

  /* ---------- กลุ่ม ---------- */
  function memberPicker(selected, cands, max) {
    var h = '<div class="field"><label for="gq">ค้นหาเพื่อน</label><input id="gq" type="search" autocomplete="off" placeholder="พิมพ์รหัสหรือชื่อ"></div><div class="stack-s" id="gList" style="max-height:260px;overflow:auto">';
    cands.forEach(function (c) {
      h += '<label class="check" data-q="' + esc((c.stdId + ' ' + c.name).toLowerCase()) + '"><input type="checkbox" name="mem" value="' + esc(c.stdId) + '"' + (selected.indexOf(c.stdId) >= 0 ? ' checked' : '') + '><span>' + esc(c.stdId) + ' — ' + esc(c.name) + '</span></label>';
    });
    return h + '</div><p class="small muted" id="gCount"></p>';
  }
  function bindPicker(box, max) {
    function upd() {
      var n = $$checked(box).length + 1;
      $('#gCount', box).innerHTML = 'เลือกแล้ว ' + (n - 1) + ' คน · รวมคุณเป็น <b>' + n + '</b> / ' + max + ' คน' + (n > max ? ' <span class="err">เกินจำนวนที่กำหนด</span>' : '');
    }
    HBT.$$('input[name=mem]', box).forEach(function (c) { c.addEventListener('change', upd); });
    $('#gq', box).addEventListener('input', function () {
      var q = this.value.trim().toLowerCase();
      HBT.$$('[data-q]', box).forEach(function (l) { l.hidden = !!q && l.getAttribute('data-q').indexOf(q) < 0; });
    });
    upd();
  }
  function $$checked(box) { return HBT.$$('input[name=mem]:checked', box).map(function (c) { return c.value; }); }

  function renderGroup() {
    var t = st.T, a = t.asg, g = t.group, box = $('#groupCard'), max = a.maxGroup;
    if (!g) {
      box.innerHTML = '<h3>กลุ่มของคุณ</h3><p class="small muted">งานนี้ส่งเป็นกลุ่ม (สูงสุด ' + max + ' คน รวมตัวแทน) · คนที่สร้างกลุ่มจะเป็น <b>ตัวแทนส่งงาน</b> เลือกสมาชิกได้ครั้งเดียว — เพื่อนที่ถูกเลือกจะเห็นกลุ่มโดยอัตโนมัติ และจะอยู่ได้เพียงกลุ่มเดียว</p>' +
        (a.phase === 'closed' ? '<div class="callout bad">งานปิดรับแล้ว สร้างกลุ่มไม่ได้</div>' :
          '<div class="field"><label for="gname">ชื่อกลุ่ม (ไม่บังคับ)</label><input id="gname" type="text" maxlength="60" autocomplete="off"></div>' +
          memberPicker([], t.candidates, max) + '<div class="err" id="gerr" role="alert"></div><button class="btn primary block" id="gmk" type="button">สร้างกลุ่ม และเป็นตัวแทน</button>');
      if (a.phase !== 'closed') {
        bindPicker(box, max);
        $('#gmk').addEventListener('click', function () { saveGroup(this, box); });
      }
      return;
    }
    var h = '<div class="row sp"><h3>กลุ่ม: <span id="gName">' + esc(g.name) + '</span></h3>' + (g.isRep ? '<span class="pill acc">คุณเป็นตัวแทน</span>' : '<span class="pill">สมาชิก</span>') + '</div>' +
      '<ul style="margin:0;padding-left:20px" id="gMembers">' + g.members.map(function (m) { return '<li>' + esc(m.stdId) + ' — ' + esc(m.name) + (m.stdId === g.rep.stdId ? ' <span class="pill acc">ตัวแทน</span>' : '') + '</li>'; }).join('') + '</ul>';
    if (!g.isRep) h += '<p class="small muted">ตัวแทนกลุ่ม (' + esc(g.rep.name) + ') เป็นผู้ส่งงาน — คุณดูสถานะได้ที่หน้านี้</p>';
    if (g.isRep && t.canEdit) {
      if (st.editGroup) {
        var cur = g.members.filter(function (m) { return m.stdId !== me().stdId; });
        h += '<div class="stack" id="gEdit"><div class="field"><label for="gname">ชื่อกลุ่ม</label><input id="gname" type="text" maxlength="60" value="' + esc(g.name) + '"></div>' +
          memberPicker(cur.map(function (m) { return m.stdId; }), cur.concat(t.candidates), max) +
          '<div class="err" id="gerr" role="alert"></div><div class="row"><button class="btn primary" id="gsave" type="button">บันทึกกลุ่ม</button><button class="btn ghost" id="gcancel" type="button">ยกเลิก</button></div></div>';
      } else {
        h += '<div class="row"><button class="btn sm" id="gedit" type="button">แก้ไขสมาชิก</button><button class="btn sm ghost" id="gdel" type="button">ยกเลิกกลุ่ม</button></div>';
      }
    }
    box.innerHTML = h;
    if ($('#gEdit', box)) {
      bindPicker(box, max);
      $('#gsave').addEventListener('click', function () { saveGroup(this, box); });
      $('#gcancel').addEventListener('click', function () { st.editGroup = false; renderGroup(); });
    }
    if ($('#gedit', box)) $('#gedit').addEventListener('click', function () { st.editGroup = true; renderGroup(); });
    if ($('#gdel', box)) $('#gdel').addEventListener('click', function () {
      if (!window.confirm('ยกเลิกกลุ่มนี้? สมาชิกทุกคนจะกลับไปเป็นคนที่ยังไม่มีกลุ่ม')) return;
      HBT.busy(this, function () { return S.call('stu.groupDelete', { asgId: a.asgId }).then(function () { HBT.toast('ยกเลิกกลุ่มแล้ว', 'good'); return loadTask(); }); })
        .catch(function (e) { HBT.toast(errText(e), 'bad'); });
    });
  }
  function me() { return st.T.me; }
  function errText(e) {
    if (e.code === 'E_ASG_HAS_SUB') return 'กลุ่มนี้มีงานที่ส่งแล้ว — ลบไฟล์/ข้อความทั้งหมดก่อนจึงจะยกเลิกกลุ่มได้';
    return HBT.errMsg(e);
  }
  function saveGroup(btn, box) {
    var a = st.T.asg, members = $$checked(box), err = $('#gerr', box);
    err.textContent = '';
    if (members.length + 1 > a.maxGroup) { err.textContent = 'กลุ่มมีสมาชิกได้ไม่เกิน ' + a.maxGroup + ' คน (รวมตัวแทน)'; return; }
    HBT.busy(btn, function () {
      return S.call('stu.groupSave', { asgId: a.asgId, name: $('#gname', box).value, members: members }).then(function () {
        st.editGroup = false; HBT.toast('บันทึกกลุ่มแล้ว', 'good'); return loadTask();
      });
    }).catch(function (e) {
      if (e.code === 'E_AUTH') return loginScreen('หมดเวลาเข้าใช้งาน — ใส่ PIN อีกครั้ง');
      err.textContent = HBT.errMsg(e);
      if (e.code === 'E_ASG_GROUP') { HBT.toast(HBT.errMsg(e), 'bad'); loadTask(); }      // มีคนอื่นเลือกเพื่อนคนนั้นไปก่อน → รีเฟรชรายชื่อที่ว่าง
    });
  }

  /* ---------- การส่ง: ไฟล์ · ข้อความ · ลิงก์ ---------- */
  function renderSub() {
    var t = st.T, a = t.asg, box = $('#subCard'), lim = t.limits, files = t.sub ? t.sub.files : [];
    var h = '<div class="row sp"><h3>งานที่ส่ง</h3><span class="small muted" id="cnt">ไฟล์ ' + files.length + ' / ' + lim.maxCount + '</span></div>';
    h += '<div class="stack-s" id="files">' + (files.length ? files.map(function (f) {
      var ext = (f.name.split('.').pop() || '').toLowerCase();
      return '<div class="filechip" data-fid="' + esc(f.fileId) + '"><span class="ext ' + (ext === 'xlsx' ? 'x' : ext === 'pptx' ? 'p' : /jpe?g|png/.test(ext) ? 'i' : '') + '">' + esc(ext.toUpperCase()) + '</span><span class="nm" title="' + esc(f.name) + '">' + esc(f.name) + '</span><span class="small muted">' + esc(S.fmtSize(f.size)) + '</span>' +
        (t.canEdit ? '<button class="btn sm ghost" type="button" data-rm="' + esc(f.fileId) + '"' + (st.uploading ? ' disabled' : '') + ' aria-label="ลบไฟล์ ' + esc(f.name) + '">ลบ</button>' : '') + '</div>';
    }).join('') : '<p class="small muted" id="noFiles">ยังไม่มีไฟล์</p>') + '</div>';
    if (!t.canEdit) {
      h += '<div class="callout ' + (t.whyNot === 'E_ASG_GRADED' ? '' : 'warn') + '" id="whyNot">' + esc(WHY[t.whyNot] || 'แก้ไขไม่ได้ในขณะนี้') + '</div>';
      if (t.sub && (t.sub.note || t.sub.link)) {
        h += '<div class="stack-s">' + (t.sub.note ? '<div><span class="small muted">ข้อความ</span><div style="white-space:pre-wrap">' + esc(t.sub.note) + '</div></div>' : '') +
          (safeUrl(t.sub.link) ? '<div><span class="small muted">ลิงก์</span><br><a href="' + esc(safeUrl(t.sub.link)) + '" target="_blank" rel="noopener noreferrer">' + esc(t.sub.link) + '</a></div>' : '') + '</div>';
      }
      box.innerHTML = h; return;
    }
    var full = files.length >= lim.maxCount;
    h += '<div class="drop stack-s"><label class="btn primary block" for="pick" style="cursor:pointer;min-height:48px' + (st.uploading || full ? ';opacity:.5' : '') + '">เลือกไฟล์ / ถ่ายรูป</label>' +
      '<input class="sr" id="pick" type="file" multiple accept="' + esc(lim.types.map(function (x) { return '.' + x; }).concat(lim.types.indexOf('jpg') >= 0 ? ['.jpeg'] : []).join(',')) + '"' + (st.uploading || full ? ' disabled' : '') + '>' +
      '<span class="small">รับ ' + esc(lim.types.join(', ')) + ' · ไม่เกิน ' + esc(lim.maxMb) + ' MB ต่อไฟล์ · สูงสุด ' + esc(lim.maxCount) + ' ไฟล์<br>รูปที่ใหญ่เกินระบบจะย่อให้อัตโนมัติ · ไฟล์ใหญ่กว่านี้ให้แปะลิงก์ด้านล่าง</span>' +
      (full ? '<span class="small err">ไฟล์ครบจำนวนแล้ว — ลบไฟล์เดิมก่อนจึงจะเพิ่มได้</span>' : '') + '</div>';
    h += '<ul class="stack-s" id="log" style="list-style:none;margin:0;padding:0" aria-live="polite">' + st.log.map(function (l) {
      return '<li class="small ' + (l.s === 'bad' ? 'err' : l.s === 'ok' ? '' : 'muted') + '">' + (l.s === 'ok' ? '✓ ' : l.s === 'bad' ? '✗ ' : l.s === 'run' ? '… ' : '· ') + esc(l.name) + (l.msg ? ' — ' + esc(l.msg) : '') + '</li>';
    }).join('') + '</ul>';
    h += '<div class="field"><label for="note">ข้อความถึงอาจารย์ (ไม่บังคับ)</label><textarea id="note" maxlength="2000" rows="3"' + (st.uploading ? ' disabled' : '') + '></textarea></div>' +
      '<div class="field"><label for="link">ลิงก์งาน เช่น Google Drive (ไม่บังคับ)</label><input id="link" type="url" inputmode="url" maxlength="500" autocomplete="off" placeholder="https://" ' + (st.uploading ? 'disabled' : '') + '></div>' +
      '<div class="err" id="nerr" role="alert"></div><button class="btn block" id="nsave" type="button"' + (st.uploading ? ' disabled' : '') + '>บันทึกข้อความ / ลิงก์</button>' +
      '<p class="small muted">ไฟล์ที่อัปโหลดถือว่า <b>ส่งแล้วทันที</b> · ข้อความ/ลิงก์ต้องกดบันทึก</p>';
    box.innerHTML = h;
    $('#note').value = st.draft.note; $('#link').value = st.draft.link;
    $('#note').addEventListener('input', function () { st.draft.note = this.value; });
    $('#link').addEventListener('input', function () { st.draft.link = this.value; });
    $('#pick').addEventListener('change', function () { var fs = Array.prototype.slice.call(this.files || []); this.value = ''; if (fs.length) addFiles(fs); });
    $('#nsave').addEventListener('click', saveNote);
    HBT.$$('[data-rm]', box).forEach(function (b) {
      b.addEventListener('click', function () {
        var id = b.getAttribute('data-rm');
        if (!window.confirm('ลบไฟล์นี้?')) return;
        HBT.busy(b, function () { return S.call('stu.removeFile', { fileId: id }).then(function () { st.log = []; HBT.toast('ลบไฟล์แล้ว', 'good'); return loadTask(); }); })
          .catch(function (e) { handleErr(e); });
      });
    });
  }

  function handleErr(e) {
    if (e.code === 'E_AUTH') { loginScreen('หมดเวลาเข้าใช้งาน (2 ชั่วโมง) — ใส่ PIN อีกครั้งเพื่อทำต่อ'); return; }
    HBT.toast(HBT.errMsg(e), 'bad');
    if (/^E_ASG_(CLOSED|GRADED|NOT_REP|NO_GROUP)$/.test(e.code)) loadTask();
  }

  function saveNote() {
    var a = st.T.asg, b = $('#nsave'), err = $('#nerr');
    err.textContent = '';
    var link = st.draft.link.trim();
    if (link && !/^https?:\/\/\S{3,}$/i.test(link)) { err.textContent = 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://'; return; }
    HBT.busy(b, function () {
      return S.call('stu.saveNote', { asgId: a.asgId, note: st.draft.note, link: link }).then(function (r) {
        HBT.toast(r.saved ? 'บันทึกแล้ว' : 'ล้างข้อความแล้ว', 'good'); return loadTask();
      });
    }).catch(function (e) { if (e.code === 'E_ASG_FIELD') err.textContent = HBT.errMsg(e); else handleErr(e); });
  }

  function addFiles(list) {
    var t = st.T, lim = t.limits, a = t.asg, used = t.sub ? t.sub.files.length : 0;
    st.log = list.map(function (f) { return { name: f.name, s: 'wait', msg: '' }; });
    st.uploading = true; renderSub();
    var i = 0, okN = 0;
    function mark(k, s, msg) { st.log[k].s = s; st.log[k].msg = msg || ''; var ul = $('#log'); if (ul) renderLog(); }
    function renderLog() {
      $('#log').innerHTML = st.log.map(function (l) {
        return '<li class="small ' + (l.s === 'bad' ? 'err' : l.s === 'ok' ? '' : 'muted') + '">' + (l.s === 'ok' ? '✓ ' : l.s === 'bad' ? '✗ ' : l.s === 'run' ? '… ' : '· ') + esc(l.name) + (l.msg ? ' — ' + esc(l.msg) : '') + '</li>';
      }).join('');
    }
    function next() {
      if (i >= list.length) return finish();
      var k = i++, f = list[k], ext = (f.name.split('.').pop() || '').toLowerCase(); if (ext === 'jpeg') ext = 'jpg';
      if (lim.types.indexOf(ext) < 0) { mark(k, 'bad', 'ชนิดไฟล์ไม่รับ (รับ ' + lim.types.join(', ') + ')'); return next(); }
      if (used + okN >= lim.maxCount) { mark(k, 'bad', 'ไฟล์ครบ ' + lim.maxCount + ' ไฟล์แล้ว'); return next(); }
      mark(k, 'run', 'กำลังเตรียมไฟล์…');
      return S.shrinkImage(f, lim.maxBytes).then(function (g) {
        if (g.size > lim.maxBytes) throw Object.assign(new Error('ไฟล์ใหญ่เกิน ' + lim.maxMb + ' MB — แปะลิงก์แทน'), { code: 'LOCAL' });
        mark(k, 'run', 'กำลังอัปโหลด ' + S.fmtSize(g.size) + '…');
        return S.readB64(g).then(function (b64) { return S.call('stu.upload', { asgId: a.asgId, name: g.name, b64: b64 }); });
      }).then(function (r) { okN++; mark(k, 'ok', r.duplicate ? 'มีไฟล์นี้อยู่แล้ว' : 'อัปโหลดแล้ว'); }, function (e) {
        if (e.code === 'E_AUTH') { st.uploading = false; throw e; }
        mark(k, 'bad', e.code === 'E_ASG_FILE_BAD' ? 'ไฟล์ไม่ตรงชนิดที่ระบุหรือเสียหาย' : e.code === 'E_NETWORK' ? 'เครือข่ายขัดข้อง ลองใหม่' : HBT.errMsg(e));
        if (/^E_ASG_(CLOSED|GRADED|NOT_REP|NO_GROUP)$/.test(e.code)) { i = list.length; }
      }).then(next);
    }
    function finish() {
      st.uploading = false;
      if (okN) HBT.toast('อัปโหลดสำเร็จ ' + okN + ' ไฟล์', 'good');
      return loadTask();
    }
    next().catch(function (e) { st.uploading = false; if (e && e.code === 'E_AUTH') loginScreen('หมดเวลาเข้าใช้งาน — ใส่ PIN อีกครั้ง (ไฟล์ที่อัปโหลดสำเร็จแล้วยังอยู่)'); else loadTask(); });
  }

  /* ---------- เริ่ม ---------- */
  /** มาจากหน้า “งานของฉัน” (?a=รหัสงานภายใน) และยังล็อกอินอยู่ → เปิดงานได้เลย
   *  ไม่ต้องรู้รหัสอาจารย์ (บางเส้นทาง เช่น เข้ามาจากลิงก์ข้อสอบ เซสชันไม่มีรหัสอาจารย์ติดมา)
   *  server ตรวจให้แล้วว่างานนี้อยู่ในวิชาของเซสชันนี้จริง (ไม่ใช่ → E_NOT_FOUND แล้วถอยไปทางเดิม) */
  function openById(asgId) {
    var s = S.sess();
    app.innerHTML = head() + '<div class="loading"><span class="spin"></span> กำลังเปิดงาน…</div>';
    return S.call('stu.task', { asgId: asgId }).then(function (t) {
      st.res = { asgId: asgId, courseId: s.courseId, title: t.asg.title, kind: t.asg.kind, phase: t.asg.phase, course: s.course };
      st.T = t;
      st.draft.note = t.sub ? t.sub.note : '';
      st.draft.link = t.sub ? t.sub.link : '';
      view();
    });
  }
  function byCode(msgIfNone) {
    if (st.tid && st.code) {
      app.innerHTML = head() + '<div class="loading"><span class="spin"></span> กำลังค้นหางาน…</div>';
      return resolve().catch(function (e) {
        find(e.code === 'E_NOT_FOUND' ? 'ไม่พบงานนี้ — ลิงก์อาจผิดหรืองานถูกลบ ตรวจสอบอาจารย์และรหัสงานอีกครั้ง' : HBT.errMsg(e));
      });
    }
    find(msgIfNone || '');
    return Promise.resolve();
  }
  function start() {
    var aid = HBT.qs('a') || '';
    if (aid && S.sess()) { openById(aid).catch(function () { byCode(); }); return; }
    byCode();
  }
  start();
})();
