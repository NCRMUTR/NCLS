'use strict';
/* ทดสอบ v0.11.0: ใบลานักศึกษา (Leave.gs) · แบบฟอร์ม/คำชี้แจงของ admin · อนุมัติ/สรุป · แสดง "ล" ในรายงานเช็คชื่อโดยไม่เปลี่ยนคะแนน · เตือนขาดเรียน
 * หมายเหตุ: รันกับตัวจำลอง Apps Script เหมือนชุดอื่น */
const assert = require('assert');
const { create } = require('./core_server.js');

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; console.log('  ✘ ' + name + '\n      ' + (e && e.stack || e).split('\n').slice(0, 4).join('\n      ')); }
}
function group(t) { console.log('\n' + t); }
const code = r => (r && r.error && r.error.code) || (r && r.ok ? 'OK' : '?');
const ok = r => { assert.strictEqual(r.ok, true, JSON.stringify(r)); return r.data; };
const std = i => String(660000 + i);
const ids = (...n) => n.map(std);
const PIN = '1234';
const PDF = n => { const b = Buffer.alloc(n || 100, 7); Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]).copy(b); return b; };
const b64 = b => b.toString('base64');
/** วันที่ (เขตเวลาไทย) เลื่อนจากวันนี้ n วัน */
const T = n => new Date(Date.now() + 7 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);

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
  ok(s.api(s.T1, 'pin.issueTemp', { courseId: s.cid, all: true })).codes.forEach(c =>
    ok(s.api('', 'pin.setWithTemp', { courseId: s.cid, stdId: c.stdId, tempPin: c.pin, newPin: PIN })));
  return s;
}
function tok(s, i) { s._tk = s._tk || {}; return s._tk[i] || (s._tk[i] = ok(s.api('', 'stu.login', { courseId: s.cid, stdId: std(i), pin: PIN })).token); }
const body = (over) => Object.assign({ type: 'sick', dateFrom: T(0), dateTo: T(0), allDay: true, reason: 'ไข้สูง', name: 'form.pdf', b64: b64(PDF(200)) }, over || {});
const submit = (s, i, over) => s.api(tok(s, i), 'stu.leaveSubmit', body(over));
const live = s => Object.values(s.state.drv.files).filter(f => !f.trashed);
const sleave = (s, i) => ok(s.api(tok(s, i), 'stu.leaveMine')).leaves;
const decide = (s, leaveIds, status, note) => s.api(s.T1, 'leave.decide', { courseId: s.cid, leaveIds, status, note });
const tick = (s, sec) => { s.state.clockMs += (sec || 5) * 1000; };
/** นำเข้าคาบย้อนหลังวันที่ date · map = { index: 'normal'|'late'|'absent'|'leave' } (ไม่ระบุ = ปกติ) */
function imp(s, date, map, n) {
  const rows = []; for (let i = 1; i <= (n || 5); i++) rows.push({ stdId: std(i), status: (map && map[i]) || 'normal' });
  return ok(s.api(s.T1, 'att.import', { courseId: s.cid, date, rows }));
}
const report = s => ok(s.api(s.T1, 'att.report', { courseId: s.cid }));
const rep = (r, i) => r.students.filter(x => x.stdId === std(i))[0];

/* ============================================================ */
group('แบบฟอร์ม + คำชี้แจง (admin) · หน้าข้อมูลสาธารณะ');
test('ยังไม่ตั้งอะไร: pub.leaveInfo ตอบได้โดยไม่ล็อกอิน (ไม่มีฟอร์ม/คำชี้แจงว่าง) · ดาวน์โหลดฟอร์ม → E_LEAVE_NO_FORM', () => {
  const s = world(2), r = ok(s.api('', 'pub.leaveInfo'));
  assert.strictEqual(r.hasForm, false); assert.strictEqual(r.notice, ''); assert.strictEqual(r.pastDays, 14); assert.strictEqual(r.futureDays, 30); assert.strictEqual(r.maxDays, 14);
  assert.ok(r.types.indexOf('pdf') >= 0);
  assert.strictEqual(code(s.api('', 'pub.leaveForm')), 'E_LEAVE_NO_FORM');
});
test('คำชี้แจงการลา: admin ตั้งได้หลายบรรทัด (ตัดช่องว่างหัวท้าย/แปลง CRLF) · อ่านได้โดยไม่ล็อกอิน · เกิน 1500 ตัวอักษร → E_SETTING', () => {
  const s = world(2);
  ok(s.api(s.A, 'settings.set', { changes: { leave_notice: '  ข้อ 1 ลาป่วยแนบใบรับรองแพทย์\r\nข้อ 2 ลากิจแจ้งล่วงหน้า  ' } }));
  assert.strictEqual(ok(s.api('', 'pub.leaveInfo')).notice, 'ข้อ 1 ลาป่วยแนบใบรับรองแพทย์\nข้อ 2 ลากิจแจ้งล่วงหน้า');
  assert.strictEqual(code(s.api(s.A, 'settings.set', { changes: { leave_notice: 'ก'.repeat(1501) } })), 'E_SETTING');
  assert.strictEqual(code(s.api(s.T1, 'settings.set', { changes: { leave_notice: 'x' } })), 'E_FORBIDDEN');
  ok(s.api(s.A, 'settings.set', { changes: { leave_past_days: 30, leave_future_days: 7, att_warn_absent: 3 } }));
  const r = ok(s.api('', 'pub.leaveInfo')); assert.strictEqual(r.pastDays, 30); assert.strictEqual(r.futureDays, 7);
  assert.strictEqual(code(s.api(s.A, 'settings.set', { changes: { leave_past_days: 61 } })), 'E_SETTING');
  assert.strictEqual(code(s.api(s.A, 'settings.set', { changes: { att_warn_absent: 0 } })), 'E_SETTING');
});
test('อัปโหลดแบบฟอร์ม: เฉพาะ admin · ชนิดไม่รับ/เนื้อไฟล์ไม่ตรง ถูกปฏิเสธ · สำเร็จแล้วดาวน์โหลดได้ตรงไบต์ (ไม่ต้องล็อกอิน)', () => {
  const s = world(2), pdf = PDF(500);
  assert.strictEqual(code(s.api(s.T1, 'leave.formSet', { name: 'f.pdf', b64: b64(pdf) })), 'E_FORBIDDEN');
  assert.strictEqual(code(s.api(s.A, 'leave.formSet', { name: 'f.exe', b64: b64(pdf) })), 'E_ASG_FILE_TYPE');
  assert.strictEqual(code(s.api(s.A, 'leave.formSet', { name: 'f.pdf', b64: b64(Buffer.from('not a pdf at all')) })), 'E_ASG_FILE_BAD');
  assert.strictEqual(code(s.api(s.A, 'leave.formSet', { name: 'f.pdf', b64: '' })), 'E_ASG_FILE_BAD');
  assert.strictEqual(live(s).length, 0, 'ที่ปฏิเสธต้องไม่ทิ้งไฟล์ใน Drive');
  const r = ok(s.api(s.A, 'leave.formSet', { name: 'แบบฟอร์มลา.pdf', b64: b64(pdf) }));
  assert.strictEqual(r.hasForm, true); assert.strictEqual(r.formName, 'แบบฟอร์มลา.pdf'); assert.strictEqual(r.formSize, 500);
  const d = ok(s.api('', 'pub.leaveForm'));
  assert.strictEqual(d.name, 'แบบฟอร์มลา.pdf'); assert.strictEqual(d.mime, 'application/pdf'); assert.ok(Buffer.from(d.b64, 'base64').equals(pdf));
  assert.strictEqual(ok(s.api('', 'pub.leaveInfo')).hasForm, true);
});
test('แทนที่แบบฟอร์ม = ไฟล์เก่าถูกทิ้งลงถังขยะ · ลบแบบฟอร์ม → ไม่มีฟอร์มและไม่มีไฟล์เหลือ · โฟลเดอร์ HBT_Leave ใช้ซ้ำ', () => {
  const s = world(2);
  ok(s.api(s.A, 'leave.formSet', { name: 'a.pdf', b64: b64(PDF(100)) }));
  ok(s.api(s.A, 'leave.formSet', { name: 'b.pdf', b64: b64(PDF(120)) }));
  assert.strictEqual(live(s).length, 1); assert.strictEqual(ok(s.api('', 'pub.leaveInfo')).formName, 'b.pdf');
  assert.strictEqual(Object.values(s.state.drv.folders).filter(f => f.name === 'HBT_Leave').length, 1);
  assert.strictEqual(ok(s.api(s.A, 'leave.formDelete')).hasForm, false);
  assert.strictEqual(live(s).length, 0); assert.strictEqual(code(s.api('', 'pub.leaveForm')), 'E_LEAVE_NO_FORM');
  assert.strictEqual(code(s.api(s.T1, 'leave.formDelete')), 'E_FORBIDDEN');
});

/* ============================================================ */
group('นักศึกษาส่งใบลา');
test('ส่งสำเร็จ: สถานะรออนุมัติ · เห็นเฉพาะของตัวเอง · ไฟล์ฟอร์มอยู่ใน Drive · ไม่รั่ว drive id ออกไปให้นักศึกษา', () => {
  const s = world(3);
  const r = ok(submit(s, 1, { reason: 'ไม่สบาย' }));
  assert.ok(r.leaveId && r.sent === true);
  const mine = sleave(s, 1); assert.strictEqual(mine.length, 1);
  const l = mine[0]; assert.strictEqual(l.status, 'pending'); assert.strictEqual(l.type, 'sick'); assert.strictEqual(l.dateFrom, T(0)); assert.strictEqual(l.days, 1);
  assert.strictEqual(l.form.name, 'form.pdf'); assert.strictEqual(l.extra, null); assert.strictEqual(l.reason, 'ไม่สบาย');
  assert.ok(!JSON.stringify(mine).includes('drive_id') && !/FIL|"drive/i.test(JSON.stringify(mine)));
  assert.strictEqual(sleave(s, 2).length, 0, 'นักศึกษาคนอื่นไม่เห็น');
  assert.strictEqual(live(s).length, 1);
  assert.strictEqual(s.rows('LeaveRequests').length, 1);
});
test('ต้องแนบฟอร์ม (ช่อง 1) · ชนิด/เนื้อไฟล์/ขนาดเกิน ถูกปฏิเสธและไม่ทิ้งไฟล์ · ต้องมีชนิดการลา', () => {
  const s = world(2);
  assert.strictEqual(code(s.api(tok(s, 1), 'stu.leaveSubmit', body({ b64: undefined, name: undefined }))), 'E_ASG_FILE_TYPE');
  assert.strictEqual(code(s.api(tok(s, 1), 'stu.leaveSubmit', body({ b64: '' }))), 'E_ASG_FILE_BAD');
  assert.strictEqual(code(submit(s, 1, { name: 'x.exe' })), 'E_ASG_FILE_TYPE');
  assert.strictEqual(code(submit(s, 1, { b64: b64(Buffer.from('fake')) })), 'E_ASG_FILE_BAD');
  assert.strictEqual(code(submit(s, 1, { b64: b64(PDF(5 * 1024 * 1024 + 100000)) })), 'E_ASG_FILE_SIZE');
  assert.strictEqual(code(submit(s, 1, { type: 'vacation' })), 'E_LEAVE_FIELD');
  assert.strictEqual(code(submit(s, 1, { type: '' })), 'E_LEAVE_FIELD');
  assert.strictEqual(live(s).length, 0); assert.strictEqual(s.rows('LeaveRequests').length, 0);
});
test('วันที่: รูปแบบผิด/วันสิ้นสุดก่อนเริ่ม/เกิน 14 วัน/ย้อนหลังเกิน 14 วัน/ล่วงหน้าเกิน 30 วัน/เวลาไม่ถูกต้อง → ปฏิเสธ · ขอบเขตพอดีผ่าน', () => {
  const s = world(2);
  const cases = [
    [{ dateFrom: '2026-02-30', dateTo: '2026-02-30' }, 'E_LEAVE_FIELD'], [{ dateFrom: 'วันนี้' }, 'E_LEAVE_FIELD'],
    [{ dateFrom: T(2), dateTo: T(1) }, 'E_LEAVE_FIELD'], [{ dateFrom: T(0), dateTo: T(14) }, 'E_LEAVE_FIELD'],
    [{ dateFrom: T(-15), dateTo: T(-15) }, 'E_LEAVE_DATE'], [{ dateFrom: T(31), dateTo: T(31) }, 'E_LEAVE_DATE'],
    [{ dateFrom: T(28), dateTo: T(32) }, 'E_LEAVE_DATE'], [{ dateFrom: T(-3), dateTo: T(31) }, 'E_LEAVE_FIELD'],
    [{ allDay: false, timeFrom: '10:00', timeTo: '09:00' }, 'E_LEAVE_FIELD'], [{ allDay: false, timeFrom: '25:00', timeTo: '26:00' }, 'E_LEAVE_FIELD'], [{ allDay: false }, 'E_LEAVE_FIELD']
  ];
  cases.forEach(([o, c]) => assert.strictEqual(code(submit(s, 1, o)), c, JSON.stringify(o)));
  assert.strictEqual(s.rows('LeaveRequests').length, 0); assert.strictEqual(live(s).length, 0, 'ไม่ผ่านการตรวจ = ไม่แตะ Drive');
  ok(submit(s, 1, { dateFrom: T(-14), dateTo: T(-14) }));        // ย้อนหลังพอดี 14 วัน
  ok(submit(s, 1, { dateFrom: T(30), dateTo: T(30) }));          // ล่วงหน้าพอดี 30 วัน
  ok(submit(s, 1, { dateFrom: T(1), dateTo: T(14) }));           // 14 วันพอดี
  assert.strictEqual(sleave(s, 1).length, 3);
});
test('กดซ้ำภายใน 60 วินาที = ไม่เกิดใบซ้ำและไม่เพิ่มไฟล์ · วันซ้อนกับใบที่รอ/อนุมัติ → E_LEAVE_OVERLAP · ช่วงเวลาคนละช่วงในวันเดียวกันได้', () => {
  const s = world(2);
  const a = ok(submit(s, 1)), b = ok(submit(s, 1));
  assert.strictEqual(b.duplicate, true); assert.strictEqual(b.leaveId, a.leaveId);
  assert.strictEqual(s.rows('LeaveRequests').length, 1); assert.strictEqual(live(s).length, 1);
  tick(s, 120);
  assert.strictEqual(code(submit(s, 1, { type: 'personal', reason: 'เรื่องอื่น' })), 'E_LEAVE_OVERLAP');
  ok(submit(s, 2, { allDay: false, timeFrom: '09:00', timeTo: '12:00' }));
  tick(s, 120);
  ok(submit(s, 2, { allDay: false, timeFrom: '13:00', timeTo: '16:00' }));
  assert.strictEqual(code(submit(s, 2, { allDay: false, timeFrom: '11:00', timeTo: '14:00' })), 'E_LEAVE_OVERLAP');
  ok(decide(s, [a.leaveId], 'approved'));
  tick(s, 120);
  assert.strictEqual(code(submit(s, 1, { type: 'personal' })), 'E_LEAVE_OVERLAP', 'ใบที่อนุมัติแล้วก็กันซ้ำ');
  ok(decide(s, [a.leaveId], 'rejected'));
  ok(submit(s, 1, { type: 'personal', reason: 'ส่งใหม่หลังไม่อนุมัติ' }));
});
test('ส่งได้ไม่เกิน 5 ใบต่อวัน → E_LEAVE_LIMIT · ใบที่ยกเลิกยังนับในโควตาของวัน', () => {
  const s = world(2);
  for (let d = 1; d <= 5; d++) { ok(submit(s, 1, { dateFrom: T(d), dateTo: T(d) })); tick(s, 70); }
  assert.strictEqual(code(submit(s, 1, { dateFrom: T(6), dateTo: T(6) })), 'E_LEAVE_LIMIT');
  const first = sleave(s, 1).filter(l => l.dateFrom === T(1))[0];
  ok(s.api(tok(s, 1), 'stu.leaveCancel', { leaveId: first.leaveId }));
  assert.strictEqual(code(submit(s, 1, { dateFrom: T(6), dateTo: T(6) })), 'E_LEAVE_LIMIT');
  ok(submit(s, 2, { dateFrom: T(6), dateTo: T(6) }));
});
test('ต้องล็อกอินนักศึกษา: ไม่มี token / token อาจารย์ → E_AUTH · นักศึกษาที่ถูกลบจากวิชาใช้ token เดิมไม่ได้', () => {
  const s = world(2);
  assert.strictEqual(code(s.api('', 'stu.leaveSubmit', body())), 'E_AUTH');
  assert.strictEqual(code(s.api(s.T1, 'stu.leaveSubmit', body())), 'E_AUTH');
  ['stu.leaveMine', 'stu.leaveCancel', 'stu.leaveAttach', 'stu.attMine'].forEach(a => assert.strictEqual(code(s.api('', a, {})), 'E_AUTH', a));
  const t = tok(s, 2);
  ok(s.api(s.T1, 'student.remove', { courseId: s.cid, stdId: std(2) }));
  assert.strictEqual(code(s.api(t, 'stu.leaveSubmit', body())), 'E_AUTH');
});
test('หลักฐานเพิ่ม (ช่อง 2): แนบได้เฉพาะใบที่รออนุมัติ · แนบซ้ำ = แทนที่ไฟล์เดิม (ไฟล์เก่าลงถังขยะ) · ใบของคนอื่น → E_NOT_FOUND · ไฟล์เสีย/ชนิดผิดปฏิเสธ', () => {
  const s = world(3), l = ok(submit(s, 1));
  const att = (i, over) => s.api(tok(s, i), 'stu.leaveAttach', Object.assign({ leaveId: l.leaveId, name: 'cert.pdf', b64: b64(PDF(150)) }, over || {}));
  assert.strictEqual(code(att(2)), 'E_NOT_FOUND');
  assert.strictEqual(code(att(1, { name: 'cert.exe' })), 'E_ASG_FILE_TYPE');
  assert.strictEqual(code(att(1, { b64: b64(Buffer.from('xx')) })), 'E_ASG_FILE_BAD');
  assert.strictEqual(code(att(1, { leaveId: 'LV-NONE' })), 'E_NOT_FOUND');
  const r = ok(att(1)); assert.strictEqual(r.attached, true); assert.strictEqual(live(s).length, 2);
  ok(att(1, { name: 'cert2.pdf' })); assert.strictEqual(live(s).length, 2, 'แทนที่ ไม่งอกไฟล์');
  assert.strictEqual(sleave(s, 1)[0].extra.name, 'cert2.pdf');
  ok(decide(s, [l.leaveId], 'approved'));
  assert.strictEqual(code(att(1)), 'E_LEAVE_STATE');
});
test('ยกเลิก: เฉพาะใบที่รออนุมัติ · ไฟล์ถูกลบ · กดซ้ำไม่เป็นไร · ใบที่ตัดสินแล้วยกเลิกไม่ได้ · ของคนอื่นยกเลิกไม่ได้', () => {
  const s = world(3), a = ok(submit(s, 1)); tick(s, 120);
  const b = ok(submit(s, 1, { dateFrom: T(3), dateTo: T(3) }));
  assert.strictEqual(code(s.api(tok(s, 2), 'stu.leaveCancel', { leaveId: a.leaveId })), 'E_NOT_FOUND');
  ok(s.api(tok(s, 1), 'stu.leaveCancel', { leaveId: a.leaveId })); ok(s.api(tok(s, 1), 'stu.leaveCancel', { leaveId: a.leaveId }));
  assert.strictEqual(sleave(s, 1).filter(l => l.leaveId === a.leaveId)[0].status, 'cancelled');
  assert.strictEqual(sleave(s, 1).filter(l => l.leaveId === a.leaveId)[0].form, null);
  assert.strictEqual(live(s).length, 1, 'เหลือไฟล์ของใบ b ใบเดียว');
  ok(decide(s, [b.leaveId], 'approved'));
  assert.strictEqual(code(s.api(tok(s, 1), 'stu.leaveCancel', { leaveId: b.leaveId })), 'E_LEAVE_STATE');
  ok(submit(s, 1, { dateFrom: T(0), dateTo: T(0), reason: 'ส่งใหม่หลังยกเลิก' }));        // ใบที่ยกเลิกไม่ทำให้วันซ้อน
});
test('Drive ล่ม: ส่งใบลาไม่สำเร็จและไม่เกิดแถวค้าง', () => {
  const s = world(2); s.state.drv.failFolder = true;
  assert.strictEqual(code(submit(s, 1)), 'E_DRIVE'); assert.strictEqual(s.rows('LeaveRequests').length, 0);
});
test('วิชาที่ไม่ใช่ภาคเรียนปัจจุบัน ส่งใบลาไม่ได้', () => {
  const s = world(2), t = tok(s, 1);
  ok(s.api(s.A, 'term.create', { name: '2/2569' }));
  const cur = ok(s.api(s.A, 'term.list')).terms.filter(x => x.name === '2/2569')[0];
  ok(s.api(s.A, 'term.setCurrent', { termId: cur.termId }));
  assert.strictEqual(code(s.api(t, 'stu.leaveSubmit', body())), 'E_NOT_FOUND');
});

/* ============================================================ */
group('อาจารย์: รายการ · อนุมัติ/ไม่อนุมัติ · ไฟล์ · บันทึกแทน · ลบ');
test('รายการใบลาของวิชา: เห็นเฉพาะอาจารย์เจ้าของวิชา/admin · ต้องมีสิทธิ์ระบบเช็คชื่อ · มีจำนวนตามสถานะและชื่อนักศึกษา', () => {
  const s = world(3);
  ok(submit(s, 1)); tick(s, 70); ok(submit(s, 2, { type: 'personal' }));
  const r = ok(s.api(s.T1, 'leave.list', { courseId: s.cid }));
  assert.strictEqual(r.leaves.length, 2); assert.strictEqual(r.counts.pending, 2); assert.strictEqual(r.counts.total, 2); assert.strictEqual(r.warnAbsent, 2);
  assert.strictEqual(r.leaves[0].stdId, std(2)); assert.strictEqual(r.leaves[0].stdName, 'นักศึกษา 2');
  assert.ok(!JSON.stringify(r).includes('drive_id'));
  assert.notStrictEqual(code(s.api(s.T2, 'leave.list', { courseId: s.cid })), 'OK', 'อาจารย์วิชาอื่น');
  assert.strictEqual(code(s.api(s.T3, 'leave.list', { courseId: s.cid })), 'E_FORBIDDEN', 'ไม่มีสิทธิ์ระบบ att');
  assert.strictEqual(code(s.api('', 'leave.list', { courseId: s.cid })), 'E_AUTH');
  assert.strictEqual(code(s.api(tok(s, 1), 'leave.list', { courseId: s.cid })), 'E_AUTH', 'token นักศึกษาใช้ฝั่งอาจารย์ไม่ได้');
  assert.strictEqual(ok(s.api(s.A, 'leave.list', { courseId: s.cid })).leaves.length, 2, 'admin เห็นทุกวิชา');
});
test('อนุมัติ/ไม่อนุมัติหลายใบ + หมายเหตุ (ไม่บังคับ) · เปลี่ยนคำตัดสินภายหลังได้ · ใบที่ยกเลิกแล้วแก้ไม่ได้ · นักศึกษาเห็นผลและหมายเหตุ', () => {
  const s = world(4);
  const a = ok(submit(s, 1)).leaveId; tick(s, 70); const b = ok(submit(s, 2)).leaveId; tick(s, 70); const c = ok(submit(s, 3)).leaveId;
  ok(s.api(tok(s, 3), 'stu.leaveCancel', { leaveId: c }));
  let r = ok(decide(s, [a, b, c], 'approved'));
  assert.strictEqual(r.changed, 2); assert.strictEqual(r.skipped, 1);
  assert.strictEqual(sleave(s, 1)[0].status, 'approved'); assert.strictEqual(sleave(s, 1)[0].teacherNote, ''); assert.strictEqual(sleave(s, 3)[0].status, 'cancelled');
  r = ok(decide(s, [b], 'rejected', 'ใบรับรองแพทย์ไม่ชัด'));
  assert.strictEqual(r.changed, 1);
  const lb = sleave(s, 2)[0]; assert.strictEqual(lb.status, 'rejected'); assert.strictEqual(lb.teacherNote, 'ใบรับรองแพทย์ไม่ชัด');
  assert.strictEqual(lb.decidedBy, 't1@rmutr.ac.th');
  assert.strictEqual(ok(decide(s, [b], 'rejected', 'ใบรับรองแพทย์ไม่ชัด')).changed, 0, 'ค่าเดิม = ไม่เปลี่ยน');
  ok(decide(s, [b], 'approved')); assert.strictEqual(sleave(s, 2)[0].status, 'approved'); assert.strictEqual(sleave(s, 2)[0].teacherNote, '');
  assert.strictEqual(code(decide(s, [a], 'pending')), 'E_LEAVE_FIELD'); assert.strictEqual(code(decide(s, [], 'approved')), 'E_BAD_REQUEST');
  assert.strictEqual(code(s.api(s.T2, 'leave.decide', { courseId: s.cid, leaveIds: [a], status: 'approved' })) === 'OK', false, 'อาจารย์วิชาอื่นอนุมัติไม่ได้');
  assert.strictEqual(code(s.api(s.T3, 'leave.decide', { courseId: s.cid, leaveIds: [a], status: 'approved' })), 'E_FORBIDDEN');
  assert.strictEqual(code(s.api(tok(s, 1), 'leave.decide', { courseId: s.cid, leaveIds: [a], status: 'approved' })), 'E_AUTH');
  assert.ok(s.rows('AuditLog').some(x => x[3] === 'leave.decide'));
});
test('เปิดดูไฟล์แนบ: เฉพาะอาจารย์เจ้าของวิชา/admin · ได้ไบต์ตรงกับที่ส่ง · บันทึก Audit · ช่องที่ไม่มีไฟล์ → E_NOT_FOUND', () => {
  const s = world(2), f = PDF(321), x = PDF(222);
  const l = ok(s.api(tok(s, 1), 'stu.leaveSubmit', body({ b64: b64(f), name: 'ฟอร์ม ลา.pdf' }))).leaveId;
  assert.strictEqual(code(s.api(s.T1, 'leave.fileGet', { leaveId: l, slot: 'extra' })), 'E_NOT_FOUND');
  ok(s.api(tok(s, 1), 'stu.leaveAttach', { leaveId: l, name: 'cert.pdf', b64: b64(x) }));
  const g = ok(s.api(s.T1, 'leave.fileGet', { leaveId: l, slot: 'form' }));
  assert.strictEqual(g.name, 'ฟอร์ม ลา.pdf'); assert.strictEqual(g.mime, 'application/pdf'); assert.ok(Buffer.from(g.b64, 'base64').equals(f));
  assert.ok(Buffer.from(ok(s.api(s.T1, 'leave.fileGet', { leaveId: l, slot: 'extra' })).b64, 'base64').equals(x));
  assert.ok(Buffer.from(ok(s.api(s.A, 'leave.fileGet', { leaveId: l })).b64, 'base64').equals(f));
  assert.notStrictEqual(code(s.api(s.T2, 'leave.fileGet', { leaveId: l })), 'OK');
  assert.strictEqual(code(s.api(s.T3, 'leave.fileGet', { leaveId: l })), 'E_FORBIDDEN');
  assert.strictEqual(code(s.api(tok(s, 2), 'leave.fileGet', { leaveId: l })), 'E_AUTH', 'นักศึกษา (แม้เพื่อน) ดาวน์โหลดไฟล์ใบลาไม่ได้');
  assert.ok(s.rows('AuditLog').filter(a => a[3] === 'leave.fileGet').length >= 3);
});
test('อาจารย์บันทึกการลาแทนนักศึกษา: อนุมัติทันที (หรือรอ) · ไม่ต้องมีไฟล์ · ไม่จำกัดช่วงวัน (ไม่เกิน 60 วัน) · ซ้อนกับใบเดิมไม่ได้ · นักศึกษานอกวิชาไม่ได้', () => {
  const s = world(3);
  const mk = (o) => s.api(s.T1, 'leave.create', Object.assign({ courseId: s.cid, stdId: std(1), type: 'sick', dateFrom: T(-40), dateTo: T(-38), reason: 'ใบกระดาษ' }, o || {}));
  const r = ok(mk());
  const l = ok(s.api(s.T1, 'leave.list', { courseId: s.cid })).leaves[0];
  assert.strictEqual(l.leaveId, r.leaveId); assert.strictEqual(l.status, 'approved'); assert.strictEqual(l.source, 'TEACHER'); assert.strictEqual(l.form, null); assert.strictEqual(l.days, 3);
  assert.strictEqual(code(mk({ dateFrom: T(-39), dateTo: T(-39) })), 'E_LEAVE_OVERLAP');
  assert.strictEqual(ok(mk({ stdId: std(2), status: 'pending', dateFrom: T(-1), dateTo: T(40) })).leaveId.length > 3, true);
  assert.strictEqual(code(mk({ stdId: std(3), dateFrom: T(0), dateTo: T(61) })), 'E_LEAVE_FIELD');
  assert.strictEqual(code(mk({ stdId: '999999' })), 'E_NOT_FOUND'); assert.strictEqual(code(mk({ stdId: '<x>' })), 'E_NOT_FOUND');
  assert.strictEqual(code(mk({ stdId: std(3), type: 'x' })), 'E_LEAVE_FIELD');
  assert.strictEqual(code(s.api(s.T3, 'leave.create', { courseId: s.cid, stdId: std(1), type: 'sick', dateFrom: T(0) })), 'E_FORBIDDEN');
  assert.strictEqual(code(s.api(tok(s, 1), 'leave.create', { courseId: s.cid, stdId: std(1), type: 'sick', dateFrom: T(0) })), 'E_AUTH');
});
test('ลบใบลา: ไฟล์ใน Drive ถูกลบด้วย · เลือกได้หลายใบ · ของวิชาอื่นลบไม่ได้', () => {
  const s = world(3), a = ok(submit(s, 1)).leaveId; tick(s, 70); const b = ok(submit(s, 2)).leaveId;
  ok(s.api(tok(s, 1), 'stu.leaveAttach', { leaveId: a, name: 'c.pdf', b64: b64(PDF(90)) }));
  assert.strictEqual(live(s).length, 3);
  assert.notStrictEqual(code(s.api(s.T2, 'leave.delete', { courseId: s.cid, leaveIds: [a] })), 'OK');
  assert.strictEqual(ok(s.api(s.T1, 'leave.delete', { courseId: s.cid, leaveIds: [a, b] })).removed, 2);
  assert.strictEqual(s.rows('LeaveRequests').length, 0); assert.strictEqual(live(s).length, 0);
});

/* ============================================================ */
group('ป้ายแจ้งเตือน · ลบนักศึกษา · รีเซ็ตวิชา');
test('จำนวนใบลาที่รออนุมัติขึ้นที่การ์ดรายวิชา (course.list/get: leaveNew) และลดลงเมื่อตัดสินแล้ว', () => {
  const s = world(3);
  assert.strictEqual(ok(s.api(s.T1, 'course.get', { courseId: s.cid })).leaveNew, 0);
  const a = ok(submit(s, 1)).leaveId; tick(s, 70); ok(submit(s, 2));
  assert.strictEqual(ok(s.api(s.T1, 'course.get', { courseId: s.cid })).leaveNew, 2);
  assert.strictEqual(ok(s.api(s.T1, 'course.list', {})).courses[0].leaveNew, 2);
  ok(decide(s, [a], 'approved'));
  assert.strictEqual(ok(s.api(s.T1, 'course.get', { courseId: s.cid })).leaveNew, 1);
});
test('ลบนักศึกษา: ใบลา+ไฟล์ของเขาหายไปด้วย (impact แสดงจำนวน) · ของคนอื่นอยู่ครบ', () => {
  const s = world(3); ok(submit(s, 1)); tick(s, 70); ok(submit(s, 2));
  const im = ok(s.api(s.T1, 'student.impact', { courseId: s.cid, stdId: std(1) }));
  assert.ok(JSON.stringify(im).includes('ใบลา'), JSON.stringify(im));
  ok(s.api(s.T1, 'student.remove', { courseId: s.cid, stdId: std(1) }));
  assert.strictEqual(s.rows('LeaveRequests').length, 1); assert.strictEqual(s.rows('LeaveRequests')[0][2], std(2)); assert.strictEqual(live(s).length, 1);
});
test('รีเซ็ตวิชา (admin): ใบลาและไฟล์ใบลาทั้งหมดถูกลบถาวร · แบบฟอร์มของ admin ยังอยู่', () => {
  const s = world(3); ok(s.api(s.A, 'leave.formSet', { name: 'f.pdf', b64: b64(PDF(80)) }));
  ok(submit(s, 1)); tick(s, 70); const l = ok(submit(s, 2)).leaveId;
  ok(s.api(tok(s, 2), 'stu.leaveAttach', { leaveId: l, name: 'c.pdf', b64: b64(PDF(90)) }));
  assert.strictEqual(live(s).length, 4);
  const r = ok(s.api(s.A, 'reset.course', { courseId: s.cid, confirm: 'BIO101-1' }));
  assert.strictEqual(r.done, true);
  assert.strictEqual(s.rows('LeaveRequests').length, 0);
  assert.strictEqual(live(s).length, 1, 'เหลือเฉพาะแบบฟอร์มของ admin'); assert.strictEqual(ok(s.api('', 'pub.leaveInfo')).hasForm, true);
});

/* ============================================================ */
group('บันทึกที่รายงานเช็คชื่อ: แสดง ล โดยไม่เปลี่ยนคะแนน');
test('ใบที่อนุมัติ: คาบที่ตรงวันและไม่มีบันทึก → ล · คาบอื่นยังขาด · ก่อนอนุมัติ/ไม่อนุมัติ/รอ = ขาดเหมือนเดิม · เปอร์เซ็นต์และคะแนนเช็คชื่อเท่าเดิมก่อน-หลังอนุมัติ', () => {
  const s = world(5);
  imp(s, T(-6), { 1: 'absent' }); imp(s, T(-5), {});                 // นศ.1 ขาดวัน T-6 แล้วมาวัน T-5
  const l = ok(s.api(s.T1, 'leave.create', { courseId: s.cid, stdId: std(1), type: 'sick', dateFrom: T(-6), dateTo: T(-6), status: 'pending' })).leaveId;
  let r = report(s); assert.deepStrictEqual(rep(r, 1).records, ['absent', 'normal']); assert.strictEqual(rep(r, 1).percent, 50);
  const typeId = () => ok(s.api(s.T1, 'score.summary', { courseId: s.cid })).types.filter(t => t.auto)[0].typeId;
  const sc = () => ok(s.api(s.T1, 'score.summary', { courseId: s.cid })).students.filter(x => x.stdId === std(1))[0].cells[typeId()].v;
  const before = sc(); assert.strictEqual(before, 50);
  ok(decide(s, [l], 'rejected')); assert.deepStrictEqual(rep(report(s), 1).records, ['absent', 'normal']);
  ok(decide(s, [l], 'approved'));
  r = report(s);
  assert.deepStrictEqual(rep(r, 1).records, ['leave', 'normal']); assert.strictEqual(rep(r, 1).counts.leave, 1); assert.strictEqual(rep(r, 1).counts.absent, 0);
  assert.strictEqual(rep(r, 1).percent, 50, 'เปอร์เซ็นต์เท่าเดิม'); assert.strictEqual(sc(), before, 'คะแนนเช็คชื่อเท่าเดิม');
  assert.deepStrictEqual(rep(r, 2).records, ['normal', 'normal']);
  const d = ok(s.api(s.T1, 'att.studentDetail', { courseId: s.cid, stdId: std(1) }));
  assert.deepStrictEqual(d.sessions.map(x => x.status), ['leave', 'normal']); assert.ok(d.sessions[0].note.indexOf('ใบลา') >= 0);
  assert.ok(rep(r, 1).percent === rep(r, 1).percent);
  ok(decide(s, [l], 'rejected')); assert.deepStrictEqual(rep(report(s), 1).records, ['absent', 'normal'], 'เปลี่ยนเป็นไม่อนุมัติ → กลับเป็นขาดทันที');
});
test('บันทึกจริงชนะใบลา: ถ้าคาบนั้นมีบันทึก (ปกติ/สาย/อาจารย์ตั้งลา) ใช้ตามบันทึก · ไม่เขียนแถวใหม่ลง AttRecords', () => {
  const s = world(3);
  imp(s, T(-4), { 1: 'late', 2: 'absent' });
  ok(s.api(s.T1, 'leave.create', { courseId: s.cid, stdId: std(1), type: 'sick', dateFrom: T(-4), dateTo: T(-4) }));
  ok(s.api(s.T1, 'leave.create', { courseId: s.cid, stdId: std(2), type: 'personal', dateFrom: T(-4), dateTo: T(-4) }));
  const before = s.rows('AttRecords').length;
  const r = report(s);
  assert.deepStrictEqual(rep(r, 1).records, ['late']); assert.deepStrictEqual(rep(r, 2).records, ['leave']); assert.deepStrictEqual(rep(r, 3).records, ['normal']);
  assert.strictEqual(s.rows('AttRecords').length, before, 'คำนวณตอนอ่านเท่านั้น');
  assert.ok(s.rows('AttRecords').every(x => x[8] !== 'LEAVE' && String(x).indexOf('LEAVE') < 0));
});
test('ช่วงหลายวัน: คาบในช่วงเป็น ล ส่วนวันก่อน/หลังช่วงเป็นขาด', () => {
  const s = world(2);
  [-9, -8, -7, -6, -5].forEach(d => imp(s, T(d), { 1: 'absent' }, 2));
  ok(s.api(s.T1, 'leave.create', { courseId: s.cid, stdId: std(1), type: 'sick', dateFrom: T(-8), dateTo: T(-6) }));
  assert.deepStrictEqual(rep(report(s), 1).records, ['absent', 'leave', 'leave', 'leave', 'absent']);
});
test('คาบสด (เปิดอยู่): คนที่มีใบลาอนุมัติตรงวันขึ้น "ลา" แทน "รอเช็ค" · ถ้าสแกนเข้าจริง บันทึกชนะ → ปกติ · ปิดคาบแล้วคนลาไม่นับขาด', () => {
  const s = world(3);
  ok(s.api(s.T1, 'leave.create', { courseId: s.cid, stdId: std(1), type: 'sick', dateFrom: T(0), dateTo: T(0) }));
  ok(s.api(s.T1, 'leave.create', { courseId: s.cid, stdId: std(2), type: 'sick', dateFrom: T(0), dateTo: T(0) }));
  const o = ok(s.api(s.T1, 'att.open', { courseId: s.cid }));
  let lv = ok(s.api(s.T1, 'att.live', { sessionId: o.sessionId }));
  const st = i => lv.students.filter(x => x.stdId === std(i))[0];
  assert.strictEqual(st(1).status, 'leave'); assert.strictEqual(st(1).source, 'LEAVE'); assert.strictEqual(st(3).status, 'waiting');
  assert.strictEqual(lv.counts.leave, 2); assert.strictEqual(lv.counts.waiting, 1);
  const c = ok(s.api('', 'att.checkIn', { sessionId: o.sessionId, stdId: std(2), deviceId: 'DEVICE-0002', pin: PIN }));
  assert.strictEqual(c.status, 'normal');
  lv = ok(s.api(s.T1, 'att.live', { sessionId: o.sessionId }));
  assert.strictEqual(st(2).status, 'normal'); assert.strictEqual(st(1).status, 'leave'); assert.strictEqual(lv.counts.leave, 1);
  ok(s.api(s.T1, 'att.close', { sessionId: o.sessionId }));
  lv = ok(s.api(s.T1, 'att.live', { sessionId: o.sessionId }));
  assert.strictEqual(st(1).status, 'leave'); assert.strictEqual(st(3).status, 'absent');
  assert.deepStrictEqual([rep(report(s), 1).records[0], rep(report(s), 2).records[0], rep(report(s), 3).records[0]], ['leave', 'normal', 'absent']);
});
test('ช่วงเวลาในใบลา: คาบที่เวลาเริ่มอยู่ในช่วงจึงนับ · คาบนำเข้า (ไม่มีเวลา) จับตามวัน · ลาทั้งวันนับทุกคาบ', () => {
  const s = world(2), L = s.ctx().Leave;
  const lv = [{ from: '2026-08-10', to: '2026-08-11', allDay: false, tf: '09:00', tt: '12:00', type: 'sick' }];
  assert.strictEqual(L.covers(lv, '2026-08-10', '2026-08-10 09:00:00'), true);
  assert.strictEqual(L.covers(lv, '2026-08-11', '2026-08-11 11:59:00'), true);
  assert.strictEqual(L.covers(lv, '2026-08-10', '2026-08-10 12:00:00'), false, 'เวลาสิ้นสุดไม่รวม');
  assert.strictEqual(L.covers(lv, '2026-08-10', '2026-08-10 08:59:00'), false);
  assert.strictEqual(L.covers(lv, '2026-08-12', '2026-08-12 10:00:00'), false);
  assert.strictEqual(L.covers(lv, '2026-08-10', ''), true, 'คาบนำเข้า = จับตามวัน');
  assert.strictEqual(L.covers([{ from: '2026-08-10', to: '2026-08-10', allDay: true, tf: '', tt: '' }], '2026-08-10', '2026-08-10 20:00:00'), true);
  assert.strictEqual(L.covers(undefined, '2026-08-10', ''), false); assert.strictEqual(L.covers([], '2026-08-10', ''), false);
});

/* ============================================================ */
group('สรุปการลา + เตือนขาดเรียน');
test('สรุปการลารายคน: นับเฉพาะที่อนุมัติ (ครั้ง/วัน แยกป่วย-กิจ) · รอ/ไม่อนุมัติแยกนับ · ส่งออก CSV', () => {
  const s = world(3);
  const mk = (i, o) => ok(s.api(s.T1, 'leave.create', Object.assign({ courseId: s.cid, stdId: std(i), type: 'sick', dateFrom: T(-20), dateTo: T(-18) }, o || {})));
  mk(1); mk(1, { type: 'personal', dateFrom: T(-10), dateTo: T(-10) }); mk(1, { dateFrom: T(-5), dateTo: T(-4) });
  mk(2, { status: 'pending' }); const r2 = mk(2, { dateFrom: T(-2), dateTo: T(-2) });
  ok(decide(s, [r2.leaveId], 'rejected'));
  const sm = ok(s.api(s.T1, 'leave.summary', { courseId: s.cid })), a = sm.students.filter(x => x.stdId === std(1))[0], b = sm.students.filter(x => x.stdId === std(2))[0];
  assert.deepStrictEqual(a.sick, { count: 2, days: 5 }); assert.deepStrictEqual(a.personal, { count: 1, days: 1 });
  assert.strictEqual(b.pending, 1); assert.strictEqual(b.rejected, 1); assert.deepStrictEqual(b.sick, { count: 0, days: 0 });
  assert.strictEqual(sm.warnAbsent, 2); assert.strictEqual(sm.students.length, 3);
  const csv = ok(s.api(s.T1, 'leave.exportCsv', { courseId: s.cid }));
  assert.ok(/-leave\.csv$/.test(csv.filename)); assert.ok(csv.csv.indexOf('ลาป่วย (วัน)') >= 0); assert.ok(csv.csv.indexOf(std(1) + ',นักศึกษา 1,2,5,1,1,6') >= 0, csv.csv);
  assert.strictEqual(code(s.api(s.T3, 'leave.summary', { courseId: s.cid })), 'E_FORBIDDEN');
  assert.notStrictEqual(code(s.api(s.T2, 'leave.summary', { courseId: s.cid })), 'OK');
});
test('นักศึกษาดูการเข้าเรียนของตัวเอง (stu.attMine): จำนวนปกติ/สาย/ลา/ขาด · % · ประวัติรายคาบ · เห็นเฉพาะของตัวเอง', () => {
  const s = world(3);
  imp(s, T(-4), { 1: 'absent', 2: 'late' }, 3); imp(s, T(-3), { 1: 'absent' }, 3); imp(s, T(-2), {}, 3);
  const a = ok(s.api(tok(s, 1), 'stu.attMine')), b = ok(s.api(tok(s, 2), 'stu.attMine'));
  assert.strictEqual(a.totalSessions, 3); assert.strictEqual(a.absent, 2); assert.strictEqual(a.normal, 1); assert.strictEqual(a.leave, 0);
  assert.strictEqual(a.percent, 33.33); assert.deepStrictEqual(a.history.map(h => h.status), ['absent', 'absent', 'normal']);
  assert.strictEqual(a.course.code, 'BIO101'); assert.strictEqual(a.warnAbsent, 2);
  assert.strictEqual(b.late, 1); assert.strictEqual(b.normal, 2); assert.strictEqual(b.absent, 0); assert.strictEqual(b.percent, 83.33);
});
test('เตือนขาดเรียน: ขาดเกินเกณฑ์ (ค่าเริ่มต้น 2 = ตั้งแต่ครั้งที่ 3) ไม่นับลาที่อนุมัติ · ปรับเกณฑ์ได้ · ธงฝั่งอาจารย์ใน leave.summary', () => {
  const s = world(4);
  [-6, -5, -4].forEach(d => imp(s, T(d), { 1: 'absent', 2: 'absent', 3: 'absent' }, 4));
  const me = i => ok(s.api(tok(s, i), 'stu.attMine'));
  assert.strictEqual(me(1).absent, 3); assert.strictEqual(me(1).over, true); assert.strictEqual(me(4).over, false);
  ok(s.api(s.T1, 'leave.create', { courseId: s.cid, stdId: std(2), type: 'sick', dateFrom: T(-6), dateTo: T(-6) }));
  assert.strictEqual(me(2).absent, 2); assert.strictEqual(me(2).leave, 1); assert.strictEqual(me(2).over, false, 'ขาด 2 ครั้ง + ลา 1 ไม่เกินเกณฑ์');
  const flags = () => Object.fromEntries(ok(s.api(s.T1, 'leave.summary', { courseId: s.cid })).students.map(x => [x.stdId, x.over]));
  assert.deepStrictEqual(flags(), { [std(1)]: true, [std(2)]: false, [std(3)]: true, [std(4)]: false });
  ok(s.api(s.A, 'settings.set', { changes: { att_warn_absent: 1 } }));
  assert.strictEqual(me(2).over, true); assert.strictEqual(me(2).warnAbsent, 1);
  assert.strictEqual(flags()[std(2)], true);
  ok(s.api(s.A, 'settings.set', { changes: { att_warn_absent: 3 } }));
  assert.strictEqual(me(1).over, false, 'ขาด 3 ครั้ง ยังไม่เกิน 3');
});
test('ใบลาไม่เปลี่ยนคะแนนรวม/เกรดในหน้าสรุปคะแนนเลย (เทียบก่อน-หลังอนุมัติทั้งตาราง)', () => {
  const s = world(4);
  [-9, -8, -7].forEach((d, k) => imp(s, T(d), k === 0 ? { 1: 'absent', 2: 'absent' } : { 2: 'late' }, 4));
  const snap = () => JSON.stringify(ok(s.api(s.T1, 'score.summary', { courseId: s.cid })).students.map(x => [x.stdId, x.cells, x.base, x.total, x.grade]));
  const before = snap();
  ok(s.api(s.T1, 'leave.create', { courseId: s.cid, stdId: std(1), type: 'sick', dateFrom: T(-9), dateTo: T(-7) }));
  ok(s.api(s.T1, 'leave.create', { courseId: s.cid, stdId: std(2), type: 'personal', dateFrom: T(-9), dateTo: T(-9) }));
  assert.strictEqual(snap(), before);
  assert.strictEqual(s.rows('ScoreRecords').filter(r => String(r).indexOf('leave') >= 0).length, 0);
});

/* ============================================================ */
group('ขนาดคำขอ (body ใหญ่) · ความปลอดภัย');
test('route ที่ประกาศ big รับ body เกิน 2 MB ได้ (ส่งใบลา/ฟอร์ม) · route ทั่วไปยังปฏิเสธ too_large · ใส่ชื่อ route อื่นไว้ใน args ก็ไม่หลอกได้', () => {
  const s = world(2), t = tok(s, 1), pad = 'x'.repeat(2.5 * 1024 * 1024);
  const raw = o => JSON.parse(s.raw(o));
  assert.strictEqual(code(raw({ action: 'stu.leaveMine', token: t, args: { pad } })), 'E_BAD_REQUEST');
  assert.strictEqual(code(raw({ action: 'leave.list', token: s.T1, args: { courseId: s.cid, pad, x: '"stu.leaveSubmit"' } })), 'E_BAD_REQUEST');
  assert.strictEqual(code(raw({ action: 'stu.leaveSubmit', token: t, args: body({ b64: b64(PDF(2.6 * 1024 * 1024)) }) })), 'OK');
  assert.strictEqual(code(raw({ action: 'leave.formSet', token: s.A, args: { name: 'big.pdf', b64: b64(PDF(2.7 * 1024 * 1024)) } })), 'OK');
  assert.strictEqual(code(raw({ action: 'stu.leaveSubmit', token: t, args: { type: 'sick', b64: 'A'.repeat(9.5 * 1024 * 1024) } })), 'E_BAD_REQUEST');
});
test('ข้อความในคำชี้แจง/เหตุผล ที่มีอักขระควบคุม/HTML ถูกเก็บเป็นข้อความธรรมดา (หน้าเว็บต้อง escape) · เหตุผลยาวถูกตัดที่ 1000 ตัวอักษร', () => {
  const s = world(2);
  ok(submit(s, 1, { reason: '<script>alert(1)</script>\u0000\u0007ป่วย' + 'ก'.repeat(1200) }));
  const r = sleave(s, 1)[0].reason;
  assert.ok(r.startsWith('<script>alert(1)</script>ป่วย')); assert.strictEqual(r.length, 1000); assert.ok(!/[\u0000-\u0008]/.test(r));
});

console.log('\n' + (fail ? '✘ มีข้อล้มเหลว ' + fail + ' ข้อ' : '✔ ผ่านทั้งหมด (' + pass + ' ผ่าน)'));
process.exit(fail ? 1 : 0);
