'use strict';
/* ทดสอบขั้น 6: สำรองข้อมูล (สถานะ/รายการ) + admin รีเซ็ตวิชา/ภาคเรียน (ลบถาวร: Core + Drive + Exam)
 * ใช้ตัวจำลอง 2 ระบบ (pair.js): Core ↔ Exam คุยกันผ่าน UrlFetchApp จำลอง · แต่ละระบบมีชีต/แคช/Drive ของตัวเอง
 * หมายเหตุ: การคุยข้าม GAS จริง (redirect 302, เวลาตอบสนอง, โควตา UrlFetch) และโหลดพร้อมกันหลายคนต้องทดสอบบน Apps Script จริง */
const assert = require('assert');
const { createPair } = require('./pair.js');

let pass = 0, fail = 0; const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; failures.push(name); console.log('  ✘ ' + name + '\n      ' + (e && e.stack || e).split('\n').filter((l,i)=>i<5||/core_test6/.test(l)).slice(0, 8).join('\n      ')); }
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


const b64 = buf => buf.toString('base64');
const coreDrive = P => P.core.state.drv;
const liveCore = P => Object.values(coreDrive(P).files).length;
const rowsOf = (P, sheet) => P.core.rows(sheet);
const colIdx = (P, sheet, col) => P.core.state.sheets[sheet].data[0].indexOf(col);
const countBy = (P, sheet, col, val) => { const i = colIdx(P, sheet, col); return rowsOf(P, sheet).filter(r => r[i] === val).length; };
const exCount = (P, sheet, cid) => { const i = P.exState.sheets[sheet].data[0].indexOf('course_id'); return P.ex.rows(sheet).filter(r => r[i] === cid).length; };
const exImages = P => Object.values(P.exState.drv.files).length;
const CONFIRM = (P, cid) => { const r = ok(P.core.api(P.A, 'course.get', { courseId: cid })); return r.code + '-' + r.section; };
const resetAll = (P, cid, over) => {              // วนเรียกจนเสร็จ (เหมือนหน้าเว็บ) · คืนรายการผลทุกครั้ง
  const out = []; let r;
  for (let i = 0; i < 30; i++) {
    r = P.core.api(P.A, 'reset.course', Object.assign({ courseId: cid, confirm: P.confirm[cid] }, over || {}));
    out.push(r); if (!r.ok || r.data.done) break;
  }
  return out;
};

/* โลกที่มีข้อมูลครบทุกระบบ: วิชา 1 (BIO101) ถูกลบในเทสต์ · วิชา 2 (CHM201) ต้องไม่ถูกแตะ */
function full(opts) {
  const P = world(4, opts), core = P.core;
  P.confirm = { [P.cid]: 'BIO101-1', [P.cid2]: 'CHM201-1' };
  // คะแนน
  const ty = ok(core.api(P.T1, 'score.saveType', { courseId: P.cid, name: 'ปฏิบัติ', pct: 20, max: 10 })).typeId;
  ok(core.api(P.T1, 'score.saveBulk', { courseId: P.cid, typeId: ty, rows: [{ stdId: std(1), score: 8 }, { stdId: std(2), score: 9 }] }));
  const ty2 = ok(core.api(P.T2, 'score.saveType', { courseId: P.cid2, name: 'ปฏิบัติ', pct: 20, max: 10 })).typeId;
  ok(core.api(P.T2, 'score.saveBulk', { courseId: P.cid2, typeId: ty2, rows: [{ stdId: std(1), score: 5 }] }));
  // เช็คชื่อ (นำเข้าย้อนหลัง)
  ok(core.api(P.T1, 'att.import', { courseId: P.cid, date: '2026-08-10', rows: [{ stdId: std(1), status: 'normal' }, { stdId: std(2), status: 'late' }] }));
  ok(core.api(P.T2, 'att.import', { courseId: P.cid2, date: '2026-08-10', rows: [{ stdId: std(1), status: 'normal' }] }));
  // งาน 2 งาน + ไฟล์ (วิชา 1) · 1 งาน + ไฟล์ (วิชา 2)
  P.a1 = ok(core.api(P.T1, 'asg.save', { courseId: P.cid, title: 'รายงาน 1', kind: 'single', maxScore: 10 })).asgId;
  P.a2 = ok(core.api(P.T1, 'asg.save', { courseId: P.cid, title: 'รายงาน 2', kind: 'single', maxScore: 10 })).asgId;
  P.b1 = ok(core.api(P.T2, 'asg.save', { courseId: P.cid2, title: 'งานเคมี', kind: 'single', maxScore: 10 })).asgId;
  const up = (cid, i, asg, name) => ok(core.api(ok(core.api('', 'stu.login', { courseId: cid, stdId: std(i), pin: PIN })).token, 'stu.upload', { asgId: asg, name, b64: b64(PDF(200)) }));
  up(P.cid, 1, P.a1, 'a.pdf'); up(P.cid, 2, P.a1, 'b.pdf'); up(P.cid, 1, P.a2, 'c.pdf');
  ok(core.api(P.T1, 'asg.grade', { asgId: P.a1, grades: [{ stdId: std(1), score: 7 }] }));
  core.api('', 'pin.issueTemp', {});
  // วิชา 2: นักศึกษา std(1) ต้องมี PIN (ตั้งไว้แล้วจาก PIN ของวิชา 1 — PIN ใช้ข้ามวิชา)
  up(P.cid2, 1, P.b1, 'k.pdf');
  // สอบ: วิชา 1 มีรูป 2 รูป + รอบ + ผู้ทำ 1 คน · วิชา 2 มีรูป 1 รูป
  const z = X(P, P.T1, 'exam.quiz.save', { courseId: P.cid, title: 'ชุดที่ 1' });
  X(P, P.T1, 'exam.q.save', { quizId: z.quizId, q_type: 'image', q_text: 'ข้อ 1', q_image: img(PNG(300), 'q.png'), choices: [{ c_type: 'text', c_text: 'ถูก' }, { c_type: 'image', c_image: img(JPG(200)) }], correct: 0, score: 2 });
  X(P, P.T1, 'exam.q.save', { quizId: z.quizId, q_type: 'text', q_text: 'ข้อ 2', choices: CH(3), correct: 0, score: 1 });
  P.quiz = z.quizId; P.rd = mkRound(P, z.quizId);
  const a = begin(P, 1, P.rd); const pp = getPaper(P, a);
  X(P, a.tok, 'exam.answer', ansPos(pp, 0, 'ถูก')); X(P, a.tok, 'exam.submit', {});
  const z2 = X(P, P.T2, 'exam.quiz.save', { courseId: P.cid2, title: 'ชุดเคมี' });
  X(P, P.T2, 'exam.q.save', { quizId: z2.quizId, q_type: 'image', q_text: 'ข้อ 1', q_image: img(PNG(300), 'k.png'), choices: CH(2), correct: 0, score: 1 });
  P.quiz2 = z2.quizId;
  return P;
}
const snapshot = (P, cid) => ({
  Students: countBy(P, 'Students', 'course_id', cid), ScoreTypes: countBy(P, 'ScoreTypes', 'course_id', cid), ScoreRecords: countBy(P, 'ScoreRecords', 'course_id', cid),
  AttSessions: countBy(P, 'AttSessions', 'course_id', cid), AttRecords: countBy(P, 'AttRecords', 'course_id', cid),
  Assignments: countBy(P, 'Assignments', 'course_id', cid), AsgSubs: countBy(P, 'AsgSubs', 'course_id', cid), AsgFiles: countBy(P, 'AsgFiles', 'course_id', cid), AsgGrades: countBy(P, 'AsgGrades', 'course_id', cid),
  Quizzes: exCount(P, 'Quizzes', cid), Questions: exCount(P, 'Questions', cid), Choices: exCount(P, 'Choices', cid), Rounds: exCount(P, 'Rounds', cid), Attempts: exCount(P, 'Attempts', cid), Answers: exCount(P, 'Answers', cid)
});

/* ============================================================ */
group('โครงสร้าง · สถานะสำรอง');
test('ตาราง/เวอร์ชัน: Courses มีคอลัมน์ใหม่ต่อท้าย · ตารางที่มี course_id ทุกตัวอยู่ในรายการลบของ Reset (กันลืมตอนเพิ่มระบบใหม่)', () => {
  const P = world(1), ct = P.core.ctx();
  assert.strictEqual(P.core.get().data.version, '0.6.0'); assert.strictEqual(P.ex.get().data.version, '0.6.0');
  const hs = P.core.state.sheets.Courses.data[0];
  assert.deepStrictEqual(hs.slice(-3), ['backup_at', 'reset_at', 'reset_by']); assert.strictEqual(hs[0], 'course_id'); assert.strictEqual(hs[7], 'last_change_at');
  const withCourse = Object.keys(ct.Db.SCHEMA).filter(t => t !== 'Courses' && ct.Db.SCHEMA[t].cols.some(c => c[0] === 'course_id'));
  withCourse.forEach(t => assert.ok(ct.Reset.COURSE_TABLES.includes(t), 'ตาราง ' + t + ' มี course_id แต่ไม่อยู่ใน Reset.COURSE_TABLES'));
  ct.Reset.COURSE_TABLES.forEach(t => assert.ok(ct.Db.SCHEMA[t], 'ไม่มีตาราง ' + t));
  // Exam: ตารางที่มี course_id ทุกตัวถูกลบโดย Purge.course
  const ec = P.ex.ctx(); const src = require('fs').readFileSync(['../exam/gas/Purge.gs', '../exam/Purge.gs'].map(f => require('path').resolve(__dirname, f)).find(f => require('fs').existsSync(f)), 'utf8');
  Object.keys(ec.Db.SCHEMA).filter(t => ec.Db.SCHEMA[t].cols.some(c => c[0] === 'course_id') && t !== 'AuditLog').forEach(t => assert.ok(src.indexOf("'" + t + "'") >= 0, 'Exam ตาราง ' + t + ' ไม่อยู่ใน Purge'));
});
test('อัปเกรดจากชีต Courses เก่า (8 คอลัมน์): ensureSchema เติมคอลัมน์ท้ายตาราง ข้อมูลเดิมอยู่ครบ', () => {
  const P = world(2), core = P.core;
  const sh = core.state.sheets.Courses; const before = sh.data.map(r => r.slice(0, 8));
  sh.data = before; core.state.props.HBT_SCHEMA_VER = '0.5.0';
  const hs = (() => { core.setup(); return core.state.sheets.Courses.data[0]; })();
  assert.deepStrictEqual(hs.slice(-3), ['backup_at', 'reset_at', 'reset_by']);
  assert.strictEqual(ok(core.api(P.T1, 'course.get', { courseId: P.cid })).code, 'BIO101');
});
test('backup.manifest: รายการงาน/ไฟล์/ขนาด · สถานะ empty → none → ok → stale (แก้ข้อมูลหลังสำรอง) · mark ซ้ำได้', () => {
  const P = world(0), core = P.core;
  // วิชาว่าง (ไม่มีนักศึกษา/คาบ/งาน/ประเภทคะแนน) = empty
  assert.strictEqual(ok(core.api(P.T1, 'backup.manifest', { courseId: P.cid })).state, 'empty');
  const F = full(); const m = ok(F.core.api(F.T1, 'backup.manifest', { courseId: F.cid }));
  assert.strictEqual(m.state, 'none'); assert.strictEqual(m.students, 4); assert.strictEqual(m.attSessions, 1); assert.strictEqual(m.scoreTypes >= 1, true);
  assert.deepStrictEqual(m.assignments.map(a => [a.title, a.files, a.bytes, a.submitted]), [['รายงาน 1', 2, 400, 2], ['รายงาน 2', 1, 200, 1]]);
  assert.strictEqual(m.course.termName, '1/2569'); assert.strictEqual(m.backupAt, '');
  F.advance(1);
  const mk = ok(F.core.api(F.T1, 'backup.mark', { courseId: F.cid, parts: 3 })); assert.ok(mk.backupAt);
  assert.strictEqual(ok(F.core.api(F.T1, 'backup.manifest', { courseId: F.cid })).state, 'ok');
  F.advance(1);
  ok(F.core.api(F.T1, 'att.import', { courseId: F.cid, date: '2026-08-11', rows: [{ stdId: std(3), status: 'normal' }] }));   // แก้ข้อมูลหลังสำรอง
  assert.strictEqual(ok(F.core.api(F.T1, 'backup.manifest', { courseId: F.cid })).state, 'stale');
  F.advance(1); ok(F.core.api(F.T1, 'backup.mark', { courseId: F.cid }));
  assert.strictEqual(ok(F.core.api(F.T1, 'backup.manifest', { courseId: F.cid })).state, 'ok');
  assert.strictEqual(F.core.rows('AuditLog').filter(r => r[3] === 'backup.mark').length, 2);
});
test('backup.*: เฉพาะเจ้าของวิชา/admin · ไม่มี token → E_AUTH · วิชาที่ไม่มี → E_NOT_FOUND · token นักศึกษาใช้ไม่ได้', () => {
  const P = full();
  ['backup.manifest', 'backup.mark'].forEach(a => {
    assert.strictEqual(code(P.core.api(P.T2, a, { courseId: P.cid })), 'E_FORBIDDEN', a);
    assert.strictEqual(code(P.core.api('', a, { courseId: P.cid })), 'E_AUTH', a);
    assert.strictEqual(code(P.core.api(coreTok(P, 1), a, { courseId: P.cid })), 'E_AUTH', a);
    assert.strictEqual(code(P.core.api(P.T1, a, { courseId: 'CRS-NONE' })), 'E_NOT_FOUND', a);
    assert.strictEqual(code(P.core.api(P.A, a, { courseId: P.cid })), 'OK', a);          // admin ช่วยสำรองได้
  });
});

group('รีเซ็ต: สิทธิ์ · ข้อความยืนยัน · ภาพรวม');
test('reset.*: เฉพาะ admin (อาจารย์/นักศึกษา/ไม่มี token ใช้ไม่ได้)', () => {
  const P = full();
  ['reset.preview', 'reset.course', 'reset.term', 'reset.pins'].forEach(a => {
    assert.strictEqual(code(P.core.api(P.T1, a, { courseId: P.cid, confirm: 'BIO101-1', termId: 'x' })), 'E_FORBIDDEN', a);
    assert.strictEqual(code(P.core.api('', a, {})), 'E_AUTH', a);
    assert.strictEqual(code(P.core.api(coreTok(P, 1), a, {})), 'E_AUTH', a);
  });
  assert.deepStrictEqual(snapshot(P, P.cid).Students, 4);
});
test('reset.preview: จำนวนต่อวิชา (นักศึกษา/คาบ/งาน/ไฟล์/ขนาด/คะแนน/สอบ) + สถานะสำรอง + ไม่แตะข้อมูล', () => {
  const P = full(); P.advance(1);
  ok(P.core.api(P.T2, 'backup.mark', { courseId: P.cid2 }));
  const before = JSON.stringify(P.core.state.sheets);
  const r = ok(P.core.api(P.A, 'reset.preview', {}));
  assert.strictEqual(r.term.name, '1/2569'); assert.strictEqual(r.term.isCurrent, true); assert.strictEqual(r.examConfigured, true); assert.strictEqual(r.examError, '');
  const b = r.courses.find(c => c.code === 'BIO101'), c = r.courses.find(c => c.code === 'CHM201');
  assert.strictEqual(b.students, 4); assert.strictEqual(b.attSessions, 1); assert.strictEqual(b.assignments, 2); assert.strictEqual(b.files, 3); assert.strictEqual(b.bytes, 600);
  assert.strictEqual(b.ownerEmail, 't1@rmutr.ac.th'); assert.strictEqual(b.ownerName, 'อาจารย์ 1');
  assert.deepStrictEqual(b.exam, { quizzes: 1, questions: 2, rounds: 1, attempts: 1, images: 2 });
  assert.deepStrictEqual(c.exam, { quizzes: 1, questions: 1, rounds: 0, attempts: 0, images: 1 });
  assert.strictEqual(b.backupState, 'none'); assert.strictEqual(c.backupState, 'ok');
  assert.strictEqual(JSON.stringify(P.core.state.sheets), before);
  assert.strictEqual(code(P.core.api(P.A, 'reset.preview', { termId: 'TERM-NONE' })), 'E_NOT_FOUND');
});
test('reset.preview: Exam ติดต่อไม่ได้ → ยังแสดงข้อมูลฝั่ง Core + examError (ไม่ล้มทั้งหน้า)', () => {
  const P = full(); P.mode.exam = 'down';
  const r = ok(P.core.api(P.A, 'reset.preview', {}));
  assert.strictEqual(r.examError, 'E_EXAM_DOWN'); assert.strictEqual(r.courses.find(c => c.code === 'BIO101').exam, null); assert.strictEqual(r.courses.find(c => c.code === 'BIO101').students, 4);
});
test('reset.course: ข้อความยืนยันไม่ตรง/ว่าง → E_RESET_CONFIRM ไม่ลบอะไรและไม่ตั้งธง · วิชาที่ไม่มี → E_NOT_FOUND', () => {
  const P = full(); const snap = JSON.stringify(P.core.state.sheets), ex = JSON.stringify(P.exState.sheets);
  ['', 'bio101', 'BIO101-2', 'CHM201-1', 'x'].forEach(c => { if (c.toUpperCase() !== 'BIO101') assert.strictEqual(code(P.core.api(P.A, 'reset.course', { courseId: P.cid, confirm: c })), 'E_RESET_CONFIRM', c); });
  assert.strictEqual(JSON.stringify(P.core.state.sheets), snap); assert.strictEqual(JSON.stringify(P.exState.sheets), ex);
  assert.strictEqual(code(P.core.api(P.A, 'reset.course', { courseId: 'CRS-NONE', confirm: 'x' })), 'E_NOT_FOUND');
  // ไม่สนช่องว่าง/ตัวพิมพ์เล็กใหญ่ของข้อความยืนยัน
  assert.strictEqual(code(P.core.api(P.A, 'reset.course', { courseId: P.cid2, confirm: ' chm201 - 1 ' })), 'OK');
});

group('รีเซ็ตวิชา: ลบครบทุกระบบ ไม่แตะวิชาอื่น');
test('ลบวิชา: ทุกตารางของ Core + Exam + ไฟล์ Drive (Core) + รูปข้อสอบ (Exam) หายถาวร · วิชาอื่นครบเหมือนเดิม', () => {
  const P = full();
  assert.ok(Object.keys(coreDrive(P).folders).length >= 4); assert.strictEqual(exImages(P), 3);
  const other = snapshot(P, P.cid2), otherFiles = Object.values(coreDrive(P).files).filter(f => !f.trashed).length;
  const mine0 = snapshot(P, P.cid); assert.ok(mine0.Students && mine0.AsgFiles === 3 && mine0.Attempts === 1);
  const calls = resetAll(P, P.cid); const last = ok(calls[calls.length - 1]);
  assert.strictEqual(last.done, true); assert.strictEqual(calls.length, 1);
  const z = snapshot(P, P.cid); Object.keys(z).forEach(k => assert.strictEqual(z[k], 0, k));
  assert.strictEqual(rowsOf(P, 'Courses').some(r => r[0] === P.cid), false);
  assert.deepStrictEqual(snapshot(P, P.cid2), other);                                      // วิชา 2 ครบ
  assert.strictEqual(ok(P.core.api(P.T2, 'course.get', { courseId: P.cid2 })).students, 2);
  // Drive ของ Core: โฟลเดอร์งานของวิชา 1 + ไฟล์หายถาวร (ไม่ใช่ trashed) · ของวิชา 2 ยังอยู่
  assert.strictEqual(Object.values(coreDrive(P).files).filter(f => !f.trashed).length, otherFiles - 3);
  assert.strictEqual(Object.values(coreDrive(P).files).filter(f => f.trashed).length, 0);
  assert.strictEqual(last.drive.deleted, 2); assert.strictEqual(last.drive.trashed, 0);
  assert.ok(!Object.values(coreDrive(P).folders).some(f => /^BIO101-1_/.test(f.name))); assert.ok(Object.values(coreDrive(P).folders).some(f => /^CHM201-1_/.test(f.name)));
  // Exam: รูปของวิชา 1 หายถาวร · เหลือ 1 รูปของวิชา 2
  assert.strictEqual(exImages(P), 1); assert.strictEqual(last.exam.images, 2); assert.strictEqual(last.exam.trashed, 0);
  assert.strictEqual(last.exam.removed.Attempts, 1);
  // ข้อมูลสอบวิชา 2 ใช้งานได้ต่อ
  assert.strictEqual(X(P, P.T2, 'exam.q.list', { quizId: P.quiz2 }).questions.length, 1);
  // บันทึกการลบ (ไม่มีข้อมูลส่วนตัวนักศึกษา)
  const au = P.core.rows('AuditLog').filter(r => r[3] === 'reset.course'); assert.strictEqual(au.length, 1);
  assert.ok(au[0][5].indexOf('BIO101') >= 0 && au[0][5].indexOf(std(1)) < 0);
});
test('หลังลบ: อาจารย์เจ้าของเข้าวิชาไม่ได้ · token นักศึกษาเดิมใช้ไม่ได้ · ลิงก์/รายชื่อสาธารณะไม่มีวิชานี้ · เริ่มสอบด้วย token เดิมไม่ได้ · ลิงก์รอบสอบเดิม E_NOT_FOUND', () => {
  const P = full(); const st = coreTok(P, 1), tid = P.core.ctx().Courses.tidOf('t1@rmutr.ac.th');
  assert.strictEqual(code(P.core.api(P.T1, 'stu.tasks', {})), 'E_AUTH');
  resetAll(P, P.cid);
  assert.strictEqual(code(P.core.api(P.T1, 'course.get', { courseId: P.cid })), 'E_NOT_FOUND');
  assert.strictEqual(code(P.core.api(st, 'stu.tasks', {})), 'E_AUTH');
  assert.strictEqual(ok(P.core.api('', 'pub.courses', { tid })).courses.length, 0);
  assert.strictEqual(code(P.core.api('', 'stu.login', { courseId: P.cid, stdId: std(1), pin: PIN })), 'E_NOT_FOUND');
  assert.ok(['E_NOT_FOUND', 'E_BAD_LINK', 'E_AUTH'].includes(XE(P, st, 'exam.start', { t: P.rd.token })));
  assert.ok(['E_NOT_FOUND', 'E_BAD_LINK'].includes(code(P.ex.api('', 'exam.resolve', { t: P.rd.token }))));
  P.advance(2);                                                                  // แคชสิทธิ์ของ Exam หมดอายุ (60 วินาที)
  assert.strictEqual(code(P.ex.api(P.T1, 'exam.round.list', { courseId: P.cid }) ), 'E_NOT_FOUND');
});
test('PIN ของนักศึกษาไม่ถูกลบตอนลบวิชา (ใช้ข้ามวิชา) · ลบเฉพาะคำขอรีเซ็ต PIN ของวิชานั้น', () => {
  const P = full(); ok(P.core.api('', 'pin.request', { courseId: P.cid, stdId: std(3) }));
  assert.ok(countBy(P, 'PinRequests', 'course_id', P.cid) >= 1);
  const pins = rowsOf(P, 'StudentPIN').length; resetAll(P, P.cid);
  assert.strictEqual(rowsOf(P, 'StudentPIN').length, pins); assert.strictEqual(countBy(P, 'PinRequests', 'course_id', P.cid), 0);
});
test('ลบวิชาที่ว่างเปล่า / ไม่ได้ใช้ระบบสอบ (ไม่ตั้ง EXAM_URL) ได้ · ข้ามขั้น Exam ไม่เรียก Exam เลย', () => {
  const P = world(0, { noExamUrl: true }); P.confirm = { [P.cid]: 'BIO101-1' };
  const r = ok(resetAll(P, P.cid)[0]); assert.strictEqual(r.done, true); assert.strictEqual(r.exam, null); assert.strictEqual(P.calls.toExam.length, 0);
  assert.strictEqual(P.core.rows('Courses').some(x => x[0] === P.cid), false);
  const Q = full({ noExamUrl: true });      // มีข้อมูลสอบค้างในชีต Exam แต่ Core ไม่รู้ URL → ไม่ยุ่งกับ Exam
  const ex0 = JSON.stringify(Q.exState.sheets);
  assert.strictEqual(ok(resetAll(Q, Q.cid)[0]).done, true); assert.strictEqual(JSON.stringify(Q.exState.sheets), ex0);
});
test('Drive advanced service ไม่ได้เปิด: ทิ้งลงถังขยะแทนและรายงานจำนวน trashed (ไม่ล้ม) · ทั้ง Core และรูปของ Exam', () => {
  const P = full(); coreDrive(P).noAdvanced = true; P.exState.drv.noAdvanced = true;
  const r = ok(resetAll(P, P.cid)[0]); assert.strictEqual(r.done, true);
  assert.strictEqual(r.drive.deleted, 0); assert.strictEqual(r.drive.trashed, 2); assert.strictEqual(r.exam.trashed, 2); assert.strictEqual(r.exam.images, 2);
  assert.strictEqual(Object.values(coreDrive(P).folders).filter(f => /^BIO101-1_/.test(f.name) && f.trashed).length, 2);
  assert.strictEqual(Object.values(P.exState.drv.files).filter(f => f.trashed).length, 2);
  assert.strictEqual(snapshot(P, P.cid).Students, 0);
});
test('ไฟล์/โฟลเดอร์ใน Drive หายไปก่อนแล้ว (ผู้ใช้ลบเอง): ถือว่าลบแล้ว ไม่ล้ม', () => {
  const P = full(); Object.keys(coreDrive(P).folders).forEach(k => { if (/^BIO101-1_/.test(coreDrive(P).folders[k].name)) { Object.keys(coreDrive(P).files).forEach(f => { if (coreDrive(P).files[f].folder === k) delete coreDrive(P).files[f]; }); delete coreDrive(P).folders[k]; } });
  Object.keys(P.exState.drv.files).slice(0, 1).forEach(k => delete P.exState.drv.files[k]);
  const r = ok(resetAll(P, P.cid)[0]); assert.strictEqual(r.done, true); assert.strictEqual(snapshot(P, P.cid).Assignments, 0);
});

group('รีเซ็ต: ระหว่างทาง · ทำต่อ · Exam ล่ม');
test('Exam ไม่ตอบ "ก่อนเริ่ม": E_EXAM_DOWN ไม่ลบอะไรเลย ไม่ตั้งธง วิชายังใช้งานปกติ · Exam กลับมาแล้วลบได้', () => {
  const P = full(); P.mode.exam = 'down'; const snap = JSON.stringify(P.core.state.sheets), ex = JSON.stringify(P.exState.sheets), drv = JSON.stringify(coreDrive(P));
  assert.strictEqual(code(P.core.api(P.A, 'reset.course', { courseId: P.cid, confirm: 'BIO101-1' })), 'E_EXAM_DOWN');
  assert.strictEqual(JSON.stringify(P.core.state.sheets), snap); assert.strictEqual(JSON.stringify(P.exState.sheets), ex); assert.strictEqual(JSON.stringify(coreDrive(P)), drv);
  assert.strictEqual(code(P.core.api(P.T1, 'course.get', { courseId: P.cid })), 'OK');
  P.mode.exam = 'ok'; assert.strictEqual(ok(resetAll(P, P.cid)[0]).done, true);
});
test('Exam ดับ "กลางทาง": หยุดที่ E_EXAM_DOWN วิชาอยู่ในสถานะกำลังลบ (เข้าไม่ได้) · ลองใหม่หลัง Exam กลับมาแล้วเสร็จ ไม่ซ้ำไม่ตก', () => {
  const P = full(); const real = P.core.state.fetchHandler;
  P.core.state.fetchHandler = ((h) => (url, o) => { const a = o && o.payload ? JSON.parse(o.payload).action : ''; if (a === 'svc.purgeImages') { P.mode.exam = 'down'; } return h(url, o); })(real);
  const r1 = P.core.api(P.A, 'reset.course', { courseId: P.cid, confirm: 'BIO101-1' });
  assert.strictEqual(code(r1), 'E_EXAM_DOWN');
  assert.strictEqual(code(P.core.api(P.T1, 'course.get', { courseId: P.cid })), 'E_COURSE_RESETTING');
  assert.strictEqual(code(P.core.api(P.A, 'course.get', { courseId: P.cid })), 'E_COURSE_RESETTING');       // แม้ admin ก็ใช้งานวิชาที่กำลังลบไม่ได้
  assert.strictEqual(snapshot(P, P.cid).Students, 0);                                                          // รายชื่อออกแล้ว (นักศึกษาเข้าไม่ได้)
  assert.ok(snapshot(P, P.cid).Questions > 0);                                                                 // ข้อมูลสอบยังอยู่ รอลองใหม่
  assert.strictEqual(code(P.core.api(coreTok(P, 1, P.cid2), 'stu.tasks', {})), 'OK');                           // วิชาอื่นไม่กระทบ
  P.core.state.fetchHandler = real; P.mode.exam = 'ok';
  const r2 = ok(resetAll(P, P.cid)[0]); assert.strictEqual(r2.done, true);
  const z = snapshot(P, P.cid); Object.keys(z).forEach(k => assert.strictEqual(z[k], 0, k));
  assert.strictEqual(P.core.rows('AuditLog').filter(r => r[3] === 'reset.start').length, 1);                    // เริ่มครั้งเดียว
});
test('งบเวลา: Drive ช้า → คืน done:false ทำต่อได้ทีละช่วง ครบแล้วผลเท่ากับลบรวดเดียว · วิชาเข้าไม่ได้ระหว่างทาง', () => {
  const P = full(); coreDrive(P).slowMs = 4000;
  const a1 = ok(P.core.api(P.A, 'reset.course', { courseId: P.cid, confirm: 'BIO101-1', budgetMs: 1000 }));
  assert.strictEqual(a1.done, false); assert.strictEqual(a1.phase, 'drive'); assert.strictEqual(a1.drive.deleted, 1);
  assert.strictEqual(code(P.core.api(P.T1, 'asg.list', { courseId: P.cid })), 'E_COURSE_RESETTING');
  assert.strictEqual(exImages(P), 1);                                                                           // รูป Exam ของวิชา 1 หมดแล้วตั้งแต่ช่วงแรก
  const a2 = ok(P.core.api(P.A, 'reset.course', { courseId: P.cid, confirm: 'BIO101-1', budgetMs: 1000 }));
  assert.strictEqual(a2.done, true); assert.strictEqual(a2.drive.deleted, 1);
  assert.strictEqual(coreDrive(P).removeCalls, 2); Object.values(snapshot(P, P.cid)).forEach(v => assert.strictEqual(v, 0));
});
test('Exam รูปมาก + งบเวลาน้อย: purgeImages ทำทีละช่วง (ไม่ทำเกินงบ) แล้วค่อยลบแถว · ไม่ลบแถวถ้ายังมีรูปค้าง', () => {
  const P = full(); P.exState.drv.slowMs = 3000; const xs = P.core.ctx().Auth.mintService('core');
  const r1 = ok(P.ex.api(xs, 'svc.purgeImages', { courseId: P.cid, budgetMs: 1000 })); assert.strictEqual(r1.done, false); assert.strictEqual(r1.deleted, 1); assert.strictEqual(r1.remaining, 1);
  assert.strictEqual(ok(P.ex.api(xs, 'svc.purgeCourse', { courseId: P.cid })).done, false); assert.ok(snapshot(P, P.cid).Questions > 0);   // ยังมีรูปค้าง = ยังไม่ลบแถว
  const r2 = ok(P.ex.api(xs, 'svc.purgeImages', { courseId: P.cid, budgetMs: 1000 })); assert.strictEqual(r2.done, true);
  assert.strictEqual(ok(P.ex.api(xs, 'svc.purgeCourse', { courseId: P.cid })).done, true); assert.strictEqual(snapshot(P, P.cid).Questions, 0);
  assert.strictEqual(ok(P.ex.api(xs, 'svc.purgeCourse', { courseId: P.cid })).done, true);                                                    // ทำซ้ำได้
});
test('svc.ping/countCourses/purgeImages/purgeCourse: รับเฉพาะ token บริการ sv=core (อาจารย์/นักศึกษา/ไม่มี token/Exam เอง → E_AUTH)', () => {
  const P = full(); const ct = P.core.ctx();
  ['svc.ping', 'svc.countCourses', 'svc.purgeImages', 'svc.purgeCourse'].forEach(a =>
    [P.T1, coreTok(P, 1), '', ct.Auth.mintService('exam')].forEach(t => assert.strictEqual(XE(P, t, a, { courseId: P.cid, courseIds: [P.cid] }), 'E_AUTH', a)));
  assert.strictEqual(ok(P.ex.api(ct.Auth.mintService('core'), 'svc.ping', {})).ok, true);
  assert.strictEqual(snapshot(P, P.cid).Questions, 2);
});
test('ลบซ้ำหลังเสร็จแล้ว: E_NOT_FOUND และไม่กระทบวิชาอื่น', () => {
  const P = full(); resetAll(P, P.cid);
  assert.strictEqual(code(P.core.api(P.A, 'reset.course', { courseId: P.cid, confirm: 'BIO101-1' })), 'E_NOT_FOUND');
  assert.strictEqual(snapshot(P, P.cid2).Students, 2);
});
test('ลบทั้งภาคเรียนทีละวิชา: ครบทุกวิชา → ลบภาคเรียนได้ (ไม่ใช่ภาคปัจจุบัน) · ภาคปัจจุบัน/ยังมีวิชา/ข้อความยืนยันผิด ลบไม่ได้', () => {
  const P = full(); const t2 = ok(P.core.api(P.A, 'term.create', { name: '2/2569' })).terms.find(t => t.name === '2/2569'); const cur = ok(P.core.api(P.A, 'auth.me', {})).term;
  const c3 = ok(P.core.api(P.T1, 'course.create', { code: 'PHY101', name: 'ฟิสิกส์', section: '2', termId: t2.termId })).courseId; P.confirm[c3] = 'PHY101-2';
  assert.strictEqual(code(P.core.api(P.A, 'reset.term', { termId: cur.termId, confirm: '1/2569' })), 'E_TERM_CURRENT');
  assert.strictEqual(code(P.core.api(P.A, 'reset.term', { termId: t2.termId, confirm: '2/2569' })), 'E_TERM_HAS_COURSES');
  const pv = ok(P.core.api(P.A, 'reset.preview', { termId: t2.termId })); assert.strictEqual(pv.term.isCurrent, false); assert.deepStrictEqual(pv.courses.map(c => c.code), ['PHY101']);
  assert.strictEqual(code(P.core.api(P.A, 'reset.term', { termId: t2.termId, confirm: 'ผิด' })), 'E_RESET_CONFIRM');
  assert.strictEqual(ok(resetAll(P, c3)[0]).done, true);
  assert.strictEqual(ok(P.core.api(P.A, 'reset.term', { termId: t2.termId, confirm: '2/2569' })).removed, true);
  assert.strictEqual(ok(P.core.api(P.A, 'term.list', {})).terms ? 1 : 1, 1);
  assert.strictEqual(P.core.rows('Terms').length, 1); assert.strictEqual(code(P.core.api(P.A, 'reset.term', { termId: t2.termId, confirm: '2/2569' })), 'E_NOT_FOUND');
});
test('reset.pins: PIN ของคนที่ไม่เหลือในวิชาใดเลยถูกลบ (dryRun ดูก่อนได้) · คนที่ยังอยู่วิชาอื่นยังอยู่ · เครื่องที่จำไว้ถูกลบตาม', () => {
  const P = full(); const core = P.core;
  ok(core.api(P.T1, 'pin.issueTemp', { courseId: P.cid, all: true }));
  core.state.sheets.StudentDevices.data.push(['d1', std(3), 'dev', 'x', 'y']);
  resetAll(P, P.cid);                       // std(1) ยังอยู่วิชา 2 · std(2..4) หลุดหมด (std(90) ไม่มี PIN)
  const dry = ok(core.api(P.A, 'reset.pins', { dryRun: true })); assert.strictEqual(dry.orphans, 3);
  assert.strictEqual(rowsOf(P, 'StudentPIN').length, 4);
  const r = ok(core.api(P.A, 'reset.pins', {})); assert.strictEqual(r.removedPin, 3); assert.strictEqual(r.removedDevices, 1);
  assert.deepStrictEqual(rowsOf(P, 'StudentPIN').map(x => x[0]), [std(1)]);
  assert.strictEqual(code(core.api('', 'stu.login', { courseId: P.cid2, stdId: std(1), pin: PIN })), 'OK');
  assert.strictEqual(ok(core.api(P.A, 'reset.pins', {})).orphans, 0);
});

console.log('\n' + (fail ? '✘ มีข้อล้มเหลว ' + fail + ' ข้อ: ' + failures.join(' | ') : '✔ ผ่านทั้งหมด (' + pass + ' ผ่าน)'));
process.exit(fail ? 1 : 0);
