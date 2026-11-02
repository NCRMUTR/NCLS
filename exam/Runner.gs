/**************************************************************
 * File: Runner.gs  (HBT Exam API v0.5.0) — ฝั่งนักศึกษา ทำข้อสอบ (ยกจาก EEOS v2.1.0 Student.gs)
 *
 * หัวใจ:
 *  - คำตอบระหว่างทำถูกเก็บไว้ใน "แถวของนักศึกษาคนนั้นคนเดียว" (answers_json) แล้วแตกลงตาราง Answers ตอนปิดรอบ
 *  - แต่ละคนแตะคนละแถว จึงไม่ต้องใช้ lock รวมระหว่างทำข้อสอบ (มี lock เฉพาะตอนเริ่มทำ exam.start)
 *  - ชุดข้อสอบอ่านจากแคช · ฝั่งนักศึกษาไม่เคยได้เฉลย (ตัวเลือกที่ส่งไปใช้ "ตำแหน่งบนจอ" ไม่ใช่หมายเลขจริง)
 *  - ตรวจเวลาต่อข้อ/ทั้งฉบับที่ server เสมอ
 * ตัวตน: เริ่มทำด้วย token นักศึกษา (s จาก Core) → ได้ token ผู้ทำข้อสอบ (a) ใช้ตลอดการทำ
 **************************************************************/

var Runner = {

  GRACE_MS: 15000,      // เผื่อเวลาเน็ตช้าหลังหมดเวลา ก่อนจะไม่รับคำตอบแล้ว

  /** ---------- เตรียมชุดข้อสอบของ attempt ---------- */
  buildPaper: function (session) {
    var paper = Paper.get(session.quiz_id);
    if (!paper.length) throw U.E('E_NO_QUESTIONS');
    var order = paper.map(function (q) { return q.question_id; });
    if (U.bool(session.shuffle_q)) order = U.shuffle(order);
    var cmap = {}, maxScore = 0;
    paper.forEach(function (q) {
      var idxs = q.choices.map(function (c) { return c.c_idx; });
      cmap[q.question_id] = U.bool(session.shuffle_c) ? U.shuffle(idxs) : idxs;
      maxScore += q.score;
    });
    return { order: order, cmap: cmap, maxScore: maxScore };
  },

  /** อ่าน attempt จากแถวจริง (จำเลขแถวไว้ในแคช ไม่ต้องค้นทุกครั้ง · ตรวจรหัสในแถวซ้ำเสมอ) */
  attempt: function (attemptId) {
    var hint = U.num(U.cGet('ARW_' + attemptId), 0);
    if (hint > 1) {
      try {
        var o = Db.readRow('Attempts', hint);
        if (o.attempt_id === attemptId) { Db.hintRow('Attempts', attemptId, hint); return o; }
      } catch (e) { /* แถวเกินชีต = แคชเก่า ค้นใหม่ */ }
    }
    var row = Db.rowById('Attempts', attemptId);
    if (!row) throw U.E('E_NOT_FOUND');
    U.cPut('ARW_' + attemptId, String(row), 21600);
    return Db.readRow('Attempts', row);
  },

  /** attempt ของผู้ถือ token นี้ (ต้องเป็นของคนนี้ในวิชานี้จริง) */
  mine: function (actor) {
    var a = Runner.attempt(actor.attemptId);
    if (a.std_id !== actor.stdId || a.course_id !== actor.courseId) throw U.E('E_AUTH');
    return a;
  },

  /** ตำแหน่งที่นักศึกษากด (1..n บนจอ) → หมายเลขตัวเลือกจริงในคลังข้อสอบ (ฝั่งนักศึกษาไม่เคยรู้หมายเลขจริง) */
  posToIdx: function (state, qid, pos, nChoices) {
    var order = (state.cmap && state.cmap[qid]) || null;
    var p = U.num(pos, 0);
    if (p < 1) return 0;
    if (!order) return p <= nChoices ? p : 0;
    return (p <= order.length) ? U.num(order[p - 1], 0) : 0;
  },
  correctPos: function (state, qid) {
    var order = (state.cmap && state.cmap[qid]) || null;
    return order ? order.indexOf(1) + 1 : 1;
  },
  idxToPos: function (state, qid, idx) {
    var order = (state.cmap && state.cmap[qid]) || null;
    var i = U.num(idx, 0);
    if (i < 1) return 0;
    return order ? order.indexOf(i) + 1 : i;
  },

  shownChoices: function (order, byIdx) {
    var out = [];
    order.forEach(function (ci) {
      var c = byIdx[ci];
      if (c) out.push({ pos: out.length + 1, type: c.c_type, text: c.c_text, imageUrl: c.c_image_url });
    });
    return out;
  },

  flagMap: function (state, answers) {
    return (state.order || []).map(function (qid) { return (answers && answers[qid]) ? 1 : 0; });
  },

  /** ชุดข้อสอบทั้งฉบับของ attempt นี้ — ไม่มีเฉลยหรือคำอธิบายติดไปเด็ดขาด */
  clientPaper: function (state, pmap, answers) {
    return state.order.map(function (qid, index) {
      var q = pmap[qid];
      if (!q) return null;
      var byIdx = {};
      q.choices.forEach(function (c) { byIdx[c.c_idx] = c; });
      var order = state.cmap[qid] || q.choices.map(function (c) { return c.c_idx; });
      return {
        index: index, questionId: qid, qNo: q.q_no, type: q.q_type, text: q.q_text, imageUrl: q.q_image_url,
        score: q.score, choices: Runner.shownChoices(order, byIdx),
        selected: (answers && answers[qid]) ? Runner.idxToPos(state, qid, answers[qid].i) : null
      };
    }).filter(function (x) { return !!x; });
  },

  deadline: function (a, s) {
    var ends = [];
    var sEnd = U.toDate(s.end_at);
    if (sEnd) ends.push(sEnd.getTime());
    if (s.status === 'CLOSED' && s.closed_at) {     // ปิดรอบด้วยมือก่อนเวลา → ทุกคนหมดเวลา ณ ตอนปิด
      var cl = U.toDate(s.closed_at);
      if (cl) ends.push(cl.getTime());
    }
    var tm = U.num(s.total_minutes, 0);
    if (tm > 0) {
      var st = U.toDate(a.started_at);
      if (st) ends.push(st.getTime() + tm * 60000);
    }
    return ends.length ? Math.min.apply(null, ends) : 0;
  },

  pastDeadline: function (a, s) {
    var dl = Runner.deadline(a, s);
    return !!(dl && Date.now() > dl + Runner.GRACE_MS);
  },

  /** สัญญาณล่าสุดของนักศึกษา เก็บในแคชเท่านั้น ไม่แตะชีต */
  beat: function (attemptId, patch) {
    var cur = U.parse(U.cGet('HB_' + attemptId), {}) || {};
    Object.keys(patch || {}).forEach(function (k) { cur[k] = patch[k]; });
    cur.at = U.nowIso();
    U.cPut('HB_' + attemptId, U.json(cur), 21600);
    return cur;
  },

  /** คิดคะแนนของ attempt จาก answers_json (ไม่แตะชีตอื่น) */
  tally: function (a, status, session, viol, nowMs) {
    var state = U.parse(a.state_json, { order: [] }) || { order: [] };
    var ans = U.parse(a.answers_json, {}) || {};
    var total = 0, correct = 0, wrong = 0, answered = 0;
    Object.keys(ans).forEach(function (qid) {
      var e = ans[qid];
      answered++;
      total += U.num(e.g);
      if (e.c) correct++; else wrong++;
    });
    var started = U.toDate(a.started_at);
    var now = nowMs || Date.now();
    var base = {
      total_score: total, max_score: a.max_score, correct_count: correct, wrong_count: wrong,
      unanswered_count: Math.max(0, (state.order || []).length - answered)
    };
    var cs = Op.scoreOf(session || {}, base);
    var stamp = U.fmt(new Date(now));
    return {
      status: status || 'SUBMITTED', submitted_at: stamp, last_seen_at: stamp,
      total_score: total, correct_count: correct, wrong_count: wrong, unanswered_count: base.unanswered_count,
      duration_sec: started ? Math.round((now - started.getTime()) / 1000) : 0,
      violations: U.num(viol, U.num(a.violations)), cur_index: U.num(state.idx),
      course_score: cs.score, course_max: cs.max
    };
  },

  /** ปิดงานและคิดคะแนนของนักศึกษาหนึ่งคน · เขียนเฉพาะแถวของ attempt นี้ (ไม่ใช้ lock รวม) · ทำซ้ำได้ปลอดภัย */
  finalize: function (attemptId, status) {
    var a = Runner.attempt(attemptId);
    if (a.status === 'SUBMITTED' || a.status === 'EXPIRED') return Runner.result(a);
    var s = Op.get(a.session_id);
    var hb = U.parse(U.cGet('HB_' + attemptId), {}) || {};
    Db.update('Attempts', attemptId, Runner.tally(a, status, s, hb.v));
    U.cDel('HB_' + attemptId);
    Db.flush();
    return Runner.result(Runner.attempt(attemptId));
  },

  /** ปิดฉบับที่ค้างหลายคนพร้อมกัน — เขียนแบบเป็นคอลัมน์ ใช้จำนวนคำสั่งคงที่ไม่ว่ากี่คน (ใช้ตอนปิดรอบ) */
  finalizeBatch: function (attempts, status, session) {
    if (!attempts || !attempts.length) return 0;
    var cache = CacheService.getScriptCache(), hb = {};
    for (var i = 0; i < attempts.length; i += 100) {
      var keys = attempts.slice(i, i + 100).map(function (a) { return 'HB_' + a.attempt_id; });
      try {
        var got = cache.getAll(keys);
        Object.keys(got).forEach(function (k) { hb[k] = U.parse(got[k], {}) || {}; });
      } catch (e) {}
    }
    var s = session || Op.get(attempts[0].session_id);
    var now = Date.now(), patch = {};
    attempts.forEach(function (a) {
      var h = hb['HB_' + a.attempt_id] || {};
      patch[a._row] = Runner.tally(a, status, s, h.v, now);
    });
    Db.bulkPatch('Attempts', patch);
    try { cache.removeAll(attempts.map(function (a) { return 'HB_' + a.attempt_id; }).slice(0, 1000)); } catch (e) {}
    Db.flush();
    return attempts.length;
  },

  /** สรุปผลจากแถวของ attempt เอง ไม่ต้องอ่านตาราง Answers */
  result: function (a) {
    var ans = U.parse(a.answers_json, {});
    var items = Object.keys(ans).map(function (qid) {
      var e = ans[qid];
      return { qNo: U.num(e.n), correct: !!e.c, got: U.num(e.g), max: U.num(e.m) };
    }).sort(function (x, y) { return x.qNo - y.qNo; });
    var cs = (a.course_score === '' || a.course_score === undefined) ? null : U.num(a.course_score);
    return {
      attemptId: a.attempt_id, mode: a.mode, stdId: a.std_id, name: a.student_name,
      totalScore: U.num(a.total_score), maxScore: U.num(a.max_score),
      correct: U.num(a.correct_count), wrong: U.num(a.wrong_count), unanswered: U.num(a.unanswered_count),
      durationSec: U.num(a.duration_sec), status: a.status,
      courseScore: cs, courseMax: cs === null ? null : U.num(a.course_max),
      items: items
    };
  },

  /** ตรวจ/ให้คะแนนข้อเดียว (ใช้ร่วมกันโดย answer และ advance) */
  grade: function (a, s, state, pmap, questionId, selectedPos) {
    var q = pmap[questionId];
    if (!q) throw U.E('E_NOT_FOUND');
    // ตรวจเวลาต่อข้อฝั่ง server กันการแก้นาฬิกาที่เครื่องตัวเอง
    var secPerQ = U.num(s.sec_per_question, 0);
    var qStart = U.toDate(state.qStart);
    var spent = qStart ? Math.floor((Date.now() - qStart.getTime()) / 1000) : 0;
    var timedOut = secPerQ > 0 && spent > secPerQ + 5;
    var none = (selectedPos === null || selectedPos === undefined || timedOut);
    var sel = none ? 0 : Runner.posToIdx(state, questionId, selectedPos, q.choices.length);
    var isCorrect = sel === 1;                       // หมายเลขจริง 1 คือคำตอบที่ถูกเสมอ
    var got = isCorrect ? q.score : 0;
    var ans = U.parse(a.answers_json, {}) || {};
    ans[questionId] = { i: sel, c: isCorrect ? 1 : 0, g: got, m: q.score, t: spent, n: q.q_no, at: U.nowIso() };
    return { q: q, ans: ans, sel: sel, isCorrect: isCorrect, got: got, spent: spent, timedOut: timedOut };
  },

  /** ---------- API ---------- */

  /** เริ่มทำ / กลับมาทำต่อ (token นักศึกษา s) → token ผู้ทำข้อสอบ a · ทำใน lock (กันสร้าง attempt ซ้อน) */
  start: function (actor, a) {
    var s = Op.byToken(a.t);
    var eff = Op.effectiveStatus(s);
    if (eff === 'SCHEDULED') throw U.E('E_SESSION_NOT_OPEN', { start: s.start_at });
    if (eff === 'CLOSED') throw U.E('E_SESSION_CLOSED');
    if (s.course_id !== actor.courseId) throw U.E('E_WRONG_COURSE');
    var name = Core.studentName(s.course_id, actor.stdId);          // ถาม Core นอก lock
    if (!name) throw U.E('E_STUDENT_NOT_FOUND');

    return U.lock(function () {
      Db.flush();
      var mine = Db.findRows('Attempts', 'std_id', actor.stdId).filter(function (x) { return x.session_id === s.session_id; });
      var open = mine.filter(function (x) { return x.status === 'IN_PROGRESS'; })[0];
      var attemptId;
      if (open && U.bool(s.resume)) {
        attemptId = open.attempt_id;
      } else {
        if (open) { Runner.finalize(open.attempt_id, 'EXPIRED'); Db.flush(); }
        // ฉบับที่เพิ่งถูกปิด (EXPIRED) เพราะรอบนี้ไม่ให้ทำต่อ ก็นับเป็นหนึ่งครั้ง (EEOS เดิมไม่นับ → กดเข้าใหม่ได้ไม่จำกัด)
        var done = mine.filter(function (x) { return x.status !== 'IN_PROGRESS'; }).length + (open ? 1 : 0);
        var maxA = U.num(s.max_attempts, 0);
        if (maxA > 0 && done >= maxA) throw U.E('E_ATTEMPT_LIMIT', { max: maxA });
        var en = U.toDate(s.end_at);
        if (en && en.getTime() - Date.now() < 60000) throw U.E('E_TOO_LATE');       // เหลือเวลาน้อยกว่า 1 นาที ไม่ควรให้เริ่ม
        var paper = Runner.buildPaper(s);
        attemptId = U.uid('ATT');
        var rec = Db.insert('Attempts', {
          attempt_id: attemptId, session_id: s.session_id, course_id: s.course_id, mode: s.mode,
          std_id: actor.stdId, student_name: name, status: 'IN_PROGRESS',
          started_at: U.nowIso(), last_seen_at: U.nowIso(), submitted_at: '',
          cur_index: 0, total_score: 0, max_score: paper.maxScore, correct_count: 0, wrong_count: 0, unanswered_count: 0,
          duration_sec: 0, violations: 0,
          state_json: U.json({ order: paper.order, cmap: paper.cmap, idx: 0, qStart: U.nowIso() }),
          answers_json: '{}', course_score: '', course_max: '', ans_written: ''
        });
        if (rec._row) U.cPut('ARW_' + attemptId, String(rec._row), 21600);
        Audit.log(actor.stdId, 'exam.start', s.session_id, s.mode);
      }
      var en2 = U.toDate(s.end_at);
      var ttl = en2 ? Math.floor((en2.getTime() - Date.now()) / 1000) + APP.ATTEMPT_TTL_PAD_SEC : APP.ATTEMPT_TTL_MIN_SEC;
      ttl = Math.min(APP.ATTEMPT_TTL_MAX_SEC, Math.max(APP.ATTEMPT_TTL_MIN_SEC, ttl));
      return {
        attemptId: attemptId, resumed: !!(open && U.bool(s.resume)), name: name, stdId: actor.stdId,
        attemptToken: Auth.mint('a', { a: attemptId, s: actor.stdId, c: s.course_id }, ttl),
        expiresAt: Date.now() + ttl * 1000
      };
    }, 45000);
  },

  /** ผลที่ผ่านมาของนักศึกษาในรอบนี้ (ไม่มีรายข้อ) */
  my: function (actor, a) {
    var s = Op.byToken(a.t);
    if (s.course_id !== actor.courseId) throw U.E('E_WRONG_COURSE');
    var mine = Db.findRows('Attempts', 'std_id', actor.stdId).filter(function (x) { return x.session_id === s.session_id; })
      .sort(function (x, y) { return x.started_at < y.started_at ? -1 : 1; });
    var done = mine.filter(function (x) { return x.status !== 'IN_PROGRESS'; });
    var open = mine.filter(function (x) { return x.status === 'IN_PROGRESS'; })[0];
    var maxA = U.num(s.max_attempts, 0);
    return {
      status: Op.effectiveStatus(s), maxAttempts: maxA, inProgress: !!open, canResume: !!open && U.bool(s.resume),
      remaining: maxA > 0 ? Math.max(0, maxA - done.length) : null,
      attempts: done.map(function (x) {
        var r = Runner.result(x); delete r.items;
        r.startedAt = x.started_at; r.submittedAt = x.submitted_at;
        return r;
      })
    };
  },

  /** ข้อสอบทั้งฉบับให้ครั้งเดียว (ไม่มีเฉลย) · เลื่อนข้อไปมาที่เครื่องนักศึกษาได้ทันที */
  paper: function (actor) {
    var a = Runner.mine(actor);
    var s = Op.get(a.session_id);
    if (!s) throw U.E('E_NOT_FOUND');
    if (a.status !== 'IN_PROGRESS') return { finished: true, result: Runner.result(a) };
    var dl = Runner.deadline(a, s);
    if (dl && Date.now() > dl) return { finished: true, result: Runner.finalize(a.attempt_id, 'SUBMITTED') };
    var state = U.parse(a.state_json, null);
    if (!state || !state.order) throw U.E('E_CORRUPT');
    var ans = U.parse(a.answers_json, {});
    var pmap = Paper.map(s.quiz_id);
    var hb = Runner.beat(a.attempt_id, { i: U.num(state.idx, 0), dl: dl || 0, sid: a.session_id });
    return {
      finished: false, mode: a.mode, allowBack: U.bool(s.allow_back), tts: U.bool(s.tts),
      lockTab: U.bool(s.lock_tab), maxViolations: U.num(s.max_violations), violations: U.num(hb.v, 0),
      secPerQuestion: U.num(s.sec_per_question), title: s.title,
      resumeIndex: Math.min(Math.max(0, U.num(state.idx, 0)), state.order.length - 1),
      questions: Runner.clientPaper(state, pmap, ans), answeredMap: Runner.flagMap(state, ans),
      qStartAt: state.qStart, deadlineAt: dl || null, serverTime: U.nowIso()
    };
  },

  /** ส่งคำตอบ 1 ข้อ · โหมดฝึกทำได้เฉลยและคำอธิบายกลับไปทันที */
  answer: function (actor, a) {
    var at = Runner.mine(actor);
    if (at.status !== 'IN_PROGRESS') throw U.E('E_ATTEMPT_DONE');
    var s = Op.get(at.session_id);
    if (Runner.pastDeadline(at, s)) return { finished: true, result: Runner.finalize(at.attempt_id, 'SUBMITTED') };
    var state = U.parse(at.state_json, null);
    if (!state) throw U.E('E_CORRUPT');
    var g = Runner.grade(at, s, state, Paper.map(s.quiz_id), String(a.questionId || ''), a.pos);
    state.qStart = U.nowIso();
    var hb = U.parse(U.cGet('HB_' + at.attempt_id), {}) || {};
    Db.update('Attempts', at.attempt_id, {
      answers_json: U.clip(U.json(g.ans)), state_json: U.clip(U.json(state)),
      last_seen_at: U.nowIso(), cur_index: U.num(state.idx), violations: U.num(hb.v, U.num(at.violations))
    });
    var res = { saved: true, timedOut: g.timedOut, answeredMap: Runner.flagMap(state, g.ans) };
    if (s.mode === 'PRACTISE') {
      res.reveal = {
        correctPos: Runner.correctPos(state, g.q.question_id), isCorrect: g.isCorrect, got: g.got,
        explainText: g.q.explain_text || '', explainImageUrl: g.q.explain_image_url || ''
      };
    }
    return res;
  },

  /** ปรับตำแหน่งข้อปัจจุบัน (ไม่คิดคะแนน) — ย้อนกลับไปทบทวน หรือไปข้อถัดไปในโหมดฝึกทำหลังดูเฉลยแล้ว */
  go: function (actor, a) {
    var at = Runner.mine(actor);
    if (at.status !== 'IN_PROGRESS') return { finished: true, index: 0 };
    var s = Op.get(at.session_id);
    var state = U.parse(at.state_json, null);
    if (!state) throw U.E('E_CORRUPT');
    var cur = U.num(state.idx, 0), idx, target = a.target;
    if (target === 'next') idx = cur + 1;
    else if (target === 'prev') idx = cur - 1;
    else idx = U.num(target, cur);
    if (idx < cur && !U.bool(s.allow_back)) throw U.E('E_NO_BACK');
    if (idx < 0) idx = 0;
    if (idx >= state.order.length) return { finished: true, result: Runner.finalize(at.attempt_id, 'SUBMITTED') };
    state.idx = idx;
    state.qStart = U.nowIso();
    Db.update('Attempts', at.attempt_id, { state_json: U.clip(U.json(state)), cur_index: idx, last_seen_at: U.nowIso() });
    Runner.beat(at.attempt_id, { i: idx });
    return { finished: false, index: idx };
  },

  /** โหมดสอบ: บันทึกคำตอบข้อที่ออก + เลื่อนไปข้อใหม่ ในคำสั่งเดียว (ข้อสุดท้าย = ส่งฉบับ) */
  advance: function (actor, a) {
    var at = Runner.mine(actor);
    if (at.status !== 'IN_PROGRESS') return { finished: true, index: 0 };
    var s = Op.get(at.session_id);
    if (Runner.pastDeadline(at, s)) return { finished: true, result: Runner.finalize(at.attempt_id, 'SUBMITTED') };
    var state = U.parse(at.state_json, null);
    if (!state) throw U.E('E_CORRUPT');
    var g = Runner.grade(at, s, state, Paper.map(s.quiz_id), String(a.questionId || ''), a.pos);
    var cur = U.num(state.idx, 0);
    var idx = (a.target === null || a.target === undefined) ? cur + 1 : U.num(a.target, cur + 1);
    if (idx < cur && !U.bool(s.allow_back)) throw U.E('E_NO_BACK');
    if (idx < 0) idx = 0;
    state.idx = idx;
    state.qStart = U.nowIso();
    var hb = U.parse(U.cGet('HB_' + at.attempt_id), {}) || {};
    var patch = { answers_json: U.clip(U.json(g.ans)), last_seen_at: U.nowIso(), violations: U.num(hb.v, U.num(at.violations)) };
    if (idx >= state.order.length) {       // ข้อสุดท้ายแล้ว — บันทึกคำตอบข้อนี้ก่อน แล้วปิดฉบับให้เลย
      Db.update('Attempts', at.attempt_id, patch);
      Db.flush();
      return { finished: true, result: Runner.finalize(at.attempt_id, 'SUBMITTED') };
    }
    patch.state_json = U.clip(U.json(state));
    patch.cur_index = idx;
    Db.update('Attempts', at.attempt_id, patch);
    Runner.beat(at.attempt_id, { i: idx });
    return { finished: false, index: idx, timedOut: g.timedOut, answeredMap: Runner.flagMap(state, g.ans) };
  },

  submit: function (actor) {
    var at = Runner.mine(actor);
    return { finished: true, result: Runner.finalize(at.attempt_id, 'SUBMITTED') };
  },

  /**
   * สัญญาณว่ายังอยู่ + นับการออกจากหน้าจอ + เฝ้าระวังเวลาหมดของทั้งฉบับ
   * ปกติไม่แตะ Spreadsheet เลย (เส้นตาย/รหัสรอบเก็บในแคชสัญญาณตอนโหลดข้อสอบ) · แคชหายจึงอ่านชีตเป็นทางสำรอง
   */
  heartbeat: function (actor, a) {
    var attemptId = actor.attemptId;
    var hb = U.parse(U.cGet('HB_' + attemptId), null);
    var at = null, sid = hb && hb.sid, dl = hb && hb.dl;
    if (!sid || !dl) {
      at = Runner.mine(actor);
      if (at.status !== 'IN_PROGRESS') return { violations: U.num(at.violations), forceSubmit: false, finished: true, serverTime: U.nowIso() };
      sid = at.session_id;
    }
    var s = Op.get(sid);
    if (!s) throw U.E('E_NOT_FOUND');
    var addV = U.bool(a.violation);
    var v = U.num(hb && hb.v, 0);
    if (addV) v++;
    Runner.beat(attemptId, { v: v });
    if (!dl || (s.status === 'CLOSED' && s.closed_at)) {        // ปิดรอบก่อนเวลา → เส้นตายเลื่อนมาเป็นเวลาที่ปิด
      if (!at) at = Runner.mine(actor);
      dl = Runner.deadline(at, s);
    }
    var force = false, result = null;
    if (dl && Date.now() > dl) {
      result = Runner.finalize(attemptId, 'SUBMITTED'); force = true;
    } else if (addV) {
      var maxV = U.num(s.max_violations, 0);
      if (maxV > 0 && v >= maxV) { result = Runner.finalize(attemptId, 'SUBMITTED'); force = true; }
    }
    return {
      violations: v, forceSubmit: force, result: result,
      secLeftTotal: dl ? Math.max(0, Math.floor((dl - Date.now()) / 1000)) : 0, serverTime: U.nowIso()
    };
  },

  /** ---------- สำหรับ Core (ลบข้อมูลนักศึกษา) · เรียกใน lock ---------- */
  countForStudent: function (courseId, stdId) {
    return Db.findRows('Attempts', 'std_id', stdId).filter(function (x) { return x.course_id === courseId; }).length;
  },
  removeForStudents: function (courseId, stdIds) {
    var set = {};
    stdIds.forEach(function (id) { set[String(id)] = true; });
    var gone = {};
    Db.findRows('Attempts', 'course_id', courseId).forEach(function (x) { if (set[x.std_id]) gone[x.attempt_id] = true; });
    var n = Db.removeWhere('Attempts', function (o) { return o.course_id === courseId && set[o.std_id] === true; });
    Db.removeWhere('Answers', function (o) { return o.course_id === courseId && set[o.std_id] === true; });
    Object.keys(gone).forEach(function (id) { U.cDel('HB_' + id); U.cDel('ARW_' + id); });
    Db.flush();
    return n;
  }
};
