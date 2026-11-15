'use strict';
/* ทดสอบ v0.9.0: ประวัติการแก้งานกลุ่ม (AsgSubLog) · กันแก้ชนกัน (E_ASG_CONFLICT) · dropdown กลุ่ม · กล่องข้อความนักศึกษา→อาจารย์ (Inbox)
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

function world(nStd) {
  const s = create(); s.setup();
  s.A = s.tokenOf('admin@rmutr.ac.th');
  ok(s.api(s.A, 'term.create', { name: '1/2569' }));
  ['t1', 't2'].forEach(n => ok(s.api(s.A, 'user.upsert', { email: n + '@rmutr.ac.th', name: 'อาจารย์ ' + n, systems: ['att', 'exam', 'asg'] })));
  s.T1 = s.tokenOf('t1@rmutr.ac.th'); s.T2 = s.tokenOf('t2@rmutr.ac.th');
  s.cid = ok(s.api(s.T1, 'course.create', { code: 'BIO101', name: 'ชีววิทยา', section: '1' })).courseId;
  const rows = []; for (let i = 1; i <= (nStd || 5); i++) rows.push({ stdId: std(i), name: 'นักศึกษา ' + i });
  ok(s.api(s.T1, 'student.importCsv', { courseId: s.cid, rows }));
  ok(s.api(s.T1, 'pin.issueTemp', { courseId: s.cid, all: true })).codes.forEach(c =>
    ok(s.api('', 'pin.setWithTemp', { courseId: s.cid, stdId: c.stdId, tempPin: c.pin, newPin: PIN })));
  return s;
}
function tok(s, i) { s._tk = s._tk || {}; return s._tk[i] || (s._tk[i] = ok(s.api('', 'stu.login', { courseId: s.cid, stdId: std(i), pin: PIN })).token); }
const up = (s, i, asgId, name) => s.api(tok(s, i), 'stu.upload', { asgId, name, b64: PDF(100).toString('base64') });
const task = (s, i, asgId) => ok(s.api(tok(s, i), 'stu.task', { asgId }));
const note = (s, i, asgId, n, base) => s.api(tok(s, i), 'stu.saveNote', Object.assign({ asgId, note: n }, base === undefined ? {} : { baseUpdatedAt: base }));
const tick = (s, sec) => { s.state.clockMs += (sec || 5) * 1000; };
/** โลกที่มีกลุ่ม 1 = นศ.1–3 · กลุ่ม 2 = นศ.4 และงานกลุ่มแบบอาจารย์จัด (งานไม่ต้องแนบไฟล์) */
function groupWorld() {
  const s = world(5);
  ok(s.api(s.T1, 'group.assign', { courseId: s.cid, stdIds: ids(1, 2, 3), newGroup: { name: 'ทีมเอ' } }));
  ok(s.api(s.T1, 'group.assign', { courseId: s.cid, stdIds: ids(4), newGroup: { name: 'ทีมบี' } }));
  s.asg = ok(s.api(s.T1, 'asg.save', { courseId: s.cid, title: 'โครงงาน', kind: 'group', groupMode: 'course', maxScore: 10, requireFile: false }));
  return s;
}

/* ============================================================ */
group('ประวัติการแก้งานกลุ่ม');
test('บันทึกใคร/ทำอะไร/เมื่อไร เรียงจากคนแรกถึงคนล่าสุด · นักศึกษาและอาจารย์เห็นตรงกัน · แก้ซ้ำค่าเดิมไม่เพิ่มบรรทัด', () => {
  const s = groupWorld(), A = s.asg.asgId;
  ok(note(s, 1, A, 'ร่างแรก')); tick(s);
  ok(up(s, 2, A, 'a.pdf')); tick(s);
  ok(note(s, 1, A, 'ร่างแรก'));                      // ค่าเดิม → ไม่ลงประวัติ
  ok(note(s, 3, A, 'ร่างสอง')); tick(s);
  const fid = s.rows('AsgFiles')[0][0];
  ok(s.api(tok(s, 3), 'stu.removeFile', { fileId: fid }));
  const t = task(s, 2, A);
  assert.deepStrictEqual(t.history.map(h => [h.stdId, h.action]), [[std(1), 'note'], [std(2), 'upload'], [std(3), 'note'], [std(3), 'remove']]);
  assert.strictEqual(t.history[1].detail, 'a.pdf'); assert.strictEqual(t.history[0].name, 'นักศึกษา 1');
  assert.strictEqual(t.sub.firstBy.stdId, std(1)); assert.strictEqual(t.sub.lastBy.stdId, std(3));
  assert.strictEqual(t.sub.note, 'ร่างสอง');
  assert.strictEqual(task(s, 4, A).history.length, 0, 'กลุ่มอื่นไม่เห็นประวัติของกลุ่มนี้');
  const u = ok(s.api(s.T1, 'asg.submissions', { asgId: A })).units.filter(x => x.groupNo === 1)[0];
  assert.strictEqual(u.history.length, 4); assert.strictEqual(u.firstBy.stdId, std(1)); assert.strictEqual(u.lastBy.name, 'นักศึกษา 3');
});
test('งานเดี่ยวไม่เขียนประวัติ · ลบงาน/ลบนักศึกษา = ประวัติหายตาม', () => {
  const s = groupWorld(), A = s.asg.asgId;
  const single = ok(s.api(s.T1, 'asg.save', { courseId: s.cid, title: 'เดี่ยว', kind: 'single', maxScore: 5, requireFile: false }));
  ok(note(s, 1, single.asgId, 'x')); assert.strictEqual(s.rows('AsgSubLog').length, 0);
  ok(note(s, 1, A, 'a')); tick(s); ok(note(s, 2, A, 'b'));
  assert.strictEqual(s.rows('AsgSubLog').length, 2);
  ok(s.api(s.T1, 'student.remove', { courseId: s.cid, stdId: std(2) }));
  assert.strictEqual(s.rows('AsgSubLog').length, 1);
  ok(s.api(s.T1, 'asg.delete', { asgId: A }));
  assert.strictEqual(s.rows('AsgSubLog').length, 0);
});
test('งานกลุ่มแบบนักศึกษาจัดเองก็มีประวัติ · ประวัติเกิน 100 รายการ ตัดกลางเก็บคนแรก + ล่าสุด', () => {
  const s = world(3);
  const a = ok(s.api(s.T1, 'asg.save', { courseId: s.cid, title: 'จัดเอง', kind: 'group', maxScore: 10, requireFile: false }));
  ok(s.api(tok(s, 1), 'stu.groupSave', { asgId: a.asgId, members: ids(2) }));
  ok(note(s, 2, a.asgId, 'n0'));
  assert.strictEqual(task(s, 1, a.asgId).history.length, 1);
  for (let i = 1; i <= 104; i++) { tick(s, 1); ok(note(s, 1 + (i % 2), a.asgId, 'n' + i)); }
  const t = task(s, 1, a.asgId);
  assert.strictEqual(t.history.length, 100); assert.strictEqual(t.historyTruncated, true);
  assert.strictEqual(t.history[0].stdId, std(2), 'คนแรกยังอยู่'); assert.strictEqual(t.sub.firstBy.stdId, std(2));
});

/* ============================================================ */
group('กันแก้ชนกัน');
test('เพื่อนแก้หลังเราโหลดหน้า → บันทึกข้อความไม่ได้ (E_ASG_CONFLICT) โดยไม่ทับ · โหลดใหม่แล้วบันทึกได้ · แก้ของตัวเองไม่ถือว่าชน', () => {
  const s = groupWorld(), A = s.asg.asgId;
  const w1 = ok(note(s, 1, A, 'v1')); tick(s);
  const base = task(s, 2, A).sub.updatedAt;                // นศ.2 เปิดหน้า
  tick(s); ok(note(s, 1, A, 'v2 จากนศ.1')); tick(s);
  const r = note(s, 2, A, 'v2 จากนศ.2', base);
  assert.strictEqual(code(r), 'E_ASG_CONFLICT'); assert.strictEqual(r.error.detail.by, 'นักศึกษา 1');
  assert.strictEqual(task(s, 3, A).sub.note, 'v2 จากนศ.1', 'ไม่ถูกทับ');
  const fresh = task(s, 2, A).sub.updatedAt;
  ok(note(s, 2, A, 'v3 รวมกัน', fresh)); tick(s);
  ok(up(s, 2, A, 'x.pdf')); tick(s);                        // อัปโหลดของตัวเองทำให้เวลาเปลี่ยน แต่คนล่าสุดคือตัวเอง
  ok(note(s, 2, A, 'v4', fresh));
  assert.strictEqual(task(s, 1, A).sub.note, 'v4');
  assert.ok(w1.saved);
});
test('ไม่ส่ง baseUpdatedAt = ทำงานแบบเดิม (ไม่ตรวจชน) · งานเดี่ยวไม่ตรวจชน', () => {
  const s = groupWorld(), A = s.asg.asgId;
  ok(note(s, 1, A, 'a')); tick(s); ok(note(s, 2, A, 'b')); tick(s);
  ok(note(s, 1, A, 'c'));
  const single = ok(s.api(s.T1, 'asg.save', { courseId: s.cid, title: 'เดี่ยว', kind: 'single', maxScore: 5, requireFile: false }));
  ok(note(s, 1, single.asgId, 'x', '1999-01-01 00:00:00'));
});

/* ============================================================ */
group('dropdown กลุ่ม (อาจารย์จัด)');
test('stu.task ให้รายการกลุ่มทั้งหมด (ลำดับ+ชื่อ+จำนวน) พร้อมธงกลุ่มของตัวเอง · สมาชิกเห็นเฉพาะกลุ่มตัวเอง · กลุ่มว่างไม่อยู่ในรายการ', () => {
  const s = groupWorld(), A = s.asg.asgId;
  ok(s.api(s.T1, 'group.save', { courseId: s.cid, name: 'ว่าง' }));
  const t = task(s, 2, A);
  assert.deepStrictEqual(t.groups.map(g => [g.groupNo, g.name, g.count, g.mine]), [[1, 'ทีมเอ', 3, true], [2, 'ทีมบี', 1, false]]);
  assert.strictEqual(t.group.members.length, 3);
  const o = task(s, 5, A);
  assert.strictEqual(o.group, null); assert.deepStrictEqual(o.groups.map(g => g.mine), [false, false]);
  assert.ok(!JSON.stringify(o).includes(std(1)), 'คนนอกกลุ่มไม่เห็นรหัสสมาชิกกลุ่มอื่น');
});

/* ============================================================ */
group('กล่องข้อความถึงอาจารย์ (Inbox)');
const send = (s, i, a) => s.api(tok(s, i), 'stu.inboxSend', a);
const T1list = s => ok(s.api(s.T1, 'inbox.list', { courseId: s.cid }));
test('ส่งข้อความทั่วไป/แจ้งเรื่องเพื่อน · อาจารย์เห็นชื่อผู้ส่ง/เพื่อน/งาน · นักศึกษาเห็นสถานะของตัวเอง', () => {
  const s = groupWorld(), A = s.asg.asgId;
  ok(send(s, 1, { message: 'ขอเลื่อนส่งงานได้ไหม' }));
  ok(send(s, 1, { message: '  นศ.3 ไม่มาช่วยงานเลย  ', asgId: A, aboutStd: std(3) }));
  const L = T1list(s);
  assert.strictEqual(L.counts.total, 2); assert.strictEqual(L.counts.new, 2);
  const m = L.messages.filter(x => x.kind === 'member')[0];
  assert.strictEqual(m.message, 'นศ.3 ไม่มาช่วยงานเลย'); assert.strictEqual(m.fromName, 'นักศึกษา 1'); assert.strictEqual(m.aboutName, 'นักศึกษา 3'); assert.strictEqual(m.asgTitle, 'โครงงาน');
  const mine = ok(s.api(tok(s, 1), 'stu.inboxMine', {}));
  assert.strictEqual(mine.messages.length, 2); assert.ok(mine.messages.every(x => x.status === 'new'));
  assert.strictEqual(mine.messages.filter(x => x.aboutName)[0].aboutName, 'นักศึกษา 3');
  assert.strictEqual(ok(s.api(tok(s, 3), 'stu.inboxMine', {})).messages.length, 0, 'เพื่อนที่ถูกกล่าวถึงไม่เห็นข้อความ');
  assert.strictEqual(ok(s.api(tok(s, 2), 'stu.inboxMine', {})).messages.length, 0);
});
test('ตรวจข้อมูล: ข้อความว่าง · แจ้งตัวเอง · เพื่อนนอกวิชา · งานนอกวิชา · ซ้ำภายใน 1 นาที = ไม่เพิ่ม', () => {
  const s = groupWorld(), A = s.asg.asgId;
  assert.strictEqual(code(send(s, 1, { message: '   ' })), 'E_INBOX_FIELD');
  assert.strictEqual(code(send(s, 1, { message: 'x', aboutStd: std(1) })), 'E_INBOX_FIELD');
  assert.strictEqual(code(send(s, 1, { message: 'x', aboutStd: '999999' })), 'E_NOT_FOUND');
  assert.strictEqual(code(send(s, 1, { message: 'x', asgId: 'ASG_NONE' })), 'E_NOT_FOUND');
  ok(send(s, 1, { message: 'ซ้ำ', asgId: A }));
  assert.strictEqual(ok(send(s, 1, { message: 'ซ้ำ', asgId: A })).duplicate, true);
  assert.strictEqual(T1list(s).counts.total, 1);
  assert.strictEqual(ok(send(s, 1, { message: 'ย' + 'า'.repeat(900) })).sent, true);
  assert.strictEqual(T1list(s).messages[0].message.length, 500, 'ตัดที่ 500 ตัวอักษร');
});
test('จำกัด 10 ข้อความ/คน/วัน (E_INBOX_LIMIT) · คนอื่นยังส่งได้ · ข้ามวันส่งได้อีก', () => {
  const s = groupWorld();
  for (let i = 1; i <= 10; i++) ok(send(s, 1, { message: 'ข้อความ ' + i }));
  assert.strictEqual(code(send(s, 1, { message: 'ข้อความที่ 11' })), 'E_INBOX_LIMIT');
  ok(send(s, 2, { message: 'ของนศ.2' }));
  s.state.clockMs += 26 * 3600 * 1000;
  ok(s.api('', 'stu.login', { courseId: s.cid, stdId: std(1), pin: PIN })); s._tk = {};
  ok(send(s, 1, { message: 'วันใหม่' }));
});
test('อาจารย์: ทำเครื่องหมายอ่านแล้ว/จัดการแล้ว/กลับเป็นใหม่ · นักศึกษาเห็นสถานะ · ลบ · นับข้อความใหม่ในรายวิชา', () => {
  const s = groupWorld();
  ok(send(s, 1, { message: 'ก' })); tick(s); ok(send(s, 2, { message: 'ข' })); tick(s); ok(send(s, 3, { message: 'ค' }));
  assert.strictEqual(ok(s.api(s.T1, 'course.get', { courseId: s.cid })).inboxNew, 3);
  assert.strictEqual(ok(s.api(s.T1, 'course.list', {})).courses[0].inboxNew, 3);
  const L = T1list(s), id = k => L.messages.filter(m => m.message === k)[0].msgId;
  assert.strictEqual(ok(s.api(s.T1, 'inbox.mark', { courseId: s.cid, msgIds: [id('ก'), id('ข')], status: 'read' })).changed, 2);
  ok(s.api(s.T1, 'inbox.mark', { courseId: s.cid, msgIds: [id('ข')], status: 'done' }));
  assert.strictEqual(ok(s.api(s.T1, 'course.get', { courseId: s.cid })).inboxNew, 1);
  assert.deepStrictEqual(ok(s.api(tok(s, 2), 'stu.inboxMine', {})).messages.map(m => m.status), ['done']);
  const c = T1list(s).counts; assert.deepStrictEqual([c.new, c.read, c.done], [1, 1, 1]);
  assert.strictEqual(ok(s.api(s.T1, 'inbox.mark', { courseId: s.cid, msgIds: [id('ข')], status: 'new' })).changed, 1);
  assert.strictEqual(ok(s.api(s.T1, 'inbox.delete', { courseId: s.cid, msgIds: [id('ก'), id('ข')] })).removed, 2);
  assert.strictEqual(T1list(s).counts.total, 1);
  assert.strictEqual(code(s.api(s.T1, 'inbox.mark', { courseId: s.cid, msgIds: [], status: 'read' })), 'E_BAD_REQUEST');
  assert.strictEqual(code(s.api(s.T1, 'inbox.mark', { courseId: s.cid, msgIds: ['x'], status: 'zzz' })), 'E_BAD_REQUEST');
});
test('สิทธิ์: อาจารย์วิชาอื่น/นักศึกษา/ไม่ล็อกอินใช้ inbox.* ไม่ได้ · ไม่มี token นักศึกษาส่งไม่ได้', () => {
  const s = groupWorld();
  ok(send(s, 1, { message: 'ก' }));
  ['inbox.list', 'inbox.mark', 'inbox.delete'].forEach(a => {
    assert.strictEqual(code(s.api(s.T2, a, { courseId: s.cid, msgIds: ['x'], status: 'read' })), 'E_FORBIDDEN', a);
    assert.strictEqual(code(s.api(tok(s, 1), a, { courseId: s.cid, msgIds: ['x'], status: 'read' })), 'E_AUTH', a);
    assert.strictEqual(code(s.api('', a, { courseId: s.cid })), 'E_AUTH', a);
  });
  assert.strictEqual(code(s.api('', 'stu.inboxSend', { message: 'x' })), 'E_AUTH');
  assert.strictEqual(code(s.api(s.T1, 'stu.inboxSend', { message: 'x' })), 'E_AUTH');
  assert.strictEqual(code(s.api(s.T1, 'stu.inboxMine', {})), 'E_AUTH');
});
test('หน้าตรวจงานของอาจารย์เห็นข้อความที่แจ้งเรื่องสมาชิกแต่ละคน · ลบงาน/ลบนักศึกษา = ข้อความที่ผูกอยู่หายตาม', () => {
  const s = groupWorld(), A = s.asg.asgId;
  ok(send(s, 1, { message: 'ไม่ช่วยงาน', asgId: A, aboutStd: std(3) })); ok(send(s, 2, { message: 'ทั่วไป' }));
  const u = ok(s.api(s.T1, 'asg.submissions', { asgId: A })).units.filter(x => x.groupNo === 1)[0];
  const m3 = u.members.filter(m => m.stdId === std(3))[0], m2 = u.members.filter(m => m.stdId === std(2))[0];
  assert.strictEqual(m3.reports.length, 1); assert.strictEqual(m3.reports[0].from, 'นักศึกษา 1'); assert.strictEqual(m3.reports[0].message, 'ไม่ช่วยงาน'); assert.strictEqual(m2.reports.length, 0);
  ok(s.api(s.T1, 'student.remove', { courseId: s.cid, stdId: std(2) }));
  assert.strictEqual(T1list(s).counts.total, 1, 'ข้อความของนศ.2 หายตาม');
  ok(s.api(s.T1, 'asg.delete', { asgId: A }));
  assert.strictEqual(T1list(s).counts.total, 0);
});
test('ลบวิชา: AsgSubLog และ Inbox หายด้วย', () => {
  const s = groupWorld(), A = s.asg.asgId;
  ok(note(s, 1, A, 'a')); ok(send(s, 1, { message: 'ก' }));
  assert.ok(s.rows('AsgSubLog').length === 1 && s.rows('Inbox').length === 1);
  for (let i = 0; i < 8; i++) { const r = s.api(s.T1, 'course.delete', { courseId: s.cid, confirm: 'BIO101-1' }); if (r.ok && r.data.done) break; }
  assert.strictEqual(s.rows('AsgSubLog').length, 0); assert.strictEqual(s.rows('Inbox').length, 0);
});

console.log('\n' + (fail ? '✘ ล้ม ' + fail + ' ข้อ' : '✔ ผ่านทั้งหมด') + ' (' + pass + ' ผ่าน' + (fail ? ' / ' + fail + ' ล้ม' : '') + ')');
process.exit(fail ? 1 : 0);
