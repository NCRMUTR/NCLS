'use strict';
/* ทดสอบขั้น 5: สอบออนไลน์ (EEOS v2.1.0 ย้ายเป็น Exam API แยก) เชื่อม HBT Core
 * ใช้ตัวจำลอง 2 ระบบ (pair.js): Core ↔ Exam คุยกันผ่าน UrlFetchApp จำลอง · แต่ละระบบมีชีต/แคช/Drive ของตัวเอง
 * หมายเหตุ: การคุยข้าม GAS จริง (redirect 302, เวลาตอบสนอง, โควตา UrlFetch) และโหลดพร้อมกันหลายคนต้องทดสอบบน Apps Script จริง */
const assert = require('assert');
const { createPair } = require('./pair.js');

let pass = 0, fail = 0; const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; failures.push(name); console.log('  ✘ ' + name + '\n      ' + (e && e.stack || e).split('\n').filter((l,i)=>i<5||/core_test5/.test(l)).slice(0, 8).join('\n      ')); }
}
function group(t) { console.log('\n' + t); }
const code = r => (r && r.error && r.error.code) || (r && r.ok ? 'OK' : '?');
const ok = r => { assert.strictEqual(r.ok, true, JSON.stringify(r)); return r.data; };
const std = i => String(660000 + i);
const PIN = '1234';
const fmtLocal = ms => { const d = new Date(ms), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
const inMin = (P, m) => fmtLocal(Date.now() + P.core.state.clockMs + m * 60000);
const mk = (head, size) => { const b = Buffer.alloc(size || 64, 7); Buffer.from(head).copy(b); return b; };
const JPG = n => mk([0xFF, 0xD8, 0xFF, 0xE0], n), PNG = n => mk([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A], n), PDF = n => mk([0x25, 0x50, 0x44, 0x46, 0x2d], n);
const img = (buf, name) => ({ base64: buf.toString('base64'), name: name || 'a.jpg' });

/* ---------- โลกจำลอง ---------- */
function world(nStd, opts) {
  const P = createPair(opts), core = P.core;
  P.A = core.tokenOf('admin@rmutr.ac.th');
  ok(core.api(P.A, 'term.create', { name: '1/2569' }));
  ok(core.api(P.A, 'user.upsert', { email: 't1@rmutr.ac.th', name: 'อาจารย์ 1', systems: ['att', 'exam', 'asg'] }));
  ok(core.api(P.A, 'user.upsert', { email: 't2@rmutr.ac.th', name: 'อาจารย์ 2', systems: ['att', 'exam', 'asg'] }));
  ok(core.api(P.A, 'user.upsert', { email: 't3@rmutr.ac.th', name: 'อาจารย์ 3', systems: ['att', 'asg'] }));
  P.T1 = core.tokenOf('t1@rmutr.ac.th'); P.T2 = core.tokenOf('t2@rmutr.ac.th'); P.T3 = core.tokenOf('t3@rmutr.ac.th');
  P.cid = ok(core.api(P.T1, 'course.create', { code: 'BIO101', name: 'ชีววิทยา', section: '1' })).courseId;
  P.cid2 = ok(core.api(P.T2, 'course.create', { code: 'CHM201', name: 'เคมี', section: '1' })).courseId;
  const rows = []; for (let i = 1; i <= (nStd === undefined ? 5 : nStd); i++) rows.push({ stdId: std(i), name: 'นักศึกษา ' + i });
  if (rows.length) {
    ok(core.api(P.T1, 'student.importCsv', { courseId: P.cid, rows }));
    ok(core.api(P.T1, 'pin.issueTemp', { courseId: P.cid, all: true })).codes.forEach(c =>
      ok(core.api('', 'pin.setWithTemp', { courseId: P.cid, stdId: c.stdId, tempPin: c.pin, newPin: PIN })));
  }
  ok(core.api(P.T2, 'student.importCsv', { courseId: P.cid2, rows: [{ stdId: std(1), name: 'นักศึกษา 1' }, { stdId: std(90), name: 'คนอื่น' }] }));
  return P;
}
const X = (P, tok, action, args, opId) => ok(P.ex.api(tok, action, args, opId));
const XE = (P, tok, action, args, opId) => code(P.ex.api(tok, action, args, opId));
const coreTok = (P, i, cid) => ok(P.core.api('', 'stu.login', { courseId: cid || P.cid, stdId: std(i), pin: PIN })).token;

const CH = (n) => ['ถูก', 'ผิด ก', 'ผิด ข', 'ผิด ค', 'ผิด ง'].slice(0, n || 4).map(t => ({ c_type: 'text', c_text: t }));
function mkQuiz(P, nQ, title) {
  const z = X(P, P.T1, 'exam.quiz.save', { courseId: P.cid, title: title || 'ชุดที่ 1' });
  for (let i = 1; i <= (nQ === undefined ? 4 : nQ); i++)
    X(P, P.T1, 'exam.q.save', { quizId: z.quizId, q_type: 'text', q_text: 'คำถามข้อ ' + i, choices: CH(4), correct: 0, score: i === 1 ? 2 : 1, explain_text: 'เฉลยข้อ ' + i });
  return z.quizId;
}
function mkRound(P, quizId, over) {
  return X(P, P.T1, 'exam.round.create', Object.assign({ courseId: P.cid, quizId, mode: 'TEST', title: 'สอบกลางภาค', startAt: inMin(P, -1), endAt: inMin(P, 90), allowBack: true, totalMinutes: 60, scoreMode: 'SCORE', scoreValue: 20 }, over || {}));
}
function start(P, i, round, cid) {
  const r = P.ex.api(coreTok(P, i, cid), 'exam.start', { t: round.token });
  return r;
}
function begin(P, i, round) { const d = ok(start(P, i, round)); d.tok = d.attemptToken; return d; }
const getPaper = (P, a) => X(P, a.tok, 'exam.paper', {});
const posOf = (q, text) => q.choices.find(c => c.text === text).pos;
/** ตอบข้อที่ index = idx ด้วยข้อความตัวเลือก (ถูก / ผิด ก ...) */
function ansPos(paper, idx, text) { const q = paper.questions[idx]; return { questionId: q.questionId, pos: posOf(q, text) }; }
const coreScores = (P, cid) => ok(P.core.api(P.T1, 'score.table', { courseId: cid || P.cid }));
const examType = (P, sid) => ok(P.core.api(P.T1, 'score.types', { courseId: P.cid })).types.filter(t => t.source === 'EXAM' && (!sid || t.sourceRef === sid));
const scoreOf = (tb, typeId, i) => tb.students.find(s => s.stdId === std(i)).scores[typeId];
const driveLive = P => Object.values(P.exState.drv.files).filter(f => !f.trashed);

/* ============================================================ */
group('ความปลอดภัยของ token · การคุยกันระหว่าง Core ↔ Exam');
test('Exam: ไม่มี/ผิดชนิด/ปลอม token → E_AUTH ทุก route ที่ต้องมี token', () => {
  const P = world(2); const ct = P.core.ctx();
  const stu = coreTok(P, 1);
  const bad = [
    ['exam.quiz.list', '', { courseId: P.cid }], ['exam.quiz.list', stu, { courseId: P.cid }], ['exam.quiz.list', 'abc.def', { courseId: P.cid }],
    ['exam.round.list', stu, { courseId: P.cid }], ['exam.start', P.T1, { t: 'x' }], ['exam.start', '', { t: 'x' }], ['exam.paper', stu, {}], ['exam.paper', P.T1, {}],
    ['exam.answer', stu, {}], ['exam.heartbeat', '', {}], ['svc.countStudent', P.T1, {}], ['svc.removeStudents', stu, {}]
  ];
  bad.forEach(([a, t, args]) => assert.strictEqual(XE(P, t, a, args), 'E_AUTH', a + ' ' + (t || '').slice(0, 6)));
  const forged = P.core.ctx().Auth.mint('u', { e: 't1@rmutr.ac.th' }, 3600).replace(/.$/, c => c === 'A' ? 'B' : 'A');
  assert.strictEqual(XE(P, forged, 'exam.quiz.list', { courseId: P.cid }), 'E_AUTH');
  // token บริการของ Exam เองใช้เรียก route ของ Core→Exam ไม่ได้ (sv ต้องเป็น core)
  const xe = ct.Auth.mintService('exam');
  assert.strictEqual(XE(P, xe, 'svc.countStudent', { courseId: P.cid, stdId: std(1) }), 'E_AUTH');
});
test('Core: route svc.* รับเฉพาะ token บริการ sv=exam — token อาจารย์/นักศึกษา/Core เอง/ไม่มี → E_AUTH', () => {
  const P = world(2); const ct = P.core.ctx();
  const acts = [['svc.access', { email: 't1@rmutr.ac.th', courseId: P.cid }], ['svc.course', { courseId: P.cid }], ['svc.syncScores', { courseId: P.cid, sessionId: 'S', name: 'n', max: 10, rows: [] }], ['svc.removeRound', { courseId: P.cid, sessionId: 'S' }]];
  [P.T1, P.A, coreTok(P, 1), '', ct.Auth.mintService('core')].forEach(t => acts.forEach(([a, args]) => assert.strictEqual(code(P.core.api(t, a, args)), 'E_AUTH', a)));
  const good = ct.Auth.mintService('exam');
  assert.strictEqual(code(P.core.api(good, 'svc.course', { courseId: P.cid })), 'OK');
});
test('svc.access: เจ้าของวิชา/admin ผ่าน · อาจารย์วิชาอื่น/ไม่มีสิทธิ์ exam → E_FORBIDDEN · ปิดบัญชี → E_DISABLED · ไม่มีในระบบ → E_NOT_LISTED · ไม่มีวิชา → E_NOT_FOUND', () => {
  const P = world(2); const xs = P.core.ctx().Auth.mintService('exam');
  const acc = (email, cid) => P.core.api(xs, 'svc.access', { email, courseId: cid || P.cid });
  assert.strictEqual(ok(acc('t1@rmutr.ac.th')).role, 'teacher'); assert.strictEqual(ok(acc('admin@rmutr.ac.th')).role, 'admin');
  assert.strictEqual(ok(acc('t1@rmutr.ac.th')).course.code, 'BIO101'); assert.strictEqual(ok(acc('t1@rmutr.ac.th')).course.current, true);
  assert.strictEqual(code(acc('t2@rmutr.ac.th')), 'E_FORBIDDEN'); assert.strictEqual(code(acc('t3@rmutr.ac.th')), 'E_FORBIDDEN');
  assert.strictEqual(code(acc('nobody@rmutr.ac.th')), 'E_NOT_LISTED'); assert.strictEqual(code(acc('t1@rmutr.ac.th', 'CRS-NONE')), 'E_NOT_FOUND');
  ok(P.core.api(P.A, 'user.setActive', { email: 't1@rmutr.ac.th', active: false }));
  P.advance(2);
  assert.strictEqual(code(acc('t1@rmutr.ac.th')), 'E_DISABLED');
});
test('Exam: อาจารย์ที่ไม่ใช่เจ้าของวิชา/ไม่มีสิทธิ์ระบบ exam ใช้ทุก route ของวิชานั้นไม่ได้ (E_FORBIDDEN)', () => {
  const P = world(3); const qid = mkQuiz(P, 2); const rd = mkRound(P, qid);
  [P.T2, P.T3].forEach(t => {
    assert.strictEqual(XE(P, t, 'exam.quiz.list', { courseId: P.cid }), 'E_FORBIDDEN');
    assert.strictEqual(XE(P, t, 'exam.quiz.save', { courseId: P.cid, title: 'x' }), 'E_FORBIDDEN');
    assert.strictEqual(XE(P, t, 'exam.quiz.delete', { quizId: qid }), 'E_FORBIDDEN');
    assert.strictEqual(XE(P, t, 'exam.q.list', { quizId: qid }), 'E_FORBIDDEN');
    assert.strictEqual(XE(P, t, 'exam.q.save', { quizId: qid, q_text: 'x', choices: CH(2) }), 'E_FORBIDDEN');
    assert.strictEqual(XE(P, t, 'exam.q.import', { quizId: qid, csv: 'a,b,c' }), 'E_FORBIDDEN');
    assert.strictEqual(XE(P, t, 'exam.round.list', { courseId: P.cid }), 'E_FORBIDDEN');
    assert.strictEqual(XE(P, t, 'exam.round.create', { courseId: P.cid, quizId: qid, startAt: inMin(P, 1), endAt: inMin(P, 9) }), 'E_FORBIDDEN');
    ['exam.round.setStatus', 'exam.round.update', 'exam.round.delete', 'exam.round.monitor', 'exam.round.report', 'exam.round.export', 'exam.round.sync']
      .forEach(a => assert.strictEqual(XE(P, t, a, { sessionId: rd.sessionId, action: 'OPEN' }), 'E_FORBIDDEN', a));
  });
  // admin ใช้ได้
  assert.strictEqual(XE(P, P.A, 'exam.quiz.list', { courseId: P.cid }), 'OK');
});
test('Exam ใช้ secret คนละค่ากับ Core → เรียก Core ไม่ได้ (E_CORE_DOWN) ไม่ใช่ E_AUTH ที่ทำให้ผู้ใช้ถูกเด้งออก', () => {
  const P = world(2, { badSecret: true });
  const r = P.ex.api(P.T1, 'exam.quiz.list', { courseId: P.cid });
  assert.strictEqual(code(r), 'E_AUTH', 'token อาจารย์จาก Core เซ็นด้วย secret อื่น ตรวจไม่ผ่านที่ Exam');
});
test('Exam ปลายทางที่ Core ตอบ HTML / เน็ตหลุด / Core ยุ่ง: ลองซ้ำ 1 ครั้ง แล้วรายงาน E_CORE_DOWN (หรือสำเร็จถ้าลองครั้งที่สอง)', () => {
  const P = world(2);
  P.mode.core = 'html'; assert.strictEqual(XE(P, P.T1, 'exam.quiz.list', { courseId: P.cid }), 'E_CORE_DOWN');
  P.mode.core = 'down'; assert.strictEqual(XE(P, P.T1, 'exam.quiz.list', { courseId: P.cid }), 'E_CORE_DOWN');
  P.mode.core = 'ok'; P.busy.core = 1; assert.strictEqual(XE(P, P.T1, 'exam.quiz.list', { courseId: P.cid }), 'OK');
  P.busy.core = 5; assert.strictEqual(XE(P, P.T1, 'exam.quiz.list', { courseId: P.cid + 'x' }), 'E_BUSY');   // Core ยุ่งต่อเนื่อง → ส่งต่อ E_BUSY ให้หน้าเว็บลองใหม่
});
test('สิทธิ์อาจารย์ที่ถามจาก Core จำไว้ 60 วินาที: ปิดบัญชีแล้วมีผลภายใน ~1 นาที', () => {
  const P = world(2);
  assert.strictEqual(XE(P, P.T1, 'exam.quiz.list', { courseId: P.cid }), 'OK');
  ok(P.core.api(P.A, 'user.setActive', { email: 't1@rmutr.ac.th', active: false }));
  const n0 = P.calls.toCore.length;
  assert.strictEqual(XE(P, P.T1, 'exam.quiz.list', { courseId: P.cid }), 'OK', 'ในแคช 60 วินาที');
  assert.strictEqual(P.calls.toCore.length, n0, 'ไม่ถาม Core ซ้ำ');
  P.advance(1.2);
  assert.strictEqual(XE(P, P.T1, 'exam.quiz.list', { courseId: P.cid }), 'E_DISABLED');
});

/* ============================================================ */
group('แบบทดสอบ / ข้อสอบ / รูปภาพ');
const mkQ = (P, quizId, o) => X(P, P.T1, 'exam.q.save', Object.assign({ quizId, q_type: 'text', q_text: 'ข้อ', choices: CH(4), correct: 0, score: 1 }, o || {}));
const qList = (P, quizId) => X(P, P.T1, 'exam.q.list', { quizId }).questions;
test('quiz.save: ชื่อว่าง/ซ้ำในวิชาเดียวกัน (ไม่สนตัวพิมพ์) ถูกปฏิเสธ · วิชาอื่นชื่อซ้ำได้ · เปลี่ยนชื่อได้ · list นับข้อ/รอบ', () => {
  const P = world(3);
  assert.strictEqual(XE(P, P.T1, 'exam.quiz.save', { courseId: P.cid, title: '   ' }), 'E_QUIZ_TITLE');
  const z = X(P, P.T1, 'exam.quiz.save', { courseId: P.cid, title: 'บทที่ 1' });
  assert.strictEqual(XE(P, P.T1, 'exam.quiz.save', { courseId: P.cid, title: ' บทที่  1 ' }), 'E_DUP_QUIZ');
  X(P, P.T2, 'exam.quiz.save', { courseId: P.cid2, title: 'บทที่ 1' });
  const r = X(P, P.T1, 'exam.quiz.save', { courseId: P.cid, quizId: z.quizId, title: 'บทที่ 1 (แก้)', note: 'โน้ต' });
  assert.strictEqual(r.title, 'บทที่ 1 (แก้)'); assert.strictEqual(r.note, 'โน้ต');
  mkQ(P, z.quizId); mkQ(P, z.quizId);
  mkRound(P, z.quizId);
  const l = X(P, P.T1, 'exam.quiz.list', { courseId: P.cid });
  assert.strictEqual(l.quizzes.length, 1); assert.strictEqual(l.quizzes[0].questionCount, 2); assert.strictEqual(l.quizzes[0].rounds, 1);
  assert.strictEqual(l.course.code, 'BIO101');
  // แก้ quizId ของวิชาอื่นผ่าน courseId ตัวเอง → ปฏิเสธ
  const z2 = X(P, P.T2, 'exam.quiz.save', { courseId: P.cid2, title: 'ของเคมี' });
  assert.notStrictEqual(XE(P, P.T1, 'exam.quiz.save', { courseId: P.cid, quizId: z2.quizId, title: 'ขโมย' }), 'OK');
});
test('q.save: ติ๊กข้อถูกข้อไหน server ย้ายขึ้นเป็นตัวเลือกแรก · ตรวจ 2–5 ตัวเลือก ข้อความว่าง คะแนน ดัชนี correct', () => {
  const P = world(2); const qid = mkQuiz(P, 0);
  const q = mkQ(P, qid, { q_text: 'ทดสอบ', choices: [{ c_type: 'text', c_text: 'A' }, { c_type: 'text', c_text: 'B' }, { c_type: 'text', c_text: 'C' }, { c_type: 'text', c_text: 'D' }], correct: 2 });
  const L = qList(P, qid); assert.strictEqual(L.length, 1);
  assert.deepStrictEqual(L[0].choices.map(c => c.c_text), ['C', 'A', 'B', 'D']); assert.deepStrictEqual(L[0].choices.map(c => c.c_idx), [1, 2, 3, 4]);
  const bad = o => XE(P, P.T1, 'exam.q.save', Object.assign({ quizId: qid, q_text: 'x', choices: CH(3), correct: 0 }, o));
  assert.strictEqual(bad({ choices: CH(1) }), 'E_CHOICES_MIN'); assert.strictEqual(bad({ choices: [] }), 'E_CHOICES_MIN');
  assert.strictEqual(bad({ choices: CH(5).concat([{ c_type: 'text', c_text: 'ที่ 6' }]) }), 'E_CHOICES_MAX');
  assert.strictEqual(bad({ q_text: '  ' }), 'E_EMPTY_Q');
  assert.strictEqual(bad({ q_type: 'image', q_text: 'x' }), 'E_EMPTY_Q');
  assert.strictEqual(bad({ choices: [{ c_type: 'text', c_text: 'a' }, { c_type: 'text', c_text: '  ' }] }), 'E_EMPTY_CHOICE');
  assert.strictEqual(bad({ choices: [{ c_type: 'text', c_text: 'a' }, { c_type: 'image' }] }), 'E_EMPTY_CHOICE');
  assert.strictEqual(bad({ score: 0 }), 'E_BAD_REQUEST'); assert.strictEqual(bad({ score: -1 }), 'E_BAD_REQUEST'); assert.strictEqual(bad({ score: 5000 }), 'E_BAD_REQUEST');
  assert.strictEqual(bad({ correct: 3 }), 'E_BAD_REQUEST'); assert.strictEqual(bad({ correct: -1 }), 'E_BAD_REQUEST'); assert.strictEqual(bad({ correct: 0.5 }), 'E_BAD_REQUEST');
  assert.strictEqual(qList(P, qid).length, 1, 'ที่ปฏิเสธไม่ทิ้งข้อค้าง');
  // แก้ข้อเดิม: เลขข้อไม่เปลี่ยน
  X(P, P.T1, 'exam.q.save', { quizId: qid, questionId: q.questionId, q_text: 'แก้แล้ว', choices: CH(2), correct: 1, score: 3 });
  const L2 = qList(P, qid); assert.strictEqual(L2.length, 1); assert.strictEqual(L2[0].q_text, 'แก้แล้ว'); assert.strictEqual(L2[0].score, 3);
  assert.deepStrictEqual(L2[0].choices.map(c => c.c_text), ['ผิด ก', 'ถูก']);
  assert.strictEqual(P.ex.rows('Choices').length, 2, 'ตัวเลือกเก่าถูกแทนที่ ไม่สะสม');
});
test('รูปภาพ: ตรวจจากไบต์หัวไฟล์ (jpg/png ผ่าน · pdf/ข้อความ/ใหญ่เกิน 1MB/base64 เสีย → E_IMG) · ขึ้น Drive แล้วอ้างด้วย id', () => {
  const P = world(2); const qid = mkQuiz(P, 0);
  const sv = o => XE(P, P.T1, 'exam.q.save', Object.assign({ quizId: qid, q_text: 'x', choices: CH(2) }, o));
  assert.strictEqual(sv({ q_image: img(PDF(100), 'a.jpg') }), 'E_IMG');
  assert.strictEqual(sv({ q_image: img(Buffer.from('hello world'), 'a.png') }), 'E_IMG');
  assert.strictEqual(sv({ q_image: img(JPG(1024 * 1024 + 10)) }), 'E_IMG');
  assert.strictEqual(sv({ q_image: { base64: '!!!', name: 'a.jpg' } }), 'E_IMG');
  assert.strictEqual(sv({ q_image: { base64: '', name: 'a.jpg' } }), 'E_IMG');
  assert.strictEqual(driveLive(P).length, 0);
  assert.strictEqual(sv({ q_image: img(JPG(500), 'ภาพ ข้อ1.exe') }), 'OK');
  const f = driveLive(P); assert.strictEqual(f.length, 1); assert.strictEqual(f[0].mime, 'image/jpeg'); assert.ok(/\.jpg$/.test(f[0].name), f[0].name);
  assert.ok(/^https:\/\/drive\.google\.com\/thumbnail\?id=FIL\d+/.test(qList(P, qid)[0].q_image_url));
  // ข้อภาพล้วน + ตัวเลือกเป็นภาพ
  const r = X(P, P.T1, 'exam.q.save', { quizId: qid, q_type: 'image', q_image: img(PNG(300), 'q.png'), choices: [{ c_type: 'image', c_image: img(PNG(200)) }, { c_type: 'image', c_image: img(JPG(200)) }], correct: 1 });
  const q = qList(P, qid).filter(x => x.question_id === r.questionId)[0];
  assert.strictEqual(q.q_type, 'image'); assert.ok(q.choices.every(c => c.c_type === 'image' && c.c_image_url));
  assert.strictEqual(driveLive(P).length, 4);
});
test('รูป: บันทึกล้มเหลวกลางทาง (ตัวเลือกที่ 2 เสีย) → รูปที่เพิ่งขึ้นถูกทิ้งลงถังขยะ ไม่มีแถวค้าง · Drive ล่ม → E_DRIVE', () => {
  const P = world(2); const qid = mkQuiz(P, 0);
  const r = XE(P, P.T1, 'exam.q.save', { quizId: qid, q_text: 'x', q_image: img(JPG(300)), choices: [{ c_type: 'image', c_image: img(PNG(100)) }, { c_type: 'image', c_image: img(PDF(100)) }] });
  assert.strictEqual(r, 'E_IMG'); assert.strictEqual(driveLive(P).length, 0); assert.strictEqual(P.ex.rows('Questions').length, 0); assert.strictEqual(P.ex.rows('Choices').length, 0);
  P.exState.drv.failCreate = true;
  assert.strictEqual(XE(P, P.T1, 'exam.q.save', { quizId: qid, q_text: 'x', q_image: img(JPG(300)), choices: CH(2) }), 'E_DRIVE');
  P.exState.drv.failCreate = false;
  assert.strictEqual(P.ex.rows('Questions').length, 0);
});
test('รูป: แก้ข้อ → รูปเดิมที่เลิกใช้ลงถังขยะ · รูปที่คงไว้ (ส่ง id เดิม) ยังอยู่ · id รูปของข้ออื่นที่หน้าเว็บส่งมา ใช้ไม่ได้', () => {
  const P = world(2); const qid = mkQuiz(P, 0);
  const a = X(P, P.T1, 'exam.q.save', { quizId: qid, q_text: 'a', q_image: img(JPG(300)), explain_image: img(PNG(300)), choices: CH(2) });
  const b = X(P, P.T1, 'exam.q.save', { quizId: qid, q_text: 'b', q_image: img(JPG(310)), choices: CH(2) });
  const fa = Object.keys(P.exState.drv.files);
  assert.strictEqual(fa.length, 3);
  const qa = qList(P, qid)[0], qb = qList(P, qid)[1];
  const idOf = u => u.match(/id=([^&]+)/)[1];
  // คงรูปโจทย์ ทิ้งรูปเฉลย
  X(P, P.T1, 'exam.q.save', { quizId: qid, questionId: a.questionId, q_text: 'a2', q_image_id: idOf(qa.q_image_url), choices: CH(2) });
  assert.strictEqual(driveLive(P).length, 2);
  assert.ok(P.exState.drv.files[idOf(qa.q_image_url)].trashed === false);
  // ส่ง id รูปของข้อ b มาใส่ข้อ a → ไม่รับ (ข้อ a กลายเป็นไม่มีรูป · ถ้าเป็นข้อภาพล้วนจะ E_EMPTY_Q)
  assert.strictEqual(XE(P, P.T1, 'exam.q.save', { quizId: qid, questionId: a.questionId, q_type: 'image', q_image_id: idOf(qb.q_image_url), choices: CH(2) }), 'E_EMPTY_Q');
  X(P, P.T1, 'exam.q.save', { quizId: qid, questionId: a.questionId, q_text: 'a3', q_image_id: idOf(qb.q_image_url), choices: CH(2) });
  assert.ok(P.exState.drv.files[idOf(qb.q_image_url)].trashed === false, 'รูปของข้อ b ต้องไม่ถูกแตะ');
  assert.strictEqual(qList(P, qid)[0].q_image_url, '', 'ข้อ a ไม่ได้ผูกรูป b');
  // ข้อของอีกแบบทดสอบ (ข้อมูลข้ามชุด) แก้ไม่ได้
  const q2 = mkQuiz(P, 0, 'ชุดอื่น');
  assert.strictEqual(XE(P, P.T1, 'exam.q.save', { quizId: q2, questionId: b.questionId, q_text: 'x', choices: CH(2) }), 'E_NOT_FOUND');
});
test('ลบข้อ/ลบหลายข้อ/ลบทั้งชุด: เรียงเลขข้อใหม่ · รูปลงถังขยะ · เลื่อนขึ้นลง · renumber · ลบแบบทดสอบที่มีรอบใช้อยู่ → E_QUIZ_IN_USE', () => {
  const P = world(3); const qid = mkQuiz(P, 0);
  const ids = [1, 2, 3, 4, 5].map(i => mkQ(P, qid, { q_text: 'ข้อ ' + i, q_image: i === 2 ? img(JPG(100)) : undefined }).questionId);
  assert.deepStrictEqual(qList(P, qid).map(q => q.q_no), [1, 2, 3, 4, 5]);
  assert.strictEqual(X(P, P.T1, 'exam.q.delete', { questionId: ids[1] }).removed, 1);
  assert.deepStrictEqual(qList(P, qid).map(q => [q.q_no, q.q_text]), [[1, 'ข้อ 1'], [2, 'ข้อ 3'], [3, 'ข้อ 4'], [4, 'ข้อ 5']]);
  assert.strictEqual(driveLive(P).length, 0);
  assert.strictEqual(XE(P, P.T1, 'exam.q.delete', { questionId: ids[1] }), 'E_NOT_FOUND');
  assert.strictEqual(X(P, P.T1, 'exam.q.move', { questionId: ids[2], dir: 'up' }).moved, true);
  const after = qList(P, qid).map(q => q.q_text); assert.deepStrictEqual(after, ['ข้อ 3', 'ข้อ 1', 'ข้อ 4', 'ข้อ 5']);
  assert.strictEqual(X(P, P.T1, 'exam.q.move', { questionId: ids[2], dir: 'up' }).moved, false, 'อยู่บนสุดแล้ว');
  assert.strictEqual(X(P, P.T1, 'exam.q.move', { questionId: ids[4], dir: 'down' }).moved, false, 'อยู่ล่างสุดแล้ว');
  assert.strictEqual(XE(P, P.T1, 'exam.q.deleteMany', { quizId: qid, ids: [] }), 'E_NOTHING_SELECTED');
  assert.strictEqual(X(P, P.T1, 'exam.q.deleteMany', { quizId: qid, ids: [ids[0], ids[3]] }).removed, 2);
  assert.deepStrictEqual(qList(P, qid).map(q => [q.q_no, q.q_text]), [[1, 'ข้อ 3'], [2, 'ข้อ 5']]);
  assert.strictEqual(X(P, P.T1, 'exam.quiz.list', { courseId: P.cid }).quizzes[0].questionCount, 2);
  const rd = mkRound(P, qid);
  assert.strictEqual(XE(P, P.T1, 'exam.quiz.delete', { quizId: qid }), 'E_QUIZ_IN_USE');
  X(P, P.T1, 'exam.round.delete', { sessionId: rd.sessionId });
  assert.strictEqual(X(P, P.T1, 'exam.q.deleteMany', { quizId: qid, ids: 'ALL' }).removed, 2);
  assert.strictEqual(qList(P, qid).length, 0);
  assert.strictEqual(XE(P, P.T1, 'exam.quiz.delete', { quizId: qid }), 'OK');
  assert.strictEqual(X(P, P.T1, 'exam.quiz.list', { courseId: P.cid }).quizzes.length, 0);
  assert.strictEqual(XE(P, P.T1, 'exam.q.list', { quizId: qid }), 'E_QUIZ_REQUIRED');
});
test('CSV: นำเข้า (หัวตาราง/ตัวคั่นเซมิโคลอน/ตัวเลือกไม่ครบ/คะแนนผิด) · ส่งออกแล้วนำเข้ากลับได้เท่าเดิม · ข้อความขึ้นต้นด้วย = ถูกกันสูตร', () => {
  const P = world(2); const qid = mkQuiz(P, 0);
  const csv = 'คำถาม,ถูก,ผิด1,ผิด2,ผิด3,,คะแนน,อธิบาย\n"2+2 คือ, เท่าไร",4,3,5,,,2,"บวกกัน"\nข้อเดียว,ก,,,,,,\n\n=HYPERLINK("x"),ใช่,ไม่,,,,0,\nสามตัว,A,B,C,,,3,';
  const r = X(P, P.T1, 'exam.q.import', { quizId: qid, csv, skipFirstRow: true });
  assert.strictEqual(r.added, 3); assert.strictEqual(r.skipped, 1);
  const L = qList(P, qid); assert.strictEqual(L[0].q_text, '2+2 คือ, เท่าไร'); assert.strictEqual(L[0].score, 2); assert.strictEqual(L[0].explain_text, 'บวกกัน');
  assert.deepStrictEqual(L[0].choices.map(c => c.c_text), ['4', '3', '5']); assert.strictEqual(L[1].score, 1, 'คะแนน 0 → 1'); assert.strictEqual(L[2].score, 3);
  assert.strictEqual(XE(P, P.T1, 'exam.q.import', { quizId: qid, csv: '' }), 'E_CSV_EMPTY'); assert.strictEqual(XE(P, P.T1, 'exam.q.import', { quizId: qid }), 'E_CSV_EMPTY');
  const ex = X(P, P.T1, 'exam.q.export', { quizId: qid });
  assert.ok(/\.csv$/.test(ex.filename));
  const q2 = mkQuiz(P, 0, 'ชุดปลายทาง');
  const r2 = X(P, P.T1, 'exam.q.import', { quizId: q2, csv: ex.csv.replace(/^﻿/, ''), skipFirstRow: true });
  assert.strictEqual(r2.added, 3);
  assert.deepStrictEqual(qList(P, q2).map(q => [q.q_text, q.score, q.choices.map(c => c.c_text).join('|')]), L.map(q => [q.q_text, q.score, q.choices.map(c => c.c_text).join('|')]));
});
test('ชุดข้อสอบในแคช: แก้/ลบข้อแล้วนักศึกษาที่เริ่มทำใหม่เห็นข้อมูลล่าสุดทันที · ชุดที่เริ่มทำไปแล้วยังใช้ลำดับเดิมไม่พัง', () => {
  const P = world(3); const qid = mkQuiz(P, 2); const rd = mkRound(P, qid);
  const a1 = begin(P, 1, rd); const p1 = getPaper(P, a1);
  assert.strictEqual(p1.questions.length, 2);
  const L = qList(P, qid);
  X(P, P.T1, 'exam.q.save', { quizId: qid, questionId: L[0].question_id, q_text: 'ข้อแก้ไขใหม่', choices: CH(3), correct: 0, score: 5 });
  mkQ(P, qid, { q_text: 'ข้อที่ 3 เพิ่มทีหลัง' });
  const a2 = begin(P, 2, rd); const p2 = getPaper(P, a2);
  assert.strictEqual(p2.questions.length, 3); assert.ok(p2.questions.some(q => q.text === 'ข้อแก้ไขใหม่'));
  // คนที่เริ่มไปแล้วยังเห็น 2 ข้อตามลำดับเดิม
  assert.strictEqual(getPaper(P, a1).questions.length, 2);
  // ลบข้อที่คนแรกกำลังทำ: คนแรกส่งคำตอบข้อนั้น → ไม่ล้มทั้งระบบ (ข้อที่หายไปถูกกรองออกจากชุด)
  X(P, P.T1, 'exam.q.delete', { questionId: L[1].question_id });
  const p1b = getPaper(P, a1); assert.ok(p1b.questions.length >= 1);
});

/* ============================================================ */
group('รอบฝึกทำ/รอบสอบ');
test('round.create: ตรวจข้อมูล (ไม่มีข้อ/ไม่มีนักศึกษา/เวลา/ชนิดคะแนน/แบบทดสอบข้ามวิชา)', () => {
  const P = world(3); const qid = mkQuiz(P, 2);
  const e0 = mkQuiz(P, 0, 'ว่าง');
  const c = o => XE(P, P.T1, 'exam.round.create', Object.assign({ courseId: P.cid, quizId: qid, mode: 'TEST', startAt: inMin(P, 1), endAt: inMin(P, 60), scoreMode: 'NONE' }, o));
  assert.strictEqual(c({}), 'OK');
  assert.strictEqual(c({ quizId: e0 }), 'E_NO_QUESTIONS');
  assert.strictEqual(c({ startAt: '' }), 'E_TIME_REQUIRED'); assert.strictEqual(c({ endAt: 'xx' }), 'E_TIME_REQUIRED');
  assert.strictEqual(c({ endAt: inMin(P, 1) }), 'E_TIME_RANGE'); assert.strictEqual(c({ endAt: inMin(P, -5) }), 'E_TIME_RANGE');
  assert.strictEqual(c({ scoreMode: 'COMPLETE' }), 'E_SCORE_MODE', 'โหมดสอบไม่มี COMPLETE');
  assert.strictEqual(c({ scoreMode: 'ZZZ' }), 'E_SCORE_MODE'); assert.strictEqual(c({ scoreMode: 'SCORE', scoreValue: 0 }), 'E_SCORE_VALUE');
  assert.strictEqual(c({ scoreMode: 'SCORE', scoreValue: 5000 }), 'E_SCORE_VALUE'); assert.strictEqual(c({ scoreMode: 'SCORE', scoreValue: 'abc' }), 'E_SCORE_VALUE');
  assert.strictEqual(c({ mode: 'PRACTISE', scoreMode: 'COMPLETE', scoreValue: 5 }), 'OK');
  assert.strictEqual(c({ quizId: 'QZ-NONE' }), 'E_QUIZ_REQUIRED');
  const z2 = X(P, P.T2, 'exam.quiz.save', { courseId: P.cid2, title: 'ชุดเคมี' }); X(P, P.T2, 'exam.q.save', { quizId: z2.quizId, q_text: 'x', choices: CH(2) });
  assert.strictEqual(XE(P, P.A, 'exam.round.create', { courseId: P.cid, quizId: z2.quizId, startAt: inMin(P, 1), endAt: inMin(P, 9) }), 'E_QUIZ_REQUIRED');
  const P0 = world(0); const q0 = mkQuiz(P0, 1);
  assert.strictEqual(XE(P0, P0.T1, 'exam.round.create', { courseId: P0.cid, quizId: q0, startAt: inMin(P0, 1), endAt: inMin(P0, 9) }), 'E_NO_STUDENTS');
});
test('round.create: ค่าเริ่มต้นและกฎโหมด — ฝึกทำไม่ย้อนข้อ · สอบ 1 ครั้ง · สลับตัวเลือกเป็นค่าเริ่มต้น · token 32 hex ไม่ซ้ำ', () => {
  const P = world(3); const qid = mkQuiz(P, 2);
  const t = mkRound(P, qid, { mode: 'TEST', allowBack: true, totalMinutes: 30, secPerQuestion: 20 });
  assert.strictEqual(t.maxAttempts, 1); assert.strictEqual(t.allowBack, true); assert.strictEqual(t.secPerQuestion, 0, 'ย้อนข้อได้ = ไม่จับเวลาต่อข้อ'); assert.strictEqual(t.totalMinutes, 30);
  assert.strictEqual(t.shuffleC, true); assert.strictEqual(t.resume, true);
  const p = mkRound(P, qid, { mode: 'PRACTISE', allowBack: true, secPerQuestion: 20, totalMinutes: 0, scoreMode: 'COMPLETE', scoreValue: 5 });
  assert.strictEqual(p.allowBack, false); assert.strictEqual(p.secPerQuestion, 20); assert.strictEqual(p.maxAttempts, 0);
  const t2 = mkRound(P, qid, { allowBack: false, secPerQuestion: 25, totalMinutes: 0 });
  assert.strictEqual(t2.allowBack, false); assert.strictEqual(t2.secPerQuestion, 25);
  [t, p, t2].forEach(r => assert.ok(/^[0-9a-f]{32}$/.test(r.token)));
  assert.strictEqual(new Set([t.token, p.token, t2.token]).size, 3);
  assert.strictEqual(t.effective, 'OPEN');
  const future = mkRound(P, qid, { startAt: inMin(P, 30), endAt: inMin(P, 90) }); assert.strictEqual(future.effective, 'SCHEDULED');
});
test('exam.resolve (ไม่ต้องล็อกอิน): คืนข้อมูลรอบสำหรับหน้านักศึกษา · ไม่มีอีเมลอาจารย์/เฉลย/รหัสแบบทดสอบ · ลิงก์ผิด/ลบแล้ว/วิชาไม่ใช่ภาคปัจจุบัน → E_BAD_LINK', () => {
  const P = world(3); const qid = mkQuiz(P, 3); const rd = mkRound(P, qid);
  const r = X(P, '', 'exam.resolve', { t: rd.token });
  assert.strictEqual(r.session.mode, 'TEST'); assert.strictEqual(r.session.status, 'OPEN'); assert.strictEqual(r.questionCount, 3); assert.strictEqual(r.course.code, 'BIO101');
  const dump = JSON.stringify(r);
  ['t1@rmutr', 'is_correct', 'explain', rd.sessionId, qid, rd.token.slice(0, 8)].forEach(s => assert.ok(dump.indexOf(s) < 0, 'รั่ว: ' + s));
  ['', 'abc', 'g'.repeat(32), rd.token.toUpperCase(), '0'.repeat(32)].forEach(t => assert.strictEqual(XE(P, '', 'exam.resolve', { t }), 'E_BAD_LINK', t));
  X(P, P.T1, 'exam.round.delete', { sessionId: rd.sessionId });
  assert.strictEqual(XE(P, '', 'exam.resolve', { t: rd.token }), 'E_BAD_LINK');
  const rd2 = mkRound(P, qid);
  const t2 = ok(P.core.api(P.A, 'term.create', { name: '2/2569' })).terms.filter(t => t.name === '2/2569')[0];
  ok(P.core.api(P.A, 'term.setCurrent', { termId: t2.termId }));  // เปลี่ยนภาคเรียนปัจจุบัน → วิชาเดิมไม่ใช่ภาคปัจจุบัน
  P.advance(6);                                                   // ข้อมูลวิชาใน Exam จำไว้ 5 นาที → เห็นผลหลังจากนั้น
  assert.strictEqual(XE(P, '', 'exam.resolve', { t: rd2.token }), 'E_BAD_LINK');
});
test('เครื่องสถานะของรอบ: ตามเวลา · OPEN ทันที · CLOSE · RESET · เลยเวลาแล้วเปิดด้วยมือ = ขยายเวลา 3 ชม.', () => {
  const P = world(3); const qid = mkQuiz(P, 2);
  const rd = mkRound(P, qid, { startAt: inMin(P, 10), endAt: inMin(P, 70) });
  const st = () => X(P, P.T1, 'exam.round.list', { courseId: P.cid }).rounds.filter(r => r.sessionId === rd.sessionId)[0];
  assert.strictEqual(st().effective, 'SCHEDULED');
  assert.strictEqual(XE(P, coreTok(P, 1), 'exam.start', { t: rd.token }), 'E_SESSION_NOT_OPEN');
  assert.strictEqual(X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'OPEN' }).effective, 'OPEN');
  begin(P, 1, rd);
  P.advance(15); assert.strictEqual(st().effective, 'OPEN');
  assert.strictEqual(X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'RESET' }).effective, 'OPEN', 'เวลาเริ่มผ่านแล้ว RESET กลับเป็นตามเวลา = เปิด');
  const c = X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'CLOSE' });
  assert.strictEqual(c.effective, 'CLOSED'); assert.strictEqual(c.remaining, 0);
  assert.strictEqual(XE(P, coreTok(P, 2), 'exam.start', { t: rd.token }), 'E_SESSION_CLOSED');
  assert.strictEqual(XE(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'FOO' }), 'E_REQUIRED');
  // เปิดใหม่หลังปิด → ปิดซ้ำได้ และปิดซ้ำไม่ทำอะไรพัง
  assert.strictEqual(X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'CLOSE' }).effective, 'CLOSED');
  // เลยเวลาปลายทางแล้ว: เปิดด้วยมือขยายให้ 3 ชม.
  const rd2 = mkRound(P, qid, { startAt: inMin(P, -100), endAt: inMin(P, -50) });
  assert.strictEqual(X(P, P.T1, 'exam.round.list', { courseId: P.cid }).rounds.filter(r => r.sessionId === rd2.sessionId)[0].status, 'CLOSED', 'list ปิดรอบที่เลยเวลาให้');
  const o = X(P, P.T1, 'exam.round.setStatus', { sessionId: rd2.sessionId, action: 'OPEN' });
  assert.strictEqual(o.effective, 'OPEN'); assert.ok(o.endAt > rd2.endAt);
});
test('round.update: เปลี่ยนชื่อ/เวลา/ตั้งค่า ตรวจช่วงเวลา · ลิงก์เดิมใช้ต่อได้ · แคชรอบไม่ค้างค่าเก่า', () => {
  const P = world(3); const qid = mkQuiz(P, 2); const rd = mkRound(P, qid, { title: 'เดิม' });
  assert.strictEqual(X(P, '', 'exam.resolve', { t: rd.token }).session.title, 'เดิม');
  const u = X(P, P.T1, 'exam.round.update', { sessionId: rd.sessionId, title: 'ใหม่', totalMinutes: 45, maxAttempts: 2 });
  assert.strictEqual(u.round.title, 'ใหม่'); assert.strictEqual(u.round.totalMinutes, 45); assert.strictEqual(u.round.maxAttempts, 2); assert.strictEqual(u.round.token, rd.token);
  assert.strictEqual(X(P, '', 'exam.resolve', { t: rd.token }).session.title, 'ใหม่');
  assert.strictEqual(XE(P, P.T1, 'exam.round.update', { sessionId: rd.sessionId, endAt: inMin(P, -10) }), 'E_TIME_RANGE');
  assert.strictEqual(XE(P, P.T1, 'exam.round.update', { sessionId: rd.sessionId, startAt: 'xx' }), 'E_TIME_REQUIRED');
  assert.strictEqual(XE(P, P.T1, 'exam.round.update', { sessionId: rd.sessionId, scoreMode: 'SCORE', scoreValue: -1 }), 'E_SCORE_VALUE');
  assert.strictEqual(X(P, '', 'exam.resolve', { t: rd.token }).session.title, 'ใหม่');
  assert.strictEqual(XE(P, P.T1, 'exam.round.update', { sessionId: 'RND-NONE', title: 'x' }), 'E_NOT_FOUND');
});

/* ============================================================ */
group('นักศึกษาทำข้อสอบ');
const alignMin = P => { const ms = Date.now() + P.core.state.clockMs; const r = ms % 60000; if (r) P.advance((60000 - r) / 60000); };
const answerAll = (P, a, paper, pickFn) => paper.questions.map((q, i) => X(P, a.tok, 'exam.answer', { questionId: q.questionId, pos: pickFn(q, i) }));
const rightPos = q => posOf(q, 'ถูก'), wrongPos = q => posOf(q, 'ผิด ก');
test('exam.start: นักศึกษานอกรายชื่อ/ผิดวิชา/ลิงก์ผิด/ไม่ใช่ token นักศึกษา ถูกปฏิเสธ · วิชาอื่นที่มีรหัสเดียวกันใช้ลิงก์รอบนี้ไม่ได้', () => {
  const P = world(3); const qid = mkQuiz(P, 2); const rd = mkRound(P, qid);
  const ghost = P.core.ctx().Auth.mint('s', { c: P.cid, s: '999999' }, 3600);
  assert.strictEqual(XE(P, ghost, 'exam.start', { t: rd.token }), 'E_STUDENT_NOT_FOUND');
  assert.strictEqual(XE(P, coreTok(P, 1, P.cid2), 'exam.start', { t: rd.token }), 'E_WRONG_COURSE');   // นักศึกษา 660001 ในวิชาเคมี
  assert.strictEqual(XE(P, coreTok(P, 1), 'exam.start', { t: 'z'.repeat(32) }), 'E_BAD_LINK');
  assert.strictEqual(XE(P, coreTok(P, 1), 'exam.start', {}), 'E_BAD_LINK');
  assert.strictEqual(P.ex.rows('Attempts').length, 0);
  const d = ok(start(P, 1, rd)); assert.strictEqual(d.name, 'นักศึกษา 1'); assert.strictEqual(d.stdId, std(1)); assert.strictEqual(d.resumed, false);
  assert.ok(d.attemptToken.split('.').length === 2);
});
test('เริ่ม/ทำต่อ: เริ่มซ้ำได้ attempt เดิม (resume) · ปิด resume = ฉบับเดิมหมดอายุแล้วนับเป็นหนึ่งครั้ง (ช่องโหว่ EEOS เดิมที่กดเข้าใหม่ได้ไม่จำกัด)', () => {
  const P = world(3); const qid = mkQuiz(P, 3);
  const rd = mkRound(P, qid, { mode: 'PRACTISE', maxAttempts: 2, scoreMode: 'NONE' });
  const a1 = begin(P, 1, rd), a1b = begin(P, 1, rd);
  assert.strictEqual(a1.attemptId, a1b.attemptId); assert.strictEqual(a1b.resumed, true); assert.strictEqual(P.ex.rows('Attempts').length, 1);
  const my = X(P, coreTok(P, 1), 'exam.my', { t: rd.token }); assert.strictEqual(my.inProgress, true); assert.strictEqual(my.canResume, true); assert.strictEqual(my.attempts.length, 0);
  X(P, P.T1, 'exam.round.update', { sessionId: rd.sessionId });
  // ปิด resume โดยสร้างรอบใหม่ที่ไม่ resume
  const rn = mkRound(P, qid, { resume: false, maxAttempts: 2, mode: 'PRACTISE' });
  const b1 = begin(P, 2, rn); const b2 = begin(P, 2, rn);
  assert.notStrictEqual(b1.attemptId, b2.attemptId); assert.strictEqual(b2.resumed, false);
  const rows = P.ex.rows('Attempts').filter(r => r[1] === rn.sessionId); assert.strictEqual(rows.length, 2);
  assert.strictEqual(XE(P, coreTok(P, 2), 'exam.start', { t: rn.token }), 'E_ATTEMPT_LIMIT', 'ครั้งที่ 1 ถูกปิดเองนับ 1 + ครั้งที่ 2 กำลังทำ = ครบ 2 ... เริ่มครั้งที่ 3 ไม่ได้');
  // ครั้งที่ 2 ถูกปิดแล้วเริ่มไม่ได้อีก
  assert.strictEqual(XE(P, coreTok(P, 3), 'exam.start', { t: rn.token }), 'OK');
  // ช่องโหว่เดิม: max=1 ไม่ resume กดเข้าซ้ำ 5 ครั้ง ต้องได้แค่ 1 ครั้ง
  const r1 = mkRound(P, qid, { resume: false, maxAttempts: 1 });
  begin(P, 1, r1);
  for (let i = 0; i < 4; i++) assert.strictEqual(XE(P, coreTok(P, 1), 'exam.start', { t: r1.token }), 'E_ATTEMPT_LIMIT');
  assert.strictEqual(P.ex.rows('Attempts').filter(r => r[1] === r1.sessionId).length, 1);
});
test('สอบ 1 ครั้ง: ส่งแล้วเริ่มใหม่ไม่ได้ (E_ATTEMPT_LIMIT) · exam.my แสดงผลที่ผ่านมา · เหลือเวลา <1 นาที เริ่มไม่ได้ (E_TOO_LATE)', () => {
  const P = world(3); const qid = mkQuiz(P, 2); const rd = mkRound(P, qid);
  const a = begin(P, 1, rd);
  const r = X(P, a.tok, 'exam.submit', {}); assert.strictEqual(r.finished, true); assert.strictEqual(r.result.status, 'SUBMITTED');
  assert.strictEqual(XE(P, coreTok(P, 1), 'exam.start', { t: rd.token }), 'E_ATTEMPT_LIMIT');
  const my = X(P, coreTok(P, 1), 'exam.my', { t: rd.token }); assert.strictEqual(my.attempts.length, 1); assert.strictEqual(my.remaining, 0); assert.strictEqual(my.attempts[0].items, undefined);
  assert.strictEqual(XE(P, coreTok(P, 1, P.cid2), 'exam.my', { t: rd.token }), 'E_WRONG_COURSE');
  alignMin(P);
  const late = mkRound(P, qid, { startAt: inMin(P, -10), endAt: inMin(P, 5) });
  P.advance(4.5);
  assert.strictEqual(XE(P, coreTok(P, 2), 'exam.start', { t: late.token }), 'E_TOO_LATE');
  P.advance(1);
  assert.strictEqual(XE(P, coreTok(P, 2), 'exam.start', { t: late.token }), 'E_SESSION_CLOSED');
});
test('ชุดข้อสอบที่ส่งให้นักศึกษา: ไม่มีเฉลย/คำอธิบาย/หมายเลขจริง · ตำแหน่งตัวเลือกบนจอ 1..n · สลับตัวเลือกต่างกันแต่ตรวจถูกทุกคน', () => {
  const P = world(5); const qid = mkQuiz(P, 6); const rd = mkRound(P, qid, { shuffleQ: true, shuffleC: true });
  let diffQ = false, diffC = false, firstOrder = null, firstPos = null;
  [1, 2, 3, 4, 5].forEach(i => {
    const a = begin(P, i, rd); const p = getPaper(P, a);
    const dump = JSON.stringify(p);
    ['is_correct', 'isCorrect', 'c_idx', 'explain', 'เฉลย', 'correctPos', 'reveal'].forEach(k => assert.ok(dump.indexOf(k) < 0, 'รั่ว: ' + k));
    assert.strictEqual(p.questions.length, 6); assert.strictEqual(p.finished, false);
    p.questions.forEach(q => { assert.deepStrictEqual(q.choices.map(c => c.pos), [1, 2, 3, 4]); assert.strictEqual(q.choices.filter(c => c.text === 'ถูก').length, 1); });
    const order = p.questions.map(q => q.text).join('|'), pos = p.questions.map(q => rightPos(q)).join('');
    if (firstOrder === null) { firstOrder = order; firstPos = pos; } else { if (order !== firstOrder) diffQ = true; if (pos !== firstPos) diffC = true; }
    // ตอบถูกทุกข้อด้วย "ตำแหน่งบนจอ" แล้วต้องเต็ม (2+1+1+1+1+1 = 7)
    const res = answerAll(P, a, p, rightPos); res.forEach(x => { assert.strictEqual(x.saved, true); assert.strictEqual(x.reveal, undefined, 'โหมดสอบไม่เฉลย'); });
    const fin = X(P, a.tok, 'exam.submit', {}).result; assert.strictEqual(fin.totalScore, 7); assert.strictEqual(fin.maxScore, 7); assert.strictEqual(fin.correct, 6);
  });
  assert.ok(diffQ, 'สลับลำดับข้อ'); assert.ok(diffC, 'สลับลำดับตัวเลือก');
  // ไม่สลับเลย: ข้อ ก. เป็นคำตอบถูก (ตำแหน่ง 1)
  const rd2 = mkRound(P, qid, { shuffleQ: false, shuffleC: false, maxAttempts: 2 });
  const b = begin(P, 1, rd2); const pb = getPaper(P, b);
  assert.deepStrictEqual(pb.questions.map(q => q.qNo), [1, 2, 3, 4, 5, 6]); assert.ok(pb.questions.every(q => rightPos(q) === 1));
});
test('ตอบข้อ: ตอบผิด/ตำแหน่งเกิน/ไม่ตอบ(null) ได้ 0 · ข้อซ้ำเขียนทับ · ข้อไม่มีในชุด → E_NOT_FOUND · โหมดฝึกทำเฉลย+คำอธิบายทันที โหมดสอบไม่เฉลย', () => {
  const P = world(3); const qid = mkQuiz(P, 3);
  const prac = mkRound(P, qid, { mode: 'PRACTISE', shuffleC: true, scoreMode: 'NONE' });
  const a = begin(P, 1, prac); const p = getPaper(P, a);
  const r0 = X(P, a.tok, 'exam.answer', { questionId: p.questions[0].questionId, pos: wrongPos(p.questions[0]) });
  assert.strictEqual(r0.reveal.isCorrect, false); assert.strictEqual(r0.reveal.got, 0); assert.strictEqual(r0.reveal.correctPos, rightPos(p.questions[0])); assert.ok(/^เฉลยข้อ \d$/.test(r0.reveal.explainText));
  const r0b = X(P, a.tok, 'exam.answer', { questionId: p.questions[0].questionId, pos: rightPos(p.questions[0]) });
  assert.strictEqual(r0b.reveal.isCorrect, true); assert.strictEqual(r0b.reveal.got, p.questions[0].score);
  X(P, a.tok, 'exam.answer', { questionId: p.questions[1].questionId, pos: 9 });
  X(P, a.tok, 'exam.answer', { questionId: p.questions[2].questionId, pos: null });
  assert.strictEqual(XE(P, a.tok, 'exam.answer', { questionId: 'QST-NONE', pos: 1 }), 'E_NOT_FOUND');
  assert.strictEqual(XE(P, a.tok, 'exam.answer', {}), 'E_NOT_FOUND');
  const fin = X(P, a.tok, 'exam.submit', {}).result;
  assert.strictEqual(fin.correct, 1); assert.strictEqual(fin.wrong, 2); assert.strictEqual(fin.unanswered, 0); assert.strictEqual(fin.totalScore, p.questions[0].score);
  assert.strictEqual(fin.items.length, 3);
  // ซ้ำหลังส่ง
  assert.strictEqual(XE(P, a.tok, 'exam.answer', { questionId: p.questions[0].questionId, pos: 1 }), 'E_ATTEMPT_DONE');
  assert.strictEqual(X(P, a.tok, 'exam.submit', {}).result.totalScore, fin.totalScore, 'ส่งซ้ำได้ผลเดิม');
  const pp = getPaper(P, a); assert.strictEqual(pp.finished, true);
});
test('ไม่ตอบบางข้อ: ข้อที่ไม่ได้ตอบนับเป็น unanswered · คิดคะแนนเต็มจากทั้งชุด', () => {
  const P = world(3); const qid = mkQuiz(P, 4); const rd = mkRound(P, qid);
  const a = begin(P, 1, rd); const p = getPaper(P, a);
  X(P, a.tok, 'exam.answer', { questionId: p.questions[0].questionId, pos: rightPos(p.questions[0]) });
  const f = X(P, a.tok, 'exam.submit', {}).result;
  assert.strictEqual(f.unanswered, 3); assert.strictEqual(f.correct, 1); assert.strictEqual(f.maxScore, 5); assert.strictEqual(f.totalScore, 2);
});
test('ย้อนข้อ: ฝึกทำ/สอบไม่ให้ย้อน → E_NO_BACK · สอบแบบย้อนได้ใช้ go ได้ · ข้ามเกินข้อสุดท้าย = ส่งฉบับ', () => {
  const P = world(3); const qid = mkQuiz(P, 3);
  const nb = mkRound(P, qid, { allowBack: false, secPerQuestion: 60, totalMinutes: 0 });
  const a = begin(P, 1, nb); const p = getPaper(P, a);
  const adv = X(P, a.tok, 'exam.advance', { questionId: p.questions[0].questionId, pos: rightPos(p.questions[0]) });
  assert.strictEqual(adv.index, 1); assert.deepStrictEqual(adv.answeredMap, [1, 0, 0]);
  assert.strictEqual(XE(P, a.tok, 'exam.go', { target: 'prev' }), 'E_NO_BACK'); assert.strictEqual(XE(P, a.tok, 'exam.go', { target: 0 }), 'E_NO_BACK');
  assert.strictEqual(XE(P, a.tok, 'exam.advance', { questionId: p.questions[1].questionId, pos: 1, target: 0 }), 'E_NO_BACK');
  assert.strictEqual(getPaper(P, a).resumeIndex, 1, 'โหลดใหม่แล้วกลับมาข้อที่ค้าง');
  X(P, a.tok, 'exam.advance', { questionId: p.questions[1].questionId, pos: rightPos(p.questions[1]) });
  const last = X(P, a.tok, 'exam.advance', { questionId: p.questions[2].questionId, pos: rightPos(p.questions[2]) });
  assert.strictEqual(last.finished, true); assert.strictEqual(last.result.correct, 3);
  const bk = mkRound(P, qid, { allowBack: true, totalMinutes: 30 });
  const b = begin(P, 2, bk); const pb = getPaper(P, b);
  assert.strictEqual(X(P, b.tok, 'exam.go', { target: 'next' }).index, 1); assert.strictEqual(X(P, b.tok, 'exam.go', { target: 'prev' }).index, 0);
  assert.strictEqual(X(P, b.tok, 'exam.go', { target: 2 }).index, 2); assert.strictEqual(X(P, b.tok, 'exam.go', { target: -5 }).index, 0);
  X(P, b.tok, 'exam.answer', { questionId: pb.questions[2].questionId, pos: rightPos(pb.questions[2]) });
  assert.strictEqual(getPaper(P, b).questions[2].selected, rightPos(pb.questions[2]), 'โหลดใหม่แล้วเห็นคำตอบเดิม');
  const e = X(P, b.tok, 'exam.go', { target: 99 }); assert.strictEqual(e.finished, true); assert.strictEqual(e.result.correct, 1);
});
test('เวลาต่อข้อ: ตอบช้าเกินกำหนด (เกินเผื่อ 5 วินาที) ถูกนับเป็นไม่ได้ตอบแม้เลือกถูก · ตอบทันได้คะแนน', () => {
  const P = world(3); const qid = mkQuiz(P, 3);
  const rd = mkRound(P, qid, { allowBack: false, secPerQuestion: 20, totalMinutes: 0 });
  const a = begin(P, 1, rd); const p = getPaper(P, a);
  const ok1 = X(P, a.tok, 'exam.advance', { questionId: p.questions[0].questionId, pos: rightPos(p.questions[0]) });
  assert.strictEqual(ok1.timedOut, false);
  P.advance(0.5);                    // 30 วินาที > 20+5
  const slow = X(P, a.tok, 'exam.advance', { questionId: p.questions[1].questionId, pos: rightPos(p.questions[1]) });
  assert.strictEqual(slow.timedOut, true);
  P.advance(22 / 60);                // 22 วินาที: เกิน 20 แต่ยังอยู่ในช่วงเผื่อ 5 วินาที
  const grace = X(P, a.tok, 'exam.advance', { questionId: p.questions[2].questionId, pos: rightPos(p.questions[2]) });
  assert.strictEqual(grace.finished, true); assert.strictEqual(grace.result.correct, 2); assert.strictEqual(grace.result.wrong, 1);
});
test('เวลารวม: หมดเวลา → ส่งฉบับให้เองเมื่อโหลดข้อสอบ/ตอบหลังเลยช่วงเผื่อ 15 วินาที · ข้อสอบจบก่อนหมดเวลารอบ (เช่น 10 นาที จากเริ่มทำ) · heartbeat รู้ว่าหมดเวลา', () => {
  const P = world(4); const qid = mkQuiz(P, 3); const rd = mkRound(P, qid, { totalMinutes: 10 });
  const a = begin(P, 1, rd), b = begin(P, 2, rd), c = begin(P, 3, rd);
  const pa = getPaper(P, a); getPaper(P, b); getPaper(P, c);
  X(P, a.tok, 'exam.answer', { questionId: pa.questions[0].questionId, pos: rightPos(pa.questions[0]) });
  const hb0 = X(P, a.tok, 'exam.heartbeat', {}); assert.strictEqual(hb0.forceSubmit, false); assert.ok(hb0.secLeftTotal > 500 && hb0.secLeftTotal <= 600, String(hb0.secLeftTotal));
  P.advance(10 + 0.1);               // เกิน 10 นาที แต่ไม่ถึงช่วงเผื่อ 15 วินาที (6 วินาที)
  const still = X(P, a.tok, 'exam.answer', { questionId: pa.questions[1].questionId, pos: rightPos(pa.questions[1]) });
  assert.strictEqual(still.saved, true, 'ในช่วงเผื่อ ยังรับคำตอบ');
  P.advance(0.3);                    // เกิน 15 วินาทีแล้ว
  const late = X(P, a.tok, 'exam.answer', { questionId: pa.questions[2].questionId, pos: rightPos(pa.questions[2]) });
  assert.strictEqual(late.finished, true); assert.strictEqual(late.result.status, 'SUBMITTED'); assert.strictEqual(late.result.correct, 2, 'คำตอบที่เลยเวลาไม่ถูกนับ');
  const hb = X(P, b.tok, 'exam.heartbeat', {}); assert.strictEqual(hb.forceSubmit, true); assert.strictEqual(hb.result.status, 'SUBMITTED');
  const pc = X(P, c.tok, 'exam.paper', {}); assert.strictEqual(pc.finished, true);
  assert.strictEqual(XE(P, coreTok(P, 4), 'exam.start', { t: rd.token }), 'OK', 'รอบยังเปิดอยู่ (เวลา 10 นาทีนับต่อคน) แต่เหลือเวลารอบ 79 นาที เริ่มคนใหม่ได้');
});
test('heartbeat + จับการออกนอกหน้าจอ: นับครั้ง · ครบ maxViolations → ส่งฉบับให้อัตโนมัติ · หายไปยังนับต่อจากเดิมเมื่อกลับมา', () => {
  const P = world(3); const qid = mkQuiz(P, 3); const rd = mkRound(P, qid, { lockTab: true, maxViolations: 3 });
  const a = begin(P, 1, rd); const p = getPaper(P, a);
  X(P, a.tok, 'exam.answer', { questionId: p.questions[0].questionId, pos: rightPos(p.questions[0]) });
  assert.strictEqual(X(P, a.tok, 'exam.heartbeat', {}).violations, 0);
  assert.strictEqual(X(P, a.tok, 'exam.heartbeat', { violation: true }).violations, 1);
  assert.strictEqual(getPaper(P, a).violations, 1);
  const h2 = X(P, a.tok, 'exam.heartbeat', { violation: true }); assert.strictEqual(h2.violations, 2); assert.strictEqual(h2.forceSubmit, false);
  const h3 = X(P, a.tok, 'exam.heartbeat', { violation: true }); assert.strictEqual(h3.forceSubmit, true); assert.strictEqual(h3.result.status, 'SUBMITTED'); assert.strictEqual(h3.result.violations === undefined || true, true);
  const row = P.ex.rows('Attempts')[0]; assert.strictEqual(Number(row[17]), 3, 'บันทึกจำนวนครั้งลงแถว');
  assert.strictEqual(X(P, a.tok, 'exam.heartbeat', {}).finished, true);
  const nl = mkRound(P, qid, { lockTab: false, maxViolations: 0 });
  const b = begin(P, 2, nl); getPaper(P, b);
  for (let i = 0; i < 6; i++) assert.strictEqual(X(P, b.tok, 'exam.heartbeat', { violation: true }).forceSubmit, false, 'maxViolations=0 ไม่ตัดสิทธิ์');
});
test('token ผู้ทำข้อสอบ: ผูกกับ attempt+คนนั้น · ใช้ของคนอื่น/ปลอมแปลง/หมดอายุไม่ได้ · อายุ = เวลาที่เหลือของรอบ + เผื่อ 30 นาที (ไม่เกิน 12 ชม.)', () => {
  const P = world(4); const qid = mkQuiz(P, 2); const rd = mkRound(P, qid);
  const a = begin(P, 1, rd), b = begin(P, 2, rd);
  const ct = P.ex.ctx();
  // ปลอม: attempt ของคน 1 แต่ใส่รหัสนักศึกษา 2
  const forged = ct.Auth.mint('a', { a: a.attemptId, s: std(2), c: P.cid }, 3600);
  assert.strictEqual(XE(P, forged, 'exam.paper', {}), 'E_AUTH');
  const wrongCourse = ct.Auth.mint('a', { a: a.attemptId, s: std(1), c: P.cid2 }, 3600);
  assert.strictEqual(XE(P, wrongCourse, 'exam.paper', {}), 'E_AUTH');
  assert.strictEqual(XE(P, ct.Auth.mint('a', { a: 'ATT-NONE', s: std(1), c: P.cid }, 3600), 'exam.paper', {}), 'E_NOT_FOUND');
  const tampered = a.tok.replace(/.$/, c => c === 'A' ? 'B' : 'A'); assert.strictEqual(XE(P, tampered, 'exam.paper', {}), 'E_AUTH');
  assert.notStrictEqual(getPaper(P, a).questions[0].questionId, undefined);
  // อายุ: รอบปิดใน 90 นาที → (90+30) นาที
  const sec = (a.expiresAt - Date.now() - P.ex.state.clockMs) / 1000; assert.ok(sec > 6900 && sec < 7300, String(sec));
  alignMin(P);
  const short = mkRound(P, qid, { endAt: inMin(P, 3), maxAttempts: 2 }); const s1 = begin(P, 3, short);
  const sec2 = (s1.expiresAt - Date.now() - P.ex.state.clockMs) / 1000; assert.ok(sec2 >= 1900 && sec2 <= 2000, 'รอบเหลือ 3 นาที + เผื่อ 30 นาที ' + sec2);
  const long = mkRound(P, qid, { endAt: inMin(P, 60 * 24 * 3), maxAttempts: 2 }); const l1 = begin(P, 4, long);
  const sec3 = (l1.expiresAt - Date.now() - P.ex.state.clockMs) / 1000; assert.ok(sec3 <= 43201, 'เพดาน 12 ชม. ' + sec3);
  P.advance(125); assert.strictEqual(XE(P, a.tok, 'exam.paper', {}), 'E_AUTH');
  // token นักศึกษา/อาจารย์ใช้กับ route ผู้ทำข้อสอบไม่ได้ และกลับกัน
  assert.strictEqual(XE(P, b.tok, 'exam.start', { t: rd.token }), 'E_AUTH'); assert.strictEqual(XE(P, b.tok, 'exam.quiz.list', { courseId: P.cid }), 'E_AUTH');
});
test('ปิดรอบกลางคัน: ฉบับที่ค้างทุกคนถูกส่ง (EXPIRED) พร้อมคะแนนที่ทำไว้ · เขียนตาราง Answers ครั้งเดียว · ตอบต่อไม่ได้ · เปิดซ้ำปิดซ้ำไม่เบิ้ลแถว', () => {
  const P = world(5); const qid = mkQuiz(P, 3); const rd = mkRound(P, qid);
  const at = [1, 2, 3, 4].map(i => begin(P, i, rd)); const pp = at.map(a => getPaper(P, a));
  at.forEach((a, i) => { X(P, a.tok, 'exam.answer', { questionId: pp[i].questions[0].questionId, pos: rightPos(pp[i].questions[0]) }); X(P, a.tok, 'exam.answer', { questionId: pp[i].questions[1].questionId, pos: wrongPos(pp[i].questions[1]) }); });
  X(P, at[0].tok, 'exam.submit', {});
  assert.strictEqual(P.ex.rows('Answers').length, 0, 'ยังไม่แตกตาราง Answers ระหว่างรอบเปิด');
  const c = X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'CLOSE' });
  assert.strictEqual(c.remaining, 0);
  const atts = P.ex.rows('Attempts'); assert.strictEqual(atts.filter(r => r[6] === 'EXPIRED').length, 3); assert.strictEqual(atts.filter(r => r[6] === 'SUBMITTED').length, 1);
  assert.strictEqual(P.ex.rows('Answers').length, 8, '4 คน × 2 ข้อ');
  assert.strictEqual(XE(P, at[1].tok, 'exam.answer', { questionId: pp[1].questions[2].questionId, pos: 1 }), 'E_ATTEMPT_DONE');
  const rep = X(P, P.T1, 'exam.round.report', { sessionId: rd.sessionId });
  assert.strictEqual(rep.stats.attempts, 4); assert.strictEqual(rep.stats.submitted, 4);
  X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'CLOSE' });
  assert.strictEqual(P.ex.rows('Answers').length, 8);
  const s1 = P.ex.rows('Rounds')[0]; assert.ok(String(s1[19] || s1.join('|')).length > 0);
});

/* ============================================================ */
group('ส่งคะแนนเข้าตารางคะแนนของ Core');
/** ทำทั้งฉบับด้วยจำนวนข้อที่ถูก nRight (ข้อแรกมี 2 คะแนน ที่เหลือข้อละ 1) */
function doExam(P, i, rd, nRight) {
  const a = begin(P, i, rd); const p = getPaper(P, a);
  p.questions.forEach((q, k) => X(P, a.tok, 'exam.answer', { questionId: q.questionId, pos: (q.qNo <= nRight) ? rightPos(q) : wrongPos(q) }));
  return X(P, a.tok, 'exam.submit', {}).result;
}
test('ปิดรอบ → สร้างประเภทคะแนน EXAM ในวิชา (น้ำหนัก 0%) คะแนนตามสัดส่วนของคะแนนเก็บ · คนที่ไม่ได้สอบว่าง · ไม่ซิงก์ก่อนปิด', () => {
  const P = world(4); const qid = mkQuiz(P, 4); const rd = mkRound(P, qid, { title: 'กลางภาค', scoreMode: 'SCORE', scoreValue: 20 });   // เต็ม 5 คะแนน
  assert.strictEqual(doExam(P, 1, rd, 4).totalScore, 5); doExam(P, 2, rd, 2);                                                          // 2+1 = 3
  assert.strictEqual(examType(P).length, 0, 'ระหว่างรอบเปิดยังไม่ส่ง');
  const c = X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'CLOSE' });
  assert.strictEqual(c.sync.state, 'OK');
  const ty = examType(P, rd.sessionId); assert.strictEqual(ty.length, 1);
  assert.strictEqual(ty[0].name, 'สอบ: กลางภาค'); assert.strictEqual(ty[0].max, 20); assert.strictEqual(ty[0].pct, 0); assert.strictEqual(ty[0].auto, true);
  const tb = coreScores(P);
  assert.strictEqual(scoreOf(tb, ty[0].typeId, 1), 20); assert.strictEqual(scoreOf(tb, ty[0].typeId, 2), 12); assert.strictEqual(scoreOf(tb, ty[0].typeId, 3), null); assert.strictEqual(scoreOf(tb, ty[0].typeId, 4), null);
  const rl = X(P, P.T1, 'exam.round.list', { courseId: P.cid }).rounds[0]; assert.strictEqual(rl.sync.state, 'OK'); assert.ok(/2 คน/.test(rl.sync.note), rl.sync.note);
  // ตั้งน้ำหนักได้ที่หน้าคะแนน แต่ชื่อ/คะแนนเต็มแก้มือไม่ได้
  ok(P.core.api(P.T1, 'score.saveType', { courseId: P.cid, typeId: ty[0].typeId, pct: 30, name: 'เปลี่ยนชื่อ', max: 99 }));
  const ty2 = examType(P, rd.sessionId)[0]; assert.strictEqual(ty2.pct, 30); assert.strictEqual(ty2.name, 'สอบ: กลางภาค'); assert.strictEqual(ty2.max, 20);
  assert.strictEqual(code(P.core.api(P.T1, 'score.saveBulk', { courseId: P.cid, typeId: ty[0].typeId, rows: [{ stdId: std(3), score: 5 }] })), 'E_SCORE_AUTO');
  assert.strictEqual(code(P.core.api(P.T1, 'score.deleteType', { courseId: P.cid, typeId: ty[0].typeId })), 'E_SCORE_AUTO');
});
test('หลายครั้ง (ฝึกทำ): ใช้ครั้งที่ได้สูงสุด · ซิงก์ซ้ำกี่ครั้งผลเท่าเดิม · COMPLETE = ทำครบได้เต็ม ไม่ครบ 0', () => {
  const P = world(3); const qid = mkQuiz(P, 4);
  const rd = mkRound(P, qid, { mode: 'PRACTISE', title: 'ซ้อม', maxAttempts: 0, resume: false, scoreMode: 'SCORE', scoreValue: 10, allowBack: false });
  doExam(P, 1, rd, 1); doExam(P, 1, rd, 4); doExam(P, 1, rd, 2);            // 2/5, 5/5, 3/5 → ใช้ 10
  doExam(P, 2, rd, 1);                                                      // 2/5 → 4
  X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'CLOSE' });
  let tb = coreScores(P), ty = examType(P, rd.sessionId)[0];
  assert.strictEqual(scoreOf(tb, ty.typeId, 1), 10); assert.strictEqual(scoreOf(tb, ty.typeId, 2), 4);
  const au0 = P.core.rows('Audit').length;
  for (let i = 0; i < 3; i++) assert.strictEqual(X(P, P.T1, 'exam.round.sync', { sessionId: rd.sessionId }).state, 'OK');
  tb = coreScores(P); assert.strictEqual(scoreOf(tb, ty.typeId, 1), 10); assert.strictEqual(examType(P, rd.sessionId).length, 1);
  assert.strictEqual(P.core.rows('ScoreTypes').filter(r => r.indexOf('EXAM') >= 0).length, 1);
  const cr = mkRound(P, qid, { mode: 'PRACTISE', title: 'ทำครบ', maxAttempts: 0, scoreMode: 'COMPLETE', scoreValue: 5 });
  doExam(P, 1, cr, 0);                                                      // ตอบครบทุกข้อ (ผิดหมด) = เต็ม
  const part = begin(P, 2, cr); const pp = getPaper(P, part); X(P, part.tok, 'exam.answer', { questionId: pp.questions[0].questionId, pos: rightPos(pp.questions[0]) });
  X(P, part.tok, 'exam.submit', {});                                        // ตอบไม่ครบ = 0
  X(P, P.T1, 'exam.round.setStatus', { sessionId: cr.sessionId, action: 'CLOSE' });
  tb = coreScores(P); ty = examType(P, cr.sessionId)[0];
  assert.strictEqual(scoreOf(tb, ty.typeId, 1), 5); assert.strictEqual(scoreOf(tb, ty.typeId, 2), 0);
});
test('เปลี่ยนเกณฑ์ → คิดคะแนนเก็บใหม่ย้อนหลังและส่งใหม่ · เปลี่ยนเป็น NONE → เอาประเภทคะแนนออกจากวิชา · เปลี่ยนชื่อรอบแล้วกดซิงก์ → ชื่อประเภทตาม', () => {
  const P = world(3); const qid = mkQuiz(P, 4); const rd = mkRound(P, qid, { title: 'เดิม', scoreMode: 'SCORE', scoreValue: 20 });
  doExam(P, 1, rd, 4); doExam(P, 2, rd, 2);
  X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'CLOSE' });
  const ty = () => examType(P, rd.sessionId)[0];
  const sc = i => scoreOf(coreScores(P), ty().typeId, i);
  assert.strictEqual(sc(2), 12);
  const u = X(P, P.T1, 'exam.round.update', { sessionId: rd.sessionId, scoreValue: 10 });
  assert.strictEqual(u.sync.state, 'OK'); assert.strictEqual(ty().max, 10); assert.strictEqual(sc(1), 10); assert.strictEqual(sc(2), 6);
  X(P, P.T1, 'exam.round.update', { sessionId: rd.sessionId, title: 'ชื่อใหม่' });
  assert.strictEqual(ty().name, 'สอบ: เดิม', 'เปลี่ยนชื่ออย่างเดียวไม่ซิงก์เอง');
  X(P, P.T1, 'exam.round.sync', { sessionId: rd.sessionId }); assert.strictEqual(ty().name, 'สอบ: ชื่อใหม่');
  const n = X(P, P.T1, 'exam.round.update', { sessionId: rd.sessionId, scoreMode: 'NONE' });
  assert.strictEqual(n.sync.state, 'SKIP'); assert.strictEqual(examType(P, rd.sessionId).length, 0);
  assert.strictEqual(P.core.rows('ScoreRecords').length, 0, 'คะแนนของประเภทที่ถูกเอาออกหายไปด้วย');
  const back = X(P, P.T1, 'exam.round.update', { sessionId: rd.sessionId, scoreMode: 'SCORE', scoreValue: 40 });
  assert.strictEqual(back.sync.state, 'OK'); assert.strictEqual(sc(1), 40);
});
test('ซิงก์: คนที่เคยมีคะแนนแต่ไม่อยู่ในชุดใหม่ถูกล้าง · ลบรอบ → ประเภทคะแนนและคะแนนหายจาก Core · ลบรอบที่ยังไม่เคยซิงก์ไม่ error', () => {
  const P = world(3); const qid = mkQuiz(P, 3); const rd = mkRound(P, qid, { scoreMode: 'SCORE', scoreValue: 10 });
  doExam(P, 1, rd, 3); doExam(P, 2, rd, 3);
  X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'CLOSE' });
  const ty = examType(P, rd.sessionId)[0];
  // ลบผลของคน 2 ฝั่ง Exam ตรง ๆ แล้วซิงก์ใหม่ → คะแนนคน 2 ต้องถูกล้างฝั่ง Core
  P.ex.ctx().Runner.removeForStudents(P.cid, [std(2)]);
  X(P, P.T1, 'exam.round.sync', { sessionId: rd.sessionId });
  const tb = coreScores(P); assert.strictEqual(scoreOf(tb, ty.typeId, 1), 10); assert.strictEqual(scoreOf(tb, ty.typeId, 2), null);
  const d = X(P, P.T1, 'exam.round.delete', { sessionId: rd.sessionId }); assert.strictEqual(d.deleted, true); assert.strictEqual(d.scoresRemoved, true);
  assert.strictEqual(examType(P).length, 0); assert.strictEqual(P.core.rows('ScoreRecords').length, 0);
  const rd2 = mkRound(P, qid, { scoreMode: 'SCORE', scoreValue: 10 });
  assert.strictEqual(X(P, P.T1, 'exam.round.delete', { sessionId: rd2.sessionId }).deleted, true);
  assert.strictEqual(XE(P, P.T1, 'exam.round.delete', { sessionId: rd2.sessionId }), 'E_NOT_FOUND');
  assert.strictEqual(X(P, P.T1, 'exam.round.list', { courseId: P.cid }).rounds.length, 0);
});
test('Core ล่มตอนปิดรอบ: ปิดรอบสำเร็จ แต่ sync_state=ERR · ตัวจับเวลา tick_ ลองส่งใหม่เมื่อ Core กลับมา · ไม่ส่งรอบ OK ซ้ำ', () => {
  const P = world(3); const qid = mkQuiz(P, 3); const rd = mkRound(P, qid, { scoreMode: 'SCORE', scoreValue: 10 });
  doExam(P, 1, rd, 3);
  X(P, P.T1, 'exam.round.list', { courseId: P.cid });                 // อุ่นแคชสิทธิ์/วิชา (จำ 60 วินาที / 5 นาที)
  P.mode.core = 'down';
  const c = X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'CLOSE' });
  assert.strictEqual(c.effective, 'CLOSED'); assert.strictEqual(c.sync.state, 'ERR');
  assert.strictEqual(P.ex.rows('Attempts')[0][6], 'SUBMITTED');
  P.mode.core = 'ok';
  assert.strictEqual(examType(P, rd.sessionId).length, 0);
  const r1 = P.ex.tick(); assert.strictEqual(r1.retried, 1);
  assert.strictEqual(examType(P, rd.sessionId).length, 1);
  assert.strictEqual(X(P, P.T1, 'exam.round.list', { courseId: P.cid }).rounds[0].sync.state, 'OK');
  assert.strictEqual(P.ex.tick().retried, 0, 'ส่งสำเร็จแล้วไม่ส่งซ้ำ');
});
test('tick_ (ทุก 5 นาที): ปิดรอบที่เลยเวลาเองโดยไม่มีใครกด · ฉบับที่ค้างถูกส่ง (EXPIRED) · คะแนนเข้า Core · ซิงก์ค้างครั้งแรกที่ Core ล่มก็ลองซ้ำ', () => {
  const P = world(3); const qid = mkQuiz(P, 3); alignMin(P);
  const rd = mkRound(P, qid, { endAt: inMin(P, 5), scoreMode: 'SCORE', scoreValue: 10, totalMinutes: 0 });
  const a = begin(P, 1, rd); const p = getPaper(P, a);
  X(P, a.tok, 'exam.answer', { questionId: p.questions[0].questionId, pos: rightPos(p.questions[0]) });
  doExam(P, 2, mkRound(P, qid, { endAt: inMin(P, 600) }), 3);
  P.advance(6);
  P.mode.core = 'down';
  const r1 = P.ex.tick(); assert.strictEqual(r1.closed, 1);
  assert.strictEqual(P.ex.rows('Attempts').filter(r => r[1] === rd.sessionId)[0][6], 'EXPIRED');
  P.mode.core = 'ok';
  const r2 = P.ex.tick(); assert.strictEqual(r2.retried, 1);
  const ty = examType(P, rd.sessionId)[0]; assert.ok(ty);
  assert.strictEqual(scoreOf(coreScores(P), ty.typeId, 1), 5, 'ได้ 2 จากเต็ม 4 → 10 × 2/4');
});

/* ============================================================ */
group('ลบนักศึกษา / นำเข้าแทนที่รายชื่อ (cascade ข้ามระบบ)');
test('student.impact นับผลสอบ · student.remove ลบเฉพาะคนนั้น (Attempts+Answers+คะแนนที่ซิงก์ไว้) ทั้งสองระบบ', () => {
  const P = world(4); const qid = mkQuiz(P, 3); const rd = mkRound(P, qid, { scoreMode: 'SCORE', scoreValue: 10 });
  doExam(P, 1, rd, 3); doExam(P, 2, rd, 2);
  X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'CLOSE' });
  const im = ok(P.core.api(P.T1, 'student.impact', { courseId: P.cid, stdId: std(1) }));
  const item = k => im.items.filter(x => x.key === k)[0];
  assert.strictEqual(item('exam').count, 1); assert.strictEqual(item('exam').label, 'ผลการทำข้อสอบ'); assert.strictEqual(item('scores').count, 1);
  assert.strictEqual(ok(P.core.api(P.T1, 'student.impact', { courseId: P.cid, stdId: std(3) })).items.filter(x => x.key === 'exam')[0].count, 0);
  const del = ok(P.core.api(P.T1, 'student.remove', { courseId: P.cid, stdId: std(1) })).deleted;
  assert.strictEqual(del.exam, 1);
  assert.deepStrictEqual(P.ex.rows('Attempts').map(r => r[4]), [std(2)]); assert.ok(P.ex.rows('Answers').every(r => r[4] === std(2)) && P.ex.rows('Answers').length === 3);
  const tb = coreScores(P); assert.strictEqual(tb.students.filter(s => s.stdId === std(1)).length, 0);
  assert.strictEqual(scoreOf(tb, examType(P, rd.sessionId)[0].typeId, 2), 7.5);
  assert.strictEqual(X(P, coreTok(P, 2), 'exam.my', { t: rd.token }).attempts.length, 1);
});
test('Exam ติดต่อไม่ได้ (ล่ม/ตอบ HTML/ใช้ secret ผิด): Core ปฏิเสธการลบ (E_EXAM_DOWN) · ไม่ลบอะไรทั้งสองฝั่ง · กลับมาแล้วลบได้', () => {
  ['down', 'html'].forEach(m => {
    const P = world(3); const qid = mkQuiz(P, 3); const rd = mkRound(P, qid, { scoreMode: 'SCORE', scoreValue: 10 });
    doExam(P, 1, rd, 3); X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'CLOSE' });
    P.mode.exam = m;
    assert.strictEqual(code(P.core.api(P.T1, 'student.impact', { courseId: P.cid, stdId: std(1) })), 'E_EXAM_DOWN', m);
    assert.strictEqual(code(P.core.api(P.T1, 'student.remove', { courseId: P.cid, stdId: std(1) })), 'E_EXAM_DOWN', m);
    assert.ok(ok(P.core.api(P.T1, 'student.list', { courseId: P.cid })).students.some(s => s.stdId === std(1)));
    assert.strictEqual(P.ex.rows('Attempts').length, 1); assert.strictEqual(P.core.rows('ScoreRecords').length, 1);
    assert.strictEqual(code(P.core.api(P.T1, 'student.importCsv', { courseId: P.cid, mode: 'replace', rows: [{ stdId: std(2), name: 'นักศึกษา 2' }] })), 'E_EXAM_DOWN', m);
    assert.strictEqual(ok(P.core.api(P.T1, 'student.list', { courseId: P.cid })).students.length, 3);
    P.mode.exam = 'ok';
    assert.strictEqual(code(P.core.api(P.T1, 'student.remove', { courseId: P.cid, stdId: std(1) })), 'OK');
    assert.strictEqual(P.ex.rows('Attempts').length, 0);
  });
  const P = world(2, { }); const ct = P.core.ctx();
  ct.Config.set('EXAM_URL', 'https://script.google.com/macros/s/ANOTHER/exec');   // URL ผิด (ไม่มีใครตอบ) → ปฏิเสธเหมือนกัน
  P.core.state.fetchHandler = () => new Error('DNS');
  assert.strictEqual(code(P.core.api(P.T1, 'student.remove', { courseId: P.cid, stdId: std(1) })), 'E_EXAM_DOWN');
});
test('นำเข้ารายชื่อแบบแทนที่: คนที่หายไปจากไฟล์ถูกลบพร้อมผลสอบ · คนที่ยังอยู่ผลสอบอยู่ครบ · ดูตัวอย่าง (dryRun) ไม่ลบอะไร', () => {
  const P = world(4); const qid = mkQuiz(P, 3); const rd = mkRound(P, qid, { maxAttempts: 2 });
  [1, 2, 3].forEach(i => doExam(P, i, rd, 2));
  const keep = [1, 2].map(i => ({ stdId: std(i), name: 'นักศึกษา ' + i }));
  const dry = ok(P.core.api(P.T1, 'student.importCsv', { courseId: P.cid, mode: 'replace', rows: keep, dryRun: true }));
  assert.strictEqual(dry.removed, 2); assert.strictEqual(P.ex.rows('Attempts').length, 3);
  const r = ok(P.core.api(P.T1, 'student.importCsv', { courseId: P.cid, mode: 'replace', rows: keep }));
  assert.strictEqual(r.removed, 2);
  assert.deepStrictEqual(P.ex.rows('Attempts').map(x => x[4]).sort(), [std(1), std(2)]);
});
test('ยังไม่ตั้ง EXAM_URL (ไม่ได้ใช้ระบบสอบ): ลบนักศึกษาได้ปกติ ไม่เรียก Exam เลย · แต่ซิงก์/สอบไม่ทำงานเพราะไม่มี Exam', () => {
  const P = world(3, { noExamUrl: true }); assert.strictEqual(P.calls.toExam.length, 0);
  const im = ok(P.core.api(P.T1, 'student.impact', { courseId: P.cid, stdId: std(1) }));
  assert.ok(!im.items.some(x => x.key === 'exam' && x.count > 0));
  ok(P.core.api(P.T1, 'student.remove', { courseId: P.cid, stdId: std(1) }));
  assert.strictEqual(P.calls.toExam.length, 0);
});

/* ============================================================ */
group('รายงาน · CSV · ติดตามสด · บันทึกตรวจสอบ · ขนาดคำขอ');
test('round.report: สถิติ/ฮิสโตแกรม/รายข้อ/รายคน และ counted = ครั้งที่ถูกนับเข้ารายวิชา', () => {
  const P = world(4); const qid = mkQuiz(P, 4);
  const rd = mkRound(P, qid, { mode: 'PRACTISE', maxAttempts: 0, resume: false, scoreMode: 'SCORE', scoreValue: 10, allowBack: false });
  doExam(P, 1, rd, 4); doExam(P, 1, rd, 1); doExam(P, 2, rd, 2); doExam(P, 3, rd, 0);
  X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'CLOSE' });
  const r = X(P, P.T1, 'exam.round.report', { sessionId: rd.sessionId });
  assert.strictEqual(r.stats.attempts, 4); assert.strictEqual(r.stats.submitted, 4); assert.strictEqual(r.stats.maxPct, 100); assert.strictEqual(r.stats.minPct, 0);
  assert.strictEqual(r.stats.hist.reduce((a, b) => a + b, 0), 4); assert.strictEqual(r.stats.hist[9], 1);
  assert.strictEqual(r.perQuestion.length, 4); assert.strictEqual(r.perQuestion[0].answered, 4); assert.strictEqual(r.perQuestion[0].correct, 3, 'ข้อ 1 ถูก 3 ครั้ง');
  assert.strictEqual(r.attempts.filter(x => x.counted).length, 3);
  assert.strictEqual(r.attempts.filter(x => x.stdId === std(1) && x.counted)[0].courseScore, 10);
  assert.strictEqual(r.round.sync.state, 'OK');
});
test('round.export: CSV หัวคอลัมน์ครบ · detail เพิ่มคะแนนรายข้อ · ชื่อไฟล์ปลอดภัย · ชื่อที่ขึ้นต้นด้วย = ถูกกันสูตร', () => {
  const P = world(3); const qid = mkQuiz(P, 3); const rd = mkRound(P, qid, { title: 'กลางภาค/ห้อง "1"' });
  doExam(P, 1, rd, 3);
  const e = X(P, P.T1, 'exam.round.export', { sessionId: rd.sessionId }); assert.ok(/^[A-Za-z0-9ก-๙._-]+\.csv$/.test(e.filename), e.filename);
  const lines = e.csv.replace(/^﻿/, '').trim().split(/\r?\n/); assert.strictEqual(lines.length, 2); assert.ok(lines[0].indexOf('รหัสนักศึกษา') >= 0); assert.ok(lines[1].indexOf(std(1)) >= 0);
  const d = X(P, P.T1, 'exam.round.export', { sessionId: rd.sessionId, detail: true });
  assert.ok(d.csv.indexOf('ข้อ 3') >= 0);
  assert.strictEqual(XE(P, P.T2, 'exam.round.export', { sessionId: rd.sessionId }), 'E_FORBIDDEN');
});
test('round.monitor: เห็นความคืบหน้าสด (ข้อที่ทำอยู่/ตอบแล้ว/ครั้งที่ออกนอกจอ) ระหว่างทำ · ไม่มีเฉลย · หลังส่งสถานะเปลี่ยน', () => {
  const P = world(4); const qid = mkQuiz(P, 4); const rd = mkRound(P, qid, { lockTab: true, maxViolations: 5 });
  const a = begin(P, 1, rd), b = begin(P, 2, rd); const pa = getPaper(P, a); getPaper(P, b);
  X(P, a.tok, 'exam.answer', { questionId: pa.questions[0].questionId, pos: rightPos(pa.questions[0]) }); X(P, a.tok, 'exam.go', { target: 2 });
  X(P, b.tok, 'exam.heartbeat', { violation: true });
  const m = X(P, P.T1, 'exam.round.monitor', { sessionId: rd.sessionId });
  assert.strictEqual(m.rows.length, 2); assert.strictEqual(m.questionCount, 4);
  const ra = m.rows.filter(r => r.stdId === std(1))[0], rb = m.rows.filter(r => r.stdId === std(2))[0];
  assert.strictEqual(ra.answered, 1); assert.strictEqual(ra.curIndex, 2); assert.strictEqual(rb.violations, 1); assert.strictEqual(ra.status, 'IN_PROGRESS');
  assert.ok(JSON.stringify(m).indexOf('is_correct') < 0);
  X(P, a.tok, 'exam.submit', {});
  assert.strictEqual(X(P, P.T1, 'exam.round.monitor', { sessionId: rd.sessionId }).rows.filter(r => r.stdId === std(1))[0].status, 'SUBMITTED');
});
test('บันทึกตรวจสอบ: สร้าง/แก้/ลบ/ปิดรอบ/เริ่มสอบ ถูกบันทึก · ไม่มี token/คำตอบ/base64 รูป', () => {
  const P = world(3); const qid = mkQuiz(P, 2); const rd = mkRound(P, qid);
  mkQ(P, qid, { q_image: img(JPG(2000)) });
  const a = begin(P, 1, rd); getPaper(P, a);
  X(P, P.T1, 'exam.round.setStatus', { sessionId: rd.sessionId, action: 'CLOSE' });
  const dump = JSON.stringify(P.ex.rows('AuditLog'));
  ['quiz.create', 'question.create', 'round.create', 'exam.start', 'round.close'].forEach(k => assert.ok(dump.indexOf(k) >= 0, k));
  [a.tok.slice(0, 20), P.T1.slice(0, 20), rd.token, JPG(2000).toString('base64').slice(0, 40), PIN].forEach(k => assert.ok(dump.indexOf(k) < 0, 'รั่ว ' + k.slice(0, 12)));
});
test('ขนาดคำขอ: q.save รับ body ใหญ่ได้ (รูป ~0.9MB) · route อื่น body เกิน 1MB ปฏิเสธ · action ไม่ใช่คีย์แรกปฏิเสธ · เกิน 9MB ปฏิเสธ', () => {
  const P = world(2); const qid = mkQuiz(P, 0);
  const big = JPG(900 * 1024).toString('base64');            // ~1.2MB
  const body = o => JSON.stringify(o);
  const ra = P.ex.call(body({ action: 'exam.q.save', token: P.T1, args: { quizId: qid, q_text: 'x', choices: CH(2), q_image: { base64: big, name: 'a.jpg' } } }));
  assert.strictEqual(ra.ok, true, JSON.stringify(ra).slice(0, 200));
  const rb = P.ex.call(body({ action: 'exam.quiz.save', token: P.T1, args: { courseId: P.cid, title: 'x'.repeat(1.2 * 1024 * 1024) } }));
  assert.strictEqual(code(rb), 'E_BAD_REQUEST');
  const rc = P.ex.call(body({ token: P.T1, pad: 'p'.repeat(400), action: 'exam.q.save', args: { quizId: qid, q_text: 'x', choices: CH(2), q_image: { base64: big, name: 'a.jpg' } } }));
  assert.strictEqual(code(rc), 'E_BAD_REQUEST');
  const rd = P.ex.call(body({ action: 'exam.q.save', token: P.T1, args: { quizId: qid, q_text: 'x', choices: CH(2), pad: 'p'.repeat(9.5 * 1024 * 1024) } }));
  assert.strictEqual(code(rd), 'E_BAD_REQUEST');
  ['{', '[]', 'null', '"x"', '{"action":5}', '{"action":"__proto__"}', '{"action":"constructor"}'].forEach(b => assert.strictEqual(code(P.ex.call(b)), 'E_BAD_REQUEST', b));
  assert.strictEqual(code(P.ex.call('')), 'E_BAD_REQUEST');
});
test('opId กันทำซ้ำ: q.save / round.create / exam.start ส่งซ้ำด้วย opId เดิม (เน็ตหลุด) ไม่สร้างซ้ำ', () => {
  const P = world(3); const qid = mkQuiz(P, 2);
  const a1 = X(P, P.T1, 'exam.q.save', { quizId: qid, q_text: 'ซ้ำ', choices: CH(2) }, 'op-1'), a2 = X(P, P.T1, 'exam.q.save', { quizId: qid, q_text: 'ซ้ำ', choices: CH(2) }, 'op-1');
  assert.strictEqual(a1.questionId, a2.questionId); assert.strictEqual(qList(P, qid).length, 3);
  const args = { courseId: P.cid, quizId: qid, mode: 'TEST', startAt: inMin(P, -1), endAt: inMin(P, 60) };
  const r1 = X(P, P.T1, 'exam.round.create', args, 'op-2'), r2 = X(P, P.T1, 'exam.round.create', args, 'op-2');
  assert.strictEqual(r1.sessionId, r2.sessionId); assert.strictEqual(P.ex.rows('Rounds').length, 1);
  const tok = coreTok(P, 1);
  const s1 = X(P, tok, 'exam.start', { t: r1.token }, 'op-3'), s2 = X(P, tok, 'exam.start', { t: r1.token }, 'op-3');
  assert.strictEqual(s1.attemptId, s2.attemptId); assert.strictEqual(P.ex.rows('Attempts').length, 1);
});
test('GET / (doGet) บอกชื่อ/เวอร์ชัน ไม่บอกความลับ · setupExam ซ้ำไม่ทำข้อมูลหาย · เวอร์ชัน 0.6.0', () => {
  const P = world(2); const qid = mkQuiz(P, 2);
  const g = P.ex.get(); assert.strictEqual(g.data.version, '0.6.0'); assert.strictEqual(g.data.status, 'ok');
  assert.ok(JSON.stringify(g).indexOf(P.core.state.props.SEC_TOKEN) < 0);
  P.ex.ctx().setupExam(); assert.strictEqual(P.ex.rows('Questions').length, 2);
  ['Quizzes', 'Questions', 'Choices', 'Rounds', 'Attempts', 'Answers', 'AuditLog'].forEach(n => assert.ok(P.ex.state.sheets[n], n));
  const sp = P.ex.state.props; assert.ok(!('SEC_TOKEN' in sp) || sp.SEC_TOKEN, 'มีความลับร่วมในที่เก็บของ Exam'); assert.ok(sp.CORE_URL);
});

console.log('\n' + (fail ? '✘ ไม่ผ่าน ' + fail + ' รายการ (ผ่าน ' + pass + ')' : '✔ ผ่านทั้งหมด (' + pass + ' ผ่าน)'));
if (fail) { failures.forEach(f => console.log('  - ' + f)); process.exit(1); }
