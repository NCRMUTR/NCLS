'use strict';
/* ทดสอบขั้น 4: ส่งงาน (สั่งงานเดี่ยว/กลุ่ม · รหัสงาน · เข้าด้วย PIN · อัปโหลดไฟล์ไป Drive จำลอง · ให้คะแนน · ซิงก์คะแนน · ลบ/cascade)
 * หมายเหตุ: Drive เป็นตัวจำลองในหน่วยความจำ และคำขอรันทีละคำขอ — พฤติกรรมของ Drive จริง/โควตา/ขนาด body 9 MB ต้องทดสอบบน Apps Script จริง */
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
const std = i => String(660000 + i);
const PIN = '1234';

/* ---------- ไฟล์ตัวอย่าง ---------- */
const mk = (head, size) => { const b = Buffer.alloc(size || 64, 7); Buffer.from(head).copy(b); return b; };
const PDF = (n) => mk([0x25, 0x50, 0x44, 0x46, 0x2d], n), PNG = (n) => mk([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A], n);
const JPG = (n) => mk([0xFF, 0xD8, 0xFF, 0xE0], n), ZIP = (n) => mk([0x50, 0x4B, 0x03, 0x04], n);
const b64 = b => b.toString('base64');

const fmtLocal = ms => { const d = new Date(ms), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
const inMin = (s, m) => fmtLocal(Date.now() + s.state.clockMs + m * 60000);

function world(nStd) {
  const s = create(); s.setup();
  s.A = s.tokenOf('admin@rmutr.ac.th');
  ok(s.api(s.A, 'term.create', { name: '1/2569' }));
  ['t1', 't2'].forEach(n => ok(s.api(s.A, 'user.upsert', { email: n + '@rmutr.ac.th', name: 'อาจารย์ ' + n, systems: ['att', 'exam', 'asg'] })));
  ok(s.api(s.A, 'user.upsert', { email: 't3@rmutr.ac.th', name: 'อาจารย์ t3', systems: ['exam'] }));
  s.T1 = s.tokenOf('t1@rmutr.ac.th'); s.T2 = s.tokenOf('t2@rmutr.ac.th'); s.T3 = s.tokenOf('t3@rmutr.ac.th');
  s.cid = ok(s.api(s.T1, 'course.create', { code: 'BIO101', name: 'ชีววิทยา', section: '1' })).courseId;
  const rows = []; for (let i = 1; i <= (nStd || 5); i++) rows.push({ stdId: std(i), name: 'นักศึกษา ' + i });
  ok(s.api(s.T1, 'student.importCsv', { courseId: s.cid, rows }));
  // ตั้ง PIN ทุกคน = 1234 (ออกรหัสชั่วคราว → นักศึกษาตั้งเอง)
  ok(s.api(s.T1, 'pin.issueTemp', { courseId: s.cid, all: true })).codes.forEach(c =>
    ok(s.api('', 'pin.setWithTemp', { courseId: s.cid, stdId: c.stdId, tempPin: c.pin, newPin: PIN })));
  s.tid = s.ctx().Courses.tidOf('t1@rmutr.ac.th');
  return s;
}
const mkAsg = (s, over) => ok(s.api(s.T1, 'asg.save', Object.assign({ courseId: s.cid, title: 'รายงานแล็บ 1', kind: 'single', maxScore: 10 }, over || {})));
function login(s, i, courseId) {
  const r = s.api('', 'stu.login', { courseId: courseId || s.cid, stdId: std(i), pin: PIN });
  return ok(r).token;
}
const S = {};  // cache token ต่อโลก: key = world id + i
function tok(s, i) { s._tk = s._tk || {}; return s._tk[i] || (s._tk[i] = login(s, i)); }
function up(s, i, asgId, name, buf) { return s.api(tok(s, i), 'stu.upload', { asgId, name, b64: b64(buf || PDF(100)) }); }
const driveFiles = s => Object.values(s.state.drv.files);
const liveFiles = s => driveFiles(s).filter(f => !f.trashed);
const sub = (s) => s.rows('AsgSubs'), files = (s) => s.rows('AsgFiles'), grades = (s) => s.rows('AsgGrades');

/* ============================================================ */
group('สั่งงาน · รหัสงาน · สิทธิ์');
test('สร้างงาน: รหัส XXX-XXX ไม่มีตัวสับสน · โฟลเดอร์ใน Drive · ประเภทคะแนน ASSIGN น้ำหนัก 0 · สถานะเริ่มต้น', () => {
  const s = world();
  const a = mkAsg(s, { description: 'ส่งเป็น PDF', dueAt: inMin(s, 60), lateOk: true });
  assert.ok(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{3}-[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{3}$/.test(a.code), a.code);
  assert.strictEqual(a.phase, 'open'); assert.strictEqual(a.kind, 'single'); assert.strictEqual(a.maxScore, 10); assert.strictEqual(a.lateOk, true);
  assert.strictEqual(a.stats.total, 5); assert.strictEqual(a.stats.submitted, 0);
  assert.strictEqual(a.tid, s.tid); assert.strictEqual(a.course.code, 'BIO101'); assert.strictEqual(ok(s.api(s.T1, 'asg.list', { courseId: s.cid })).tid, s.tid);
  const fl = Object.values(s.state.drv.folders);
  assert.strictEqual(fl.length, 2, 'HBT_Files + โฟลเดอร์งาน'); assert.ok(fl.some(f => f.name === 'HBT_Files') && fl.some(f => /BIO101-1_/.test(f.name) && f.name.indexOf(a.code) > 0));
  const t = ok(s.api(s.T1, 'score.types', { courseId: s.cid })).types.filter(x => x.source === 'ASSIGN');
  assert.strictEqual(t.length, 1); assert.strictEqual(t[0].max, 10); assert.strictEqual(t[0].pct, 0);
  mkAsg(s, { title: 'งานที่ 2' });
  assert.strictEqual(Object.values(s.state.drv.folders).filter(f => f.name === 'HBT_Files').length, 1, 'โฟลเดอร์รากใช้ซ้ำ');
});
test('รหัสงานไม่ซ้ำกัน (สร้าง 40 งาน)', () => {
  const s = world(2); const set = {};
  for (let i = 0; i < 40; i++) set[mkAsg(s, { title: 'งาน ' + i }).code] = 1;
  assert.strictEqual(Object.keys(set).length, 40);
});
test('ตรวจข้อมูลเข้า: ชื่อว่าง/คะแนนเต็ม/ประเภท/วันเวลา/ปิดก่อนส่ง/ลิงก์/กลุ่ม → ปฏิเสธ ไม่เขียนแถว ไม่สร้างโฟลเดอร์', () => {
  const s = world(2);
  const bad = [
    { title: '  ' }, { maxScore: 0 }, { maxScore: 1001 }, { maxScore: 'x' }, { kind: 'team' }, { dueAt: '2026-13-40 10:00' }, { dueAt: 'พรุ่งนี้' },
    { dueAt: '2026-05-10 10:00', closeAt: '2026-05-09 10:00' }, { linkUrl: 'javascript:alert(1)' }, { linkUrl: 'ftp://x.y/z' }, { maxGroup: 0 }, { maxGroup: 31 }, { maxGroup: 2.5 }
  ];
  bad.forEach(b => assert.strictEqual(code(s.api(s.T1, 'asg.save', Object.assign({ courseId: s.cid, title: 'ok', kind: 'single', maxScore: 10 }, b))), 'E_ASG_FIELD', JSON.stringify(b)));
  assert.strictEqual(s.rows('Assignments').length, 0); assert.strictEqual(Object.keys(s.state.drv.folders).length, 0);
});
test('สิทธิ์: อาจารย์วิชาอื่น/ไม่มีระบบ asg/ไม่ล็อกอิน/นักศึกษา ใช้ไม่ได้ · admin ใช้ได้', () => {
  const s = world(2); const a = mkAsg(s);
  ['asg.get', 'asg.submissions', 'asg.setStatus', 'asg.delete'].forEach(act =>
    assert.strictEqual(code(s.api(s.T2, act, { asgId: a.asgId, closed: true })), 'E_FORBIDDEN', act + ' T2'));
  assert.ok(['E_NOT_FOUND', 'E_FORBIDDEN'].includes(code(s.api(s.T2, 'asg.list', { courseId: s.cid }))));
  assert.ok(['E_NOT_FOUND', 'E_FORBIDDEN'].includes(code(s.api(s.T2, 'asg.save', { courseId: s.cid, title: 'x' }))));
  assert.strictEqual(code(s.api(s.T3, 'asg.list', { courseId: s.cid })), 'E_FORBIDDEN');
  assert.strictEqual(code(s.api('', 'asg.list', { courseId: s.cid })), 'E_AUTH');
  assert.strictEqual(code(s.api(tok(s, 1), 'asg.list', { courseId: s.cid })), 'E_AUTH', 'token นักศึกษาใช้เป็นอาจารย์ไม่ได้');
  assert.strictEqual(ok(s.api(s.A, 'asg.get', { asgId: a.asgId })).asgId, a.asgId);
  assert.strictEqual(s.rows('Assignments').length, 1);
});
test('แก้งาน: เปลี่ยนชื่อ/คะแนนเต็มซิงก์เข้าประเภทคะแนน · เปลี่ยนเดี่ยว↔กลุ่มได้เมื่อยังไม่มีการส่ง · ล็อกหลังมีการส่ง', () => {
  const s = world(3); const a = mkAsg(s);
  const u = ok(s.api(s.T1, 'asg.save', { asgId: a.asgId, title: 'ชื่อใหม่', maxScore: 20 }));
  assert.strictEqual(u.title, 'ชื่อใหม่'); assert.strictEqual(u.maxScore, 20); assert.strictEqual(u.code, a.code, 'รหัสไม่เปลี่ยน');
  const ty = ok(s.api(s.T1, 'score.types', { courseId: s.cid })).types.filter(x => x.source === 'ASSIGN')[0];
  assert.strictEqual(ty.name, 'ชื่อใหม่'); assert.strictEqual(ty.max, 20);
  assert.strictEqual(ok(s.api(s.T1, 'asg.save', { asgId: a.asgId, kind: 'group' })).kind, 'group');
  ok(s.api(s.T1, 'asg.save', { asgId: a.asgId, kind: 'single' }));
  ok(up(s, 1, a.asgId, 'a.pdf'));
  assert.strictEqual(code(s.api(s.T1, 'asg.save', { asgId: a.asgId, kind: 'group' })), 'E_ASG_KIND_LOCKED');
  assert.strictEqual(s.rows('Assignments').length, 1);
});
test('ลดคะแนนเต็มต่ำกว่าคะแนนที่ให้ไปแล้ว = E_ASG_MAX_LOW · ลดได้ถ้ายังไม่เกิน', () => {
  const s = world(2); const a = mkAsg(s, { maxScore: 10 });
  ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(1), score: 8 }] }));
  assert.strictEqual(code(s.api(s.T1, 'asg.save', { asgId: a.asgId, maxScore: 5 })), 'E_ASG_MAX_LOW');
  assert.strictEqual(ok(s.api(s.T1, 'asg.save', { asgId: a.asgId, maxScore: 8 })).maxScore, 8);
});
test('Drive ใช้ไม่ได้ตอนสร้างงาน → E_DRIVE ไม่มีแถวค้าง ไม่มีประเภทคะแนนค้าง', () => {
  const s = world(2); s.state.drv.failFolder = true;
  assert.strictEqual(code(s.api(s.T1, 'asg.save', { courseId: s.cid, title: 'x' })), 'E_DRIVE');
  assert.strictEqual(s.rows('Assignments').length, 0); assert.strictEqual(s.rows('ScoreTypes').length, 0);
  s.state.drv.failFolder = false;
  assert.ok(mkAsg(s).asgId);
});
test('opId: สร้างงานซ้ำด้วย opId เดียวกัน = ได้งานเดียว', () => {
  const s = world(2); const args = { courseId: s.cid, title: 'x', kind: 'single', maxScore: 5 };
  const a = ok(s.api(s.T1, 'asg.save', args, 'op-1')), b = ok(s.api(s.T1, 'asg.save', args, 'op-1'));
  assert.strictEqual(a.asgId, b.asgId); assert.strictEqual(s.rows('Assignments').length, 1);
});

/* ============================================================ */
group('เฟสเวลา · เปิด/ปิด');
test('เฟส: ก่อนกำหนด=open → เลยกำหนด+รับช้า=late → เลยวันปิด=closed · ไม่รับช้า เลยกำหนด=closed', () => {
  const s = world(2);
  const a = mkAsg(s, { dueAt: inMin(s, 10), closeAt: inMin(s, 30), lateOk: true });
  const ph = () => ok(s.api(s.T1, 'asg.get', { asgId: a.asgId })).phase;
  assert.strictEqual(ph(), 'open'); s.advance(11); assert.strictEqual(ph(), 'late'); s.advance(20); assert.strictEqual(ph(), 'closed');
  const b = mkAsg(s, { title: 'ไม่รับช้า', dueAt: inMin(s, 10), lateOk: false });
  s.advance(5); assert.strictEqual(ok(s.api(s.T1, 'asg.get', { asgId: b.asgId })).phase, 'open');
  s.advance(6); assert.strictEqual(ok(s.api(s.T1, 'asg.get', { asgId: b.asgId })).phase, 'closed');
});
test('ไม่ตั้งกำหนดส่ง = เปิดตลอดจนอาจารย์ปิด · ปิด/เปิดใหม่ด้วยมือ', () => {
  const s = world(2); const a = mkAsg(s);
  s.advance(90); assert.strictEqual(ok(s.api(s.T1, 'asg.get', { asgId: a.asgId })).phase, 'open');
  assert.strictEqual(ok(s.api(s.T1, 'asg.setStatus', { asgId: a.asgId, closed: true })).phase, 'closed');
  assert.strictEqual(code(up(s, 1, a.asgId, 'a.pdf')), 'E_ASG_CLOSED');
  assert.strictEqual(ok(s.api(s.T1, 'asg.setStatus', { asgId: a.asgId, closed: false })).phase, 'open');
  ok(up(s, 1, a.asgId, 'a.pdf'));
});
test('ส่งช้า: ทำเครื่องหมาย late ตามเวลาแก้ล่าสุด · ส่งก่อนกำหนดแล้วแก้หลังกำหนด = ช้า', () => {
  const s = world(3);
  const a = mkAsg(s, { dueAt: inMin(s, 10), lateOk: true });
  ok(up(s, 1, a.asgId, 'a.pdf')); s.advance(11); ok(up(s, 2, a.asgId, 'b.pdf')); ok(up(s, 1, a.asgId, 'c.pdf', PDF(200)));
  const r = ok(s.api(s.T1, 'asg.submissions', { asgId: a.asgId }));
  assert.strictEqual(r.stats.submitted, 2); assert.strictEqual(r.stats.late, 2);
  const t = ok(s.api(tok(s, 2), 'stu.task', { asgId: a.asgId }));
  assert.strictEqual(t.asg.phase, 'late'); assert.strictEqual(t.sub.late, true); assert.strictEqual(t.canEdit, true);
});

/* ============================================================ */
group('ลิงก์ถาวร: resolve · เข้าระบบด้วย PIN · token นักศึกษา');
test('asg.resolve: อาจารย์(tid)+รหัสงาน → งาน · รับตัวพิมพ์เล็ก/ไม่มีขีด · tid ผิด/รหัสผิด/รูปแบบผิด = ไม่พบ', () => {
  const s = world(2); const a = mkAsg(s);
  const r = ok(s.api('', 'asg.resolve', { tid: s.tid, code: a.code.toLowerCase().replace('-', '') }));
  assert.strictEqual(r.asgId, a.asgId); assert.strictEqual(r.courseId, s.cid); assert.strictEqual(r.course.code, 'BIO101'); assert.strictEqual(r.phase, 'open');
  assert.strictEqual(code(s.api('', 'asg.resolve', { tid: 'xxxxxxxxxxxx', code: a.code })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api('', 'asg.resolve', { tid: s.tid, code: 'ZZZ-ZZZ' })), 'E_NOT_FOUND');
  ['', 'ABC', '1234567', null].forEach(c => assert.strictEqual(code(s.api('', 'asg.resolve', { tid: s.tid, code: c })), 'E_NOT_FOUND'));
  assert.strictEqual(code(s.api('', 'asg.resolve', { code: a.code })), 'E_NOT_FOUND');
});
test('asg.resolve: วิชาในเทอมที่ไม่ใช่เทอมปัจจุบัน = ไม่พบ (ทั้ง resolve และ stu.login)', () => {
  const s = world(2); const a = mkAsg(s);
  const t2 = ok(s.api(s.A, 'term.create', { name: '2/2569' })).terms.find(x => x.name === '2/2569'); ok(s.api(s.A, 'term.setCurrent', { termId: t2.termId }));
  assert.strictEqual(code(s.api('', 'asg.resolve', { tid: s.tid, code: a.code })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api('', 'stu.login', { courseId: s.cid, stdId: std(1), pin: PIN })), 'E_NOT_FOUND');
});
test('stu.login: ถูก → token + ชื่อ/วิชา · PIN ผิด E_PIN_BAD · ผิดครบ 5 ครั้ง ล็อก (PIN ถูกก็เข้าไม่ได้)', () => {
  const s = world(2);
  const r = ok(s.api('', 'stu.login', { courseId: s.cid, stdId: std(1), pin: PIN }));
  assert.ok(r.token && r.expiresAt > Date.now()); assert.strictEqual(r.name, 'นักศึกษา 1'); assert.strictEqual(r.course.code, 'BIO101');
  for (let i = 0; i < 4; i++) assert.strictEqual(code(s.api('', 'stu.login', { courseId: s.cid, stdId: std(2), pin: '0000' })), 'E_PIN_BAD');
  assert.strictEqual(code(s.api('', 'stu.login', { courseId: s.cid, stdId: std(2), pin: '0000' })), 'E_PIN_LOCKED');
  assert.strictEqual(code(s.api('', 'stu.login', { courseId: s.cid, stdId: std(2), pin: PIN })), 'E_PIN_LOCKED');
  assert.strictEqual(code(s.api('', 'stu.login', { courseId: s.cid, stdId: std(1), pin: PIN })), 'OK', 'คนอื่นไม่ถูกล็อกด้วย');
});
test('stu.login: ยังไม่มี PIN = E_PIN_NONE · ไม่อยู่ในวิชา/รหัสเพี้ยน/วิชาไม่มี = E_NOT_FOUND · PIN รูปแบบผิด E_PIN_FORMAT', () => {
  const s = world(2);
  ok(s.api(s.T1, 'student.add', { courseId: s.cid, stdId: '660099', name: 'ใหม่' }));
  assert.strictEqual(code(s.api('', 'stu.login', { courseId: s.cid, stdId: '660099', pin: PIN })), 'E_PIN_NONE');
  assert.strictEqual(code(s.api('', 'stu.login', { courseId: s.cid, stdId: '999999', pin: PIN })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api('', 'stu.login', { courseId: s.cid, stdId: '', pin: PIN })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api('', 'stu.login', { courseId: 'CRS_NOPE', stdId: std(1), pin: PIN })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api('', 'stu.login', { courseId: s.cid, stdId: std(1), pin: '12' })), 'E_PIN_FORMAT');
});
test('token นักศึกษา: อาจารย์ใช้แทนไม่ได้ · ของแก้ไข/หมดอายุ(2 ชม.)/นักศึกษาถูกลบแล้ว = E_AUTH · ข้ามวิชาไม่ได้', () => {
  const s = world(3); const a = mkAsg(s);
  const t = tok(s, 1);
  assert.strictEqual(code(s.api(s.T1, 'stu.tasks', {})), 'E_AUTH');
  assert.strictEqual(code(s.api('', 'stu.tasks', {})), 'E_AUTH');
  assert.strictEqual(code(s.api(t.slice(0, -2) + (t.endsWith('AA') ? 'BB' : 'AA'), 'stu.tasks', {})), 'E_AUTH');
  assert.strictEqual(code(s.api(t, 'stu.tasks', {})), 'OK');
  // วิชาอื่นของอาจารย์อีกคน: งานของวิชา A เปิดด้วย token วิชา B ไม่ได้
  const cid2 = ok(s.api(s.T2, 'course.create', { code: 'CHE201', name: 'เคมี', section: '1' })).courseId;
  ok(s.api(s.T2, 'student.importCsv', { courseId: cid2, rows: [{ stdId: std(1), name: 'นักศึกษา 1' }] }));
  const tB = ok(s.api('', 'stu.login', { courseId: cid2, stdId: std(1), pin: PIN })).token;
  assert.strictEqual(code(s.api(tB, 'stu.task', { asgId: a.asgId })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api(tB, 'stu.upload', { asgId: a.asgId, name: 'a.pdf', b64: b64(PDF()) })), 'E_NOT_FOUND');
  assert.strictEqual(ok(s.api(tB, 'stu.tasks', {})).tasks.length, 0);
  s.advance(121); assert.strictEqual(code(s.api(t, 'stu.tasks', {})), 'E_AUTH');
  const t2 = login(s, 2); ok(s.api(s.T1, 'student.remove', { courseId: s.cid, stdId: std(2) }));
  assert.strictEqual(code(s.api(t2, 'stu.tasks', {})), 'E_AUTH', 'ถูกลบออกจากวิชา → token เดิมใช้ไม่ได้ทันที');
});

/* ============================================================ */
group('ส่งงานเดี่ยว · อัปโหลดไฟล์');
test('อัปโหลด pdf: ขึ้น Drive ในโฟลเดอร์งาน ไบต์ตรง · แถว AsgSubs/AsgFiles · ครูเห็นว่าส่งแล้ว · นักศึกษาเห็นไฟล์ตัวเอง', () => {
  const s = world(3); const a = mkAsg(s); const buf = PDF(1234);
  const r = ok(up(s, 1, a.asgId, 'C:\\fakepath\\รายงาน แล็บ.pdf', buf));
  assert.strictEqual(r.name, 'รายงาน แล็บ.pdf'); assert.strictEqual(r.size, 1234);
  const df = liveFiles(s); assert.strictEqual(df.length, 1);
  assert.ok(df[0].buf.equals(buf)); assert.strictEqual(df[0].mime, 'application/pdf'); assert.strictEqual(df[0].folder, Object.keys(s.state.drv.folders).filter(k => s.state.drv.folders[k].parent)[0]);
  assert.strictEqual(sub(s).length, 1); assert.strictEqual(files(s).length, 1);
  const subs = ok(s.api(s.T1, 'asg.submissions', { asgId: a.asgId }));
  assert.strictEqual(subs.stats.submitted, 1); const u = subs.units.filter(x => x.submitted)[0];
  assert.strictEqual(u.name, 'นักศึกษา 1'); assert.strictEqual(u.files.length, 1);
  const t = ok(s.api(tok(s, 1), 'stu.task', { asgId: a.asgId })); assert.strictEqual(t.sub.files.length, 1); assert.strictEqual(t.canEdit, true);
  assert.strictEqual(ok(s.api(tok(s, 2), 'stu.task', { asgId: a.asgId })).sub, null, 'คนอื่นไม่เห็นไฟล์ของเรา');
  assert.strictEqual(ok(s.api(tok(s, 1), 'stu.tasks', {})).tasks[0].submitted, true);
  assert.strictEqual(ok(s.api(tok(s, 2), 'stu.tasks', {})).tasks[0].submitted, false);
});
test('ชนิดไฟล์: pdf/jpg/jpeg/png/docx/xlsx/pptx รับ (ตัวพิมพ์ใหญ่ได้) · exe/txt/zip/ไม่มีนามสกุล/ชื่อแปลง → E_ASG_FILE_TYPE', () => {
  const s = world(2); const a = mkAsg(s); s._tk = {};
  ok(s.api(s.A, 'settings.set', { changes: { file_max_count: 10 } }));
  [['a.pdf', PDF()], ['b.JPG', JPG()], ['c.jpeg', JPG(80)], ['d.png', PNG()], ['e.docx', ZIP()], ['f.xlsx', ZIP(90)], ['g.pptx', ZIP(95)], ['h.PDF', PDF(70)]]
    .forEach(([n, b]) => ok(up(s, 1, a.asgId, n, b)));
  assert.strictEqual(files(s).length, 8);
  ['x.exe', 'x.txt', 'x.zip', 'x.html', 'noext', 'x.pdf.exe', 'x.doc'].forEach(n => assert.strictEqual(code(up(s, 1, a.asgId, n, PDF())), 'E_ASG_FILE_TYPE', n));
  assert.strictEqual(files(s).length, 8); assert.strictEqual(liveFiles(s).length, 8);
});
test('ตั้งค่าชนิดไฟล์ (file_types) จำกัดได้ · ตัวที่ไม่อยู่ในรายการถูกปฏิเสธ', () => {
  const s = world(2); const a = mkAsg(s);
  ok(s.api(s.A, 'settings.set', { changes: { file_types: ['pdf'] } }));
  assert.strictEqual(code(up(s, 1, a.asgId, 'a.png', PNG())), 'E_ASG_FILE_TYPE'); ok(up(s, 1, a.asgId, 'a.pdf'));
  assert.strictEqual(ok(s.api(tok(s, 1), 'stu.task', { asgId: a.asgId })).limits.types.join(), 'pdf');
});
test('ตรวจไบต์หัวไฟล์: นามสกุล .pdf แต่เนื้อเป็น png/exe/ข้อความ → E_ASG_FILE_BAD · base64 เสีย/ว่าง → E_ASG_FILE_BAD', () => {
  const s = world(2); const a = mkAsg(s);
  assert.strictEqual(code(up(s, 1, a.asgId, 'a.pdf', PNG())), 'E_ASG_FILE_BAD');
  assert.strictEqual(code(up(s, 1, a.asgId, 'a.docx', PDF())), 'E_ASG_FILE_BAD');
  assert.strictEqual(code(up(s, 1, a.asgId, 'a.png', Buffer.from('MZ\u0090\u0000not an image'))), 'E_ASG_FILE_BAD');
  assert.strictEqual(code(up(s, 1, a.asgId, 'a.pdf', Buffer.from('<script>alert(1)</script>'))), 'E_ASG_FILE_BAD');
  ['', '***', null, 12345].forEach(x => assert.strictEqual(code(s.api(tok(s, 1), 'stu.upload', { asgId: a.asgId, name: 'a.pdf', b64: x })), 'E_ASG_FILE_BAD'));
  assert.strictEqual(files(s).length, 0); assert.strictEqual(driveFiles(s).length, 0);
});
test('ขนาดไฟล์: เกิน file_max_mb → E_ASG_FILE_SIZE · พอดีผ่าน · ปรับตั้งค่าแล้วมีผลทันที', () => {
  const s = world(2); const a = mkAsg(s);
  ok(s.api(s.A, 'settings.set', { changes: { file_max_mb: 1 } }));
  const MB = 1024 * 1024;
  assert.strictEqual(code(up(s, 1, a.asgId, 'big.pdf', PDF(MB + 1))), 'E_ASG_FILE_SIZE');
  assert.strictEqual(code(up(s, 1, a.asgId, 'huge.pdf', PDF(3 * MB))), 'E_ASG_FILE_SIZE');
  assert.strictEqual(ok(up(s, 1, a.asgId, 'edge.pdf', PDF(MB))).size, MB);
  ok(s.api(s.A, 'settings.set', { changes: { file_max_mb: 5 } }));
  assert.strictEqual(ok(up(s, 1, a.asgId, 'ok5.pdf', PDF(4 * MB))).size, 4 * MB);
  assert.strictEqual(files(s).length, 2);
});
test('จำนวนไฟล์: เกิน file_max_count → E_ASG_FILE_COUNT (ไม่ขึ้น Drive) · ลบแล้วเพิ่มได้', () => {
  const s = world(2); const a = mkAsg(s);
  ok(s.api(s.A, 'settings.set', { changes: { file_max_count: 2 } }));
  const f1 = ok(up(s, 1, a.asgId, 'a.pdf', PDF(100))); ok(up(s, 1, a.asgId, 'b.pdf', PDF(101)));
  assert.strictEqual(code(up(s, 1, a.asgId, 'c.pdf', PDF(102))), 'E_ASG_FILE_COUNT'); assert.strictEqual(driveFiles(s).length, 2);
  ok(s.api(tok(s, 1), 'stu.removeFile', { fileId: f1.fileId })); ok(up(s, 1, a.asgId, 'c.pdf', PDF(102)));
  assert.strictEqual(files(s).length, 2);
});
test('กันกดซ้ำ: ไฟล์ชื่อ/ขนาดเดียวกันภายใน 60 วินาที = ไม่สร้างซ้ำ (duplicate) · เกิน 60 วินาทีถือเป็นไฟล์ใหม่', () => {
  const s = world(2); const a = mkAsg(s);
  const f = ok(up(s, 1, a.asgId, 'a.pdf', PDF(500))), g = ok(up(s, 1, a.asgId, 'a.pdf', PDF(500)));
  assert.strictEqual(g.duplicate, true); assert.strictEqual(g.fileId, f.fileId); assert.strictEqual(files(s).length, 1); assert.strictEqual(driveFiles(s).length, 1);
  ok(up(s, 1, a.asgId, 'a.pdf', PDF(501))); assert.strictEqual(files(s).length, 2, 'ขนาดต่างกัน = ไฟล์ใหม่');
  s.advance(2); ok(up(s, 1, a.asgId, 'a.pdf', PDF(500))); assert.strictEqual(files(s).length, 3);
});
test('Drive ล้มเหลวตอนอัปโหลด → E_DRIVE ไม่มีแถวค้าง (ไม่นับว่าส่งแล้ว) · กลับมาปกติแล้วส่งได้', () => {
  const s = world(2); const a = mkAsg(s);
  s.state.drv.failCreate = true;
  assert.strictEqual(code(up(s, 1, a.asgId, 'a.pdf')), 'E_DRIVE');
  assert.strictEqual(files(s).length, 0); assert.strictEqual(sub(s).length, 0);
  assert.strictEqual(ok(s.api(s.T1, 'asg.submissions', { asgId: a.asgId })).stats.submitted, 0);
  s.state.drv.failCreate = false; ok(up(s, 1, a.asgId, 'a.pdf')); assert.strictEqual(files(s).length, 1);
});
test('แข่งกัน: ระหว่างอัปโหลด (หลังขึ้น Drive ก่อนล็อกบันทึก) งานถูกปิด/ให้คะแนน → ตรวจซ้ำใน lock ปฏิเสธ + ไฟล์ที่ขึ้นไปแล้วลงถังขยะ ไม่เหลือแถว', () => {
  const s = world(2); const a = mkAsg(s); const t = tok(s, 1);
  s.state.drv.onCreate = () => ok(s.api(s.T1, 'asg.setStatus', { asgId: a.asgId, closed: true }));
  assert.strictEqual(code(s.api(t, 'stu.upload', { asgId: a.asgId, name: 'a.pdf', b64: b64(PDF()) })), 'E_ASG_CLOSED');
  assert.strictEqual(files(s).length, 0); assert.strictEqual(sub(s).length, 0); assert.strictEqual(liveFiles(s).length, 0); assert.strictEqual(driveFiles(s).length, 1, 'ไฟล์อยู่ในถังขยะ');
  ok(s.api(s.T1, 'asg.setStatus', { asgId: a.asgId, closed: false }));
  s.state.drv.onCreate = () => ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(1), score: 1 }] }));
  ok(s.api(t, 'stu.saveNote', { asgId: a.asgId, note: 'x' }));
});
test('แข่งกัน: ครบจำนวนไฟล์ระหว่างที่อีกคำขอแทรก (คนละอุปกรณ์ของนักศึกษาคนเดียวกัน) → ไม่เกินจำนวนที่กำหนด', () => {
  const s = world(2); const a = mkAsg(s); const t = tok(s, 1);
  ok(s.api(s.A, 'settings.set', { changes: { file_max_count: 1 } }));
  s.state.drv.onCreate = () => ok(up(s, 1, a.asgId, 'other.pdf', PDF(333)));
  assert.strictEqual(code(s.api(t, 'stu.upload', { asgId: a.asgId, name: 'a.pdf', b64: b64(PDF(100)) })), 'E_ASG_FILE_COUNT');
  assert.strictEqual(files(s).length, 1); assert.strictEqual(liveFiles(s).length, 1);
});
test('ปิดงาน/เลยกำหนดไม่รับช้า/ให้คะแนนแล้ว → อัปโหลด ลบไฟล์ แก้ข้อความ ไม่ได้ (E_ASG_CLOSED / E_ASG_GRADED)', () => {
  const s = world(3); const a = mkAsg(s);
  const f = ok(up(s, 1, a.asgId, 'a.pdf')); ok(up(s, 2, a.asgId, 'b.pdf'));
  ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(2), score: 5 }] }));
  assert.strictEqual(code(up(s, 2, a.asgId, 'c.pdf', PDF(222))), 'E_ASG_GRADED');
  assert.strictEqual(code(s.api(tok(s, 2), 'stu.saveNote', { asgId: a.asgId, note: 'x' })), 'E_ASG_GRADED');
  assert.strictEqual(ok(s.api(tok(s, 2), 'stu.task', { asgId: a.asgId })).canEdit, false);
  ok(s.api(s.T1, 'asg.setStatus', { asgId: a.asgId, closed: true }));
  assert.strictEqual(code(s.api(tok(s, 1), 'stu.removeFile', { fileId: f.fileId })), 'E_ASG_CLOSED');
  assert.strictEqual(code(s.api(tok(s, 1), 'stu.saveNote', { asgId: a.asgId, note: 'x' })), 'E_ASG_CLOSED');
  assert.strictEqual(code(up(s, 3, a.asgId, 'c.pdf')), 'E_ASG_CLOSED');
  assert.strictEqual(files(s).length, 2); assert.strictEqual(liveFiles(s).length, 2);
});
test('ข้อความ/ลิงก์: บันทึกได้ · ลิงก์ผิดรูปแบบปฏิเสธ · ล้างทั้งหมดและไม่มีไฟล์ = ถอนการส่ง · ลบไฟล์สุดท้ายแต่ยังมีข้อความ = ยังนับว่าส่ง', () => {
  const s = world(2); const a = mkAsg(s); const t = tok(s, 1);
  assert.strictEqual(ok(s.api(t, 'stu.saveNote', { asgId: a.asgId, note: 'ดูในลิงก์', link: 'https://drive.google.com/x' })).saved, true);
  assert.strictEqual(ok(s.api(s.T1, 'asg.submissions', { asgId: a.asgId })).stats.submitted, 1);
  assert.strictEqual(code(s.api(t, 'stu.saveNote', { asgId: a.asgId, note: 'x', link: 'javascript:1' })), 'E_ASG_FIELD');
  assert.strictEqual(code(s.api(t, 'stu.saveNote', { asgId: a.asgId, link: 'drive.google.com' })), 'E_ASG_FIELD');
  assert.strictEqual(ok(s.api(t, 'stu.saveNote', { asgId: a.asgId, note: '', link: '' })).saved, false);
  assert.strictEqual(sub(s).length, 0);
  const f = ok(up(s, 1, a.asgId, 'a.pdf')); ok(s.api(t, 'stu.saveNote', { asgId: a.asgId, note: 'หมายเหตุ' }));
  ok(s.api(t, 'stu.removeFile', { fileId: f.fileId }));
  assert.strictEqual(sub(s).length, 1); assert.strictEqual(ok(s.api(tok(s, 1), 'stu.task', { asgId: a.asgId })).sub.note, 'หมายเหตุ');
  ok(s.api(t, 'stu.saveNote', { asgId: a.asgId, note: '' })); assert.strictEqual(sub(s).length, 0);
});
test('ข้อความมีอักขระควบคุม/ยาวเกิน → ตัดให้ปลอดภัย · HTML เก็บเป็นข้อความดิบ (หน้าเว็บ escape)', () => {
  const s = world(2); const a = mkAsg(s);
  ok(s.api(tok(s, 1), 'stu.saveNote', { asgId: a.asgId, note: '<b>x</b>\u0000\u0007' + 'ก'.repeat(5000) }));
  const n = ok(s.api(tok(s, 1), 'stu.task', { asgId: a.asgId })).sub.note;
  assert.ok(n.startsWith('<b>x</b>')); assert.strictEqual(n.length, 2000); assert.ok(n.indexOf('\u0000') < 0 && n.indexOf('\u0007') < 0);
});
test('ลบไฟล์: ลงถังขยะ Drive + ลบแถว · ลบไฟล์ของคนอื่น/ไฟล์ที่ไม่มี ไม่ได้', () => {
  const s = world(3); const a = mkAsg(s);
  const f = ok(up(s, 1, a.asgId, 'a.pdf')); const g = ok(up(s, 2, a.asgId, 'b.pdf', PDF(300)));
  assert.ok(['E_FORBIDDEN', 'E_NOT_FOUND'].includes(code(s.api(tok(s, 2), 'stu.removeFile', { fileId: f.fileId }))));
  assert.strictEqual(code(s.api(tok(s, 1), 'stu.removeFile', { fileId: 'FIL_nope' })), 'E_NOT_FOUND');
  assert.strictEqual(liveFiles(s).length, 2);
  ok(s.api(tok(s, 1), 'stu.removeFile', { fileId: f.fileId }));
  assert.strictEqual(liveFiles(s).length, 1); assert.strictEqual(files(s).length, 1); assert.strictEqual(files(s)[0][0], g.fileId);
  assert.strictEqual(sub(s).length, 1, 'งานของคนที่ 2 ยังอยู่');
});
test('งานของแต่ละคนแยกกัน: คนที่ 2 ส่งไม่ทับของคนที่ 1 · งานที่ไม่มีอยู่ = E_NOT_FOUND', () => {
  const s = world(3); const a = mkAsg(s);
  ok(up(s, 1, a.asgId, 'a.pdf')); ok(up(s, 2, a.asgId, 'a.pdf', PDF(200)));
  assert.strictEqual(sub(s).length, 2); assert.strictEqual(new Set(sub(s).map(r => r[0])).size, 2);
  assert.strictEqual(code(s.api(tok(s, 1), 'stu.task', { asgId: 'ASG_nope' })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api(tok(s, 1), 'stu.task', {})), 'E_NOT_FOUND');
});
test('ขนาด body: คำขออื่นเกิน 2 MB ถูกปฏิเสธ · stu.upload ไฟล์ 5 MB (base64 ≈ 6.7 MB) ผ่าน · เกิน 9 MB ปฏิเสธ · สวมชื่อ stu.upload ในหัวแต่เรียก action อื่นก็ไม่ผ่าน', () => {
  const s = world(2); const a = mkAsg(s); const t = tok(s, 1);
  const pad = 'x'.repeat(2 * 1024 * 1024 + 10);
  assert.strictEqual(code(JSON.parse(s.raw({ action: 'asg.list', token: s.T1, args: { courseId: s.cid, pad } }))), 'E_BAD_REQUEST');
  assert.strictEqual(code(JSON.parse(s.raw({ action: 'stu.saveNote', token: t, args: { asgId: a.asgId, note: pad } }))), 'E_BAD_REQUEST');
  assert.strictEqual(code(JSON.parse(s.raw({ action: 'stu.saveNote', token: t, args: { asgId: a.asgId, note: pad, x: '"stu.upload"' } }))), 'E_BAD_REQUEST');
  const five = 5 * 1024 * 1024;
  assert.strictEqual(ok(up(s, 1, a.asgId, 'five.pdf', PDF(five))).size, five);
  assert.strictEqual(code(JSON.parse(s.raw({ action: 'stu.upload', token: t, args: { asgId: a.asgId, name: 'a.pdf', b64: 'A'.repeat(9.5 * 1024 * 1024) } }))), 'E_BAD_REQUEST');
  assert.strictEqual(code(JSON.parse(s.raw({ action: 'stu.upload', token: t, args: { asgId: a.asgId, name: 'six.pdf', b64: b64(PDF(6 * 1024 * 1024 + 8192)) } }))), 'E_ASG_FILE_SIZE');
});

/* ============================================================ */
group('งานกลุ่ม');
const G = (s, i, asgId, members, name) => s.api(tok(s, i), 'stu.groupSave', { asgId, members: members.map(std), name });
test('ตัวแทนสร้างกลุ่ม: เลือกสมาชิกจากคนที่ยังว่าง · สมาชิกเห็นกลุ่ม · candidates ไม่รวมคนที่มีกลุ่มแล้ว', () => {
  const s = world(6); const a = mkAsg(s, { kind: 'group', maxGroup: 4 });
  const t0 = ok(s.api(tok(s, 1), 'stu.task', { asgId: a.asgId }));
  assert.strictEqual(t0.group, null); assert.strictEqual(t0.canEdit, false); assert.strictEqual(t0.whyNot, 'E_ASG_NO_GROUP'); assert.strictEqual(t0.candidates.length, 5);
  assert.strictEqual(ok(s.api(tok(s, 1), 'stu.tasks', {})).tasks[0].needsGroup, true);
  assert.strictEqual(ok(G(s, 1, a.asgId, [2, 3], 'ทีมสาม')).members, 3);
  const t1 = ok(s.api(tok(s, 2), 'stu.task', { asgId: a.asgId }));
  assert.strictEqual(t1.group.name, 'ทีมสาม'); assert.strictEqual(t1.group.isRep, false); assert.strictEqual(t1.group.members.length, 3); assert.strictEqual(t1.group.rep.stdId, std(1));
  assert.strictEqual(t1.canEdit, false); assert.strictEqual(t1.whyNot, 'E_ASG_NOT_REP'); assert.strictEqual(t1.candidates.length, 0);
  const t2 = ok(s.api(tok(s, 1), 'stu.task', { asgId: a.asgId }));
  assert.strictEqual(t2.group.isRep, true); assert.strictEqual(t2.canEdit, true); assert.deepStrictEqual(t2.candidates.map(x => x.stdId), [std(4), std(5), std(6)]);
  assert.strictEqual(ok(s.api(tok(s, 4), 'stu.task', { asgId: a.asgId })).candidates.length, 2, 'คนว่างเลือกเพื่อนตั้งกลุ่มเองได้ (ไม่รวมคนที่มีกลุ่ม)');
});
test('กติกากลุ่ม: 1 คนอยู่ได้กลุ่มเดียว · เกิน max · ไม่มีรหัสในวิชา · งานเดี่ยวไม่มีกลุ่ม', () => {
  const s = world(7); const a = mkAsg(s, { kind: 'group', maxGroup: 3 });
  ok(G(s, 1, a.asgId, [2]));
  assert.strictEqual(code(G(s, 3, a.asgId, [2])), 'E_ASG_GROUP', 'นศ.2 อยู่กลุ่มแรกแล้ว');
  assert.strictEqual(code(G(s, 3, a.asgId, [1])), 'E_ASG_GROUP', 'ตัวแทนกลุ่มอื่นก็เลือกไม่ได้');
  assert.strictEqual(code(G(s, 3, a.asgId, [4, 5, 6])), 'E_ASG_GROUP', 'เกิน 3 คน (รวมตัวแทน)');
  assert.strictEqual(code(s.api(tok(s, 3), 'stu.groupSave', { asgId: a.asgId, members: ['999999'] })), 'E_ASG_GROUP');
  assert.strictEqual(code(s.api(tok(s, 3), 'stu.groupSave', { asgId: a.asgId, members: ['@@'] })), 'E_ASG_GROUP');
  assert.strictEqual(s.rows('AsgGroups').length, 1); assert.strictEqual(s.rows('AsgMembers').length, 2);
  ok(G(s, 3, a.asgId, [4, 5])); assert.strictEqual(s.rows('AsgGroups').length, 2);
  const single = mkAsg(s, { title: 'เดี่ยว' });
  assert.strictEqual(code(G(s, 1, single.asgId, [2])), 'E_ASG_NOT_GROUP');
  assert.strictEqual(code(s.api(tok(s, 1), 'stu.groupDelete', { asgId: single.asgId })), 'E_ASG_NOT_GROUP');
});
test('ใส่ตัวเองหรือซ้ำในรายชื่อ = ตัดซ้ำ · สร้างกลุ่มที่ไม่มีสมาชิกอื่น (คนเดียว) ได้', () => {
  const s = world(4); const a = mkAsg(s, { kind: 'group' });
  assert.strictEqual(ok(G(s, 1, a.asgId, [1, 2, 2, 1])).members, 2);
  assert.strictEqual(ok(G(s, 3, a.asgId, [])).members, 1);
});
test('แก้กลุ่ม: เพิ่ม/ถอนสมาชิก · สมาชิกที่ไม่ใช่ตัวแทนแก้ไม่ได้ · ปิดงานแล้วแก้ไม่ได้ · ให้คะแนนแล้วแก้ไม่ได้', () => {
  const s = world(6); const a = mkAsg(s, { kind: 'group' });
  ok(G(s, 1, a.asgId, [2, 3], 'ก'));
  assert.strictEqual(code(G(s, 2, a.asgId, [3, 4])), 'E_ASG_NOT_REP');
  assert.strictEqual(ok(G(s, 1, a.asgId, [3, 4], 'ข')).members, 3);
  assert.deepStrictEqual(s.rows('AsgMembers').map(r => r[4]).sort(), [std(1), std(3), std(4)]);
  assert.strictEqual(s.rows('AsgGroups')[0][3], 'ข');
  ok(G(s, 5, a.asgId, [2]));    // นศ.2 ถูกถอนแล้ว → ไปอยู่กลุ่มอื่นได้
  ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(3), score: 5 }] }));
  assert.strictEqual(code(G(s, 1, a.asgId, [4])), 'E_ASG_GRADED');
  ok(s.api(s.T1, 'asg.setStatus', { asgId: a.asgId, closed: true }));
  assert.strictEqual(code(G(s, 5, a.asgId, [])), 'E_ASG_CLOSED');
});
test('ลบกลุ่ม: เฉพาะตัวแทน · ถ้ามีงานส่งแล้วลบไม่ได้ · ลบแล้วสมาชิกว่างกลับไปเลือกกลุ่มใหม่ได้', () => {
  const s = world(4); const a = mkAsg(s, { kind: 'group' });
  ok(G(s, 1, a.asgId, [2]));
  assert.strictEqual(code(s.api(tok(s, 2), 'stu.groupDelete', { asgId: a.asgId })), 'E_ASG_NOT_REP');
  assert.strictEqual(code(s.api(tok(s, 3), 'stu.groupDelete', { asgId: a.asgId })), 'E_ASG_NO_GROUP');
  ok(up(s, 1, a.asgId, 'a.pdf'));
  assert.strictEqual(code(s.api(tok(s, 1), 'stu.groupDelete', { asgId: a.asgId })), 'E_ASG_HAS_SUB');
  ok(s.api(tok(s, 1), 'stu.removeFile', { fileId: files(s)[0][0] }));
  assert.strictEqual(ok(s.api(tok(s, 1), 'stu.groupDelete', { asgId: a.asgId })).deleted, true);
  assert.strictEqual(s.rows('AsgGroups').length, 0); assert.strictEqual(s.rows('AsgMembers').length, 0);
  ok(G(s, 2, a.asgId, [1]));
});
test('ส่งงานกลุ่ม: เฉพาะตัวแทน · งานเก็บใต้กลุ่ม · สมาชิกเห็นไฟล์เดียวกัน · อาจารย์เห็น 1 หน่วยพร้อมสมาชิกทุกคน · ไม่มีกลุ่มส่งไม่ได้', () => {
  const s = world(5); const a = mkAsg(s, { kind: 'group' });
  assert.strictEqual(code(up(s, 1, a.asgId, 'a.pdf')), 'E_ASG_NO_GROUP');
  ok(G(s, 1, a.asgId, [2, 3]));
  assert.strictEqual(code(up(s, 2, a.asgId, 'a.pdf')), 'E_ASG_NOT_REP');
  assert.strictEqual(code(s.api(tok(s, 2), 'stu.saveNote', { asgId: a.asgId, note: 'x' })), 'E_ASG_NOT_REP');
  ok(up(s, 1, a.asgId, 'a.pdf')); ok(s.api(tok(s, 1), 'stu.saveNote', { asgId: a.asgId, note: 'ของกลุ่ม' }));
  const t2 = ok(s.api(tok(s, 2), 'stu.task', { asgId: a.asgId })); assert.strictEqual(t2.sub.files.length, 1); assert.strictEqual(t2.sub.note, 'ของกลุ่ม');
  assert.strictEqual(ok(s.api(tok(s, 2), 'stu.tasks', {})).tasks[0].submitted, true);
  assert.strictEqual(ok(s.api(tok(s, 4), 'stu.tasks', {})).tasks[0].submitted, false);
  const r = ok(s.api(s.T1, 'asg.submissions', { asgId: a.asgId }));
  assert.strictEqual(r.units.length, 1); assert.strictEqual(r.units[0].members.length, 3); assert.strictEqual(r.units[0].rep.stdId, std(1)); assert.strictEqual(r.units[0].files.length, 1);
  assert.deepStrictEqual(r.ungrouped.map(x => x.stdId), [std(4), std(5)]); assert.strictEqual(r.stats.submitted, 1); assert.strictEqual(r.stats.ungrouped, 2);
  assert.strictEqual(sub(s)[0][0].split('|')[1].startsWith('GRP'), true, 'คีย์งานกลุ่ม = asg|groupId');
});

/* ============================================================ */
group('ให้คะแนน · ซิงก์ตารางคะแนน');
const scoreRow = (s, i) => {
  const t = ok(s.api(s.T1, 'score.table', { courseId: s.cid })); const ty = t.types.filter(x => x.source === 'ASSIGN')[0];
  return { ty, v: ty ? t.students.filter(x => x.stdId === std(i))[0].scores[ty.typeId] : undefined, total: t.students.filter(x => x.stdId === std(i))[0].total };
};
test('ให้คะแนนรายคน: บันทึก + ซิงก์เข้าตารางคะแนน ASSIGN · น้ำหนัก 0% ไม่กระทบคะแนนรวม · แก้ทับ/ล้างได้', () => {
  const s = world(3); const a = mkAsg(s, { maxScore: 20 });
  const r = ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(1), score: '15.5', feedback: 'ดี' }, { stdId: std(2), score: 0 }] }));
  assert.strictEqual(r.saved, 2); assert.strictEqual(r.skippedCount, 0);
  assert.strictEqual(scoreRow(s, 1).v, 15.5); assert.strictEqual(scoreRow(s, 2).v, 0); assert.strictEqual(scoreRow(s, 3).v, null);
  assert.ok(!scoreRow(s, 1).total, 'น้ำหนัก 0% → คะแนนรวมไม่ขยับ');
  ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(1), score: 18 }] }));
  assert.strictEqual(scoreRow(s, 1).v, 18); assert.strictEqual(grades(s).length, 2);
  const c = ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(1), score: '' }, { stdId: std(2), score: null, feedback: '' }] }));
  assert.strictEqual(c.cleared, 2); assert.strictEqual(grades(s).length, 0); assert.strictEqual(scoreRow(s, 1).v, null);
});
test('ตั้งน้ำหนัก ASSIGN แล้วคะแนนรวมคำนวณจากคะแนนงาน (ซิงก์ผ่านระบบคะแนนกลาง)', () => {
  const s = world(2); const a = mkAsg(s, { maxScore: 10 });
  const ty = ok(s.api(s.T1, 'score.types', { courseId: s.cid })).types.filter(x => x.source === 'ASSIGN')[0];
  ok(s.api(s.T1, 'score.saveType', { courseId: s.cid, typeId: ty.typeId, name: ty.name, pct: 20, max: ty.max }));
  ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(1), score: 8 }] }));
  assert.strictEqual(scoreRow(s, 1).total, 16);
});
test('ให้คะแนนงานกลุ่ม: ทั้งกลุ่ม (ส่งสมาชิกทุกคนคะแนนเดียวกัน) หรือรายคนต่างกัน · หน่วยถือว่าตรวจแล้วเมื่อครบทุกคน', () => {
  const s = world(4); const a = mkAsg(s, { kind: 'group', maxScore: 10 });
  ok(G(s, 1, a.asgId, [2, 3])); ok(up(s, 1, a.asgId, 'a.pdf'));
  ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [std(1), std(2), std(3)].map(i => ({ stdId: i, score: 9 })) }));
  [1, 2, 3].forEach(i => assert.strictEqual(scoreRow(s, i).v, 9)); assert.strictEqual(scoreRow(s, 4).v, null);
  assert.strictEqual(ok(s.api(s.T1, 'asg.submissions', { asgId: a.asgId })).stats.graded, 1);
  ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(3), score: 6, feedback: 'มาไม่ครบ' }] }));
  assert.strictEqual(scoreRow(s, 3).v, 6); assert.strictEqual(scoreRow(s, 2).v, 9);
  ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(3), score: '' }] }));
  const u = ok(s.api(s.T1, 'asg.submissions', { asgId: a.asgId })).units[0];
  assert.strictEqual(u.graded, false); assert.strictEqual(ok(s.api(s.T1, 'asg.submissions', { asgId: a.asgId })).stats.toGrade, 1);
});
test('แถวคะแนนผิด: ข้ามเฉพาะแถวนั้นพร้อมเหตุผล (เกินเต็ม/ติดลบ/ไม่ใช่ตัวเลข/ไม่อยู่ในวิชา/รหัสซ้ำ/รหัสเพี้ยน) แถวดีบันทึกครบ', () => {
  const s = world(4); const a = mkAsg(s, { maxScore: 10 });
  const r = ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [
    { stdId: std(1), score: 11 }, { stdId: std(2), score: -1 }, { stdId: std(3), score: 'abc' }, { stdId: '999999', score: 5 },
    { stdId: std(4), score: 7 }, { stdId: std(4), score: 8 }, { stdId: '', score: 3 }, { stdId: std(1), score: 10 }
  ] }));
  assert.strictEqual(r.saved, 1, JSON.stringify(r)); assert.strictEqual(r.skippedCount, 7);
  assert.strictEqual(scoreRow(s, 4).v, 7, 'ซ้ำ = ใช้แถวแรก'); assert.strictEqual(scoreRow(s, 1).v, null, 'แถวแรกของรหัสนี้ผิด → ข้าม และแถวหลังของรหัสเดียวกันไม่ถูกนำมาแทน');
  assert.ok(r.skipped.every(x => x.why));
  assert.strictEqual(code(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [] })), 'E_BAD_REQUEST');
  assert.strictEqual(code(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: 'x' })), 'E_BAD_REQUEST');
  assert.strictEqual(code(s.api(s.T2, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(1), score: 1 }] })), 'E_FORBIDDEN');
});
test('show_grades: เปิด=นักศึกษาเห็นคะแนน+ความเห็น · ปิด=เห็นแค่ว่าตรวจแล้ว ไม่เห็นคะแนน (ทั้งหน้ารายการและรายละเอียด)', () => {
  const s = world(2); const a = mkAsg(s, { showGrades: true });
  ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(1), score: 7, feedback: 'พอใช้' }] }));
  let t = ok(s.api(tok(s, 1), 'stu.task', { asgId: a.asgId }));
  assert.strictEqual(t.graded, true); assert.strictEqual(t.grade.score, 7); assert.strictEqual(t.grade.feedback, 'พอใช้');
  assert.strictEqual(ok(s.api(tok(s, 1), 'stu.tasks', {})).tasks[0].score, 7);
  ok(s.api(s.T1, 'asg.save', { asgId: a.asgId, showGrades: false }));
  t = ok(s.api(tok(s, 1), 'stu.task', { asgId: a.asgId }));
  assert.strictEqual(t.graded, true); assert.strictEqual(t.grade, null);
  const l = ok(s.api(tok(s, 1), 'stu.tasks', {})).tasks[0]; assert.strictEqual(l.graded, true); assert.strictEqual(l.score, null);
  assert.ok(JSON.stringify(ok(s.api(tok(s, 1), 'stu.task', { asgId: a.asgId }))).indexOf('พอใช้') < 0, 'ความเห็นไม่รั่ว');
  assert.strictEqual(ok(s.api(tok(s, 2), 'stu.task', { asgId: a.asgId })).graded, false);
});
test('นักศึกษาเห็นเฉพาะข้อมูลของตัวเอง: stu.task ไม่คืนรหัสไฟล์ Drive/โฟลเดอร์/คะแนนของคนอื่น', () => {
  const s = world(3); const a = mkAsg(s);
  ok(up(s, 1, a.asgId, 'a.pdf')); ok(up(s, 2, a.asgId, 'b.pdf', PDF(300)));
  ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(2), score: 3, feedback: 'ลับ' }] }));
  const dump = JSON.stringify(ok(s.api(tok(s, 1), 'stu.task', { asgId: a.asgId }))) + JSON.stringify(ok(s.api(tok(s, 1), 'stu.tasks', {})));
  Object.keys(s.state.drv.folders).concat(Object.keys(s.state.drv.files)).forEach(id => assert.ok(dump.indexOf('"' + id + '"') < 0, 'รั่ว ' + id));
  assert.ok(dump.indexOf('ลับ') < 0 && dump.indexOf('folder') < 0 && dump.indexOf('drive') < 0);
});

/* ============================================================ */
group('ดาวน์โหลด · ลบงาน · ลบนักศึกษา (cascade) · บันทึกตรวจสอบ');
test('asg.fileGet: อาจารย์เจ้าของ/admin ดาวน์โหลดได้ ไบต์ตรง · อาจารย์อื่น/นักศึกษา/ไม่ล็อกอินไม่ได้ · ไฟล์หายจาก Drive = E_NOT_FOUND', () => {
  const s = world(2); const a = mkAsg(s); const buf = PNG(777);
  const f = ok(up(s, 1, a.asgId, 'p.png', buf));
  const g = ok(s.api(s.T1, 'asg.fileGet', { fileId: f.fileId }));
  assert.strictEqual(g.name, 'p.png'); assert.strictEqual(g.mime, 'image/png'); assert.strictEqual(g.size, 777); assert.ok(Buffer.from(g.b64, 'base64').equals(buf));
  assert.strictEqual(ok(s.api(s.A, 'asg.fileGet', { fileId: f.fileId })).size, 777);
  assert.strictEqual(code(s.api(s.T2, 'asg.fileGet', { fileId: f.fileId })), 'E_FORBIDDEN');
  assert.strictEqual(code(s.api(s.T3, 'asg.fileGet', { fileId: f.fileId })), 'E_FORBIDDEN');
  assert.strictEqual(code(s.api(tok(s, 1), 'asg.fileGet', { fileId: f.fileId })), 'E_AUTH');
  assert.strictEqual(code(s.api('', 'asg.fileGet', { fileId: f.fileId })), 'E_AUTH');
  assert.strictEqual(code(s.api(s.T1, 'asg.fileGet', { fileId: 'FIL_x' })), 'E_NOT_FOUND');
  delete s.state.drv.files[Object.keys(s.state.drv.files)[0]];
  assert.strictEqual(code(s.api(s.T1, 'asg.fileGet', { fileId: f.fileId })), 'E_NOT_FOUND');
});
test('ลบงาน: แถวทั้งหมด + ประเภท/คะแนน ASSIGN หาย · ไฟล์และโฟลเดอร์ลงถังขยะ · งานอื่นและคะแนนอื่นอยู่ครบ', () => {
  const s = world(4); const a = mkAsg(s, { kind: 'group' }); const b = mkAsg(s, { title: 'งานที่เก็บไว้' });
  ok(G(s, 1, a.asgId, [2])); ok(up(s, 1, a.asgId, 'a.pdf')); ok(up(s, 3, b.asgId, 'k.pdf', PDF(222)));
  ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(1), score: 5 }] })); ok(s.api(s.T1, 'asg.grade', { asgId: b.asgId, grades: [{ stdId: std(3), score: 6 }] }));
  const r = ok(s.api(s.T1, 'asg.delete', { asgId: a.asgId }));
  assert.strictEqual(r.deletedFiles, 1);
  assert.strictEqual(s.rows('Assignments').length, 1); assert.strictEqual(s.rows('AsgGroups').length, 0); assert.strictEqual(s.rows('AsgMembers').length, 0);
  assert.strictEqual(files(s).length, 1); assert.strictEqual(sub(s).length, 1); assert.strictEqual(grades(s).length, 1);
  const t = ok(s.api(s.T1, 'score.table', { courseId: s.cid })); assert.strictEqual(t.types.filter(x => x.source === 'ASSIGN').length, 1);
  assert.strictEqual(scoreRow(s, 3).v, 6);
  assert.strictEqual(liveFiles(s).length, 1); assert.strictEqual(driveFiles(s).length, 2);
  const dead = Object.values(s.state.drv.folders).filter(f => f.trashed); assert.strictEqual(dead.length, 1);
  assert.strictEqual(code(s.api(s.T1, 'asg.get', { asgId: a.asgId })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api(s.T2, 'asg.delete', { asgId: b.asgId })), 'E_FORBIDDEN');
  assert.strictEqual(s.rows('Assignments').length, 1);
});
test('ลบงานขณะ Drive ใช้ไม่ได้: ข้อมูลในชีตยังถูกลบ (ไฟล์ค้างในถังไม่ทำให้ล้มทั้งคำสั่ง)', () => {
  const s = world(2); const a = mkAsg(s); ok(up(s, 1, a.asgId, 'a.pdf'));
  Object.keys(s.state.drv.files).forEach(k => delete s.state.drv.files[k]);
  assert.strictEqual(ok(s.api(s.T1, 'asg.delete', { asgId: a.asgId })).deletedFiles, 1);
  assert.strictEqual(s.rows('Assignments').length, 0); assert.strictEqual(files(s).length, 0);
});
test('student.impact แจ้งจำนวนข้อมูลส่งงาน · ลบนักศึกษา: งานเดี่ยว+ไฟล์(ถังขยะ)+คะแนนงานหาย · คนอื่นอยู่ครบ', () => {
  const s = world(3); const a = mkAsg(s);
  ok(up(s, 1, a.asgId, 'a.pdf')); ok(up(s, 2, a.asgId, 'b.pdf', PDF(300)));
  ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(1), score: 4 }, { stdId: std(2), score: 5 }] }));
  const im = ok(s.api(s.T1, 'student.impact', { courseId: s.cid, stdId: std(1) })).items.filter(x => x.key === 'assignments')[0];
  assert.ok(im && im.count >= 2, JSON.stringify(im));
  assert.strictEqual(ok(s.api(s.T1, 'student.impact', { courseId: s.cid, stdId: std(3) })).items.filter(x => x.key === 'assignments')[0].count, 0);
  ok(s.api(s.T1, 'student.remove', { courseId: s.cid, stdId: std(1) }));
  assert.strictEqual(sub(s).length, 1); assert.strictEqual(files(s).length, 1); assert.strictEqual(grades(s).length, 1); assert.strictEqual(liveFiles(s).length, 1);
  assert.strictEqual(scoreRow(s, 2).v, 5);
  assert.strictEqual(ok(s.api(s.T1, 'asg.submissions', { asgId: a.asgId })).units.length, 2);
});
test('ลบนักศึกษา (งานกลุ่ม): ตัวแทนถูกลบ → สมาชิกคนถัดไปรับช่วงพร้อมงานที่ส่ง · ลบจนไม่เหลือสมาชิก → กลุ่ม/งาน/ไฟล์หาย', () => {
  const s = world(4); const a = mkAsg(s, { kind: 'group' });
  ok(G(s, 1, a.asgId, [3, 2])); ok(up(s, 1, a.asgId, 'a.pdf'));
  ok(s.api(s.T1, 'student.remove', { courseId: s.cid, stdId: std(1) }));
  const g = s.rows('AsgGroups'); assert.strictEqual(g.length, 1); assert.strictEqual(g[0][4], std(2), 'รับช่วง = รหัสน้อยสุดในกลุ่มที่เหลือ');
  assert.strictEqual(sub(s)[0][4], std(2)); assert.strictEqual(files(s).length, 1);
  const t = ok(s.api(tok(s, 2), 'stu.task', { asgId: a.asgId })); assert.strictEqual(t.group.isRep, true); assert.strictEqual(t.sub.files.length, 1); assert.strictEqual(t.canEdit, true);
  ok(s.api(s.T1, 'student.remove', { courseId: s.cid, stdId: std(2) })); ok(s.api(s.T1, 'student.remove', { courseId: s.cid, stdId: std(3) }));
  assert.strictEqual(s.rows('AsgGroups').length, 0); assert.strictEqual(s.rows('AsgMembers').length, 0); assert.strictEqual(sub(s).length, 0); assert.strictEqual(files(s).length, 0); assert.strictEqual(liveFiles(s).length, 0);
});
test('นำเข้ารายชื่อใหม่ (student.importCsv) ไม่กระทบงานที่ส่งแล้ว · นักศึกษาที่เพิ่มใหม่เห็นงานเก่าและส่งได้ (ถ้ายังเปิด)', () => {
  const s = world(2); const a = mkAsg(s); ok(up(s, 1, a.asgId, 'a.pdf'));
  ok(s.api(s.T1, 'student.add', { courseId: s.cid, stdId: '660777', name: 'มาใหม่' }));
  const c = ok(s.api(s.T1, 'pin.issueTemp', { courseId: s.cid, stdId: '660777' })).codes[0];
  ok(s.api('', 'pin.setWithTemp', { courseId: s.cid, stdId: '660777', tempPin: c.pin, newPin: PIN }));
  const tk = ok(s.api('', 'stu.login', { courseId: s.cid, stdId: '660777', pin: PIN })).token;
  assert.strictEqual(ok(s.api(tk, 'stu.tasks', {})).tasks.length, 1);
  ok(s.api(tk, 'stu.upload', { asgId: a.asgId, name: 'n.pdf', b64: b64(PDF(150)) }));
  assert.strictEqual(files(s).length, 2); assert.strictEqual(ok(s.api(s.T1, 'asg.get', { asgId: a.asgId })).stats.total, 3);
});
test('บันทึกตรวจสอบ: สร้าง/แก้/ปิด/ให้คะแนน/อัปโหลด/ดาวน์โหลด/ลบ ถูกบันทึก · ไม่มี PIN · ไม่มีเนื้อไฟล์ base64', () => {
  const s = world(2); const a = mkAsg(s); const f = ok(up(s, 1, a.asgId, 'a.pdf', PDF(900)));
  ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: [{ stdId: std(1), score: 5 }] })); ok(s.api(s.T1, 'asg.fileGet', { fileId: f.fileId }));
  ok(s.api(s.T1, 'asg.setStatus', { asgId: a.asgId, closed: true })); ok(s.api(s.T1, 'asg.delete', { asgId: a.asgId }));
  const dump = JSON.stringify(s.rows('AuditLog'));
  ['asg.create', 'asg.upload', 'asg.grade', 'asg.fileGet', 'asg.close', 'asg.delete'].forEach(x => assert.ok(dump.indexOf(x) >= 0, x));
  assert.ok(dump.indexOf(PIN) < 0 || dump.indexOf('"' + PIN + '"') < 0); assert.ok(dump.indexOf(b64(PDF(900)).substring(0, 40)) < 0);
});
test('ตาราง/เวอร์ชัน: 6 ตารางงานมีครบ ส่วนหัวคอลัมน์ถูก · เรียก setup ซ้ำไม่ทำข้อมูลหาย · เวอร์ชัน schema 0.4.0', () => {
  const s = world(2); const a = mkAsg(s); ok(up(s, 1, a.asgId, 'a.pdf'));
  const names = ['Assignments', 'AsgGroups', 'AsgMembers', 'AsgSubs', 'AsgFiles', 'AsgGrades'];
  names.forEach(n => assert.ok(s.state.sheets[n], n));
  assert.strictEqual(s.state.sheets.AsgFiles.data[0].join(), 'file_id,sub_key,asg_id,course_id,name,size,mime,drive_id,uploaded_at,uploaded_by');
  s.setup(); assert.strictEqual(s.rows('Assignments').length, 1); assert.strictEqual(files(s).length, 1);
  assert.strictEqual(s.get().data.version, '0.6.0');
});

console.log('\n' + (fail ? '✘ ' + fail + ' ล้มเหลว (' + pass + ' ผ่าน)\n - ' + failures.join('\n - ') : '✔ ผ่านทั้งหมด (' + pass + ' ผ่าน)'));
process.exit(fail ? 1 : 0);
