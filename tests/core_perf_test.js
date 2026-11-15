'use strict';
/* ทดสอบประสิทธิภาพ (นับจำนวนครั้งที่เรียก Google Sheets ต่อคำขอ ในตัวจำลอง) + ความถูกต้องของแคชข้าม execution + การอ่านตารางใหญ่เป็นช่วง
 * เป้าหมาย: จำนวนคำสั่งต่อคำขอ "ต้องไม่โตตามจำนวนนักศึกษา" — ถ้าหลุดเพดานแปลว่ามีโค้ดอ่านทีละแถว (N+1) กลับเข้ามา
 * หมายเหตุ: นับคำสั่งในตัวจำลอง ไม่ใช่เวลาจริงของ Google (เวลาจริงต้องวัดบน Apps Script) */
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
const std = i => String(660000 + i), dev = i => 'device-' + String(i).padStart(4, '0');

function world(N) {
  const s = create(); s.setup();
  s.A = s.tokenOf('admin@rmutr.ac.th');
  ok(s.api(s.A, 'term.create', { name: '1/2569' }));
  ['t1', 't2'].forEach(n => ok(s.api(s.A, 'user.upsert', { email: n + '@rmutr.ac.th', name: 'อาจารย์ ' + n, systems: ['att', 'exam', 'asg'] })));
  s.T1 = s.tokenOf('t1@rmutr.ac.th'); s.T2 = s.tokenOf('t2@rmutr.ac.th');
  s.cid = ok(s.api(s.T1, 'course.create', { code: 'BIO101', name: 'ชีววิทยา', section: '1' })).courseId;
  const rows = []; for (let i = 1; i <= N; i++) rows.push({ stdId: std(i), name: 'นักศึกษา ' + i });
  ok(s.api(s.T1, 'student.importCsv', { courseId: s.cid, rows }));
  return s;
}
/** จำนวนคำสั่ง Sheets ของคำขอเดียว */
function ops(s, fn) { const o = s.state.ops; const r = fn(); return { n: s.state.ops - o, r }; }

/* ============================================================ */
group('จำนวนคำสั่ง Sheets ต่อคำขอ: ห้อง 100 คนต้องไม่เกินเพดาน และไม่โตตามจำนวนนักศึกษา');
function readers(s) {
  const o = ok(s.api(s.T1, 'att.open', { courseId: s.cid }));
  for (let i = 1; i <= 5; i++) s.api('', 'att.checkIn', { sessionId: o.sessionId, stdId: std(i), deviceId: dev(i), newPin: '1234' });
  ok(s.api(s.T1, 'att.close', { sessionId: o.sessionId }));
  const o2 = ok(s.api(s.T1, 'att.open', { courseId: s.cid })); ok(s.api(s.T1, 'att.close', { sessionId: o2.sessionId }));
  const lg = ok(s.api('', 'stu.login', { courseId: s.cid, stdId: std(1), pin: '1234' }));
  const calls = {
    'att.live': () => { const c = ok(s.api(s.T1, 'att.open', { courseId: s.cid })); const r = ops(s, () => s.api(s.T1, 'att.live', { sessionId: c.sessionId })); ok(s.api(s.T1, 'att.close', { sessionId: c.sessionId })); return r; },
    'student.list': () => ops(s, () => s.api(s.T1, 'student.list', { courseId: s.cid })),
    'course.get': () => ops(s, () => s.api(s.T1, 'course.get', { courseId: s.cid })),
    'att.sessions': () => ops(s, () => s.api(s.T1, 'att.sessions', { courseId: s.cid })),
    'att.page': () => ops(s, () => s.api(s.T1, 'att.page', { courseId: s.cid })),
    'att.report': () => ops(s, () => s.api(s.T1, 'att.report', { courseId: s.cid })),
    'score.table': () => ops(s, () => s.api(s.T1, 'score.table', { courseId: s.cid })),
    'stu.tasks': () => ops(s, () => s.api(lg.token, 'stu.tasks', {})),
    'stu.login': () => ops(s, () => s.api('', 'stu.login', { courseId: s.cid, stdId: std(2), pin: '1234' }))
  };
  const out = {};
  Object.keys(calls).forEach(k => { const r = calls[k](); assert.strictEqual(r.r.ok, true, k + ' ' + JSON.stringify(r.r)); out[k] = r.n; });
  return out;
}
const CEIL = { 'att.live': 16, 'student.list': 16, 'course.get': 12, 'att.sessions': 12, 'att.page': 24, 'att.report': 18, 'score.table': 20, 'stu.tasks': 25, 'stu.login': 10 };
const small = readers(world(30)), big = readers(world(100));
Object.keys(CEIL).forEach(k => {
  test(k + ': ห้อง 100 คน ≤ ' + CEIL[k] + ' คำสั่ง (ได้ ' + big[k] + ') · ต่างจากห้อง 30 คนไม่เกิน 4 (ได้ ' + (big[k] - small[k]) + ')', () => {
    assert.ok(big[k] <= CEIL[k], k + ' = ' + big[k]);
    assert.ok(big[k] - small[k] <= 4, k + ' โตตามจำนวนนักศึกษา: ' + small[k] + ' → ' + big[k]);
  });
});
test('เช็คชื่อ 1 คน (ตั้ง PIN ครั้งแรก): ≤ 32 คำสั่งรวม · ไม่โตตามจำนวนนักศึกษา', () => {
  const run = N => {
    const s = world(N); const o = ok(s.api(s.T1, 'att.open', { courseId: s.cid }));
    for (let i = 1; i < N; i++) s.api('', 'att.checkIn', { sessionId: o.sessionId, stdId: std(i), deviceId: dev(i), newPin: '1234' });
    const r = ops(s, () => s.api('', 'att.checkIn', { sessionId: o.sessionId, stdId: std(N), deviceId: dev(N), newPin: '1234' }));
    assert.strictEqual(r.r.ok, true); return r.n;
  };
  const a = run(30), b = run(100);
  assert.ok(b <= 32, 'ได้ ' + b); assert.ok(b - a <= 4, a + ' → ' + b);
});
test('หน้าสแกนไม่ดาวน์โหลดรายชื่อ: att.info ≤ 6 คำสั่ง (ไม่ต้องเรียก pub.students อีก)', () => {
  const s = world(100); const o = ok(s.api(s.T1, 'att.open', { courseId: s.cid }));
  assert.ok(ops(s, () => s.api('', 'att.info', { sessionId: o.sessionId })).n <= 6);
});

/* ============================================================ */
group('แคชข้าม execution: ข้อมูลเปลี่ยนแล้วเห็นผลทันที (ไม่มีข้อมูลเก่าค้าง)');
test('เพิ่ม/แก้/ลบนักศึกษา → pub.students และ student.list ตรงทันที · คำขอถัดไปอ่านจากแคช (0 คำสั่ง)', () => {
  const s = world(5);
  const pub = () => ok(s.api('', 'pub.students', { courseId: s.cid })).students.map(x => x.stdId + ':' + x.name);
  assert.strictEqual(pub().length, 5);
  assert.strictEqual(ops(s, () => s.api('', 'pub.students', { courseId: s.cid })).n, 0, 'ครั้งที่ 2 ต้องมาจากแคช');
  ok(s.api(s.T1, 'student.add', { courseId: s.cid, stdId: '660099', name: 'คนใหม่' }));
  assert.ok(pub().includes('660099:คนใหม่'));
  ok(s.api(s.T1, 'student.update', { courseId: s.cid, stdId: '660099', name: 'ชื่อใหม่' }));
  assert.ok(pub().includes('660099:ชื่อใหม่') && !pub().includes('660099:คนใหม่'));
  ok(s.api(s.T1, 'student.remove', { courseId: s.cid, stdId: '660099' }));
  assert.ok(!pub().some(x => x.startsWith('660099')));
  ok(s.api(s.T1, 'student.removeMany', { courseId: s.cid, stdIds: [std(1), std(2)] }));
  assert.strictEqual(pub().length, 3);
  ok(s.api(s.T1, 'student.importCsv', { courseId: s.cid, mode: 'replace', rows: [{ stdId: std(3), name: 'คนเดียว' }] }));
  assert.deepStrictEqual(pub(), [std(3) + ':คนเดียว']);
});
test('แก้ชื่อวิชา/ย้ายภาคเรียนปัจจุบัน/ปิดบัญชีอาจารย์ → ผลตรงทันที (วิชา ภาคเรียน ผู้ใช้ ถูกแคช)', () => {
  const s = world(2);
  const tid = s.ctx().Courses.tidOf('t1@rmutr.ac.th');
  assert.strictEqual(ok(s.api('', 'pub.courses', { tid })).courses[0].name, 'ชีววิทยา');
  ok(s.api(s.T1, 'course.update', { courseId: s.cid, name: 'ชีววิทยาทั่วไป' }));
  assert.strictEqual(ok(s.api('', 'pub.courses', { tid })).courses[0].name, 'ชีววิทยาทั่วไป');
  const t2 = ok(s.api(s.A, 'term.create', { name: '2/2569' })).terms.find(t => t.name === '2/2569');
  ok(s.api(s.A, 'term.setCurrent', { termId: t2.termId }));
  assert.strictEqual(ok(s.api('', 'pub.courses', { tid })).courses.length, 0);            // วิชาอยู่ภาคเก่า
  assert.strictEqual(code(s.api('', 'stu.login', { courseId: s.cid, stdId: std(1), pin: '1234' })), 'E_NOT_FOUND');
  ok(s.api(s.A, 'user.setActive', { email: 't1@rmutr.ac.th', active: false }));
  assert.strictEqual(code(s.api(s.T1, 'course.list', {})), 'E_DISABLED');
});
test('ลบวิชา (reset) → รายการวิชา/นักศึกษาในแคชหายทันที · เช็คชื่อด้วยรหัสที่ถูกลบ = E_NOT_FOUND', () => {
  const s = world(3); const o = ok(s.api(s.T1, 'att.open', { courseId: s.cid }));
  assert.strictEqual(ok(s.api('', 'pub.students', { courseId: s.cid })).students.length, 3);
  ok(s.api(s.T1, 'student.remove', { courseId: s.cid, stdId: std(1) }));
  assert.strictEqual(code(s.api('', 'att.checkIn', { sessionId: o.sessionId, stdId: std(1), deviceId: dev(1), newPin: '1234' })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api('', 'att.checkIn', { sessionId: o.sessionId, stdId: std(2), deviceId: dev(2), newPin: '1234' })), 'OK');
  ok(s.api(s.T1, 'course.delete', { courseId: s.cid, confirm: 'BIO101-1' }));
  assert.strictEqual(ok(s.api('', 'pub.students', { courseId: s.cid })).students.length, 0);
});

/* ============================================================ */
group('หน้าสแกน: กรอกรหัสนักศึกษาแทนเลือกชื่อ (ระบบเทียบรายชื่อและคืนชื่อ)');
test('รหัสถูก → สำเร็จและคืนชื่อ · รหัสไม่อยู่ในวิชา/ผิดรูปแบบ/ว่าง → E_NOT_FOUND (ไม่เปิดเผยรายชื่อ) · ตัวพิมพ์เล็กใช้ได้ (ปรับเป็นพิมพ์ใหญ่)', () => {
  const s = world(5); const o = ok(s.api(s.T1, 'att.open', { courseId: s.cid }));
  const ci = (id, d) => s.api('', 'att.checkIn', { sessionId: o.sessionId, stdId: id, deviceId: dev(d), newPin: '1234' });
  ['999999', '12', 'x y', '', '<b>'].forEach((id, k) => assert.strictEqual(code(ci(id, 20 + k)), 'E_NOT_FOUND', JSON.stringify(id)));
  const r = ok(ci(std(3), 1)); assert.strictEqual(r.name, 'นักศึกษา 3'); assert.strictEqual(r.already, false);
  assert.strictEqual(ok(ci(std(3), 1)).already, true);
  const s2 = world(2); ok(s2.api(s2.T1, 'student.add', { courseId: s2.cid, stdId: 'abc-1234', name: 'รหัสผสม' }));
  const o2 = ok(s2.api(s2.T1, 'att.open', { courseId: s2.cid }));
  assert.strictEqual(ok(s2.api('', 'att.checkIn', { sessionId: o2.sessionId, stdId: 'ABC-1234', deviceId: dev(1), newPin: '1234' })).name, 'รหัสผสม');
  assert.strictEqual(ok(s2.api('', 'att.checkIn', { sessionId: o2.sessionId, stdId: 'abc-1234', deviceId: dev(1) })).already, true);
});
test('เว็บ: scan.js ไม่เรียก pub.students และมีช่องกรอกรหัส (#stdId) พร้อมข้อความเมื่อรหัสไม่ตรง', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'web', 'assets', 'scan.js'), 'utf8');
  assert.ok(!src.includes("'pub.students'") && !src.includes('selS'));
  assert.ok(src.includes('id="stdId"') && src.includes('ไม่พบรหัสนักศึกษา'));
});

/* ============================================================ */
group('ตารางใหญ่ (> 400 แถว): อ่านเป็นช่วง ผลต้องถูกแม้ข้อมูลหลายวิชาแทรกสลับกัน');
test('AttRecords สลับหลายวิชา 900+ แถว: รายงานแต่ละวิชาตรง · คำสั่งต่อคำขอไม่โตตามจำนวนแถว', () => {
  const s = world(450);
  const B = ok(s.api(s.T2, 'course.create', { code: 'CHM201', name: 'เคมี', section: '1' })).courseId;
  const rowsB = []; for (let i = 1; i <= 30; i++) rowsB.push({ stdId: 'B' + String(100000 + i), name: 'เคมี ' + i });
  ok(s.api(s.T2, 'student.importCsv', { courseId: B, rows: rowsB }));
  const all = []; for (let i = 1; i <= 450; i++) all.push({ stdId: std(i), status: i % 3 === 0 ? 'late' : 'normal' });
  ok(s.api(s.T1, 'att.import', { courseId: s.cid, date: '2026-08-03', rows: all }));
  ok(s.api(s.T2, 'att.import', { courseId: B, date: '2026-08-03', rows: rowsB.map(r => ({ stdId: r.stdId, status: 'normal' })) }));
  ok(s.api(s.T1, 'att.import', { courseId: s.cid, date: '2026-08-10', rows: all }));
  ok(s.api(s.T2, 'att.import', { courseId: B, date: '2026-08-10', rows: rowsB.slice(0, 10).map(r => ({ stdId: r.stdId, status: 'late' })) }));
  assert.ok(s.state.sheets.AttRecords.data.length > 930);
  const ra = ok(s.api(s.T1, 'att.report', { courseId: s.cid })), rb = ok(s.api(s.T2, 'att.report', { courseId: B }));
  assert.strictEqual(ra.totalSessions, 2); assert.strictEqual(ra.students.length, 450);
  assert.deepStrictEqual(ra.students[2].records, ['late', 'late']); assert.strictEqual(ra.students[0].percent, 100); assert.strictEqual(ra.students[2].percent, 50);
  assert.strictEqual(rb.students.length, 30); assert.strictEqual(rb.students[0].percent, 75); assert.strictEqual(rb.students[29].percent, 50);
  assert.ok(ops(s, () => s.api(s.T2, 'att.report', { courseId: B })).n <= 25, 'รายงานวิชา B (30 คน) ในชีต 900 แถว');
  const sd = ok(s.api(s.T1, 'att.studentDetail', { courseId: s.cid, stdId: std(3) }));
  assert.deepStrictEqual(sd.sessions.map(x => x.status), ['late', 'late']);
});

console.log('\n' + (fail ? '✘ มีข้อล้มเหลว ' + fail + ' ข้อ: ' + failures.join(' | ') : '✔ ผ่านทั้งหมด (' + pass + ' ผ่าน)'));
process.exit(fail ? 1 : 0);
