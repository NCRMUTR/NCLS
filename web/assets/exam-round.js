/* HBT Core — รอบสอบ/ฝึกทำ (อาจารย์): ติดตามสด · ผลสอบ/สถิติรายข้อ · ตั้งค่ารอบ · ซิงก์คะแนนเข้ารายวิชา */
HBT.page({ active: 'exam', need: 'exam', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['สอบออนไลน์'], ['รอบ']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var sid = HBT.qs('r'), cid = HBT.qs('id');
  var X = { api: 'exam' };
  var tab = ['live', 'results', 'settings'].indexOf(HBT.qs('tab')) >= 0 ? HBT.qs('tab') : 'live';
  var round = null, mon = null, rep = null, timer = null, loading = false;

  if (!sid) { ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบรอบ</b></div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>'); return; }
  if (!HBT.api.configuredExam()) { ctx.content.insertAdjacentHTML('beforeend', '<div class="callout warn"><b>ยังไม่ได้ตั้งค่าระบบสอบออนไลน์</b><br>ไฟล์ assets/config.js ยังไม่มี EXAM_URL</div>'); return; }
  var listUrl = root + 't/exam.html?id=' + encodeURIComponent(cid);

  ctx.content.insertAdjacentHTML('beforeend', '<div id="box" class="stack"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>');

  function fmt(t) { return t ? HBT.fmtBE(t, true) : ''; }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function toInput(v) { return v ? String(v).replace(' ', 'T').substring(0, 16) : ''; }
  function fromInput(v) { return v ? String(v).replace('T', ' ') : ''; }
  function mmss(sec) { sec = Math.max(0, Math.floor(sec)); return Math.floor(sec / 60) + ':' + p2(sec % 60); }
  function effPill(e) { return e === 'CLOSED' ? '<span class="pill bad">ปิดแล้ว</span>' : e === 'SCHEDULED' ? '<span class="pill warn">รอเวลา</span>' : '<span class="pill good">เปิดอยู่</span>'; }
  function stPill(s) { return s === 'IN_PROGRESS' ? '<span class="pill info">กำลังทำ</span>' : s === 'SUBMITTED' ? '<span class="pill good">ส่งแล้ว</span>' : '<span class="pill warn">หมดเวลา</span>'; }
  function fail(e) { HBT.toast(HBT.errMsg(e), 'bad'); }
  function studentUrl() { return new URL(root + 's/exam.html', location.href).toString() + '?t=' + encodeURIComponent(round.token); }

  function shell() {
    var r = round;
    document.title = r.title + ' — HBT Teaching';
    var syncTxt = r.scoreMode === 'NONE' ? '<span class="pill">ไม่บันทึกคะแนนเข้ารายวิชา</span>' :
      (r.sync.state === 'OK' ? '<span class="pill good">ซิงก์คะแนนแล้ว</span>' : r.sync.state === 'ERR' ? '<span class="pill bad">ซิงก์ไม่สำเร็จ</span>' : '<span class="pill info">จะซิงก์เมื่อปิดรอบ</span>');
    $('#box').innerHTML =
      '<div class="page-h"><div class="stack-s"><h1 id="rTitle">' + esc(r.title) + '</h1><div class="row"><span class="pill ' + (r.mode === 'TEST' ? 'acc' : 'info') + '">' + (r.mode === 'TEST' ? 'สอบ' : 'ฝึกทำ') + '</span><span id="effPill">' + effPill(r.effective) + '</span>' + syncTxt + '</div>' +
      '<p class="small muted">' + esc(r.quizTitle) + ' · ' + esc(fmt(r.startAt)) + ' – ' + esc(fmt(r.endAt)) + '</p></div>' +
      '<div class="row"><a class="btn" href="' + listUrl + '">‹ รอบทั้งหมด</a>' +
      (r.effective === 'CLOSED' ? '' : (r.effective === 'SCHEDULED' ? '<button class="btn" type="button" id="stBtn" data-a="OPEN">เปิดทันที</button>' : '<button class="btn" type="button" id="stBtn" data-a="CLOSE">ปิดรอบ</button>')) + '</div></div>' +
      '<div class="tabs" role="tablist"><button type="button" role="tab" id="tab-live" data-tab="live" aria-selected="' + (tab === 'live') + '">ติดตามสด</button>' +
      '<button type="button" role="tab" id="tab-results" data-tab="results" aria-selected="' + (tab === 'results') + '">ผลสอบ</button>' +
      '<button type="button" role="tab" id="tab-settings" data-tab="settings" aria-selected="' + (tab === 'settings') + '">ตั้งค่า / ลิงก์</button></div><div id="panel"></div>';
    HBT.$$('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { tab = b.getAttribute('data-tab'); shell(); panel(); }); });
    var sb = $('#stBtn'); if (sb) sb.addEventListener('click', function () { setStatus(sb); });
  }

  function setStatus(btn) {
    var a = btn.getAttribute('data-a');
    if (a === 'CLOSE' && !window.confirm('ปิดรอบนี้ตอนนี้? ฉบับที่นักศึกษายังทำค้างอยู่จะถูกส่งตามที่ตอบไว้')) return;
    HBT.busy(btn, function () {
      return HBT.api.call('exam.round.setStatus', { sessionId: sid, action: a }, { api: 'exam', write: true }).then(function (r) {
        HBT.toast(a === 'OPEN' ? 'เปิดรอบแล้ว' : (r.sync && r.sync.state === 'ERR' ? 'ปิดรอบแล้ว แต่ส่งคะแนนเข้ารายวิชาไม่สำเร็จ' : 'ปิดรอบแล้ว'), r.sync && r.sync.state === 'ERR' ? 'bad' : 'good');
        rep = null; return refresh();
      });
    }).catch(fail);
  }

  /* ---------- ติดตามสด ---------- */
  function panel() {
    clearInterval(timer);
    if (tab === 'live') { liveLoad(); timer = setInterval(function () { if (!document.hidden && tab === 'live') liveLoad(true); }, 8000); }
    else if (tab === 'results') resultsLoad();
    else settings();
  }
  function liveLoad(quiet) {
    if (loading) return;
    loading = true;
    if (!quiet && !mon) $('#panel').innerHTML = '<div class="loading"><span class="spin"></span> กำลังโหลด…</div>';
    HBT.api.call('exam.round.monitor', { sessionId: sid }, X).then(function (m) { mon = m; if (tab === 'live') liveRender(); }, function (e) { if (!quiet) fail(e); }).then(function () { loading = false; });
  }
  function liveRender() {
    var m = mon, rows = m.rows, n = m.questionCount;
    var cnt = { IN_PROGRESS: 0, SUBMITTED: 0, EXPIRED: 0 }; rows.forEach(function (r) { cnt[r.status] = (cnt[r.status] || 0) + 1; });
    var h = '<div class="grid g4" id="liveStats"><div class="card flat"><span class="small muted">เริ่มทำแล้ว</span><h2 id="lvAll">' + rows.length + '</h2></div>' +
      '<div class="card flat"><span class="small muted">กำลังทำ</span><h2 id="lvDoing">' + cnt.IN_PROGRESS + '</h2></div>' +
      '<div class="card flat"><span class="small muted">ส่งแล้ว</span><h2 id="lvDone">' + (cnt.SUBMITTED + cnt.EXPIRED) + '</h2></div>' +
      '<div class="card flat"><span class="small muted">ข้อสอบ</span><h2>' + n + ' ข้อ</h2></div></div>';
    if (!rows.length) h += '<div class="card stack-s" id="liveEmpty"><h3>ยังไม่มีใครเริ่มทำ</h3><p class="small muted">ส่งลิงก์ให้นักศึกษาที่แท็บ “ตั้งค่า / ลิงก์” — หน้านี้อัปเดตเองทุก 8 วินาที</p></div>';
    else h += '<div class="card scroll-x"><table id="liveTbl"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>สถานะ</th><th>ข้อที่ทำอยู่</th><th>ตอบแล้ว</th><th>ออกนอกจอ</th><th>เห็นล่าสุด</th></tr></thead><tbody>' +
      rows.map(function (r) {
        return '<tr data-std="' + esc(r.stdId) + '"><td class="mono">' + esc(r.stdId) + '</td><td>' + esc(r.name) + '</td><td>' + stPill(r.status) + '</td>' +
          '<td class="num">' + (r.status === 'IN_PROGRESS' ? (r.curIndex + 1) + ' / ' + n : '—') + '</td><td class="num">' + r.answered + ' / ' + n + '</td>' +
          '<td class="num' + (r.violations ? ' ex-live-hot' : '') + '">' + r.violations + '</td><td class="small muted">' + esc(HBT.fmtBE(r.lastSeenAt, true)) + '</td></tr>';
      }).join('') + '</tbody></table></div>';
    $('#panel').innerHTML = h;
    var eff = $('#effPill'); if (eff && m.effective !== round.effective) { round.effective = m.effective; eff.innerHTML = effPill(m.effective); }
  }

  /* ---------- ผลสอบ ---------- */
  function resultsLoad() {
    if (rep) { resultsRender(); return; }
    $('#panel').innerHTML = '<div class="loading"><span class="spin"></span> กำลังโหลด…</div>';
    HBT.api.call('exam.round.report', { sessionId: sid }, X).then(function (r) { rep = r; if (tab === 'results') resultsRender(); }, function (e) { $('#panel').innerHTML = '<div class="callout bad">' + esc(HBT.errMsg(e)) + '</div>'; });
  }
  function resultsRender() {
    var r = rep, s = r.stats, max = Math.max.apply(null, s.hist.concat([1]));
    var h = '<div class="grid g4" id="repStats"><div class="card flat"><span class="small muted">ฉบับทั้งหมด</span><h2>' + s.attempts + '</h2></div><div class="card flat"><span class="small muted">ส่งแล้ว</span><h2>' + s.submitted + '</h2></div>' +
      '<div class="card flat"><span class="small muted">เฉลี่ย</span><h2 id="repAvg">' + s.avgPct + '%</h2></div><div class="card flat"><span class="small muted">มัธยฐาน</span><h2>' + s.medianPct + '%</h2></div>' +
      '<div class="card flat"><span class="small muted">ต่ำสุด</span><h2>' + s.minPct + '%</h2></div><div class="card flat"><span class="small muted">สูงสุด</span><h2>' + s.maxPct + '%</h2></div></div>';
    h += '<div class="card stack-s"><h3>การกระจายคะแนน (ร้อยละ)</h3><div class="ex-hist" aria-hidden="true">' + s.hist.map(function (n) {
      return '<div style="height:' + Math.max(2, Math.round(n / max * 100)) + '%"><span>' + (n || '') + '</span></div>';
    }).join('') + '</div><div class="ex-histx">' + s.hist.map(function (n, i) { return '<span>' + (i * 10) + '</span>'; }).join('') + '</div></div>';
    if (round.scoreMode !== 'NONE') {
      var sy = round.sync || {};
      h += '<div class="card stack-s" id="syncCard"><div class="row sp"><h3>คะแนนเก็บเข้ารายวิชา</h3>' +
        (sy.state === 'OK' ? '<span class="pill good">ซิงก์แล้ว</span>' : sy.state === 'ERR' ? '<span class="pill bad">ซิงก์ไม่สำเร็จ</span>' : '<span class="pill info">ยังไม่ซิงก์</span>') + '</div>' +
        '<p class="small muted">' + (round.scoreMode === 'COMPLETE' ? 'ทำครบทุกข้อได้เต็ม ' : 'ตามสัดส่วน เต็ม ') + esc(round.scoreValue) + ' คะแนน · นับครั้งที่ดีที่สุดของแต่ละคน · ' + esc(sy.note || '') + (sy.at ? ' (' + esc(HBT.fmtBE(sy.at, true)) + ')' : '') + '</p>' +
        '<div class="row"><button class="btn sm" type="button" id="syncBtn">ส่งคะแนนเข้ารายวิชาอีกครั้ง</button><a class="btn sm ghost" href="' + root + 't/scores.html?id=' + encodeURIComponent(cid) + '">ไปหน้าคะแนน</a></div></div>';
    }
    h += '<div class="card stack-s"><div class="row sp"><h3>รายข้อ</h3><span class="small muted">% ที่ตอบถูก — ข้อที่ต่ำควรทบทวน</span></div><div class="scroll-x"><table id="perQ"><thead><tr><th>ข้อ</th><th>คำถาม</th><th>ตอบ</th><th>ถูก</th><th>ร้อยละ</th></tr></thead><tbody>' +
      r.perQuestion.map(function (q) {
        return '<tr><td class="num">' + q.qNo + '</td><td>' + esc(q.text) + '</td><td class="num">' + q.answered + '</td><td class="num">' + q.correct + '</td><td style="min-width:110px">' +
          (q.pct === null ? '—' : '<div class="row" style="flex-wrap:nowrap"><div class="ex-bar grow"><i style="width:' + q.pct + '%"></i></div><span class="num small">' + q.pct + '%</span></div>') + '</td></tr>';
      }).join('') + '</tbody></table></div></div>';
    h += '<div class="card stack-s"><div class="row sp"><h3>รายคน</h3><div class="row"><button class="btn sm" type="button" id="csv1">ส่งออก CSV</button><button class="btn sm" type="button" id="csv2">CSV + คะแนนรายข้อ</button></div></div>' +
      (r.attempts.length ? '<div class="scroll-x"><table id="attTbl"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>สถานะ</th><th>คะแนน</th><th>%</th><th>ถูก/ผิด/ว่าง</th><th>เวลา</th><th>ออกจอ</th><th>คะแนนเก็บ</th></tr></thead><tbody>' +
        r.attempts.map(function (a) {
          return '<tr data-att="' + esc(a.attemptId) + '"><td class="mono">' + esc(a.stdId) + '</td><td>' + esc(a.name) + '</td><td>' + stPill(a.status) + '</td><td class="num">' + a.totalScore + ' / ' + a.maxScore + '</td><td class="num">' + a.pct + '</td>' +
            '<td class="num">' + a.correct + ' / ' + a.wrong + ' / ' + a.unanswered + '</td><td class="num">' + mmss(a.durationSec) + '</td><td class="num">' + a.violations + '</td>' +
            '<td class="num">' + (a.courseScore === null ? '—' : a.courseScore + (a.counted ? ' <span class="pill good">นับ</span>' : '')) + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="small muted">ยังไม่มีผล</p>') + '</div>';
    $('#panel').innerHTML = h;
    $('#csv1').addEventListener('click', function () { exp(this, false); });
    $('#csv2').addEventListener('click', function () { exp(this, true); });
    var sb = $('#syncBtn'); if (sb) sb.addEventListener('click', function () { resync(sb); });
  }
  function exp(btn, detail) {
    HBT.busy(btn, function () { return HBT.api.call('exam.round.export', { sessionId: sid, detail: detail }, X).then(function (r) { HBT.csv.download(r.filename, r.csv); }); }).catch(fail);
  }
  function resync(btn) {
    HBT.busy(btn, function () {
      return HBT.api.call('exam.round.sync', { sessionId: sid }, X).then(function (r) {
        HBT.toast(r.state === 'OK' ? 'ส่งคะแนนแล้ว · ' + r.note : (r.state === 'ERR' ? 'ยังส่งไม่สำเร็จ: ' + r.note : r.note), r.state === 'ERR' ? 'bad' : 'good');
        return refresh();
      });
    }).catch(fail);
  }

  /* ---------- ตั้งค่า / ลิงก์ ---------- */
  function settings() {
    var r = round;
    $('#panel').innerHTML =
      '<div class="card stack" id="linkCard"><h3>ลิงก์สำหรับนักศึกษา</h3><div class="field"><label for="lnk">คัดลอกส่งในกลุ่มไลน์/ห้องเรียนออนไลน์</label><input id="lnk" type="text" readonly value="' + esc(studentUrl()) + '"></div>' +
      '<div class="row"><button class="btn primary sm" type="button" id="cpy">คัดลอกลิงก์</button><a class="btn sm" id="opn" target="_blank" rel="noopener" href="' + esc(studentUrl()) + '">ลองเปิดลิงก์</a></div></div>' +
      '<div class="card stack" id="setCard"><h3>แก้ไขรอบ</h3>' +
      '<div class="field"><label for="eName">ชื่อรอบ</label><input id="eName" type="text" maxlength="200" value="' + esc(r.title) + '"></div>' +
      '<div class="grid g2"><div class="field"><label for="eStart">เปิดให้เข้า</label><input id="eStart" type="datetime-local" value="' + esc(toInput(r.startAt)) + '"></div><div class="field"><label for="eEnd">ปิดรับ</label><input id="eEnd" type="datetime-local" value="' + esc(toInput(r.endAt)) + '"></div></div>' +
      '<div class="grid g2"><div class="field"><label for="eTotal">เวลาทำทั้งฉบับ (นาที — 0 = ไม่จำกัด)</label><input id="eTotal" type="number" inputmode="numeric" min="0" max="1440" value="' + r.totalMinutes + '"></div>' +
      (r.allowBack ? '' : '<div class="field"><label for="eSec">เวลาต่อข้อ (วินาที — 0 = ไม่จำกัด)</label><input id="eSec" type="number" inputmode="numeric" min="0" max="3600" value="' + r.secPerQuestion + '"></div>') +
      '<div class="field"><label for="eMax">ทำได้กี่ครั้ง (0 = ไม่จำกัด)</label><input id="eMax" type="number" inputmode="numeric" min="0" max="50" value="' + r.maxAttempts + '"></div></div>' +
      '<div class="grid g2"><div class="field"><label for="eSm">คะแนนเก็บเข้ารายวิชา</label><select id="eSm"><option value="NONE">ไม่บันทึก</option><option value="SCORE">ตามสัดส่วน</option>' + (r.mode === 'PRACTISE' ? '<option value="COMPLETE">ทำครบทุกข้อได้เต็ม</option>' : '') + '</select></div>' +
      '<div class="field"><label for="eSv">คะแนนเต็มในรายวิชา</label><input id="eSv" type="number" inputmode="decimal" min="0.01" max="1000" step="any" value="' + (r.scoreValue || 10) + '"></div></div>' +
      '<p class="help">เปลี่ยนวิธี/คะแนนเต็มของคะแนนเก็บ → ระบบคิดคะแนนของฉบับที่ส่งแล้วใหม่และส่งเข้ารายวิชาให้ทันที · ตัวเลือกอื่น (สลับข้อ ออกนอกจอ ย้อนข้อ) แก้หลังสร้างรอบไม่ได้ เพื่อให้ทุกคนสอบเงื่อนไขเดียวกัน</p>' +
      '<div class="err" id="eErr" role="alert"></div><div class="row"><button class="btn primary" type="button" id="eSave">บันทึก</button></div></div>' +
      '<div class="card stack-s" id="dangerCard"><h3>ลบรอบ</h3><p class="small muted">ลบรอบนี้พร้อมลิงก์ · คะแนนที่ซิงก์ไว้ในรายวิชาจะถูกเอาออกด้วย (ผลสอบรายคนยังเก็บอยู่ในระบบสอบ)</p><div><button class="btn danger" type="button" id="delBtn">ลบรอบนี้</button></div></div>';
    $('#eSm').value = r.scoreMode;
    $('#cpy').addEventListener('click', function () {
      var ta = $('#lnk'), done = function () { HBT.toast('คัดลอกแล้ว', 'good'); };
      ta.focus(); ta.select();
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, function () { try { document.execCommand('copy'); done(); } catch (e) { fail({ message: 'คัดลอกไม่ได้ — เลือกข้อความแล้วคัดลอกเอง' }); } });
      else { try { document.execCommand('copy'); done(); } catch (e) { fail({ message: 'คัดลอกไม่ได้ — เลือกข้อความแล้วคัดลอกเอง' }); } }
    });
    $('#eSave').addEventListener('click', function () {
      var p = { sessionId: sid, title: $('#eName').value, startAt: fromInput($('#eStart').value), endAt: fromInput($('#eEnd').value), totalMinutes: $('#eTotal').value, maxAttempts: $('#eMax').value, scoreMode: $('#eSm').value, scoreValue: $('#eSv').value };
      if ($('#eSec')) p.secPerQuestion = $('#eSec').value;
      $('#eErr').textContent = '';
      HBT.busy(this, function () {
        return HBT.api.call('exam.round.update', p, { api: 'exam', write: true }).then(function (r2) {
          HBT.toast(r2.sync ? (r2.sync.state === 'ERR' ? 'บันทึกแล้ว แต่ส่งคะแนนเข้ารายวิชาไม่สำเร็จ' : 'บันทึกแล้ว และคิดคะแนนใหม่') : 'บันทึกแล้ว', r2.sync && r2.sync.state === 'ERR' ? 'bad' : 'good');
          rep = null; return refresh();
        });
      }).catch(function (e) { $('#eErr').textContent = HBT.errMsg(e); });
    });
    $('#delBtn').addEventListener('click', function () {
      if (!window.confirm('ลบรอบ “' + round.title + '” ? ลิงก์ของนักศึกษาจะใช้ไม่ได้ และคะแนนที่ซิงก์ไว้ในรายวิชาจะถูกเอาออก')) return;
      HBT.busy(this, function () {
        return HBT.api.call('exam.round.delete', { sessionId: sid }, { api: 'exam', write: true }).then(function (r) {
          HBT.toast(r.scoresRemoved ? 'ลบรอบแล้ว' : 'ลบรอบแล้ว แต่เอาคะแนนออกจากรายวิชาไม่สำเร็จ — ตรวจที่หน้าคะแนน', r.scoresRemoved ? 'good' : 'bad');
          setTimeout(function () { location.href = listUrl; }, 600);
        });
      }).catch(fail);
    });
  }

  /* ---------- โหลดข้อมูลรอบ (ดึงจากรายการของวิชา) ---------- */
  function refresh() {
    return HBT.api.call('exam.round.list', { courseId: cid }, X).then(function (r) {
      round = r.rounds.filter(function (x) { return x.sessionId === sid; })[0];
      if (!round) throw Object.assign(new Error('ไม่พบรอบนี้ (อาจถูกลบแล้ว)'), { code: 'E_NOT_FOUND' });
      shell(); panel();
    });
  }
  if (!cid) { $('#box').innerHTML = '<div class="callout bad"><b>ไม่พบรายวิชา</b><br>เปิดรอบจากหน้ารายการรอบของวิชา</div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>'; return; }
  refresh().catch(function (e) {
    var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN';
    $('#box').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบรอบนี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
      '<div class="row" style="margin-top:10px">' + (nf ? '' : '<button class="btn" type="button" id="reload">ลองใหม่</button>') + '<a class="btn" href="' + listUrl + '">รอบทั้งหมด</a></div>';
    var rb = $('#reload'); if (rb) rb.addEventListener('click', function () { location.reload(); });
  });
});
