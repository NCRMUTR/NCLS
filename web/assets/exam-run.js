/* HBT Core — หน้านักศึกษา: เข้าสอบ / ฝึกทำ (ลิงก์รอบ s/exam.html?t=<รหัสรอบ>)
 * ลำดับ: เปิดลิงก์ → ยืนยันตัวตนด้วยชื่อ + PIN (token ชนิด s จาก Core) → ดูเงื่อนไข/ผลที่ผ่านมา → เริ่มทำ (token ผู้ทำข้อสอบ a จาก Exam API)
 *        → ข้อสอบทั้งฉบับถูกโหลดครั้งเดียว (ไม่มีเฉลย) → ตอบ/เลื่อนข้อในเครื่องทันที คำตอบส่งเบื้องหลังเรียงคิว → สรุปผล
 * ยกตรรกะจาก EEOS v2.1.0 (JsStudent) · ตำแหน่งตัวเลือกที่ส่งไป-กลับคือ "ตำแหน่งบนจอ" ไม่ใช่หมายเลขจริง */
(function () {
  'use strict';
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var S = HBT.stu;
  var app = document.getElementById('app');
  var T = HBT.qs('t');
  var X = { api: 'exam' };

  var st = {
    res: null, my: null, att: null,                     // att = { tok, expiresAt, attemptId }
    paper: [], answeredMap: [], cur: 0, selected: null, revealed: false, q: null,
    mode: 'TEST', allowBack: false, tts: false, lockTab: false, maxV: 0, violations: 0,
    secPerQ: 0, deadlineAt: null, qStart: 0, totalMin: 0,
    tick: null, busy: false, offline: false, pendingFinish: null, watching: false, hbTimer: null, finished: false
  };

  /* ---------- ที่เก็บในเครื่อง ---------- */
  var mem = {};
  function ssGet(k) { try { var v = sessionStorage.getItem(k); return v ? JSON.parse(v) : (mem[k] || null); } catch (e) { return mem[k] || null; } }
  function ssSet(k, v) { mem[k] = v; try { if (v) sessionStorage.setItem(k, JSON.stringify(v)); else sessionStorage.removeItem(k); } catch (e) {} }
  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  var attKey = function () { return 'hbt.exam.att.' + T; };
  function loadAtt() {
    var a = ssGet(attKey());
    if (!a || !a.tok || !a.expiresAt || a.expiresAt < Date.now() + 30000) { if (a) ssSet(attKey(), null); return null; }
    return a;
  }
  function newOp() { return 'op-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 10); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function hhmmss(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return (h ? h + ':' : '') + pad2(m) + ':' + pad2(s);
  }
  function fmt(t) { return t ? HBT.fmtBE(t, true) : ''; }
  function parseLocal(s) { var d = new Date(String(s || '').replace(' ', 'T')); return isNaN(d.getTime()) ? null : d.getTime(); }

  /* ---------- ข้อความ error (ภาษาที่นักศึกษาเข้าใจ) ---------- */
  var WHY = {
    E_SESSION_NOT_OPEN: 'ยังไม่ถึงเวลาเข้าทำ', E_SESSION_CLOSED: 'ปิดรับการทำแล้ว', E_STUDENT_NOT_FOUND: 'ไม่พบรายชื่อนี้ในรายวิชา',
    E_WRONG_COURSE: 'ลิงก์นี้ไม่ใช่ของรายวิชาที่คุณเข้าสู่ระบบไว้', E_ATTEMPT_LIMIT: 'ทำครบจำนวนครั้งที่กำหนดแล้ว', E_ATTEMPT_DONE: 'การทำข้อสอบนี้จบแล้ว',
    E_NO_QUESTIONS: 'ชุดนี้ยังไม่มีข้อสอบ', E_NO_BACK: 'รอบนี้ไม่อนุญาตให้ย้อนกลับ', E_BAD_LINK: 'ลิงก์ไม่ถูกต้องหรือถูกยกเลิกแล้ว',
    E_BUSY: 'ระบบกำลังทำงานหนัก กรุณาลองอีกครั้ง', E_CORRUPT: 'ข้อมูลการทำข้อสอบมีปัญหา กรุณาแจ้งอาจารย์',
    E_TOO_LATE: 'เหลือเวลาในรอบนี้น้อยกว่า 1 นาที เริ่มทำไม่ได้แล้ว', E_CORE_DOWN: 'ระบบกลางยังไม่พร้อม กรุณารอสักครู่แล้วลองใหม่',
    E_NETWORK: 'เชื่อมต่อไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต'
  };
  function errText(e) { return (e && WHY[e.code]) || HBT.errMsg(e); }

  /* ---------- เรียก API ---------- */
  function sCall(action, args, opt) { return S.call(action, args, Object.assign({ api: 'exam' }, opt || {})); }                 // token นักศึกษา s
  function aCall(action, args, opt) {                                                                                         // token ผู้ทำข้อสอบ a
    return HBT.api.call(action, args, Object.assign({ api: 'exam', token: st.att ? st.att.tok : '' }, opt || {})).catch(function (e) {
      if (e && e.code === 'E_AUTH') authLost();
      throw e;
    });
  }
  function authLost() {
    if (st.finished) return;
    clearInterval(st.tick); clearInterval(st.hbTimer);
    ssSet(attKey(), null); st.att = null;
    app.innerHTML = head() + '<div class="callout warn" id="authLost"><b>เซสชันทำข้อสอบหมดอายุ</b><br>คำตอบที่ส่งไปแล้วถูกเก็บไว้ครบ — เปิดหน้านี้ใหม่แล้วเลือก “ทำต่อจากเดิม” (ถ้ารอบยังเปิดอยู่)</div>' +
      '<div><button class="btn primary" type="button" id="reopen">เปิดใหม่</button></div>';
    $('#reopen').addEventListener('click', function () { location.reload(); });
  }

  /* ============================================================
     คิวเบื้องหลัง (โหมดสอบ/ย้ายข้อ): เก็บลงเครื่องก่อนส่งเสมอ แล้วส่งทีละรายการเรียงลำดับ — เซิร์ฟเวอร์ไม่มีวันได้รับคำสั่งสลับลำดับ
     ============================================================ */
  var Q = {
    key: function () { return 'hbt.exam.q.' + (st.att ? st.att.attemptId : ''); },
    all: function () { try { return JSON.parse(lsGet(Q.key()) || '[]'); } catch (e) { return []; } },
    save: function (l) { lsSet(Q.key(), l.length ? JSON.stringify(l) : null); },
    push: function (it) { var l = Q.all(); l.push(it); Q.save(l); },
    drop: function (id) { Q.save(Q.all().filter(function (x) { return x.opId !== id; })); },
    running: false, p: null,
    flush: function () {
      if (Q.running) return Q.p || Promise.resolve(0);
      Q.running = true;
      var n = 0;
      Q.p = (function drain() {
        var l = Q.all();
        if (!l.length) { Q.running = false; if (n) setOffline(false); return Promise.resolve(n); }
        var it = l[0];
        var call = it.type === 'goto'
          ? aCall('exam.go', { target: it.target }, { write: true, opId: it.opId })
          : aCall('exam.advance', { questionId: it.q, pos: it.pos, target: it.target }, { write: true, opId: it.opId });
        return call.then(function (r) {
          Q.drop(it.opId); n++; setOffline(false);
          if (r && r.finished && r.result) st.pendingFinish = r.result;
          return drain();
        }).catch(function (e) {
          if (e && (e.code === 'E_NETWORK' || e.code === 'E_BUSY')) { setOffline(true); Q.running = false; return n; }
          if (e && e.code === 'E_AUTH') { Q.running = false; return n; }
          Q.drop(it.opId);                                   // ผิดที่ข้อมูล (เช่น ฉบับจบแล้ว/ข้อไม่มี) — ทิ้งรายการนี้ ไม่ให้คิวติดตลอดไป
          if (e && e.code === 'E_ATTEMPT_DONE') { Q.save([]); }
          return drain();
        });
      })();
      return Q.p;
    }
  };

  function setOffline(v) {
    if (st.offline === v) return;
    st.offline = v;
    var el = $('#exWarn');
    if (!el) return;
    if (v) el.innerHTML = '<div class="ex-warn" id="offBar">เน็ตหลุด — คำตอบถูกเก็บไว้ในเครื่อง จะส่งให้อัตโนมัติเมื่อกลับมา (อย่าปิดหน้านี้)</div>';
    else el.innerHTML = st.violations ? violHtml() : '';
  }
  function violHtml() { return '<div class="ex-warn" id="violBar">ระบบบันทึกว่าคุณออกจากหน้าจอ ' + st.violations + ' ครั้ง</div>'; }

  /* ---------- โครงหน้า ---------- */
  function head() { return '<div class="stack-s"><a class="brand" href="' + root + 'index.html"><span class="mark">H</span>HBT Teaching</a></div>'; }
  function hero() {
    var c = st.res.course, s = st.res.session;
    return '<div class="ex-hero" id="hero"><div class="code">' + esc(c.code) + ' · กลุ่ม ' + esc(c.section) + '</div><h2>' + esc(s.title || c.name) + '</h2>' +
      '<div class="by">' + esc(c.name) + (s.quizTitle ? ' · ' + esc(s.quizTitle) : '') + '</div>' +
      '<span class="tag">' + (s.mode === 'PRACTISE' ? 'ฝึกทำ' : 'สอบ') + '</span></div>';
  }
  function fail(title, msg) {
    app.innerHTML = head() + '<div class="callout bad"><b>' + esc(title) + '</b><br>' + esc(msg) + '</div><div><a class="btn" href="' + root + 'index.html">กลับหน้าแรก</a></div>';
  }

  /* ============================================================
     1) ปก + ยืนยันตัวตน
     ============================================================ */
  function boot() {
    if (!HBT.api.configuredCore() || !HBT.api.configuredExam()) {
      app.innerHTML = '<div class="callout warn"><b>ยังไม่ได้ตั้งค่าเว็บ</b><br>ไฟล์ assets/config.js ยังไม่มี CORE_URL หรือ EXAM_URL</div>';
      return;
    }
    if (!/^[0-9a-f]{32}$/.test(T)) { fail('ลิงก์ไม่ถูกต้อง', 'ขอลิงก์ใหม่จากอาจารย์ (ลิงก์ต้องมีรหัสรอบสอบต่อท้าย)'); return; }
    app.innerHTML = '<div class="loading" role="status"><span class="spin"></span> กำลังโหลด…</div>';
    HBT.api.call('exam.resolve', { t: T }, { api: 'exam', token: '' }).then(function (r) {
      st.res = r; st.mode = r.session.mode;
      var a = loadAtt();
      if (a) {                                         // รีเฟรชหน้าระหว่างทำ → กลับเข้าข้อสอบเดิมทันที
        st.att = a;
        watch();
        return Q.flush().then(loadPaper).catch(function (e) {
          if (e && e.code === 'E_AUTH') { ssSet(attKey(), null); st.att = null; }
          cover();
        });
      }
      cover();
    }, function (e) {
      fail(e.code === 'E_BAD_LINK' ? 'เปิดลิงก์นี้ไม่ได้' : 'โหลดไม่สำเร็จ', errText(e));
    });
  }

  function cover(msg) {
    var s = st.res.session, sess = S.sess();
    app.innerHTML = head() + hero() +
      '<section class="card stack" id="cover"><div id="cvStat" class="small muted"></div><h3>ยืนยันตัวตน</h3>' +
      '<p class="small muted">เลือกชื่อของคุณแล้วใส่ PIN 4 หลัก</p>' + (msg ? '<div class="callout warn">' + esc(msg) + '</div>' : '') + '<div id="loginBox"></div></section>' +
      '<p class="small muted"><a href="' + root + 'index.html">กลับหน้าแรก</a></p>';
    $('#cvStat').textContent = statLine();
    if (sess && sess.courseId === st.res.course.courseId) { afterLogin(); return; }
    S.loginBox($('#loginBox'), { courseId: st.res.course.courseId, tid: '', onDone: function () { afterLogin(); } });
  }
  function statLine() {
    var s = st.res.session;
    if (s.status === 'SCHEDULED') return 'ยังไม่ถึงเวลา · เปิด ' + fmt(s.startAt);
    if (s.status === 'CLOSED') return 'ปิดรับแล้ว';
    return st.res.questionCount + ' ข้อ · ปิดรับ ' + fmt(s.endAt);
  }

  /* ============================================================
     2) เงื่อนไข + ผลที่ผ่านมา + ปุ่มเริ่ม
     ============================================================ */
  function afterLogin() {
    app.innerHTML = head() + hero() + '<div class="loading"><span class="spin"></span> กำลังโหลด…</div>';
    sCall('exam.my', { t: T }).then(function (m) { st.my = m; howto(); }, function (e) {
      if (e && e.code === 'E_AUTH') { S.clear(); cover('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'); return; }
      if (e && e.code === 'E_WRONG_COURSE') { S.clear(); cover(WHY.E_WRONG_COURSE); return; }
      app.innerHTML = head() + hero() + '<div class="callout bad"><b>โหลดไม่สำเร็จ</b><br>' + esc(errText(e)) + '</div><div class="row"><button class="btn primary" type="button" id="rt">ลองใหม่</button></div>';
      $('#rt').addEventListener('click', afterLogin);
    });
  }

  function rules() {
    var s = st.res.session, L = [];
    L.push('ชุดนี้มีทั้งหมด <b>' + st.res.questionCount + ' ข้อ</b> ลำดับข้อและตัวเลือกของแต่ละคนอาจไม่เหมือนกัน');
    if (s.mode === 'PRACTISE') {
      L.push('เลือกคำตอบแล้วกด <b>ตรวจคำตอบ</b> ระบบจะเฉลยพร้อมคำอธิบายทันที');
      L.push('ย้อนกลับไปทำข้อเดิมไม่ได้ แต่ระบบบันทึกผลการฝึกไว้ให้อาจารย์ดูทุกครั้ง');
      if (s.tts) L.push('กดปุ่ม <b>อ่านออกเสียง</b> เพื่อให้ระบบอ่านคำถามและตัวเลือกให้ฟัง');
    } else {
      L.push('ระหว่างสอบจะไม่มีเฉลยและคำอธิบาย ระบบจะแจ้งคะแนนรวมหลังกดส่งข้อสอบ');
      L.push(s.allowBack ? 'ย้อนกลับไปแก้คำตอบข้อก่อนหน้าได้จนกว่าจะกดส่งข้อสอบ' : 'เมื่อผ่านไปข้อถัดไปแล้ว จะย้อนกลับมาแก้ข้อเดิมไม่ได้');
    }
    if (s.secPerQuestion) L.push('แต่ละข้อมีเวลา <b>' + s.secPerQuestion + ' วินาที</b> หมดเวลาระบบจะนับว่าไม่ได้ตอบและไปข้อถัดไปให้เอง');
    if (s.totalMinutes) L.push('มีเวลาทำ <b>' + s.totalMinutes + ' นาที</b> นับจากตอนกดเริ่มทำ หมดเวลาระบบจะส่งข้อสอบให้อัตโนมัติ (และไม่เกินเวลาปิดรับ ' + esc(fmt(s.endAt)) + ')');
    else L.push('ต้องทำให้เสร็จก่อนเวลาปิดรับ <b>' + esc(fmt(s.endAt)) + '</b>');
    if (s.scoreMode === 'COMPLETE') L.push('ทำให้ครบ <b>ทุกข้อ</b> จะได้ <b>' + esc(s.scoreValue) + ' คะแนน</b> เก็บเข้ารายวิชา');
    if (s.scoreMode === 'SCORE') L.push('ผลที่ได้จะนับเป็นคะแนนเก็บเข้ารายวิชา เต็ม <b>' + esc(s.scoreValue) + ' คะแนน</b>' + (s.maxAttempts !== 1 ? ' (นับครั้งที่ดีที่สุด)' : ''));
    if (s.maxAttempts > 0) L.push('ทำได้ไม่เกิน <b>' + s.maxAttempts + ' ครั้ง</b>');
    if (s.lockTab) L.push('ระบบจะบันทึกทุกครั้งที่ออกจากหน้าจอนี้' + (s.maxViolations ? ' หากครบ ' + s.maxViolations + ' ครั้ง ระบบจะส่งข้อสอบอัตโนมัติ' : ' และรายงานให้อาจารย์ทราบ'));
    if (s.resume) L.push('ถ้าเน็ตหลุด คำตอบจะถูกเก็บไว้ในเครื่องและส่งให้เองเมื่อกลับมา ไม่ต้องปิดหน้านี้');
    return L;
  }

  function howto() {
    var s = st.res.session, m = st.my, sess = S.sess();
    var past = m.attempts.length ? '<section class="card stack-s" id="past"><h3>ผลที่ผ่านมาของคุณ</h3>' + m.attempts.map(function (a, i) {
      var cs = a.courseScore !== null && a.courseScore !== undefined ? ' · คะแนนเก็บ ' + a.courseScore + '/' + a.courseMax : '';
      return '<div class="ex-att"><span>ครั้งที่ ' + (i + 1) + ' · ' + esc(fmt(a.startedAt)) + (a.status === 'EXPIRED' ? ' <span class="pill warn">หมดเวลา</span>' : '') + '</span>' +
        '<b class="num">' + esc(a.totalScore) + ' / ' + esc(a.maxScore) + '</b><span class="small muted">' + esc(cs) + '</span></div>';
    }).join('') + '</section>' : '';
    var label = '', can = true, why = '';
    if (m.status === 'SCHEDULED') { can = false; why = 'ยังไม่ถึงเวลา — เปิดให้เข้า ' + fmt(s.startAt); }
    else if (m.status === 'CLOSED') { can = false; why = 'รอบนี้ปิดรับแล้ว'; }
    else if (m.inProgress && m.canResume) label = 'ทำต่อจากเดิม';
    else if (m.remaining === 0 && !m.inProgress) { can = false; why = 'คุณทำครบจำนวนครั้งที่กำหนดแล้ว'; }
    else label = m.attempts.length ? 'เริ่มทำอีกครั้ง' : 'เริ่มทำ';
    var note = (m.inProgress && !m.canResume) ? '<div class="callout warn">คุณมีฉบับที่ค้างอยู่ แต่รอบนี้ไม่ให้ทำต่อ — การเริ่มใหม่จะส่งฉบับเดิมตามที่ตอบไว้และนับเป็น 1 ครั้ง</div>' : '';
    app.innerHTML = head() + hero() +
      '<section class="card stack"><div class="row sp"><h3>ก่อนเริ่ม</h3><span class="small muted">' + esc(sess.name) + ' (' + esc(sess.stdId) + ')</span></div>' +
      '<ol class="ex-list" id="rules">' + rules().map(function (x) { return '<li>' + x + '</li>'; }).join('') + '</ol>' + note +
      (can ? '<button class="btn primary block" type="button" id="goBtn" style="min-height:52px;font-size:1.05rem">' + label + '</button>'
           : '<div class="callout warn" id="cant">' + esc(why) + '</div>') +
      '<div class="err" id="goErr" role="alert"></div></section>' + past +
      '<p class="small muted"><a href="#" id="bye">ไม่ใช่คุณ? ออกจากระบบ</a> · <a href="' + root + 'index.html">กลับหน้าแรก</a></p>';
    $('#bye').addEventListener('click', function (e) { e.preventDefault(); S.clear(); cover(); });
    var g = $('#goBtn');
    if (g) g.addEventListener('click', function () { startNow(g); });
  }

  function startNow(btn) {
    var op = newOp(), n = 0;
    $('#goErr').textContent = '';
    function attempt() {
      return sCall('exam.start', { t: T }, { write: true, opId: op }).catch(function (e) {
        if (e && e.code === 'E_BUSY' && ++n < 6) return new Promise(function (ok) { setTimeout(ok, 1200 + Math.random() * 2500); }).then(attempt);   // ช่วงคนเข้าพร้อมกันมาก ลองใหม่เอง (opId เดิม ไม่สร้างฉบับซ้ำ)
        throw e;
      });
    }
    HBT.busy(btn, function () {
      btn.textContent = 'กำลังเริ่ม…';
      return attempt().then(function (r) {
        st.att = { tok: r.attemptToken, expiresAt: r.expiresAt, attemptId: r.attemptId };
        ssSet(attKey(), st.att);
        watch();
        return loadPaper();
      });
    }).catch(function (e) {
      if (e && e.code === 'E_AUTH') { S.clear(); cover('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง'); return; }
      var el = $('#goErr'); if (el) el.textContent = errText(e);
    });
  }

  /* ============================================================
     3) ทำข้อสอบ
     ============================================================ */
  function loadPaper() {
    return aCall('exam.paper', {}).then(function (pt) {
      if (pt.finished) { done(pt.result); return; }
      st.paper = pt.questions; st.answeredMap = pt.answeredMap; st.mode = pt.mode; st.allowBack = pt.allowBack; st.tts = pt.tts;
      st.lockTab = pt.lockTab; st.maxV = pt.maxViolations; st.violations = pt.violations || 0; st.secPerQ = pt.secPerQuestion || 0;
      st.deadlineAt = pt.deadlineAt ? Number(pt.deadlineAt) : null; st.title = pt.title;
      st.totalMin = st.res.session.totalMinutes || 0;
      var qs = parseLocal(pt.qStartAt), sv = parseLocal(pt.serverTime);
      st.qElapsed = (qs !== null && sv !== null) ? Math.max(0, sv - qs) : 0;       // เวลาที่ผ่านไปแล้วของข้อที่ค้าง (ตามนาฬิกาเซิร์ฟเวอร์)
      examShell();
      renderQ(pt.resumeIndex || 0, true);
      beat(false);                                                                  // ปรับเวลารวมให้ตรงเซิร์ฟเวอร์ทันที
    });
  }

  function examShell() {
    app.innerHTML =
      '<div class="ex-head"><div class="in"><div class="grow"><div class="small muted" id="exLabel">ข้อ 1 / 1</div><div class="ex-prog"><i id="exProg"></i></div></div>' +
      '<div class="ex-clock" id="exClock" aria-live="off">--:--</div></div></div>' +
      '<div id="exWarn"></div>' +
      '<section class="card stack" id="exCard"><div class="row sp" style="align-items:flex-start"><span class="small muted" id="exPts"></span>' +
      '<button class="ex-spk" type="button" id="exSpeak" hidden>🔊 อ่านออกเสียง</button></div>' +
      '<div class="ex-q" id="exQ"></div><div id="exQImg"></div><div id="exOpts"></div><div id="exReveal"></div></section>' +
      '<section class="card stack-s"><div class="small muted">กระดาษคำตอบ</div><div class="ex-omr" id="exOmr"></div></section>' +
      '<div class="ex-pad"></div>' +
      '<div class="ex-foot"><div class="in"><button class="btn" type="button" id="exPrev">← ก่อนหน้า</button><div class="grow"></div>' +
      '<button class="btn ghost" type="button" id="exSubmit">ส่งข้อสอบ</button><button class="btn primary" type="button" id="exNext">ถัดไป →</button></div></div>';
    $('#exPrev').addEventListener('click', function () { if (st.allowBack) localGoto(Math.max(0, st.cur - 1)); });
    $('#exNext').addEventListener('click', onNext);
    $('#exSubmit').addEventListener('click', askSubmit);
    $('#exSpeak').addEventListener('click', speak);
  }
  /** ถามยืนยันก่อนส่ง (นับข้อที่ยังไม่ได้ตอบ โดยนับคำตอบที่เลือกไว้ในข้อนี้แต่ยังไม่ได้บันทึกด้วย) */
  function askSubmit() {
    var left = HBT.$$('#exOmr .b:not(.done)').length;
    var pending = st.mode === 'TEST' && st.selected !== null && st.selected !== undefined && !st.answeredMap[st.cur];
    if (pending) left -= 1;
    $('#cfMsg').textContent = 'ส่งข้อสอบเลยหรือไม่? เมื่อส่งแล้วจะแก้ไขคำตอบไม่ได้' + (left > 0 ? '\nยังไม่ได้ตอบอีก ' + left + ' ข้อ' : '');
    HBT.modal.open('mConfirm');
  }
  $('#cfYes').addEventListener('click', function () {
    HBT.modal.close('mConfirm');
    if (st.mode === 'TEST' && !st.finished) localGoto(st.paper.length);      // บันทึกคำตอบข้อปัจจุบันก่อนส่ง
    else finish();
  });

  function renderQ(index, first) {
    st.cur = index;
    var q = st.paper[index]; st.q = q;
    st.selected = (q.selected === null || q.selected === undefined) ? null : q.selected;
    st.revealed = false;
    $('#exLabel').textContent = 'ข้อ ' + (index + 1) + ' / ' + st.paper.length;
    $('#exPts').textContent = q.score + ' คะแนน';
    $('#exQ').textContent = q.text || '';
    $('#exQImg').innerHTML = q.imageUrl ? '<img class="ex-img" src="' + esc(q.imageUrl) + '" alt="รูปประกอบคำถาม">' : '';
    var opts = $('#exOpts');
    opts.innerHTML = q.choices.map(function (c) {
      var body = c.imageUrl ? '<img src="' + esc(c.imageUrl) + '" alt="ตัวเลือก ' + String.fromCharCode(64 + c.pos) + '">' + (c.text ? '<div>' + esc(c.text) + '</div>' : '') : esc(c.text);
      return '<button class="ex-opt' + (st.selected === c.pos ? ' sel' : '') + '" type="button" data-pos="' + c.pos + '"><span class="k">' + String.fromCharCode(64 + c.pos) + '</span><span class="tx">' + body + '</span></button>';
    }).join('');
    HBT.$$('.ex-opt', opts).forEach(function (b) {
      b.addEventListener('click', function () {
        if (st.revealed) return;
        st.selected = Number(b.getAttribute('data-pos'));
        HBT.$$('.ex-opt', opts).forEach(function (x) { x.classList.remove('sel'); });
        b.classList.add('sel');
      });
    });
    $('#exReveal').innerHTML = '';
    paintOmr();
    var spk = $('#exSpeak'); spk.hidden = !st.tts; spk.classList.remove('on'); spk.textContent = '🔊 อ่านออกเสียง';
    var pv = $('#exPrev'); pv.hidden = !st.allowBack; pv.disabled = index === 0;
    setNextLabel();
    var w = $('#exWarn'); if (w && !st.offline) w.innerHTML = st.violations ? violHtml() : '';
    st.qStart = Date.now() - (first ? st.qElapsed : 0);
    startTimer();
    window.scrollTo(0, 0);
  }

  function setNextLabel() {
    var b = $('#exNext');
    if (st.mode === 'PRACTISE' && !st.revealed) b.textContent = 'ตรวจคำตอบ';
    else if (st.cur === st.paper.length - 1) b.textContent = 'ส่งข้อสอบ';
    else b.textContent = 'ถัดไป →';
  }

  function paintOmr() {
    var el = $('#exOmr');
    el.innerHTML = st.answeredMap.map(function (v, i) {
      return '<div class="b' + (v ? ' done' : '') + (i === st.cur ? ' cur' : '') + (st.allowBack ? ' nav' : '') + '" data-g="' + i + '">' + (i + 1) + '</div>';
    }).join('');
    if (st.allowBack) HBT.$$('[data-g]', el).forEach(function (b) { b.addEventListener('click', function () { localGoto(Number(b.getAttribute('data-g'))); }); });
  }

  /* ---------- นาฬิกา (คำนวณในเครื่อง; เวลารวมปรับตามเซิร์ฟเวอร์ทุก 30 วินาที) ---------- */
  function startTimer() {
    clearInterval(st.tick);
    paintClock();
    st.tick = setInterval(function () {
      paintClock();
      if (st.busy || st.finished) return;
      if (st.secPerQ > 0 && !st.revealed && Math.floor((Date.now() - st.qStart) / 1000) >= st.secPerQ) {
        clearInterval(st.tick);
        HBT.toast('หมดเวลาข้อนี้', 'bad');
        if (st.mode === 'PRACTISE') submitAnswer(true);
        else localGoto(st.cur + 1, true);               // หมดเวลา: ส่งคำตอบที่เลือกไว้ (ถ้ามี) แล้วไปข้อถัดไปให้เอง
        return;
      }
      if (st.deadlineAt && Date.now() >= st.deadlineAt) { clearInterval(st.tick); finish(); }
    }, 1000);
  }
  function paintClock() {
    var c = $('#exClock'), bar = $('#exProg');
    if (!c) return;
    var val, span;
    if (st.secPerQ > 0) { span = st.secPerQ; val = Math.max(0, span - Math.floor((Date.now() - st.qStart) / 1000)); }
    else if (st.deadlineAt) { span = Math.max(1, st.totalMin * 60) || Math.max(1, Math.floor((st.deadlineAt - st.qStart) / 1000)); val = Math.max(0, Math.floor((st.deadlineAt - Date.now()) / 1000)); }
    else { c.textContent = '—'; bar.style.width = '0'; return; }
    c.textContent = hhmmss(val);
    var pct = Math.max(0, Math.min(100, val / span * 100));
    bar.style.width = pct + '%';
    var hot = pct < 12, warn = pct < 30;
    c.className = 'ex-clock' + (hot ? ' hot' : warn ? ' warn' : '');
    bar.className = hot ? 'hot' : warn ? 'warn' : '';
  }

  /* ---------- เลื่อนข้อ / ตอบ ---------- */
  function onNext() {
    if (st.mode === 'PRACTISE') {
      if (!st.revealed) return submitAnswer(false);
      if (st.cur === st.paper.length - 1) return finish();
      return practiceNext();
    }
    if (st.selected === null || st.selected === undefined) { HBT.toast('กรุณาเลือกคำตอบก่อน', 'bad'); return; }
    if (st.cur === st.paper.length - 1) return askSubmit();
    localGoto(st.cur + 1);
  }

  /** โหมดสอบ: บันทึกคำตอบข้อปัจจุบัน (ถ้ามีของใหม่) + เลื่อนข้อ ทั้งหมดเกิดในเครื่องทันที คำสั่งไปเซิร์ฟเวอร์เรียงคิวเบื้องหลัง */
  function localGoto(target, forceSave) {
    if (st.busy || st.finished) return;
    var cur = st.cur, cq = st.paper[cur], total = st.paper.length;
    if (target < 0) target = 0;
    if (target < cur && !st.allowBack) return;
    var sel = st.selected;
    var changed = !!forceSave || (sel !== null && sel !== undefined && sel !== cq.selected);
    if (changed) {
      cq.selected = (sel === null || sel === undefined) ? 0 : sel;
      st.answeredMap[cur] = 1;
      Q.push({ type: 'adv', opId: newOp(), q: cq.questionId, pos: (sel === null || sel === undefined) ? null : sel, target: target });
    } else {
      Q.push({ type: 'goto', opId: newOp(), target: target });
    }
    Q.flush();
    if (target >= total) { finish(); return; }
    renderQ(target);
  }

  function practiceNext() {
    var target = st.cur + 1;
    Q.push({ type: 'goto', opId: newOp(), target: target });
    Q.flush();
    renderQ(target);
  }

  /** ฝึกทำ: ขอเฉลยจากเซิร์ฟเวอร์ (ต้องรอผลจริง) */
  function submitAnswer(auto) {
    if (st.busy) return;
    if (!auto && (st.selected === null || st.selected === undefined)) { HBT.toast('กรุณาเลือกคำตอบก่อน', 'bad'); return; }
    st.busy = true;
    var sel = auto ? (st.selected === undefined ? null : st.selected) : st.selected;
    var q = st.q;
    aCall('exam.answer', { questionId: q.questionId, pos: sel }, { write: true }).then(function (r) {
      if (r.finished) { done(r.result); return; }
      st.answeredMap[st.cur] = 1; q.selected = (sel === null || sel === undefined) ? 0 : sel;
      paintOmr();
      reveal(r.reveal, sel, auto || r.timedOut);
    }).catch(function (e) { if (!st.finished) HBT.toast(errText(e), 'bad'); if (auto) startTimer(); }).then(function () { st.busy = false; });
  }

  function reveal(rv, sel, timedOut) {
    st.revealed = true;
    clearInterval(st.tick);
    HBT.$$('.ex-opt', $('#exOpts')).forEach(function (b) {
      var pos = Number(b.getAttribute('data-pos'));
      b.disabled = true; b.classList.remove('sel');
      if (rv && pos === rv.correctPos) b.classList.add('right');
      else if (!timedOut && pos === sel) b.classList.add('wrong');
    });
    var ok = rv && rv.isCorrect;
    $('#exReveal').innerHTML = '<div class="ex-reveal ' + (ok ? 'ok' : 'no') + '" id="rv"><b>' + (ok ? '✓ ตอบถูก!' : '✕ ยังไม่ถูก') + ' · ' + (rv ? rv.got : 0) + '/' + st.q.score + '</b>' +
      ((rv && rv.explainText) ? '<p><b>คำอธิบาย:</b> ' + esc(rv.explainText) + '</p>' : '') +
      ((rv && rv.explainImageUrl) ? '<img src="' + esc(rv.explainImageUrl) + '" alt="รูปประกอบคำอธิบาย">' : '') + '</div>';
    $('#exClock').textContent = '—';
    setNextLabel();
    try { $('#rv').scrollIntoView({ block: 'nearest' }); } catch (e) {}
  }

  function finish() {
    if (st.busy || st.finished) return;
    st.busy = true;
    clearInterval(st.tick);
    Q.flush().then(function () {
      if (st.pendingFinish) { var r = st.pendingFinish; st.pendingFinish = null; return { result: r }; }
      return aCall('exam.submit', {}, { write: true });
    }).then(function (r) { done(r.result); }, function (e) {
      st.busy = false;
      if (!st.finished) { HBT.toast(errText(e) + ' — กดส่งอีกครั้ง', 'bad'); startTimer(); }
    }).then(function () { st.busy = false; });
  }

  /* ---------- 4) สรุปผล ---------- */
  function done(res) {
    st.finished = true;
    clearInterval(st.tick); clearInterval(st.hbTimer);
    lsSet(Q.key(), null);
    ssSet(attKey(), null);
    var pct = res.maxScore ? Math.round(res.totalScore / res.maxScore * 1000) / 10 : 0;
    var cs = (res.courseScore !== null && res.courseScore !== undefined) ? '<p class="small" id="courseLine">คะแนนเก็บเข้ารายวิชา: <b>' + esc(res.courseScore) + ' / ' + esc(res.courseMax) + '</b></p>' : '';
    app.innerHTML = head() + hero() +
      '<section class="card stack" style="text-align:center" id="result"><div class="small muted">คะแนนที่ได้</div><div class="ex-score" id="scoreTxt">' + esc(res.totalScore) + ' / ' + esc(res.maxScore) + '</div>' +
      '<div class="muted">' + pct + '% · ใช้เวลา ' + hhmmss(res.durationSec) + (res.status === 'EXPIRED' ? ' · หมดเวลา' : '') + '</div>' +
      '<div class="row" style="justify-content:center;gap:22px"><div><b class="mono" style="font-size:1.3rem;color:var(--good)">' + res.correct + '</b><div class="xs muted">ตอบถูก</div></div>' +
      '<div><b class="mono" style="font-size:1.3rem;color:var(--bad)">' + res.wrong + '</b><div class="xs muted">ตอบผิด</div></div>' +
      '<div><b class="mono" style="font-size:1.3rem;color:var(--muted)">' + res.unanswered + '</b><div class="xs muted">ไม่ได้ตอบ</div></div></div>' +
      '<div class="ex-omr" style="justify-content:center">' + res.items.map(function (it) { return '<div class="b ' + (it.correct ? 'ok' : 'no') + '">' + it.qNo + '</div>'; }).join('') + '</div>' + cs +
      '<p class="small muted">' + (res.mode === 'PRACTISE' ? 'บันทึกผลการฝึกทำแล้ว ทบทวนข้อที่ผิดได้จากกระดาษคำตอบด้านบน' : 'บันทึกผลเรียบร้อยแล้ว ปิดหน้านี้ได้เลย') + '</p></section>' +
      '<div class="row"><button class="btn" type="button" id="again">กลับหน้าเริ่มต้น</button><a class="btn ghost" href="' + root + 'index.html">หน้าแรก</a></div>';
    $('#again').addEventListener('click', function () { location.reload(); });
    window.scrollTo(0, 0);
  }

  /* ---------- อ่านออกเสียง ---------- */
  function speak() {
    if (!('speechSynthesis' in window)) { HBT.toast('อุปกรณ์นี้อ่านออกเสียงไม่ได้', 'bad'); return; }
    var btn = $('#exSpeak');
    if (speechSynthesis.speaking) { speechSynthesis.cancel(); btn.classList.remove('on'); btn.textContent = '🔊 อ่านออกเสียง'; return; }
    var parts = [st.q.text || ''];
    st.q.choices.forEach(function (c) { parts.push('ตัวเลือก ' + String.fromCharCode(64 + c.pos) + '. ' + (c.text || '')); });
    var u = new SpeechSynthesisUtterance(parts.join('. '));
    u.lang = 'th-TH'; u.rate = 0.95;
    u.onend = function () { btn.classList.remove('on'); btn.textContent = '🔊 อ่านออกเสียง'; };
    btn.classList.add('on'); btn.textContent = '■ หยุดอ่าน';
    speechSynthesis.speak(u);
  }

  /* ---------- เฝ้าหน้าจอ + สัญญาณ + เฝ้าเวลาหมด ---------- */
  function beat(violation) {
    if (!st.att || st.finished) return Promise.resolve();
    return aCall('exam.heartbeat', violation ? { violation: true } : {}).then(onBeat, function () {});
  }
  function onBeat(r) {
    if (st.finished) return;
    if (r.finished) { if (!st.busy) finish(); return; }
    st.violations = r.violations;
    if (typeof r.secLeftTotal === 'number' && r.secLeftTotal > 0) st.deadlineAt = Date.now() + r.secLeftTotal * 1000;      // ปรับให้ตรงนาฬิกาเซิร์ฟเวอร์ กันเครื่องเพี้ยน
    if (r.forceSubmit) {
      clearInterval(st.tick);
      HBT.toast('ระบบส่งข้อสอบให้อัตโนมัติ', 'bad');
      if (r.result) { done(r.result); return; }
      finish(); return;
    }
    var el = $('#exWarn'); if (el && st.violations && !st.offline) el.innerHTML = violHtml();
  }
  function watch() {
    if (st.watching) return; st.watching = true;
    document.addEventListener('visibilitychange', function () {
      if (!st.att || st.finished) return;
      if (document.hidden) { if (st.lockTab && !st.busy) beat(true); }
      else Q.flush();
    });
    st.hbTimer = setInterval(function () {
      if (!st.att || st.finished || document.hidden || st.busy) return;
      if (Q.all().length) Q.flush(); else beat(false);
    }, 30000);
    window.addEventListener('online', function () { setOffline(false); Q.flush(); });
    window.addEventListener('offline', function () { setOffline(true); });
    window.addEventListener('beforeunload', function (e) {
      if (st.att && !st.finished && $('#exCard')) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  boot();
})();
