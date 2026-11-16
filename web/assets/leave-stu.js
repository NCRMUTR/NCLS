/* HBT Core — หน้านักศึกษา: ส่งใบลา (เลือกอาจารย์ → วิชา → ชื่อ + PIN) · อ่านคำชี้แจง · ดาวน์โหลดแบบฟอร์ม · แนบฟอร์มที่กรอกแล้ว (บังคับ) + หลักฐานเพิ่ม (ไม่บังคับ) · ติดตามสถานะ/ยกเลิก */
(function () {
  'use strict';
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var app = document.getElementById('app');
  var S = HBT.stu;
  var st = { tid: '' }, info = null;

  if (!HBT.api.configuredCore()) {
    app.innerHTML = '<div class="callout warn"><b>ยังไม่ได้ตั้งค่าเว็บ</b><br>ไฟล์ assets/config.js ยังไม่มี CORE_URL</div>';
    return;
  }
  function head(sub) {
    return '<div class="stack-s"><a class="brand" href="' + root + 's/home.html"><span class="mark">H</span>HBT Learning System</a><h1>ส่งใบลา</h1>' + (sub || '') + '</div>';
  }
  function foot() { return '<p class="small muted"><a href="' + root + 's/tasks.html">งานของฉัน</a> · <a href="' + root + 's/home.html">กลับหน้าแรก</a></p>'; }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(n) { var d = new Date(); d.setDate(d.getDate() + n); return ymd(d); }
  var TYPE_TH = { sick: 'ลาป่วย', personal: 'ลากิจ' };
  var ST_TH = { pending: ['รออาจารย์อนุมัติ', 'warn'], approved: ['อนุมัติแล้ว', 'good'], rejected: ['ไม่อนุมัติ', 'bad'], cancelled: ['ยกเลิกแล้ว', ''] };

  /* ---------- เลือกอาจารย์ → วิชา → ชื่อ + PIN (เหมือนหน้า “งานของฉัน”) ---------- */
  function pick(msg) {
    app.innerHTML = head('<p class="muted">เลือกวิชาที่จะลา แล้วใส่ PIN เพื่อส่งใบลาและดูสถานะ</p>') +
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
    S.loginBox($('#lbox'), { courseId: cid, tid: st.tid, onDone: function () { view(); } });
  }

  /* ---------- หน้าส่งใบลา ---------- */
  function fileAccept() { return info.types.map(function (x) { return '.' + x; }).concat(info.types.indexOf('jpg') >= 0 ? ['.jpeg'] : []).join(','); }
  function extOk(name) {
    var m = /\.([A-Za-z0-9]{1,5})$/.exec(name || ''), e = m ? m[1].toLowerCase() : ''; if (e === 'jpeg') e = 'jpg';
    return info.types.indexOf(e) >= 0;
  }
  /** อ่านไฟล์ที่เลือก → { name, b64 } (ย่อรูปที่ใหญ่เกินให้อัตโนมัติ) หรือโยน Error ภาษาไทย */
  function prep(file) {
    if (!extOk(file.name)) return Promise.reject(new Error('รับเฉพาะไฟล์ ' + info.types.join(', ') + ' (ไฟล์ ' + file.name + ' ไม่รองรับ)'));
    var max = info.maxMb * 1048576;
    return S.shrinkImage(file, max).then(function (g) {
      if (g.size > max) throw new Error('ไฟล์ใหญ่เกิน ' + info.maxMb + ' MB');
      return S.readB64(g).then(function (b64) { return { name: g.name, b64: b64 }; });
    });
  }
  function errText(e) { return e && e.code ? HBT.errMsg(e) : (e && e.message) || 'เกิดข้อผิดพลาด'; }

  function view(msg) {
    var s = S.sess(); if (!s) { pick(); return; }
    app.innerHTML = head() + '<div class="loading"><span class="spin"></span> กำลังโหลด…</div>';
    Promise.all([HBT.api.call('pub.leaveInfo', {}, { token: '' }), S.call('stu.leaveMine', {})]).then(function (rs) {
      info = rs[0]; render(s, rs[1].leaves, msg);
    }, function (e) {
      if (e.code === 'E_AUTH') { pick('หมดเวลาเข้าใช้งาน (2 ชั่วโมง) — เลือกวิชาและใส่ PIN อีกครั้ง'); return; }
      app.innerHTML = head() + '<div class="callout bad"><b>โหลดไม่สำเร็จ</b><br>' + esc(HBT.errMsg(e)) + '</div><div class="row"><button class="btn" id="retry" type="button">ลองใหม่</button></div>' + foot();
      $('#retry').addEventListener('click', function () { view(); });
    });
  }

  function leaveCard(l) {
    var t = ST_TH[l.status] || ['', ''], range = l.dateFrom === l.dateTo ? HBT.fmtBE(l.dateFrom) : HBT.fmtBE(l.dateFrom) + ' – ' + HBT.fmtBE(l.dateTo);
    var when = l.allDay ? 'ทั้งวัน' : 'เวลา ' + esc(l.timeFrom) + '–' + esc(l.timeTo) + ' น.';
    return '<div class="card stack-s" data-leave="' + esc(l.leaveId) + '" data-status="' + esc(l.status) + '">' +
      '<div class="row sp"><b>' + esc(TYPE_TH[l.type] || l.type) + ' · ' + esc(range) + '</b><span class="pill ' + t[1] + '">' + esc(t[0]) + '</span></div>' +
      '<p class="small muted">' + when + ' · ' + esc(l.days) + ' วัน · ส่งเมื่อ ' + esc(HBT.fmtBE(l.createdAt, true)) + '</p>' +
      (l.reason ? '<p class="small" style="white-space:pre-wrap">' + esc(l.reason) + '</p>' : '') +
      '<p class="small muted">' + (l.form ? 'ฟอร์มลา: ' + esc(l.form.name) : '') + (l.extra ? ' · หลักฐานเพิ่ม: ' + esc(l.extra.name) : '') + '</p>' +
      (l.teacherNote ? '<div class="callout small"><b>หมายเหตุจากอาจารย์:</b> ' + esc(l.teacherNote) + '</div>' : '') +
      (l.status === 'pending' ? '<div class="row"><label class="btn sm" style="cursor:pointer">' + (l.extra ? 'เปลี่ยนหลักฐานเพิ่ม' : 'แนบหลักฐานเพิ่ม') +
        '<input class="sr" type="file" data-extra accept="' + esc(fileAccept()) + '"></label><button class="btn sm danger" type="button" data-cancel>ยกเลิกใบลา</button></div>' : '') +
      '</div>';
  }

  function render(s, leaves, msg) {
    var today = ymd(new Date());
    app.innerHTML = head('<p class="muted" id="who">' + esc(s.course.code) + ' กลุ่ม ' + esc(s.course.section) + ' — ' + esc(s.course.name) + '<br><b>' + esc(s.name) + '</b> (' + esc(s.stdId) + ')</p>') +
      (msg ? '<div class="callout good" id="okMsg">' + esc(msg) + '</div>' : '') +
      '<div id="attBox"></div>' +
      (info.notice ? '<section class="callout" id="notice" style="white-space:pre-wrap"><b>คำชี้แจงการลา</b>\n' + esc(info.notice) + '</section>' : '') +
      '<section class="card stack" id="formCard"><h3>ใบลาใหม่</h3>' +
      '<div class="row sp"><span class="small muted">1) ดาวน์โหลดแบบฟอร์ม กรอกให้ครบ แล้วถ่ายรูป/สแกนเป็นไฟล์  2) แนบไฟล์ด้านล่างแล้วกดส่ง</span>' +
      (info.hasForm ? '<button class="btn sm" type="button" id="dlForm">ดาวน์โหลดแบบฟอร์มการลา</button>' : '<span class="pill warn" id="noForm">ยังไม่มีแบบฟอร์มในระบบ</span>') + '</div>' +
      '<div class="field"><span class="lbl">ชนิดการลา</span><div class="row">' +
      '<label class="pill acc" style="cursor:pointer"><input type="radio" name="lvType" value="sick" checked style="accent-color:var(--accent)"> ลาป่วย</label>' +
      '<label class="pill acc" style="cursor:pointer"><input type="radio" name="lvType" value="personal" style="accent-color:var(--accent)"> ลากิจ</label></div></div>' +
      '<div class="grid g2"><div class="field"><label for="lvFrom">ลาตั้งแต่วันที่</label><input id="lvFrom" type="date" value="' + today + '" min="' + addDays(-info.pastDays) + '" max="' + addDays(info.futureDays) + '"></div>' +
      '<div class="field"><label for="lvTo">ถึงวันที่</label><input id="lvTo" type="date" value="' + today + '" min="' + addDays(-info.pastDays) + '" max="' + addDays(info.futureDays) + '"></div></div>' +
      '<p class="small muted" id="lvRange"></p>' +
      '<div class="field"><span class="lbl">เวลาเรียนที่ลา</span><div class="row">' +
      '<label class="pill acc" style="cursor:pointer"><input type="radio" name="lvAll" value="1" checked style="accent-color:var(--accent)"> ทั้งวัน</label>' +
      '<label class="pill acc" style="cursor:pointer"><input type="radio" name="lvAll" value="0" style="accent-color:var(--accent)"> ระบุช่วงเวลา</label></div></div>' +
      '<div class="grid g2" id="lvTimes" hidden><div class="field"><label for="lvTf">เวลาเริ่ม</label><input id="lvTf" type="time" value="08:00"></div><div class="field"><label for="lvTt">เวลาสิ้นสุด</label><input id="lvTt" type="time" value="17:00"></div></div>' +
      '<div class="field"><label for="lvForm">แนบแบบฟอร์มการลาที่กรอกแล้ว <b>(จำเป็น)</b></label><input id="lvForm" type="file" accept="' + esc(fileAccept()) + '"><span class="help">รับไฟล์ ' + esc(info.types.join(', ')) + ' · ไม่เกิน ' + esc(info.maxMb) + ' MB (รูปจากมือถือย่อให้อัตโนมัติ)</span></div>' +
      '<div class="field"><label for="lvExtra">หลักฐานเพิ่มเติม เช่น ใบรับรองแพทย์ (ไม่บังคับ)</label><input id="lvExtra" type="file" accept="' + esc(fileAccept()) + '"></div>' +
      '<div class="field"><label for="lvReason">คำชี้แจงเพิ่มเติม (ไม่บังคับ)</label><textarea id="lvReason" rows="3" maxlength="1000" placeholder="เช่น เป็นไข้ แพทย์ให้พักรักษาตัว"></textarea></div>' +
      '<div class="err" id="lvErr" role="alert"></div>' +
      '<button class="btn primary block" type="button" id="lvGo" style="min-height:50px;font-size:1.05rem">ส่งใบลา</button>' +
      '<p class="small muted">ส่งได้ย้อนหลัง ' + esc(info.pastDays) + ' วัน และล่วงหน้า ' + esc(info.futureDays) + ' วัน · ลาครั้งละไม่เกิน ' + esc(info.maxDays) + ' วัน · ใบลาจะถึงอาจารย์ผู้สอนของวิชานี้เท่านั้น</p></section>' +
      '<section class="stack" id="myLeaves"><h3>ใบลาของฉันในวิชานี้</h3>' +
      (leaves.length ? leaves.map(leaveCard).join('') : '<div class="callout" id="noLeave">ยังไม่เคยส่งใบลา</div>') + '</section>' +
      '<p class="small"><a href="#" id="bye">ออกจากระบบ</a></p>' + foot();
    $('#bye').addEventListener('click', function (e) { e.preventDefault(); S.clear(); pick(); });
    S.attCard($('#attBox')).catch(function () {});
    bind(s);
  }

  function bind(s) {
    function rangeHint() {
      var a = $('#lvFrom').value, b = $('#lvTo').value;
      $('#lvRange').textContent = a && b ? (a === b ? 'ลาวันที่ ' + HBT.fmtBE(a) : 'ลา ' + HBT.fmtBE(a) + ' – ' + HBT.fmtBE(b)) : '';
    }
    $('#lvFrom').addEventListener('change', function () { if ($('#lvTo').value < this.value) $('#lvTo').value = this.value; rangeHint(); });
    $('#lvTo').addEventListener('change', rangeHint); rangeHint();
    HBT.$$('input[name="lvAll"]').forEach(function (r) { r.addEventListener('change', function () { $('#lvTimes').hidden = document.querySelector('input[name="lvAll"]:checked').value === '1'; }); });
    var dl = $('#dlForm');
    if (dl) dl.addEventListener('click', function () {
      HBT.busy(this, function () { return HBT.api.call('pub.leaveForm', {}, { token: '' }).then(HBT.saveB64); }).catch(function (e) { HBT.toast(errText(e), 'bad'); });
    });

    $('#lvGo').addEventListener('click', function () {
      var err = $('#lvErr'); err.textContent = '';
      var type = document.querySelector('input[name="lvType"]:checked').value, all = document.querySelector('input[name="lvAll"]:checked').value === '1';
      var from = $('#lvFrom').value, to = $('#lvTo').value || from, f1 = $('#lvForm').files[0], f2 = $('#lvExtra').files[0];
      if (!from) { err.textContent = 'กรุณาเลือกวันที่ลา'; return; }
      if (to < from) { err.textContent = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม'; return; }
      if (!all && (!$('#lvTf').value || !$('#lvTt').value || $('#lvTt').value <= $('#lvTf').value)) { err.textContent = 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม'; return; }
      if (!f1) { err.textContent = 'กรุณาแนบแบบฟอร์มการลาที่กรอกแล้ว'; return; }
      var warnExtra = '';
      HBT.busy(this, function () {
        return prep(f1).then(function (a) {
          return (f2 ? prep(f2) : Promise.resolve(null)).then(function (b) {
            return S.call('stu.leaveSubmit', { type: type, dateFrom: from, dateTo: to, allDay: all, timeFrom: all ? '' : $('#lvTf').value, timeTo: all ? '' : $('#lvTt').value, reason: $('#lvReason').value, name: a.name, b64: a.b64 })
              .then(function (r) {
                if (!b || r.duplicate) return r;
                return S.call('stu.leaveAttach', { leaveId: r.leaveId, name: b.name, b64: b.b64 }).then(function () { return r; }, function (e2) { warnExtra = ' แต่แนบหลักฐานเพิ่มไม่สำเร็จ (' + errText(e2) + ') — แนบใหม่จากรายการด้านล่างได้'; return r; });
              });
          });
        });
      }).then(function (r) {
        view((r.duplicate ? 'ใบลานี้ส่งไปแล้ว (ไม่ส่งซ้ำ)' : 'ส่งใบลาแล้ว รออาจารย์อนุมัติ') + warnExtra);
      }).catch(function (e) {
        if (e && e.code === 'E_AUTH') { pick('หมดเวลาเข้าใช้งาน (2 ชั่วโมง) — เลือกวิชาและใส่ PIN อีกครั้ง'); return; }
        err.textContent = errText(e);
      });
    });

    $('#myLeaves').addEventListener('click', function (e) {
      var b = e.target.closest('[data-cancel]'); if (!b) return;
      var id = b.closest('[data-leave]').getAttribute('data-leave');
      if (!window.confirm('ยกเลิกใบลานี้? (ไฟล์ที่แนบจะถูกลบออกจากระบบ)')) return;
      HBT.busy(b, function () { return S.call('stu.leaveCancel', { leaveId: id }).then(function () { view('ยกเลิกใบลาแล้ว'); }); })
        .catch(function (er) { HBT.toast(errText(er), 'bad'); });
    });
    $('#myLeaves').addEventListener('change', function (e) {
      var inp = e.target.closest('[data-extra]'); if (!inp || !inp.files[0]) return;
      var id = inp.closest('[data-leave]').getAttribute('data-leave'), f = inp.files[0];
      HBT.toast('กำลังอัปโหลดหลักฐาน…');             // (ไม่ใช้ HBT.busy กับ label: มันเขียนทับข้อความและลบช่องเลือกไฟล์)
      prep(f).then(function (a) { return S.call('stu.leaveAttach', { leaveId: id, name: a.name, b64: a.b64 }); }).then(function () { view('แนบหลักฐานเพิ่มแล้ว'); })
        .catch(function (er) { HBT.toast(errText(er), 'bad'); inp.value = ''; });
    });
  }

  if (S.sess()) view(); else pick();
})();
