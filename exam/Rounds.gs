/**************************************************************
 * File: Rounds.gs  (HBT Exam API v0.5.0)
 * รอบฝึกทำ (PRACTISE) และรอบสอบ (TEST) — ยกจาก EEOS v2.1.0 (Operation.gs) เปลี่ยนที่เก็บ/สิทธิ์เป็นของ HBT
 *  - ข้อมูลรอบถูกแคช ลดการอ่านชีตในหน้าสอบ
 *  - ปิดรอบแล้วคำนวณสถิติเก็บไว้ใน stat_json
 *  - คะแนนเก็บเข้ารายวิชา: score_mode NONE | COMPLETE (ฝึกทำ: ทำครบได้เต็ม) | SCORE (ตามสัดส่วน) → ส่งเข้า Core ที่ Sync.gs
 **************************************************************/

var Op = {

  /** ---------- แคชข้อมูลรอบสอบ ---------- */
  cacheKey: function (id) { return 'SESM_' + id; },
  tokenKey: function (t) { return 'STOK_' + U.sha256(String(t)).substring(0, 24); },

  clean: function (row) {
    var s = JSON.parse(JSON.stringify(row));
    delete s._row;
    return s;
  },

  get: function (sessionId) {
    var hit = U.cGet(Op.cacheKey(sessionId));
    if (hit) { var p = U.parse(hit, null); if (p) return p; }
    var row = Db.byId('Rounds', sessionId);
    if (!row) return null;
    var s = Op.clean(row);
    U.cPut(Op.cacheKey(sessionId), U.json(s), 3600);
    return s;
  },

  byToken: function (token) {
    token = String(token || '');
    if (!/^[0-9a-f]{32}$/.test(token)) throw U.E('E_BAD_LINK');
    var k = Op.tokenKey(token);
    var id = U.cGet(k);
    if (id) {
      var s = Op.get(id);
      if (s && s.token === token && s.status !== 'DELETED') return s;
    }
    var list = Db.findRows('Rounds', 'token', token).filter(function (x) { return x.status !== 'DELETED'; });
    if (!list.length) throw U.E('E_BAD_LINK');
    var found = Op.clean(list[0]);
    U.cPut(k, found.session_id, 21600);
    U.cPut(Op.cacheKey(found.session_id), U.json(found), 3600);
    return found;
  },

  invalidate: function (sessionId, token) {
    U.cDel(Op.cacheKey(sessionId));
    if (token) U.cDel(Op.tokenKey(token));
  },

  /** ---------- สถานะที่แท้จริง ณ เวลาปัจจุบัน ---------- */
  effectiveStatus: function (s) {
    if (s.status === 'CLOSED') return 'CLOSED';
    var now = Date.now();
    var st = U.toDate(s.start_at), en = U.toDate(s.end_at);
    if (en && now > en.getTime()) return 'CLOSED';
    if (s.status === 'FORCE_OPEN') return 'OPEN';
    if (st && now < st.getTime()) return 'SCHEDULED';
    return 'OPEN';
  },

  toClient: function (s, stats, quizTitle) {
    return {
      sessionId: s.session_id, courseId: s.course_id, mode: s.mode, title: s.title,
      quizId: s.quiz_id || '', quizTitle: quizTitle || '',
      scoreMode: s.score_mode || 'NONE', scoreValue: U.num(s.score_value),
      startAt: s.start_at, endAt: s.end_at,
      secPerQuestion: U.num(s.sec_per_question), totalMinutes: U.num(s.total_minutes),
      allowBack: U.bool(s.allow_back), shuffleQ: U.bool(s.shuffle_q), shuffleC: U.bool(s.shuffle_c),
      lockTab: U.bool(s.lock_tab), maxViolations: U.num(s.max_violations),
      tts: U.bool(s.tts), resume: U.bool(s.resume), maxAttempts: U.num(s.max_attempts),
      status: s.status, effective: Op.effectiveStatus(s), token: s.token,
      createdAt: s.created_at, openedAt: s.opened_at, closedAt: s.closed_at,
      attempts: stats ? stats.attempts : 0, submitted: stats ? stats.submitted : 0,
      sync: { state: s.sync_state || '', at: s.sync_at || '', note: s.sync_note || '' }
    };
  },

  /**
   * คะแนนที่จะบันทึกเข้ารายวิชาของ attempt หนึ่ง ตามที่ตั้งไว้ในรอบ
   *   NONE = ไม่บันทึก · COMPLETE = (ฝึกทำ) ทำครบทุกข้อได้เต็ม score_value ไม่ครบได้ 0 · SCORE = ตามสัดส่วน
   */
  scoreOf: function (s, a) {
    var mode = s.score_mode || 'NONE', val = U.num(s.score_value);
    if (mode === 'NONE' || val <= 0) return { score: '', max: '' };
    if (mode === 'COMPLETE') {
      var answered = U.num(a.correct_count) + U.num(a.wrong_count);
      var total = answered + U.num(a.unanswered_count);
      return { score: (total > 0 && answered >= total) ? val : 0, max: val };
    }
    var mx = U.num(a.max_score);
    return { score: mx > 0 ? U.round2(U.num(a.total_score) / mx * val) : 0, max: val };
  },

  /** คิดคะแนนเก็บใหม่ให้ทุก attempt ที่จบแล้วของรอบนี้ (ใช้เมื่ออาจารย์แก้เกณฑ์) · เรียกใน lock */
  rescore: function (sessionId) {
    Db.flush();
    var s = Db.byId('Rounds', sessionId);
    if (!s) return 0;
    var patch = {}, n = 0;
    Db.findRows('Attempts', 'session_id', sessionId).forEach(function (a) {
      if (a.status === 'IN_PROGRESS') return;
      var r = Op.scoreOf(s, a);
      patch[a._row] = { course_score: r.score, course_max: r.max };
      n++;
    });
    Db.bulkPatch('Attempts', patch);
    Db.flush();
    return n;
  },

  /**
   * เขียนตาราง Answers (บันทึกรายข้อไว้ตรวจย้อนหลัง) ของ attempt ที่จบแล้วแต่ยังไม่ได้เขียน
   * ย้ายมาทำตอนปิดรอบ แทนตอนนักศึกษาแต่ละคนกดส่ง เพื่อไม่ให้ทุกคนต้องต่อคิวแย่ง lock เดียวกัน
   */
  materialize: function (sessionId) {
    return U.lock(function () {
      Db.flush();
      var todo = Db.findRows('Attempts', 'session_id', sessionId).filter(function (a) {
        return a.status !== 'IN_PROGRESS' && a.ans_written !== '1';
      });
      var rows = [], patch = {};
      todo.forEach(function (a) {
        var ans = U.parse(a.answers_json, {});
        Object.keys(ans).map(function (qid) { return [qid, ans[qid]]; })
          .sort(function (x, y) { return U.num(x[1].n) - U.num(y[1].n); })
          .forEach(function (pair) {
            var e = pair[1];
            rows.push({
              answer_id: U.uid('ANS'), attempt_id: a.attempt_id, session_id: a.session_id,
              course_id: a.course_id, std_id: a.std_id, question_id: pair[0],
              q_no: U.num(e.n), selected_idx: U.num(e.i), is_correct: U.bstr(e.c),
              score_got: U.num(e.g), score_max: U.num(e.m),
              time_spent_sec: U.num(e.t), answered_at: e.at || U.nowIso()
            });
          });
        patch[a._row] = { ans_written: '1' };
      });
      Db.insertMany('Answers', rows);
      Db.bulkPatch('Attempts', patch);
      Db.flush();
      return todo.length;
    }, 120000);
  },

  /**
   * ปิดรอบ: ตั้งสถานะปิด → ส่งฉบับที่ค้างทั้งหมดเป็นชุดเดียว → เขียน Answers → สรุปสถิติ
   * ทำซ้ำได้ (ถ้าหมดเวลากลางทาง กดปิดอีกครั้งจะทำส่วนที่เหลือต่อ) · เรียกใน lock
   */
  close: function (sessionId, budgetMs) {
    var t0 = Date.now();
    Db.flush();
    var s = Db.byId('Rounds', sessionId);
    if (!s) throw U.E('E_NOT_FOUND');
    if (s.status !== 'CLOSED') {
      Db.update('Rounds', sessionId, { status: 'CLOSED', closed_at: U.nowIso() });
      Op.invalidate(sessionId, s.token);        // ตั้งแต่นี้ Runner.deadline จะอิง closed_at
    }
    var left = Db.findRows('Attempts', 'session_id', sessionId).filter(function (a) { return a.status === 'IN_PROGRESS'; });
    Runner.finalizeBatch(left, 'EXPIRED', Op.clean(Db.byId('Rounds', sessionId)));
    var remain = Db.findRows('Attempts', 'session_id', sessionId).filter(function (a) { return a.status === 'IN_PROGRESS'; }).length;
    if (Date.now() - t0 < (budgetMs || 150000)) Op.materialize(sessionId);
    Db.flush();
    Db.update('Rounds', sessionId, { stat_json: U.clip(U.json(Op.computeStats(sessionId))) });
    Op.invalidate(sessionId, s.token);
    return { remaining: remain };
  },

  /** รอบของวิชา (หรือทุกวิชา ถ้าไม่ระบุ) ที่เลยเวลาแล้วแต่ยังไม่ถูกปิด → ปิดให้ · คืนรหัสรอบที่ปิด (ผู้เรียกไปซิงก์คะแนนต่อนอก lock) */
  autoCloseEnded: function (courseId, maxN) {
    var t0 = Date.now(), closed = [];
    var rows = courseId ? Db.findRows('Rounds', 'course_id', courseId) : Db.all('Rounds');
    rows.filter(function (x) {
      return x.status !== 'DELETED' && x.status !== 'CLOSED' && Op.effectiveStatus(x) === 'CLOSED';
    }).forEach(function (x) {
      if (closed.length >= (maxN || 20) || Date.now() - t0 > 120000) return;
      try { Op.close(x.session_id, 100000); closed.push(x.session_id); } catch (e) { Audit.log('system', 'round.autoCloseFail', x.session_id, String(e.message || e)); }
    });
    Db.flush();
    return closed;
  },

  /** สถิติของรอบ (ใช้ตอนปิดรอบ และหน้ารายงาน) */
  computeStats: function (sessionId) {
    var atts = Db.findRows('Attempts', 'session_id', sessionId);
    var done = atts.filter(function (a) { return a.status !== 'IN_PROGRESS'; });
    var pcts = done.map(function (a) { return U.num(a.total_score) / (U.num(a.max_score) || 1) * 100; })
      .sort(function (x, y) { return x - y; });
    var sum = pcts.reduce(function (s, v) { return s + v; }, 0);
    var perQ = {};
    done.forEach(function (a) {
      var ans = U.parse(a.answers_json, {});
      Object.keys(ans).forEach(function (qid) {
        var e = perQ[qid] || (perQ[qid] = { n: 0, ok: 0 });
        e.n++;
        if (ans[qid].c) e.ok++;
      });
    });
    function r1(v) { return Math.round(v * 10) / 10; }
    return {
      attempts: atts.length, submitted: done.length,
      avgPct: pcts.length ? r1(sum / pcts.length) : 0,
      minPct: pcts.length ? r1(pcts[0]) : 0,
      maxPct: pcts.length ? r1(pcts[pcts.length - 1]) : 0,
      medianPct: pcts.length ? r1(pcts.length % 2 ? pcts[(pcts.length - 1) / 2] : (pcts[pcts.length / 2 - 1] + pcts[pcts.length / 2]) / 2) : 0,
      hist: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (i) {
        var lo = i * 10, hi = (i + 1) * 10;
        return pcts.filter(function (v) { return i === 9 ? (v >= lo && v <= 100) : (v >= lo && v < hi); }).length;
      }),
      perQ: perQ, at: U.nowIso()
    };
  }
};

var Rounds = {

  /** ตรวจชุดค่าตั้งคะแนนเก็บ → { mode, value } */
  scoreSetting: function (mode, sm, sv) {
    sm = String(sm || 'NONE').toUpperCase();
    var ok = (mode === 'TEST') ? ['NONE', 'SCORE'] : ['NONE', 'COMPLETE', 'SCORE'];
    if (ok.indexOf(sm) < 0) throw U.E('E_SCORE_MODE');
    sv = U.num(sv, 0);
    if (sm !== 'NONE' && (!(sv > 0) || sv > 1000)) throw U.E('E_SCORE_VALUE');
    return { mode: sm, value: sm === 'NONE' ? 0 : U.round2(sv) };
  },

  /** หน้านักศึกษา (ไม่ล็อกอิน): ข้อมูลรอบจากลิงก์ — ไม่มีอีเมลอาจารย์/ข้อสอบ */
  resolve: function (a) {
    var s = Op.byToken(a.t);
    var c = Core.course(s.course_id, false);
    if (!c.current) throw U.E('E_BAD_LINK');
    var quiz = s.quiz_id ? Db.byId('Quizzes', s.quiz_id) : null;
    return {
      course: c.course,
      session: {
        mode: s.mode, title: s.title, quizTitle: quiz ? quiz.title : '',
        startAt: s.start_at, endAt: s.end_at,
        secPerQuestion: U.num(s.sec_per_question), totalMinutes: U.num(s.total_minutes),
        allowBack: U.bool(s.allow_back), lockTab: U.bool(s.lock_tab), maxViolations: U.num(s.max_violations),
        tts: U.bool(s.tts), resume: U.bool(s.resume), maxAttempts: U.num(s.max_attempts),
        scoreMode: s.score_mode || 'NONE', scoreValue: U.num(s.score_value),
        status: Op.effectiveStatus(s)
      },
      questionCount: quiz ? U.num(quiz.question_count) : 0,
      serverTime: U.nowIso()
    };
  },

  /** รายการรอบของวิชา · รอบที่เลยเวลาจะถูกปิด (และส่งคะแนน) ให้ก่อนแสดง */
  list: function (actor, a) {
    var c = Gate.course(actor, a.courseId);
    var closed = U.lock(function () { Db.flush(); return Op.autoCloseEnded(a.courseId, 10); }, 60000);
    closed.forEach(function (id) { Sync.push(id); });
    var titles = {};
    Quiz.live(a.courseId).forEach(function (z) { titles[z.quiz_id] = z.title; });
    var attempts = Db.findRows('Attempts', 'course_id', a.courseId);
    var rounds = Db.findRows('Rounds', 'course_id', a.courseId).filter(function (s) { return s.status !== 'DELETED'; })
      .map(function (s) {
        var mine = attempts.filter(function (x) { return x.session_id === s.session_id; });
        return Op.toClient(s, { attempts: mine.length, submitted: mine.filter(function (x) { return x.status !== 'IN_PROGRESS'; }).length }, titles[s.quiz_id]);
      })
      .sort(function (x, y) { return x.createdAt < y.createdAt ? 1 : -1; });
    return { course: c.course, rounds: rounds };
  },

  create: function (actor, a) {
    var c = Gate.course(actor, a.courseId);
    var mode = (a.mode === 'TEST') ? 'TEST' : 'PRACTISE';
    var quiz = Gate.quiz(actor, a.quizId);
    if (quiz.course_id !== a.courseId) throw U.E('E_QUIZ_REQUIRED');
    if (!U.num(quiz.question_count)) { Quiz.recount(quiz.quiz_id); quiz = Db.byId('Quizzes', quiz.quiz_id); }
    if (!U.num(quiz.question_count)) throw U.E('E_NO_QUESTIONS');
    if (!(Core.course(a.courseId, true).students || []).length) throw U.E('E_NO_STUDENTS');

    var start = U.toDate(a.startAt), end = U.toDate(a.endAt);
    if (!start || !end) throw U.E('E_TIME_REQUIRED');
    if (end.getTime() <= start.getTime()) throw U.E('E_TIME_RANGE');
    var sc = Rounds.scoreSetting(mode, a.scoreMode, a.scoreValue);
    var allowBack = (mode === 'TEST') ? U.bool(a.allowBack) : false;

    var rec = {
      session_id: U.uid('RND'), course_id: a.courseId, quiz_id: quiz.quiz_id, mode: mode,
      title: U.clip(String(a.title || '').trim() || (mode === 'TEST' ? 'สอบ' : 'ฝึกทำ'), 200),
      start_at: U.fmt(start), end_at: U.fmt(end),
      sec_per_question: allowBack ? 0 : Math.max(0, Math.floor(U.num(a.secPerQuestion, 0))),
      total_minutes: allowBack ? Math.max(1, Math.floor(U.num(a.totalMinutes, 60))) : Math.max(0, Math.floor(U.num(a.totalMinutes, 0))),
      allow_back: U.bstr(allowBack), shuffle_q: U.bstr(a.shuffleQ),
      shuffle_c: U.bstr(a.shuffleC === undefined ? true : a.shuffleC),          // ไม่สลับ = ข้อ ก. เป็นคำตอบถูกเสมอ จึงสลับเป็นค่าเริ่มต้น
      lock_tab: U.bstr(a.lockTab), max_violations: Math.max(0, Math.floor(U.num(a.maxViolations, 0))),
      tts: U.bstr(a.tts), resume: U.bstr(a.resume === undefined ? true : a.resume),
      max_attempts: (mode === 'TEST') ? Math.max(1, Math.floor(U.num(a.maxAttempts, 1))) : Math.max(0, Math.floor(U.num(a.maxAttempts, 0))),
      status: 'SCHEDULED', token: Utilities.getUuid().replace(/-/g, ''),
      created_at: U.nowIso(), opened_at: '', closed_at: '', stat_json: '',
      score_mode: sc.mode, score_value: sc.value, sync_state: '', sync_at: '', sync_note: ''
    };
    Db.insert('Rounds', rec);
    Audit.log(actor.email, 'round.create', rec.session_id, mode + ' ' + quiz.title + ' score=' + sc.mode + ':' + sc.value);
    return Op.toClient(Op.clean(rec), { attempts: 0, submitted: 0 }, quiz.title);
  },

  /** OPEN (เปิดทันที) | CLOSE (ปิดรอบ ส่งฉบับค้างทั้งหมด) | RESET (กลับไปรอเวลา) — ส่วนที่แก้ข้อมูลทำใน lock, ส่งคะแนนเข้า Core ทำนอก lock */
  setStatus: function (actor, a) {
    var s0 = Gate.round(actor, a.sessionId), action = String(a.action || '');
    if (['OPEN', 'CLOSE', 'RESET'].indexOf(action) < 0) throw U.E('E_REQUIRED', { field: 'action' });
    var out = U.lock(function () {
      Db.flush();
      var s = Db.byId('Rounds', s0.session_id);
      if (!s || s.status === 'DELETED') throw U.E('E_NOT_FOUND');
      var remaining = 0;
      if (action === 'OPEN') {
        var patch = { status: 'FORCE_OPEN', opened_at: U.nowIso(), closed_at: '' };
        var en = U.toDate(s.end_at);
        if (!en || en.getTime() <= Date.now()) patch.end_at = U.fmt(new Date(Date.now() + 3 * 3600 * 1000));
        Db.update('Rounds', s.session_id, patch);
      } else if (action === 'CLOSE') {
        remaining = Op.close(s.session_id, 150000).remaining;
      } else {
        Db.update('Rounds', s.session_id, { status: 'SCHEDULED', opened_at: '', closed_at: '' });
      }
      Op.invalidate(s.session_id, s.token);
      Audit.log(actor.email, 'round.' + action.toLowerCase(), s.session_id, remaining ? 'remaining=' + remaining : '');
      Db.flush();
      var o = Op.toClient(Op.clean(Db.byId('Rounds', s.session_id)), null);
      o.remaining = remaining;
      return o;
    }, 120000);
    if (action === 'CLOSE') out.sync = Sync.push(s0.session_id);
    return out;
  },

  update: function (actor, a) {
    var s0 = Gate.round(actor, a.sessionId);
    var rescore = false;
    U.lock(function () {
      Db.flush();
      var s = Db.byId('Rounds', s0.session_id);
      if (!s || s.status === 'DELETED') throw U.E('E_NOT_FOUND');
      var patch = {};
      if (a.title !== undefined) patch.title = U.clip(String(a.title).trim() || s.title, 200);
      if (a.startAt) { var d1 = U.toDate(a.startAt); if (!d1) throw U.E('E_TIME_REQUIRED'); patch.start_at = U.fmt(d1); }
      if (a.endAt) { var d2 = U.toDate(a.endAt); if (!d2) throw U.E('E_TIME_REQUIRED'); patch.end_at = U.fmt(d2); }
      if (a.secPerQuestion !== undefined) patch.sec_per_question = Math.max(0, Math.floor(U.num(a.secPerQuestion, 0)));
      if (a.totalMinutes !== undefined) patch.total_minutes = Math.max(0, Math.floor(U.num(a.totalMinutes, 0)));
      if (a.maxAttempts !== undefined) patch.max_attempts = Math.max(0, Math.floor(U.num(a.maxAttempts, 0)));
      if (a.scoreMode !== undefined || a.scoreValue !== undefined) {
        var sc = Rounds.scoreSetting(s.mode,
          a.scoreMode !== undefined ? a.scoreMode : s.score_mode,
          a.scoreValue !== undefined ? a.scoreValue : s.score_value);
        patch.score_mode = sc.mode; patch.score_value = sc.value;
        rescore = (sc.mode !== (s.score_mode || 'NONE')) || sc.value !== U.num(s.score_value);
      }
      var st = U.toDate(patch.start_at || s.start_at), en = U.toDate(patch.end_at || s.end_at);
      if (st && en && en.getTime() <= st.getTime()) throw U.E('E_TIME_RANGE');
      Db.update('Rounds', s.session_id, patch);
      Op.invalidate(s.session_id, s.token);
      if (rescore) Op.rescore(s.session_id);
      Audit.log(actor.email, 'round.update', s.session_id, Object.keys(patch).join(','));
    });
    var res = { updated: true };
    if (rescore) res.sync = Sync.push(s0.session_id);
    var fresh = Db.byId('Rounds', s0.session_id);
    res.round = Op.toClient(Op.clean(fresh), null);
    return res;
  },

  remove: function (actor, a) {
    var s0 = Gate.round(actor, a.sessionId);
    U.lock(function () {
      Db.flush();
      var s = Db.byId('Rounds', s0.session_id);
      if (!s || s.status === 'DELETED') throw U.E('E_NOT_FOUND');
      Db.update('Rounds', s.session_id, { status: 'DELETED', closed_at: U.nowIso() });
      Op.invalidate(s.session_id, s.token);
      Audit.log(actor.email, 'round.delete', s.session_id, '');
    });
    var synced = Sync.remove(s0.course_id, s0.session_id);
    return { deleted: true, scoresRemoved: synced };
  },

  /** ติดตามสด — รวมข้อมูลในชีตกับสัญญาณล่าสุดที่ยังอยู่ในแคช */
  monitor: function (actor, a) {
    var s = Gate.round(actor, a.sessionId);
    var eff = Op.effectiveStatus(s);
    var rows = Db.findRows('Attempts', 'session_id', s.session_id).map(function (x) {
      var hb = U.parse(U.cGet('HB_' + x.attempt_id), null);
      return {
        attemptId: x.attempt_id, stdId: x.std_id, name: x.student_name, status: x.status,
        startedAt: x.started_at, lastSeenAt: (hb && hb.at) ? hb.at : x.last_seen_at, submittedAt: x.submitted_at,
        curIndex: hb && hb.i !== undefined ? hb.i : U.num(x.cur_index),
        answered: Object.keys(U.parse(x.answers_json, {})).length,
        totalScore: U.num(x.total_score), maxScore: U.num(x.max_score),
        violations: hb && hb.v !== undefined ? hb.v : U.num(x.violations)
      };
    }).sort(function (x, y) { return x.stdId < y.stdId ? -1 : (x.stdId > y.stdId ? 1 : 0); });
    var qn = Quiz.live(s.course_id).filter(function (z) { return z.quiz_id === s.quiz_id; })[0];
    return { effective: eff, status: s.status, questionCount: qn ? U.num(qn.question_count) : 0, serverTime: U.nowIso(), rows: rows };
  }
};
