/* HBT Core — สอบออนไลน์ (อาจารย์): รอบสอบ/ฝึกทำ ของรายวิชา + แบบทดสอบ (คลังข้อสอบ) · คัดลอกข้อความแจ้งนักศึกษา
 * ข้อมูลอยู่ที่ Exam API (EXAM_URL) · สิทธิ์/วิชา/รายชื่อนักศึกษามาจาก Core */
HBT.page({ active: 'exam', need: 'exam', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['สอบออนไลน์']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var id = HBT.qs('id');
  var X = { api: 'exam' };
  var quizzes = [], rounds = [], course = null, tab = HBT.qs('tab') === 'quizzes' ? 'quizzes' : 'rounds', editQuiz = null;

  if (!id) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบรายวิชา</b><br>เลือกรายวิชาก่อนจึงจะจัดสอบได้</div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>');
    return;
  }
  if (!HBT.api.configuredExam()) {
    ctx.content.insertAdjacentHTML('beforeend', '<div class="callout warn" id="noExam"><b>ยังไม่ได้ตั้งค่าระบบสอบออนไลน์</b><br>ไฟล์ assets/config.js ยังไม่มี EXAM_URL — ดูขั้นตอนติดตั้ง Exam API ใน README</div>');
    return;
  }
  var q = encodeURIComponent(id);

  ctx.content.insertAdjacentHTML('beforeend', '<div id="box" class="stack"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +
    /* สร้าง/แก้ แบบทดสอบ */
    '<div class="modal" id="mQuiz" hidden role="dialog" aria-modal="true" aria-labelledby="zTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="zTitle">สร้างแบบทดสอบ</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="field"><label for="zName">ชื่อแบบทดสอบ</label><input id="zName" type="text" maxlength="200" autocomplete="off" placeholder="เช่น บทที่ 1 เซลล์"></div>' +
    '<div class="field"><label for="zNote">หมายเหตุ (ไม่บังคับ)</label><input id="zNote" type="text" maxlength="500" autocomplete="off"></div>' +
    '<div class="err" id="zErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="zSave">บันทึก</button></div></div></div>' +
    /* สร้างรอบ */
    '<div class="modal" id="mRound" hidden role="dialog" aria-modal="true" aria-labelledby="rTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="rTitle">สร้างรอบสอบ / ฝึกทำ</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="choice-row" role="radiogroup" aria-label="ประเภทรอบ"><label class="choice"><input type="radio" name="rMode" value="TEST" checked><span><b>สอบ</b><br><span class="small muted">ไม่เฉลย · ทำได้ตามจำนวนครั้ง</span></span></label>' +
    '<label class="choice"><input type="radio" name="rMode" value="PRACTISE"><span><b>ฝึกทำ</b><br><span class="small muted">เฉลย + คำอธิบายทุกข้อ</span></span></label></div>' +
    '<div class="field"><label for="rQuiz">แบบทดสอบ</label><select id="rQuiz"></select></div>' +
    '<div class="field"><label for="rName">ชื่อรอบ</label><input id="rName" type="text" maxlength="200" autocomplete="off" placeholder="เช่น สอบกลางภาค"></div>' +
    '<div class="grid g2"><div class="field"><label for="rStart">เปิดให้เข้า</label><input id="rStart" type="datetime-local"></div><div class="field"><label for="rEnd">ปิดรับ</label><input id="rEnd" type="datetime-local"></div></div>' +
    '<label class="check" id="rBackW"><input type="checkbox" id="rBack"><span>ให้ย้อนกลับไปแก้ข้อก่อนหน้าได้ (จะไม่จับเวลาต่อข้อ)</span></label>' +
    '<div class="grid g2"><div class="field"><label for="rTotal">เวลาทำทั้งฉบับ (นาที — 0 = ไม่จำกัด)</label><input id="rTotal" type="number" inputmode="numeric" min="0" max="1440" step="1" value="60"></div>' +
    '<div class="field" id="rSecW"><label for="rSec">เวลาต่อข้อ (วินาที — 0 = ไม่จำกัด)</label><input id="rSec" type="number" inputmode="numeric" min="0" max="3600" step="1" value="0"></div></div>' +
    '<div class="grid g2"><div class="field"><label for="rMax">ทำได้กี่ครั้ง (0 = ไม่จำกัด)</label><input id="rMax" type="number" inputmode="numeric" min="0" max="50" step="1" value="1"></div>' +
    '<div class="field"><label for="rViol">ออกนอกหน้าจอได้กี่ครั้ง (0 = ไม่ตัดสิทธิ์)</label><input id="rViol" type="number" inputmode="numeric" min="0" max="50" step="1" value="0"></div></div>' +
    '<label class="check"><input type="checkbox" id="rShufQ"><span>สลับลำดับข้อ</span></label>' +
    '<label class="check"><input type="checkbox" id="rShufC" checked><span>สลับลำดับตัวเลือก</span></label>' +
    '<label class="check"><input type="checkbox" id="rLock"><span>บันทึกเมื่อนักศึกษาออกจากหน้าจอ</span></label>' +
    '<label class="check"><input type="checkbox" id="rTts"><span>มีปุ่มอ่านออกเสียง</span></label>' +
    '<label class="check"><input type="checkbox" id="rResume" checked><span>ให้ทำต่อจากเดิมได้ถ้าหลุด</span></label>' +
    '<fieldset class="card flat stack-s" style="border:1px solid var(--line)"><legend class="small muted">คะแนนเก็บเข้ารายวิชา</legend>' +
    '<div class="field"><label for="rSm">วิธีนับ</label><select id="rSm"><option value="NONE">ไม่บันทึกเข้ารายวิชา</option><option value="SCORE">ตามสัดส่วนคะแนนที่ทำได้</option><option value="COMPLETE" id="optComplete">ทำครบทุกข้อได้เต็ม (เฉพาะฝึกทำ)</option></select></div>' +
    '<div class="field" id="rSvW" hidden><label for="rSv">คะแนนเต็มของรอบนี้ในรายวิชา</label><input id="rSv" type="number" inputmode="decimal" min="0.01" max="1000" step="any" value="10"></div>' +
    '<p class="help">ซิงก์เข้าตารางคะแนนของวิชาเมื่อปิดรอบ (นับครั้งที่ดีที่สุด) · น้ำหนัก % ตั้งเองที่หน้าคะแนน</p></fieldset>' +
    '<div class="err" id="rErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="rSave">สร้างรอบ</button></div></div></div>' +
    /* ข้อความแจ้งนักศึกษา */
    '<div class="modal" id="mMsg" hidden role="dialog" aria-modal="true" aria-labelledby="mgTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="mgTitle">ข้อความแจ้งนักศึกษา</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<p class="small muted">คัดลอกไปวางในกลุ่มไลน์/ห้องเรียนออนไลน์ นักศึกษากดลิงก์แล้วเลือกชื่อ + ใส่ PIN ได้เลย</p>' +
    '<textarea id="msgTxt" rows="7" readonly></textarea><div class="row"><button class="btn primary" type="button" id="msgCopy">คัดลอก</button><a class="btn" id="msgOpen" target="_blank" rel="noopener" href="#">ลองเปิดลิงก์</a></div></div></div>');

  function fmt(t) { return t ? HBT.fmtBE(t, true) : ''; }
  function toInput(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function fromInput(v) { return v ? String(v).replace('T', ' ') : ''; }
  function studentUrl(token) { return new URL(root + 's/exam.html', location.href).toString() + '?t=' + encodeURIComponent(token); }
  function effPill(e) { return e === 'CLOSED' ? '<span class="pill bad">ปิดแล้ว</span>' : e === 'SCHEDULED' ? '<span class="pill warn">รอเวลา</span>' : '<span class="pill good">เปิดอยู่</span>'; }
  function syncPill(r) {
    var s = r.sync || {};
    if (r.scoreMode === 'NONE') return '<span class="pill">ไม่บันทึกคะแนน</span>';
    if (s.state === 'OK') return '<span class="pill good" title="' + esc(s.note) + '">ซิงก์คะแนนแล้ว</span>';
    if (s.state === 'ERR') return '<span class="pill bad" title="' + esc(s.note) + '">ซิงก์ไม่สำเร็จ</span>';
    return '<span class="pill info">จะซิงก์เมื่อปิดรอบ</span>';
  }
  function scoreTxt(r) { return r.scoreMode === 'NONE' ? '' : (r.scoreMode === 'COMPLETE' ? ' · ทำครบได้ ' : ' · เต็ม ') + r.scoreValue + ' คะแนน'; }

  function render() {
    var c = course;
    document.title = 'สอบออนไลน์ ' + c.code + ' — HBT Teaching';
    var h = '<div class="page-h"><div class="stack-s"><h1>สอบออนไลน์ <span class="muted">' + esc(c.code) + ' กลุ่ม ' + esc(c.section) + '</span></h1><p>' + esc(c.name) + '</p></div>' +
      '<div class="row">' + (tab === 'rounds' ? '<button class="btn primary" type="button" id="newRound">สร้างรอบสอบ / ฝึกทำ</button>' : '<button class="btn primary" type="button" id="newQuiz">สร้างแบบทดสอบ</button>') + '</div></div>';
    if (!c.current) h += '<div class="callout warn" id="notCur"><b>วิชานี้ไม่ใช่ของภาคเรียนปัจจุบัน</b> — นักศึกษาจะเข้าสอบไม่ได้</div>';
    h += '<div class="tabs" role="tablist"><button type="button" role="tab" id="tab-rounds" data-tab="rounds" aria-selected="' + (tab === 'rounds') + '">รอบสอบ / ฝึกทำ (' + rounds.length + ')</button>' +
      '<button type="button" role="tab" id="tab-quizzes" data-tab="quizzes" aria-selected="' + (tab === 'quizzes') + '">แบบทดสอบ (' + quizzes.length + ')</button></div>';
    h += tab === 'rounds' ? roundsHtml() : quizzesHtml();
    $('#box').innerHTML = h;
    HBT.$$('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { tab = b.getAttribute('data-tab'); render(); }); });
    var nr = $('#newRound'); if (nr) nr.addEventListener('click', openRound);
    var nq = $('#newQuiz'); if (nq) nq.addEventListener('click', function () { openQuiz(null); });
    HBT.$$('[data-msg]').forEach(function (b) { b.addEventListener('click', function () { openMsg(b.getAttribute('data-msg')); }); });
    HBT.$$('[data-st]').forEach(function (b) { b.addEventListener('click', function () { setStatus(b); }); });
    HBT.$$('[data-sync]').forEach(function (b) { b.addEventListener('click', function () { resync(b); }); });
    HBT.$$('[data-zedit]').forEach(function (b) { b.addEventListener('click', function () { openQuiz(b.getAttribute('data-zedit')); }); });
    HBT.$$('[data-zdel]').forEach(function (b) { b.addEventListener('click', function () { delQuiz(b); }); });
    var go = $('#goQuizzes'); if (go) go.addEventListener('click', function () { tab = 'quizzes'; render(); });
  }

  function roundsHtml() {
    if (!quizzes.length) return '<div class="card stack-s" id="emptyQ"><h3>เริ่มจากสร้างแบบทดสอบ</h3><p class="small muted">แบบทดสอบคือชุดข้อสอบ (ใช้ซ้ำได้หลายรอบ) — สร้างและใส่ข้อสอบก่อน แล้วค่อยสร้างรอบ</p><div><button class="btn primary" type="button" id="goQuizzes">ไปที่แบบทดสอบ</button></div></div>';
    if (!rounds.length) return '<div class="card stack-s" id="empty"><h3>ยังไม่มีรอบ</h3><p class="small muted">กด “สร้างรอบสอบ / ฝึกทำ” เพื่อกำหนดเวลาและเงื่อนไข ระบบจะออกลิงก์ให้นักศึกษา</p></div>';
    return '<div class="stack" id="list">' + rounds.map(function (r) {
      return '<div class="card stack-s" data-round="' + esc(r.sessionId) + '"><div class="row sp"><h3>' + esc(r.title) + '</h3><div class="row"><span class="pill ' + (r.mode === 'TEST' ? 'acc' : 'info') + '">' + (r.mode === 'TEST' ? 'สอบ' : 'ฝึกทำ') + '</span>' + effPill(r.effective) + '</div></div>' +
        '<p class="small muted">' + esc(r.quizTitle) + ' · ' + esc(fmt(r.startAt)) + ' – ' + esc(fmt(r.endAt)) + (r.totalMinutes ? ' · ' + r.totalMinutes + ' นาที' : '') + esc(scoreTxt(r)) + '</p>' +
        '<div class="row small"><span class="pill ' + (r.submitted ? 'good' : '') + '">ทำแล้ว ' + r.submitted + ' / ' + r.attempts + ' ฉบับ</span>' + syncPill(r) + '</div>' +
        '<div class="row"><a class="btn primary sm" href="' + root + 't/exam-round.html?r=' + encodeURIComponent(r.sessionId) + '&id=' + q + '">ติดตาม / ผลสอบ</a>' +
        '<button class="btn sm" type="button" data-msg="' + esc(r.sessionId) + '">แจ้งนักศึกษา</button>' +
        (r.effective === 'CLOSED' ? '' : (r.effective === 'SCHEDULED' ? '<button class="btn sm" type="button" data-st="OPEN" data-sid="' + esc(r.sessionId) + '">เปิดทันที</button>' : '<button class="btn sm" type="button" data-st="CLOSE" data-sid="' + esc(r.sessionId) + '">ปิดรอบ</button>')) +
        (r.scoreMode !== 'NONE' && r.sync.state === 'ERR' ? '<button class="btn sm" type="button" data-sync="' + esc(r.sessionId) + '">ส่งคะแนนใหม่</button>' : '') + '</div></div>';
    }).join('') + '</div>';
  }

  function quizzesHtml() {
    if (!quizzes.length) return '<div class="card stack-s" id="emptyZ"><h3>ยังไม่มีแบบทดสอบ</h3><p class="small muted">กด “สร้างแบบทดสอบ” แล้วเพิ่มข้อสอบทีละข้อ หรือนำเข้าจากไฟล์ CSV</p></div>';
    return '<div class="stack" id="zlist">' + quizzes.map(function (z) {
      return '<div class="card stack-s" data-quiz="' + esc(z.quizId) + '"><div class="row sp"><h3>' + esc(z.title) + '</h3><span class="pill ' + (z.questionCount ? 'good' : 'warn') + '">' + z.questionCount + ' ข้อ</span></div>' +
        (z.note ? '<p class="small muted">' + esc(z.note) + '</p>' : '') +
        '<p class="small muted">ใช้ในรอบ ' + z.rounds + ' รอบ</p>' +
        '<div class="row"><a class="btn primary sm" href="' + root + 't/exam-questions.html?z=' + encodeURIComponent(z.quizId) + '&id=' + q + '">จัดการข้อสอบ</a>' +
        '<button class="btn sm ghost" type="button" data-zedit="' + esc(z.quizId) + '">เปลี่ยนชื่อ</button><button class="btn sm ghost" type="button" data-zdel="' + esc(z.quizId) + '">ลบ</button></div></div>';
    }).join('') + '</div>';
  }

  /* ---------- แบบทดสอบ ---------- */
  function openQuiz(zid) {
    editQuiz = zid ? quizzes.filter(function (z) { return z.quizId === zid; })[0] : null;
    $('#zTitle').textContent = editQuiz ? 'เปลี่ยนชื่อแบบทดสอบ' : 'สร้างแบบทดสอบ';
    $('#zName').value = editQuiz ? editQuiz.title : ''; $('#zNote').value = editQuiz ? editQuiz.note : ''; $('#zErr').textContent = '';
    HBT.modal.open('mQuiz');
  }
  $('#zSave').addEventListener('click', function () {
    var b = this, p = { courseId: id, title: $('#zName').value, note: $('#zNote').value };
    $('#zErr').textContent = '';
    if (!p.title.trim()) { $('#zErr').textContent = 'กรุณากรอกชื่อแบบทดสอบ'; return; }
    if (editQuiz) p.quizId = editQuiz.quizId;
    HBT.busy(b, function () {
      return HBT.api.call('exam.quiz.save', p, { api: 'exam', write: true }).then(function (r) {
        HBT.modal.close('mQuiz');
        if (!editQuiz) { location.href = root + 't/exam-questions.html?z=' + encodeURIComponent(r.quizId) + '&id=' + q; return; }
        HBT.toast('บันทึกแล้ว', 'good'); return load();
      });
    }).catch(function (e) { $('#zErr').textContent = HBT.errMsg(e); });
  });
  function delQuiz(btn) {
    var z = quizzes.filter(function (x) { return x.quizId === btn.getAttribute('data-zdel'); })[0];
    if (!z) return;
    if (z.rounds) { HBT.toast('ลบไม่ได้ — มี ' + z.rounds + ' รอบใช้แบบทดสอบนี้อยู่ (ลบรอบก่อน)', 'bad'); return; }
    if (!window.confirm('ลบแบบทดสอบ “' + z.title + '” พร้อมข้อสอบทั้ง ' + z.questionCount + ' ข้อ? ลบแล้วกู้คืนไม่ได้')) return;
    HBT.busy(btn, function () {
      return HBT.api.call('exam.quiz.delete', { quizId: z.quizId }, { api: 'exam', write: true }).then(function () { HBT.toast('ลบแล้ว', 'good'); return load(); });
    }).catch(function (e) { HBT.toast(HBT.errMsg(e), 'bad'); });
  }

  /* ---------- รอบ ---------- */
  function modeOf() { return (HBT.$('input[name=rMode]:checked') || {}).value || 'TEST'; }
  function syncForm() {
    var t = modeOf() === 'TEST';
    $('#rBackW').hidden = !t;
    $('#optComplete').disabled = t; $('#optComplete').hidden = t;
    if (t && $('#rSm').value === 'COMPLETE') $('#rSm').value = 'SCORE';
    var back = t && $('#rBack').checked;
    $('#rSecW').hidden = back;
    $('#rSvW').hidden = $('#rSm').value === 'NONE';
    if (t && $('#rMax').value === '0') $('#rMax').value = '1';
  }
  HBT.$$('input[name=rMode]').forEach(function (r) { r.addEventListener('change', syncForm); });
  $('#rBack').addEventListener('change', syncForm); $('#rSm').addEventListener('change', syncForm);

  function openRound() {
    if (!quizzes.length) { tab = 'quizzes'; render(); return; }
    var ok = quizzes.filter(function (z) { return z.questionCount > 0; });
    $('#rQuiz').innerHTML = quizzes.map(function (z) { return HBT.stu.opt(z.quizId, z.title + ' (' + z.questionCount + ' ข้อ)'); }).join('');
    if (ok.length) $('#rQuiz').value = ok[0].quizId;
    var now = new Date(), end = new Date(now.getTime() + 2 * 3600 * 1000);
    now.setSeconds(0, 0); end.setSeconds(0, 0);
    $('#rStart').value = toInput(now); $('#rEnd').value = toInput(end); $('#rName').value = '';
    HBT.$$('input[name=rMode]').forEach(function (r) { r.checked = r.value === 'TEST'; });
    $('#rBack').checked = false; $('#rTotal').value = 60; $('#rSec').value = 0; $('#rMax').value = 1; $('#rViol').value = 0;
    $('#rShufQ').checked = false; $('#rShufC').checked = true; $('#rLock').checked = false; $('#rTts').checked = false; $('#rResume').checked = true;
    $('#rSm').value = 'NONE'; $('#rSv').value = 10; $('#rErr').textContent = '';
    syncForm(); HBT.modal.open('mRound');
  }
  $('#rSave').addEventListener('click', function () {
    var b = this, mode = modeOf();
    var p = {
      courseId: id, quizId: $('#rQuiz').value, mode: mode, title: $('#rName').value, startAt: fromInput($('#rStart').value), endAt: fromInput($('#rEnd').value),
      allowBack: mode === 'TEST' && $('#rBack').checked, totalMinutes: $('#rTotal').value, secPerQuestion: $('#rSec').value, maxAttempts: $('#rMax').value,
      maxViolations: $('#rViol').value, shuffleQ: $('#rShufQ').checked, shuffleC: $('#rShufC').checked, lockTab: $('#rLock').checked, tts: $('#rTts').checked, resume: $('#rResume').checked,
      scoreMode: $('#rSm').value, scoreValue: $('#rSv').value
    };
    $('#rErr').textContent = '';
    if (!p.quizId) { $('#rErr').textContent = 'กรุณาเลือกแบบทดสอบ'; return; }
    HBT.busy(b, function () {
      return HBT.api.call('exam.round.create', p, { api: 'exam', write: true }).then(function (r) {
        HBT.modal.close('mRound'); HBT.toast('สร้างรอบแล้ว', 'good');
        return load().then(function () { openMsg(r.sessionId); });
      });
    }).catch(function (e) { $('#rErr').textContent = HBT.errMsg(e); });
  });

  function setStatus(btn) {
    var action = btn.getAttribute('data-st'), sid = btn.getAttribute('data-sid');
    if (action === 'CLOSE' && !window.confirm('ปิดรอบนี้ตอนนี้? ฉบับที่นักศึกษายังทำค้างอยู่จะถูกส่งตามที่ตอบไว้')) return;
    HBT.busy(btn, function () {
      return HBT.api.call('exam.round.setStatus', { sessionId: sid, action: action }, { api: 'exam', write: true }).then(function (r) {
        HBT.toast(action === 'OPEN' ? 'เปิดรอบแล้ว' : (r.sync && r.sync.state === 'ERR' ? 'ปิดรอบแล้ว แต่ส่งคะแนนเข้ารายวิชาไม่สำเร็จ' : 'ปิดรอบแล้ว'), r.sync && r.sync.state === 'ERR' ? 'bad' : 'good');
        return load();
      });
    }).catch(function (e) { HBT.toast(HBT.errMsg(e), 'bad'); });
  }
  function resync(btn) {
    HBT.busy(btn, function () {
      return HBT.api.call('exam.round.sync', { sessionId: btn.getAttribute('data-sync') }, { api: 'exam' }).then(function (r) {
        HBT.toast(r.state === 'OK' ? 'ส่งคะแนนแล้ว · ' + r.note : (r.state === 'ERR' ? 'ยังส่งไม่สำเร็จ: ' + r.note : r.note), r.state === 'ERR' ? 'bad' : 'good'); return load();
      });
    }).catch(function (e) { HBT.toast(HBT.errMsg(e), 'bad'); });
  }

  function openMsg(sid) {
    var r = rounds.filter(function (x) { return x.sessionId === sid; })[0], c = course;
    if (!r) return;
    var url = studentUrl(r.token);
    var t = (r.mode === 'TEST' ? 'สอบ: ' : 'ฝึกทำ: ') + r.title + '\nวิชา: ' + c.code + ' กลุ่ม ' + c.section + ' ' + c.name + '\nเปิดให้เข้า: ' + fmt(r.startAt) + '\nปิดรับ: ' + fmt(r.endAt) +
      (r.totalMinutes ? '\nเวลาทำ: ' + r.totalMinutes + ' นาที' : '') + '\nเข้าทำที่: ' + url + '\n(เลือกชื่อของคุณ + PIN 4 หลัก)';
    $('#msgTxt').value = t; $('#msgOpen').setAttribute('href', url); HBT.modal.open('mMsg');
  }
  $('#msgCopy').addEventListener('click', function () {
    var ta = $('#msgTxt'), done = function () { HBT.toast('คัดลอกแล้ว', 'good'); };
    ta.focus(); ta.select();
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, function () { try { document.execCommand('copy'); done(); } catch (e) { HBT.toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกดคัดลอกเอง', 'bad'); } });
    else { try { document.execCommand('copy'); done(); } catch (e) { HBT.toast('คัดลอกไม่ได้ — เลือกข้อความแล้วกดคัดลอกเอง', 'bad'); } }
  });

  function load() {
    return Promise.all([HBT.api.call('exam.quiz.list', { courseId: id }, X), HBT.api.call('exam.round.list', { courseId: id }, X)]).then(function (r) {
      course = r[0].course; quizzes = r[0].quizzes; rounds = r[1].rounds; render();
    }, function (e) {
      var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN';
      $('#box').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบรายวิชานี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
        '<div class="row" style="margin-top:10px">' + (nf ? '' : '<button class="btn" type="button" id="reload">ลองใหม่</button>') + '<a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>';
      var rb = $('#reload'); if (rb) rb.addEventListener('click', load);
    });
  }
  load();
});
