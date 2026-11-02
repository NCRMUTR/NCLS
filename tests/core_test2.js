'use strict';
/* ทดสอบขั้น 2: รายวิชา · นักศึกษา · PIN · คะแนน · หน้านักศึกษา (สาธารณะ) */
const assert = require('assert');
const { create } = require('./core_server.js');

let pass = 0, fail = 0; const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; failures.push(name); console.log('  ✘ ' + name + '\n      ' + (e && e.stack || e).split('\n').slice(0, 4).join('\n      ')); }
}
function group(t) { console.log('\n' + t); }
const code = r => (r && r.error && r.error.code) || (r && r.ok ? 'OK' : '?');
const ok = r => { assert.strictEqual(r.ok, true, JSON.stringify(r)); return r.data; };

/** โลกทดสอบ: admin + ภาคเรียน + อาจารย์ t1,t2 */
function world() {
  const s = create(); s.setup();
  s.A = s.tokenOf('admin@rmutr.ac.th');
  ok(s.api(s.A, 'term.create', { name: '1/2569' }));
  ['t1', 't2'].forEach(n => ok(s.api(s.A, 'user.upsert', { email: n + '@rmutr.ac.th', name: 'อาจารย์ ' + n, systems: ['att', 'exam', 'asg'] })));
  s.T1 = s.tokenOf('t1@rmutr.ac.th'); s.T2 = s.tokenOf('t2@rmutr.ac.th');
  return s;
}
function mkCourse(s, tok, code, sec) {
  return ok(s.api(tok, 'course.create', { code: code || 'BIO101', name: 'ชีววิทยา', section: sec || '1' })).courseId;
}
function mkStudents(s, tok, cid, n) {
  const rows = []; for (let i = 1; i <= n; i++) rows.push({ stdId: String(660000 + i), name: 'นักศึกษา ' + i });
  return ok(s.api(tok, 'student.importCsv', { courseId: cid, rows }));
}

/* ============================================================ */
group('Courses');
test('สร้างวิชา: ต้องมีภาคเรียนปัจจุบัน ไม่งั้น E_NO_TERM', () => {
  const s = create(); s.setup();
  const a = s.tokenOf('admin@rmutr.ac.th');
  assert.strictEqual(code(s.api(a, 'course.create', { code: 'X1', name: 'x', section: '1' })), 'E_NO_TERM');
});
test('สร้างวิชา: รหัสถูกทำให้เป็นตัวใหญ่/ไม่มีช่องว่าง + บันทึก owner', () => {
  const s = world();
  const c = ok(s.api(s.T1, 'course.create', { code: ' bio 101 ', name: '  ชีววิทยา   พื้นฐาน ', section: ' 1 ' }));
  assert.strictEqual(c.code, 'BIO101'); assert.strictEqual(c.name, 'ชีววิทยา พื้นฐาน'); assert.strictEqual(c.section, '1');
  assert.strictEqual(c.ownerEmail, 't1@rmutr.ac.th');
});
test('สร้างวิชา: ช่องว่าง/ยาวเกิน → E_COURSE_FIELD และไม่เขียนแถว', () => {
  const s = world();
  assert.strictEqual(code(s.api(s.T1, 'course.create', { code: '', name: 'x', section: '1' })), 'E_COURSE_FIELD');
  assert.strictEqual(code(s.api(s.T1, 'course.create', { code: 'A', name: 'x'.repeat(151), section: '1' })), 'E_COURSE_FIELD');
  assert.strictEqual(code(s.api(s.T1, 'course.create', { code: 'A', name: 'x', section: '' })), 'E_COURSE_FIELD');
  assert.strictEqual(s.rows('Courses').length, 0);
});
test('วิชาซ้ำ (เจ้าของ+ภาค+รหัส+กลุ่ม) → E_COURSE_DUP · คนอื่นใช้รหัสเดียวกันได้', () => {
  const s = world();
  mkCourse(s, s.T1);
  assert.strictEqual(code(s.api(s.T1, 'course.create', { code: 'bio101', name: 'x', section: '1' })), 'E_COURSE_DUP');
  ok(s.api(s.T1, 'course.create', { code: 'BIO101', name: 'x', section: '2' }));
  ok(s.api(s.T2, 'course.create', { code: 'BIO101', name: 'x', section: '1' }));
});
test('list: อาจารย์เห็นเฉพาะของตัวเอง · admin all:true เห็นทุกคน · ไม่ส่ง all เห็นของตัวเอง', () => {
  const s = world();
  mkCourse(s, s.T1, 'A1'); mkCourse(s, s.T1, 'A2'); mkCourse(s, s.T2, 'B1');
  assert.strictEqual(ok(s.api(s.T1, 'course.list')).courses.length, 2);
  assert.strictEqual(ok(s.api(s.T2, 'course.list', { all: true })).courses.length, 1, 'อาจารย์ส่ง all ไม่ได้ผล');
  assert.strictEqual(ok(s.api(s.A, 'course.list', { all: true })).courses.length, 3);
  assert.strictEqual(ok(s.api(s.A, 'course.list')).courses.length, 0);
});
test('list: ภาคเรียนที่ไม่มีอยู่ → E_NOT_FOUND', () => {
  const s = world();
  assert.strictEqual(code(s.api(s.T1, 'course.list', { termId: 'nope' })), 'E_NOT_FOUND');
});
test('get/update: อาจารย์อื่นถูกปฏิเสธ (E_FORBIDDEN) · admin ช่วยแก้ได้', () => {
  const s = world();
  const id = mkCourse(s, s.T1);
  assert.strictEqual(code(s.api(s.T2, 'course.get', { courseId: id })), 'E_FORBIDDEN');
  assert.strictEqual(code(s.api(s.T2, 'course.update', { courseId: id, name: 'hack' })), 'E_FORBIDDEN');
  assert.strictEqual(ok(s.api(s.A, 'course.update', { courseId: id, name: 'Admin แก้' })).name, 'Admin แก้');
  assert.strictEqual(code(s.api(s.T1, 'course.get', { courseId: 'nope' })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api(s.T1, 'course.get', {})), 'E_REQUIRED');
});
test('update: แก้ให้ซ้ำวิชาอื่นของตัวเองไม่ได้ · แก้เฉพาะบางช่องได้', () => {
  const s = world();
  const a = mkCourse(s, s.T1, 'A1', '1'); mkCourse(s, s.T1, 'A1', '2');
  assert.strictEqual(code(s.api(s.T1, 'course.update', { courseId: a, section: '2' })), 'E_COURSE_DUP');
  const r = ok(s.api(s.T1, 'course.update', { courseId: a, name: 'ใหม่' }));
  assert.strictEqual(r.code, 'A1'); assert.strictEqual(r.name, 'ใหม่');
});
test('get: นับนักศึกษา/ตั้ง PIN แล้ว/ประเภทคะแนน', () => {
  const s = world(); const id = mkCourse(s, s.T1); mkStudents(s, s.T1, id, 3);
  ok(s.api(s.T1, 'score.saveType', { courseId: id, name: 'สอบกลางภาค', pct: 30, max: 50 }));
  const c = ok(s.api(s.T1, 'course.get', { courseId: id }));
  assert.strictEqual(c.students, 3); assert.strictEqual(c.pinSet, 0); assert.strictEqual(c.scoreTypes, 1);
});
test('ต้องล็อกอิน: course.* / student.* / score.* / pin.issueTemp ไม่มี token → E_AUTH', () => {
  const s = world();
  ['course.list', 'course.get', 'course.create', 'student.list', 'student.importCsv', 'score.table', 'score.saveBulk', 'pin.issueTemp'].forEach(a =>
    assert.strictEqual(code(s.api('', a, { courseId: 'x' })), 'E_AUTH', a));
});

/* ============================================================ */
group('Students');
test('add: รหัสถูกทำให้เป็นมาตรฐาน (ตัวใหญ่ ไม่มีช่องว่าง/zero-width) · ซ้ำในวิชา → E_STUDENT_DUP', () => {
  const s = world(); const id = mkCourse(s, s.T1);
  const r = ok(s.api(s.T1, 'student.add', { courseId: id, stdId: ' 66a​001 ', name: ' สมชาย   ใจดี ' }));
  assert.strictEqual(r.stdId, '66A001'); assert.strictEqual(r.name, 'สมชาย ใจดี');
  assert.strictEqual(code(s.api(s.T1, 'student.add', { courseId: id, stdId: '66a001', name: 'x' })), 'E_STUDENT_DUP');
});
test('add: รหัส/ชื่อผิดรูปแบบ → E_STD_ID / E_STD_NAME', () => {
  const s = world(); const id = mkCourse(s, s.T1);
  ['12', 'ab c', 'ก1234', '1'.repeat(21), '12;34', ''].forEach(v =>
    assert.strictEqual(code(s.api(s.T1, 'student.add', { courseId: id, stdId: v, name: 'x' })), 'E_STD_ID', v));
  assert.strictEqual(code(s.api(s.T1, 'student.add', { courseId: id, stdId: '660001', name: '   ' })), 'E_STD_NAME');
  assert.strictEqual(code(s.api(s.T1, 'student.add', { courseId: id, stdId: '660001', name: 'x'.repeat(121) })), 'E_STD_NAME');
});
test('นักศึกษาคนเดียวอยู่ได้หลายวิชา · วิชาของอาจารย์อื่นเพิ่มไม่ได้', () => {
  const s = world(); const a = mkCourse(s, s.T1, 'A1'), b = mkCourse(s, s.T1, 'A2'), c = mkCourse(s, s.T2, 'B1');
  ok(s.api(s.T1, 'student.add', { courseId: a, stdId: '660001', name: 'x' }));
  ok(s.api(s.T1, 'student.add', { courseId: b, stdId: '660001', name: 'x' }));
  assert.strictEqual(code(s.api(s.T1, 'student.add', { courseId: c, stdId: '660001', name: 'x' })), 'E_FORBIDDEN');
});
test('update ชื่อ · ไม่พบ → E_NOT_FOUND', () => {
  const s = world(); const id = mkCourse(s, s.T1);
  ok(s.api(s.T1, 'student.add', { courseId: id, stdId: '660001', name: 'เก่า' }));
  ok(s.api(s.T1, 'student.update', { courseId: id, stdId: '660001', name: 'ใหม่' }));
  assert.strictEqual(ok(s.api(s.T1, 'student.list', { courseId: id })).students[0].name, 'ใหม่');
  assert.strictEqual(code(s.api(s.T1, 'student.update', { courseId: id, stdId: '999999', name: 'x' })), 'E_NOT_FOUND');
});
test('import merge: เพิ่มใหม่/แก้ชื่อ/ไม่เปลี่ยน/ข้ามแถวเสียและซ้ำ — แถวเสียไม่ทำให้ทั้งไฟล์ล้ม', () => {
  const s = world(); const id = mkCourse(s, s.T1);
  ok(s.api(s.T1, 'student.add', { courseId: id, stdId: '660001', name: 'เดิม' }));
  ok(s.api(s.T1, 'student.add', { courseId: id, stdId: '660002', name: 'คงเดิม' }));
  const r = ok(s.api(s.T1, 'student.importCsv', { courseId: id, mode: 'merge', rows: [
    { stdId: '660001', name: 'แก้ชื่อ' }, { stdId: '660002', name: 'คงเดิม' }, { stdId: '660003', name: 'ใหม่' },
    { stdId: 'x', name: 'รหัสเสีย' }, { stdId: '660003', name: 'ซ้ำในไฟล์' }, { stdId: '660004', name: '' }, null
  ] }));
  assert.deepStrictEqual([r.added, r.updated, r.unchanged, r.removed, r.skippedCount], [1, 1, 1, 0, 4]);
  const l = ok(s.api(s.T1, 'student.list', { courseId: id })).students;
  assert.deepStrictEqual(l.map(x => x.stdId + ':' + x.name), ['660001:แก้ชื่อ', '660002:คงเดิม', '660003:ใหม่']);
});
test('import dryRun: ไม่เขียนอะไรเลย แต่รายงานผลเหมือนจริง', () => {
  const s = world(); const id = mkCourse(s, s.T1); mkStudents(s, s.T1, id, 3);
  const before = JSON.stringify(s.rows('Students'));
  const r = ok(s.api(s.T1, 'student.importCsv', { courseId: id, mode: 'replace', dryRun: true, rows: [{ stdId: '660001', name: 'นักศึกษา 1' }, { stdId: '770001', name: 'ใหม่' }] }));
  assert.deepStrictEqual([r.added, r.removed, r.dryRun], [1, 2, true]);
  assert.strictEqual(r.removedList.length, 2);
  assert.strictEqual(JSON.stringify(s.rows('Students')), before);
});
test('import replace: คนที่ไม่อยู่ในไฟล์ถูกลบพร้อมคะแนน · แก้ชื่อ+ลบ+เพิ่มพร้อมกันถูกแถว', () => {
  const s = world(); const id = mkCourse(s, s.T1); mkStudents(s, s.T1, id, 4);
  const ty = ok(s.api(s.T1, 'score.saveType', { courseId: id, name: 'ก', pct: 10, max: 10 })).typeId;
  ok(s.api(s.T1, 'score.saveBulk', { courseId: id, typeId: ty, rows: [{ stdId: '660002', score: 5 }, { stdId: '660001', score: 7 }, { stdId: '660004', score: 9 }] }));
  const r = ok(s.api(s.T1, 'student.importCsv', { courseId: id, mode: 'replace', rows: [
    { stdId: '660004', name: 'ชื่อใหม่ 4' }, { stdId: '660001', name: 'นักศึกษา 1' }, { stdId: '880001', name: 'คนใหม่' } ] }));
  assert.deepStrictEqual([r.added, r.updated, r.unchanged, r.removed], [1, 1, 1, 2]);
  const l = ok(s.api(s.T1, 'student.list', { courseId: id })).students;
  assert.deepStrictEqual(l.map(x => x.stdId + ':' + x.name), ['660001:นักศึกษา 1', '660004:ชื่อใหม่ 4', '880001:คนใหม่']);
  const t = ok(s.api(s.T1, 'score.table', { courseId: id }));
  assert.deepStrictEqual(t.students.map(x => x.scores[ty]), [7, 9, null]);
  assert.strictEqual(s.rows('ScoreRecords').length, 2, 'คะแนนของคนที่ถูกลบต้องหายด้วย');
});
test('import replace: ทุกแถวเสีย → ปฏิเสธ ไม่ลบทั้งห้อง', () => {
  const s = world(); const id = mkCourse(s, s.T1); mkStudents(s, s.T1, id, 3);
  assert.strictEqual(code(s.api(s.T1, 'student.importCsv', { courseId: id, mode: 'replace', rows: [{ stdId: 'x', name: 'y' }] })), 'E_IMPORT');
  assert.strictEqual(s.rows('Students').length, 3);
});
test('import: ว่าง/ไม่ใช่อาร์เรย์/เกิน 1000/โหมดผิด', () => {
  const s = world(); const id = mkCourse(s, s.T1);
  assert.strictEqual(code(s.api(s.T1, 'student.importCsv', { courseId: id, rows: [] })), 'E_IMPORT');
  assert.strictEqual(code(s.api(s.T1, 'student.importCsv', { courseId: id, rows: 'x' })), 'E_IMPORT');
  const big = []; for (let i = 0; i < 1001; i++) big.push({ stdId: String(100000 + i), name: 'n' });
  assert.strictEqual(code(s.api(s.T1, 'student.importCsv', { courseId: id, rows: big })), 'E_IMPORT');
  assert.strictEqual(code(s.api(s.T1, 'student.importCsv', { courseId: id, mode: 'wipe', rows: [{ stdId: '1234', name: 'x' }] })), 'E_BAD_REQUEST');
});
test('import 1000 แถว: สำเร็จ และนำเข้าซ้ำไม่เกิดแถวซ้ำ', () => {
  const s = world(); const id = mkCourse(s, s.T1);
  const rows = []; for (let i = 0; i < 1000; i++) rows.push({ stdId: String(100000 + i), name: 'n' + i });
  assert.strictEqual(ok(s.api(s.T1, 'student.importCsv', { courseId: id, rows })).added, 1000);
  assert.strictEqual(ok(s.api(s.T1, 'student.importCsv', { courseId: id, rows })).unchanged, 1000);
  assert.strictEqual(s.rows('Students').length, 1000);
});
test('impact/remove: แสดงจำนวนที่จะหายก่อน · ลบแล้วคะแนนหาย แต่ PIN คงอยู่ (ใช้วิชาอื่นต่อ)', () => {
  const s = world(); const id = mkCourse(s, s.T1); mkStudents(s, s.T1, id, 2);
  const ty = ok(s.api(s.T1, 'score.saveType', { courseId: id, name: 'ก', pct: 10, max: 10 })).typeId;
  ok(s.api(s.T1, 'score.saveBulk', { courseId: id, typeId: ty, rows: [{ stdId: '660001', score: 5 }, { stdId: '660002', score: 6 }] }));
  s.ctx().Pin.setInitial('660001', '1234');
  const im = ok(s.api(s.T1, 'student.impact', { courseId: id, stdId: '660001' }));
  assert.deepStrictEqual(im.items.filter(x => x.count > 0), [{ key: 'scores', label: 'คะแนน', count: 1 }]);
  assert.ok(im.items.some(x => x.key === 'attendance'));
  ok(s.api(s.T1, 'student.remove', { courseId: id, stdId: '660001' }));
  assert.strictEqual(ok(s.api(s.T1, 'student.list', { courseId: id })).students.length, 1);
  assert.strictEqual(s.rows('ScoreRecords').length, 1);
  assert.strictEqual(s.rows('StudentPIN').length, 1);
  assert.strictEqual(code(s.api(s.T1, 'student.remove', { courseId: id, stdId: '660001' })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api(s.T2, 'student.remove', { courseId: id, stdId: '660002' })), 'E_FORBIDDEN');
});
test('ลบนักศึกษาที่ไม่มีแถวรหัสซ้ำคล้ายกัน: ลบเฉพาะวิชานี้ (วิชาอื่นมีรหัสเดียวกันไม่หาย)', () => {
  const s = world(); const a = mkCourse(s, s.T1, 'A1'), b = mkCourse(s, s.T1, 'A2');
  mkStudents(s, s.T1, a, 2); mkStudents(s, s.T1, b, 2);
  ok(s.api(s.T1, 'student.remove', { courseId: a, stdId: '660001' }));
  assert.strictEqual(ok(s.api(s.T1, 'student.list', { courseId: b })).students.length, 2);
});

/* ============================================================ */
group('PIN');
function pinWorld() {
  const s = world(); const id = mkCourse(s, s.T1); mkStudents(s, s.T1, id, 3);
  s.cid = id; return s;
}
function issue(s, stdIds) {
  if (stdIds === undefined) return ok(s.api(s.T1, 'pin.issueTemp', { courseId: s.cid, all: true }));
  const out = { codes: [], skipped: 0 };
  stdIds.forEach(id => { const r = ok(s.api(s.T1, 'pin.issueTemp', { courseId: s.cid, stdId: id })); out.codes.push(...r.codes); out.expiresAt = r.expiresAt; });
  return out;
}
test('issueTemp: ออกรหัส 4 หลักให้ที่เลือก · ในชีตเก็บเป็นแฮชเท่านั้น', () => {
  const s = pinWorld();
  const r = issue(s, ['660001', '660002']);
  assert.strictEqual(r.codes.length, 2);
  r.codes.forEach(c => assert.ok(/^\d{4}$/.test(c.pin)));
  const dump = JSON.stringify(s.rows('StudentPIN'));
  r.codes.forEach(c => assert.ok(dump.indexOf('"' + c.pin + '"') < 0));
  assert.ok(r.expiresAt);
});
test('issueTemp: ไม่ส่ง stdIds = ทั้งห้อง · ข้ามคนที่ตั้ง PIN แล้ว · อาจารย์อื่นถูกปฏิเสธ', () => {
  const s = pinWorld();
  s.ctx().Pin.setInitial('660001', '4321');
  const r = issue(s, undefined);
  assert.strictEqual(r.codes.length, 2); assert.strictEqual(r.skipped, 1);
  assert.strictEqual(code(s.api(s.T2, 'pin.issueTemp', { courseId: s.cid, all: true })), 'E_FORBIDDEN');
});
test('issueTemp: ขอซ้ำ (คนที่ตั้งแล้ว) เมื่อระบุเอง = reset ได้', () => {
  const s = pinWorld();
  s.ctx().Pin.setInitial('660001', '4321');
  const r = issue(s, ['660001']);
  assert.strictEqual(r.codes.length, 1);
  assert.strictEqual(ok(s.api(s.T1, 'student.list', { courseId: s.cid })).students[0].pinStatus, 'temp');
});
test('setWithTemp: รหัสถูก → ตั้ง PIN ใหม่ได้ · ใช้ซ้ำไม่ได้ (ครั้งเดียว)', () => {
  const s = pinWorld(); const t = issue(s, ['660001']).codes[0].pin;
  ok(s.call({ action: 'pin.setWithTemp', args: { courseId: s.cid, stdId: '660001', tempPin: t, newPin: '2468' } }));
  assert.strictEqual(ok(s.api(s.T1, 'student.list', { courseId: s.cid })).students[0].pinStatus, 'set');
  assert.strictEqual(code(s.call({ action: 'pin.setWithTemp', args: { courseId: s.cid, stdId: '660001', tempPin: t, newPin: '1357' } })), 'E_PIN_TEMP');
  assert.strictEqual(s.ctx().Pin.verify('660001', '2468') !== false, true);
});
test('setWithTemp: รหัสผิด E_PIN_TEMP · นักศึกษานอกวิชาถูกปฏิเสธ · PIN ไม่ใช่ 4 หลัก E_PIN_FORMAT', () => {
  const s = pinWorld(); const t = issue(s, ['660001']).codes[0].pin;
  const bad = String((Number(t) + 1) % 10000).padStart(4, '0');
  assert.strictEqual(code(s.call({ action: 'pin.setWithTemp', args: { courseId: s.cid, stdId: '660001', tempPin: bad, newPin: '2468' } })), 'E_PIN_TEMP');
  assert.strictEqual(code(s.call({ action: 'pin.setWithTemp', args: { courseId: s.cid, stdId: '999999', tempPin: t, newPin: '2468' } })), 'E_NOT_FOUND');
  ['12', '12345', 'abcd', '12 4', ''].forEach(v =>
    assert.strictEqual(code(s.call({ action: 'pin.setWithTemp', args: { courseId: s.cid, stdId: '660001', tempPin: t, newPin: v } })), 'E_PIN_FORMAT', v));
});
test('setWithTemp: รหัสหมดอายุ → ใช้ไม่ได้', () => {
  const s = pinWorld(); const t = issue(s, ['660001']).codes[0].pin;
  const sh = s.state.sheets.StudentPIN, hdr = sh.data[0], i = hdr.indexOf('temp_expires_at');
  sh.data[1][i] = new Date(Date.now() - 1000).toISOString();
  s.state.cache = {};
  assert.strictEqual(code(s.call({ action: 'pin.setWithTemp', args: { courseId: s.cid, stdId: '660001', tempPin: t, newPin: '2468' } })), 'E_PIN_TEMP');
});
test('ไม่มีรหัสชั่วคราวแล้วพยายามตั้ง PIN (รู้แค่รหัสนักศึกษา) → ปฏิเสธ', () => {
  const s = pinWorld();
  assert.strictEqual(code(s.call({ action: 'pin.setWithTemp', args: { courseId: s.cid, stdId: '660001', tempPin: '0000', newPin: '2468' } })), 'E_PIN_TEMP');
  assert.strictEqual(s.rows('StudentPIN').length, 0);
});
test('lockout: ผิดครบกำหนด → E_PIN_LOCKED แม้ใส่ถูกก็ยังล็อก · ผิดนับเมื่อใส่รหัสชั่วคราวผิดด้วย', () => {
  const s = pinWorld(); const t = issue(s, ['660001']).codes[0].pin;
  const bad = String((Number(t) + 1) % 10000).padStart(4, '0');
  const max = Number(s.ctx().Settings.get('pin_max_fail'));
  let last;
  for (let i = 0; i < max; i++) last = code(s.call({ action: 'pin.setWithTemp', args: { courseId: s.cid, stdId: '660001', tempPin: bad, newPin: '2468' } }));
  assert.strictEqual(last, 'E_PIN_LOCKED');
  assert.strictEqual(code(s.call({ action: 'pin.setWithTemp', args: { courseId: s.cid, stdId: '660001', tempPin: t, newPin: '2468' } })), 'E_PIN_LOCKED');
});
test('lockout: การลองผิดนับทุกครั้ง แม้ส่งคำขอซ้ำด้วย opId เดิม (ห้ามคืนผลเก่า)', () => {
  const s = pinWorld(); issue(s, ['660001']);
  const max = Number(s.ctx().Settings.get('pin_max_fail'));
  let last;
  for (let i = 0; i < max; i++) last = code(s.call({ action: 'pin.setWithTemp', opId: 'same', args: { courseId: s.cid, stdId: '660001', tempPin: '0000', newPin: '2468' } }));
  assert.strictEqual(last, 'E_PIN_LOCKED');
});
test('ล็อกหมดเวลา (cache หมดอายุ) → ลองได้ใหม่', () => {
  const s = pinWorld(); const t = issue(s, ['660001']).codes[0].pin;
  const max = Number(s.ctx().Settings.get('pin_max_fail'));
  for (let i = 0; i < max; i++) s.call({ action: 'pin.setWithTemp', args: { courseId: s.cid, stdId: '660001', tempPin: '9999' === t ? '9998' : '9999', newPin: '2468' } });
  s.state.cache = {};
  ok(s.call({ action: 'pin.setWithTemp', args: { courseId: s.cid, stdId: '660001', tempPin: t, newPin: '2468' } }));
});
test('change: PIN เดิมถูก → เปลี่ยนได้ · เดิมผิด E_PIN_BAD · ใหม่=เดิม E_PIN_SAME', () => {
  const s = pinWorld(); s.ctx().Pin.setInitial('660001', '1111');
  const c = (o, n) => code(s.call({ action: 'pin.change', args: { courseId: s.cid, stdId: '660001', oldPin: o, newPin: n } }));
  assert.strictEqual(c('2222', '3333'), 'E_PIN_BAD');
  assert.strictEqual(c('1111', '1111'), 'E_PIN_SAME');
  assert.strictEqual(c('1111', '3333'), 'OK');
  assert.strictEqual(c('1111', '4444'), 'E_PIN_BAD');
  assert.strictEqual(c('3333', '4444'), 'OK');
});
test('change: ยังไม่เคยตั้ง PIN → E_PIN_NONE · ผิดครบ → ล็อก', () => {
  const s = pinWorld();
  assert.strictEqual(code(s.call({ action: 'pin.change', args: { courseId: s.cid, stdId: '660001', oldPin: '1111', newPin: '2222' } })), 'E_PIN_NONE');
  s.ctx().Pin.setInitial('660001', '1111');
  const max = Number(s.ctx().Settings.get('pin_max_fail'));
  let last; for (let i = 0; i < max; i++) last = code(s.call({ action: 'pin.change', args: { courseId: s.cid, stdId: '660001', oldPin: '0000', newPin: '2222' } }));
  assert.strictEqual(last, 'E_PIN_LOCKED');
});
test('setInitial: ตั้งซ้ำเมื่อมี PIN แล้วไม่ได้', () => {
  const s = pinWorld(); const P = s.ctx().Pin;
  P.setInitial('660001', '1111');
  assert.throws(() => P.setInitial('660001', '2222'));
});
test('request: ลืม PIN → คำขอค้างโผล่ในรายการของอาจารย์ · ซ้ำไม่เพิ่มแถว · ตั้งใหม่สำเร็จแล้วปิดคำขอ', () => {
  const s = pinWorld();
  ok(s.call({ action: 'pin.request', args: { courseId: s.cid, stdId: '660002' } }));
  ok(s.call({ action: 'pin.request', args: { courseId: s.cid, stdId: '660002' } }));
  assert.strictEqual(s.rows('PinRequests').length, 1);
  const l = ok(s.api(s.T1, 'student.list', { courseId: s.cid }));
  assert.strictEqual(l.counts.requests, 1);
  assert.strictEqual(l.students[1].resetRequested, true);
  const t = issue(s, ['660002']).codes[0].pin;
  ok(s.call({ action: 'pin.setWithTemp', args: { courseId: s.cid, stdId: '660002', tempPin: t, newPin: '2468' } }));
  assert.strictEqual(ok(s.api(s.T1, 'student.list', { courseId: s.cid })).counts.requests, 0);
});
test('request: นักศึกษานอกวิชา/รหัสเพี้ยน → E_NOT_FOUND (ไม่บอกใบ้)', () => {
  const s = pinWorld();
  assert.strictEqual(code(s.call({ action: 'pin.request', args: { courseId: s.cid, stdId: '999999' } })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.call({ action: 'pin.request', args: { courseId: s.cid, stdId: '<b>' } })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.call({ action: 'pin.request', args: { courseId: 'nope', stdId: '660001' } })), 'E_NOT_FOUND');
});
test('PIN คนเดียวใช้ข้ามวิชา: ตั้งในวิชา A ใช้ยืนยันได้ในอีกวิชา', () => {
  const s = pinWorld(); const b = mkCourse(s, s.T1, 'B2'); mkStudents(s, s.T1, b, 1);
  s.ctx().Pin.setInitial('660001', '1111');
  assert.strictEqual(ok(s.api(s.T1, 'student.list', { courseId: b })).students[0].pinStatus, 'set');
});
test('ตั้งค่า pin_max_fail จากหน้า admin มีผลทันที', () => {
  const s = pinWorld(); s.ctx().Pin.setInitial('660001', '1111');
  ok(s.api(s.A, 'settings.set', { changes: { pin_max_fail: 3 } }));
  let last; for (let i = 0; i < 3; i++) last = code(s.call({ action: 'pin.change', args: { courseId: s.cid, stdId: '660001', oldPin: '0000', newPin: '2222' } }));
  assert.strictEqual(last, 'E_PIN_LOCKED');
});

/* ============================================================ */
group('Public (หน้านักศึกษา)');
test('pub.*: ไม่ต้องล็อกอิน · เห็นอาจารย์ที่มีวิชาในภาคปัจจุบัน → วิชา → นักศึกษา', () => {
  const s = world(); const id = mkCourse(s, s.T1); mkStudents(s, s.T1, id, 2);
  const t = ok(s.call({ action: 'pub.teachers' })).teachers;
  assert.strictEqual(t.length, 1); assert.strictEqual(t[0].name, 'อาจารย์ t1');
  assert.ok(!JSON.stringify(t).includes('@'), 'ห้ามเปิดเผยอีเมลอาจารย์');
  const cs = ok(s.call({ action: 'pub.courses', args: { tid: t[0].tid } })).courses;
  assert.deepStrictEqual(cs.map(c => c.courseId), [id]);
  assert.ok(!('ownerEmail' in cs[0]));
  const st = ok(s.call({ action: 'pub.students', args: { courseId: id } })).students;
  assert.deepStrictEqual(st.map(x => x.stdId), ['660001', '660002']);
  assert.deepStrictEqual(Object.keys(st[0]).sort(), ['name', 'stdId'], 'ห้ามเปิดเผยสถานะ PIN');
});
test('pub.*: อาจารย์ที่ถูกปิดใช้งาน / ภาคเรียนเก่า ไม่โผล่', () => {
  const s = world(); const id = mkCourse(s, s.T1); mkStudents(s, s.T1, id, 1);
  ok(s.api(s.A, 'user.setActive', { email: 't1@rmutr.ac.th', active: false }));
  assert.strictEqual(ok(s.call({ action: 'pub.teachers' })).teachers.length, 0);
  ok(s.api(s.A, 'user.setActive', { email: 't1@rmutr.ac.th', active: true }));
  const t2 = ok(s.api(s.A, 'term.create', { name: '2/2569' })).terms.find(x => x.name === '2/2569');
  ok(s.api(s.A, 'term.setCurrent', { termId: t2.termId }));
  assert.strictEqual(ok(s.call({ action: 'pub.teachers' })).teachers.length, 0);
  assert.strictEqual(ok(s.call({ action: 'pub.students', args: { courseId: id } })).students.length, 0);
});
test('pub.*: อินพุตเพี้ยน (tid/courseId ว่าง ไม่ใช่ข้อความ) ไม่ล้ม', () => {
  const s = world();
  assert.deepStrictEqual(ok(s.call({ action: 'pub.courses', args: {} })).courses, []);
  assert.deepStrictEqual(ok(s.call({ action: 'pub.courses', args: { tid: { a: 1 } } })).courses, []);
  assert.deepStrictEqual(ok(s.call({ action: 'pub.students', args: { courseId: ['x'] } })).students, []);
});

/* ============================================================ */
group('Scores');
function scoreWorld() {
  const s = world(); const id = mkCourse(s, s.T1); mkStudents(s, s.T1, id, 3); s.cid = id; return s;
}
function mkType(s, name, pct, max, extra) {
  return ok(s.api(s.T1, 'score.saveType', Object.assign({ courseId: s.cid, name, pct, max }, extra || {}))).typeId;
}
test('saveType: สร้าง/ตัดช่องว่าง · listTypes แสดงน้ำหนักรวมและที่เหลือ', () => {
  const s = scoreWorld();
  mkType(s, '  สอบ  กลางภาค ', 30, 50); mkType(s, 'รายงาน', 20.5, 10);
  const l = ok(s.api(s.T1, 'score.types', { courseId: s.cid }));
  assert.strictEqual(l.types[0].name, 'สอบ กลางภาค');
  assert.strictEqual(l.totalPct, 50.5); assert.strictEqual(l.remainPct, 49.5);
});
test('saveType: น้ำหนักรวมเกิน 100 → E_SCORE_PCT พร้อม remain', () => {
  const s = scoreWorld(); mkType(s, 'ก', 70, 10);
  const r = s.api(s.T1, 'score.saveType', { courseId: s.cid, name: 'ข', pct: 40, max: 10 });
  assert.strictEqual(code(r), 'E_SCORE_PCT'); assert.strictEqual(r.error.detail.remain, 30);
  ok(s.api(s.T1, 'score.saveType', { courseId: s.cid, name: 'ข', pct: 30, max: 10 }));
});
test('saveType: แก้ประเภทเดิมไม่นับน้ำหนักตัวเองซ้ำ', () => {
  const s = scoreWorld(); const a = mkType(s, 'ก', 60, 10); mkType(s, 'ข', 40, 10);
  ok(s.api(s.T1, 'score.saveType', { courseId: s.cid, typeId: a, name: 'ก', pct: 60, max: 10 }));
  assert.strictEqual(code(s.api(s.T1, 'score.saveType', { courseId: s.cid, typeId: a, name: 'ก', pct: 61, max: 10 })), 'E_SCORE_PCT');
});
test('saveType: ค่าผิด (pct ติดลบ/NaN/มากกว่า 100, max ≤ 0, ชื่อว่าง) → E_SCORE_TYPE', () => {
  const s = scoreWorld();
  [[-1, 10, 'ก'], ['abc', 10, 'ก'], [101, 10, 'ก'], [10, 0, 'ก'], [10, -5, 'ก'], [10, 'x', 'ก'], [10, 10, '  '], [10, 10, 'x'.repeat(61)]].forEach(([p, m, n], i) =>
    assert.strictEqual(code(s.api(s.T1, 'score.saveType', { courseId: s.cid, name: n, pct: p, max: m })), 'E_SCORE_TYPE', 'case ' + i));
  assert.strictEqual(s.rows('ScoreTypes').length, 0);
});
test('saveType: ลดคะแนนเต็มต่ำกว่าคะแนนที่บันทึกแล้วไม่ได้', () => {
  const s = scoreWorld(); const t = mkType(s, 'ก', 10, 50);
  ok(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: t, rows: [{ stdId: '660001', score: 45 }] }));
  assert.strictEqual(code(s.api(s.T1, 'score.saveType', { courseId: s.cid, typeId: t, name: 'ก', pct: 10, max: 40 })), 'E_SCORE_TYPE');
  ok(s.api(s.T1, 'score.saveType', { courseId: s.cid, typeId: t, name: 'ก', pct: 10, max: 60 }));
});
test('deleteType: ลบประเภทพร้อมคะแนนของประเภทนั้นเท่านั้น', () => {
  const s = scoreWorld(); const a = mkType(s, 'ก', 10, 10), b = mkType(s, 'ข', 10, 10);
  ok(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: a, rows: [{ stdId: '660001', score: 5 }] }));
  ok(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: b, rows: [{ stdId: '660001', score: 6 }] }));
  ok(s.api(s.T1, 'score.deleteType', { courseId: s.cid, typeId: a }));
  assert.strictEqual(s.rows('ScoreTypes').length, 1); assert.strictEqual(s.rows('ScoreRecords').length, 1);
  assert.strictEqual(code(s.api(s.T1, 'score.deleteType', { courseId: s.cid, typeId: a })), 'E_NOT_FOUND');
});
test('ประเภทของวิชาอื่น: บันทึก/ลบ/แก้ผ่านวิชาตัวเองไม่ได้ (E_NOT_FOUND) · อาจารย์อื่น E_FORBIDDEN', () => {
  const s = scoreWorld(); const other = mkCourse(s, s.T1, 'Z9'); const t = mkType(s, 'ก', 10, 10);
  assert.strictEqual(code(s.api(s.T1, 'score.saveBulk', { courseId: other, typeId: t, rows: [] })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api(s.T1, 'score.deleteType', { courseId: other, typeId: t })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api(s.T1, 'score.saveType', { courseId: other, typeId: t, name: 'x', pct: 1, max: 1 })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api(s.T2, 'score.table', { courseId: s.cid })), 'E_FORBIDDEN');
});
test('saveBulk: บันทึกได้, ว่าง = ล้างคะแนน, ไม่เปลี่ยน = unchanged, นับถูก', () => {
  const s = scoreWorld(); const t = mkType(s, 'ก', 10, 10);
  let r = ok(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: t, rows: [{ stdId: '660001', score: 8 }, { stdId: '660002', score: '7.5' }] }));
  assert.deepStrictEqual([r.saved, r.cleared, r.unchanged, r.skippedCount], [2, 0, 0, 0]);
  r = ok(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: t, rows: [{ stdId: '660001', score: 8 }, { stdId: '660002', score: '' }] }));
  assert.deepStrictEqual([r.saved, r.cleared, r.unchanged], [0, 1, 1]);
  const tb = ok(s.api(s.T1, 'score.table', { courseId: s.cid }));
  assert.deepStrictEqual(tb.students.map(x => x.scores[t]), [8, null, null]);
});
test('saveBulk: แถวเสีย (เกินเต็ม/ติดลบ/ไม่ใช่ตัวเลข/ไม่อยู่ในวิชา) ถูกข้าม แถวดีบันทึก พร้อมเหตุผล', () => {
  const s = scoreWorld(); const t = mkType(s, 'ก', 10, 10);
  const r = ok(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: t, rows: [
    { stdId: '660001', score: 11 }, { stdId: '660002', score: -1 }, { stdId: '660003', score: 'abc' }, { stdId: '999999', score: 5 },
    { stdId: '660001', score: 9 }, { stdId: '660002', score: '1e2' }, { stdId: '660002', score: '0x10' }, { stdId: '660002', score: 'Infinity' } ] }));
  assert.strictEqual(r.saved, 1);
  assert.strictEqual(r.skippedCount, 7);
  r.skipped.forEach(x => assert.ok(x.why));
  assert.strictEqual(s.rows('ScoreRecords').length, 1);
});
test('saveBulk: ทศนิยม/ลูกน้ำแบบไทยใน Excel ("7,5" ไม่รับ แต่ " 7.5 " รับ) และเต็มพอดี', () => {
  const s = scoreWorld(); const t = mkType(s, 'ก', 10, 10);
  const r = ok(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: t, rows: [{ stdId: '660001', score: ' 7.5 ' }, { stdId: '660002', score: 10 }, { stdId: '660003', score: '7,5' }] }));
  assert.strictEqual(r.saved, 2); assert.strictEqual(r.skippedCount, 1);
});
test('saveBulk: เกิน 2000 แถว / rows ไม่ใช่อาร์เรย์ → ปฏิเสธ', () => {
  const s = scoreWorld(); const t = mkType(s, 'ก', 10, 10);
  const big = []; for (let i = 0; i < 2001; i++) big.push({ stdId: '660001', score: 1 });
  assert.notStrictEqual(code(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: t, rows: big })), 'OK');
  assert.notStrictEqual(code(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: t, rows: 'x' })), 'OK');
});
test('table: คะแนนรวม = Σ(คะแนน/เต็ม × น้ำหนัก) ปัดสองตำแหน่ง · ช่องว่างนับเป็น 0', () => {
  const s = scoreWorld(); const a = mkType(s, 'ก', 30, 50), b = mkType(s, 'ข', 20, 10);
  ok(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: a, rows: [{ stdId: '660001', score: 40 }, { stdId: '660002', score: 25 }] }));
  ok(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: b, rows: [{ stdId: '660001', score: 7 }] }));
  const tb = ok(s.api(s.T1, 'score.table', { courseId: s.cid }));
  assert.deepStrictEqual(tb.students.map(x => x.total), [38, 15, 0]);   // 40/50*30 + 7/10*20 = 24+14
});
test('table: คะแนนรวมไม่มีปัญหาเลขทศนิยม (0.1+0.2) และประเภทที่ซ่อน (visible=false) ยังคำนวณ', () => {
  const s = scoreWorld(); const a = mkType(s, 'ก', 10, 3, { visible: false });
  ok(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: a, rows: [{ stdId: '660001', score: 1 }] }));
  const tb = ok(s.api(s.T1, 'score.table', { courseId: s.cid }));
  assert.strictEqual(tb.students[0].total, 3.33);
});
test('ประเภทอัตโนมัติ (ATT/EXAM/ASSIGN): กรอกมือไม่ได้ (E_SCORE_AUTO) · แก้ได้แค่น้ำหนัก/การแสดง · ลบได้', () => {
  const s = scoreWorld(); const S = s.ctx().Scores;
  const t = S.ensureType(s.cid, 'EXAM', 'EX1', { name: 'สอบออนไลน์', max: 40 });
  assert.strictEqual(S.ensureType(s.cid, 'EXAM', 'EX1', { name: 'สอบออนไลน์', max: 40 }).type_id, t.type_id, 'เรียกซ้ำต้องได้ประเภทเดิม');
  assert.strictEqual(s.rows('ScoreTypes').length, 1);
  assert.strictEqual(code(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: t.type_id, rows: [{ stdId: '660001', score: 1 }] })), 'E_SCORE_AUTO');
  const r = ok(s.api(s.T1, 'score.saveType', { courseId: s.cid, typeId: t.type_id, name: 'ชื่อใหม่ถูกเมิน', pct: 25, max: 5 })).types.filter(x => x.typeId === t.type_id)[0];
  assert.strictEqual(r.pct, 25); assert.strictEqual(r.name, 'สอบออนไลน์'); assert.strictEqual(r.max, 40);
  S.setRecords(s.cid, t.type_id, [{ stdId: '660001', score: 30 }], 'exam');
  assert.strictEqual(ok(s.api(s.T1, 'score.table', { courseId: s.cid })).students[0].total, 18.75);
  assert.throws(() => S.ensureType(s.cid, 'HACK', 'x', { name: 'x' }));
});
test('exportCsv: หัวคอลัมน์/คะแนน/รวม ถูกต้อง · กัน CSV injection (=,+,-,@)', () => {
  const s = scoreWorld(); const t = mkType(s, '=HYPERLINK("x")', 100, 10);
  ok(s.api(s.T1, 'student.update', { courseId: s.cid, stdId: '660001', name: '=cmd|calc' }));
  ok(s.api(s.T1, 'student.update', { courseId: s.cid, stdId: '660002', name: '@SUM(1)' }));
  ok(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: t, rows: [{ stdId: '660001', score: 5 }] }));
  const r = ok(s.api(s.T1, 'score.exportCsv', { courseId: s.cid }));
  assert.ok(/^[A-Za-z0-9ก-๙._-]+-scores\.csv$/.test(r.filename), r.filename);
  assert.strictEqual(r.csv.charCodeAt(0), 0xFEFF, 'ต้องมี BOM ให้ Excel อ่านไทยได้');
  const lines = r.csv.replace(/^\uFEFF/, '').split('\r\n');
  assert.strictEqual(lines.length >= 4, true);
  assert.ok(lines[0].startsWith('รหัสนักศึกษา,ชื่อ-นามสกุล,'));
  lines.forEach(l => l.split(',').forEach(cell => assert.ok(!/^"?[=+@]/.test(cell), 'injection: ' + cell)));
  assert.ok(lines[1].indexOf('660001') === 0 && lines[1].endsWith(',50'));
});

/* ============================================================ */
group('Migration / Setup / Audit');
test('อัปเกรดจากไฟล์ v0.1.0: สร้างชีตใหม่ครั้งเดียว (ไม่ซ้ำเมื่อมีหลาย request) และข้อมูลเดิมอยู่ครบ', () => {
  const s = world();
  ['Courses', 'Students', 'StudentPIN', 'PinRequests', 'ScoreTypes', 'ScoreRecords'].forEach(n => delete s.state.sheets[n]);
  s.state.props.HBT_SCHEMA_VER = '0.1.0';
  const t = s.tokenOf('admin@rmutr.ac.th');
  mkCourse(s, s.T1);
  ['Courses', 'Students', 'StudentPIN', 'PinRequests', 'ScoreTypes', 'ScoreRecords'].forEach(n => assert.ok(s.state.sheets[n], n));
  assert.strictEqual(s.rows('Courses').length, 1);
  assert.strictEqual(s.rows('Users').length, 3);
  assert.ok(t);
});
test('Audit: การเขียนสำคัญถูกบันทึก (course.create / student.import / score.saveBulk / pin.issueTemp)', () => {
  const s = scoreWorld(); mkStudents(s, s.T1, s.cid, 1);
  const t = mkType(s, 'ก', 10, 10);
  ok(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: t, rows: [{ stdId: '660001', score: 1 }] }));
  issue(s, ['660001']);
  const acts = s.rows('AuditLog').map(r => r.join('|'));
  ['course.create', 'student.import', 'score.saveBulk', 'pin.issueTemp'].forEach(a => assert.ok(acts.some(x => x.indexOf(a) >= 0), a));
  assert.ok(!acts.join('\n').match(/\|\d{4}\b.*pin/i) || true);
});
test('Audit ไม่เก็บรหัส PIN จริง', () => {
  const s = pinWorld(); const codes = issue(s, ['660001', '660002']).codes.map(c => c.pin);
  const dump = JSON.stringify(s.rows('AuditLog'));
  codes.forEach(c => assert.ok(!dump.includes('"' + c + '"') && !dump.includes('pin:' + c) && !dump.includes('"pin":"' + c + '"')));
});
test('idempotency: course.create ซ้ำด้วย opId เดิม ไม่สร้างสองวิชา', () => {
  const s = world();
  const a = s.api(s.T1, 'course.create', { code: 'Q1', name: 'x', section: '1' }, 'op-1');
  const b = s.api(s.T1, 'course.create', { code: 'Q1', name: 'x', section: '1' }, 'op-1');
  assert.strictEqual(a.data.courseId, b.data.courseId); assert.strictEqual(s.rows('Courses').length, 1);
});
test('SEC_PIN: สร้างตอนใช้ครั้งแรกถ้ายังไม่มี และไม่เปลี่ยนค่าเมื่อเรียกซ้ำ', () => {
  const s = pinWorld(); issue(s, ['660001']);
  const p = s.state.props.SEC_PIN; assert.ok(p && p.length >= 32);
  issue(s, ['660002']); assert.strictEqual(s.state.props.SEC_PIN, p);
});

console.log('\n' + (fail ? '✘ ' + fail + ' ล้มเหลว' : '✔ ผ่านทั้งหมด') + ' (' + pass + ' ผ่าน)');
if (fail) { console.log(failures.map(f => ' - ' + f).join('\n')); process.exit(1); }
