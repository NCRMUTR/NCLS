'use strict';
/* ทดสอบ v0.8.0: กลุ่มนักศึกษาที่อาจารย์จัดไว้ (group.*) + งานกลุ่มแบบ "ใช้กลุ่มที่จัดไว้" (groupMode = course)
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
const PIN = '1234';
const PDF = n => { const b = Buffer.alloc(n || 100, 7); Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d]).copy(b); return b; };

function world(nStd) {
  const s = create(); s.setup();
  s.A = s.tokenOf('admin@rmutr.ac.th');
  ok(s.api(s.A, 'term.create', { name: '1/2569' }));
  ['t1', 't2'].forEach(n => ok(s.api(s.A, 'user.upsert', { email: n + '@rmutr.ac.th', name: 'อาจารย์ ' + n, systems: ['att', 'exam', 'asg'] })));
  s.T1 = s.tokenOf('t1@rmutr.ac.th'); s.T2 = s.tokenOf('t2@rmutr.ac.th');
  s.cid = ok(s.api(s.T1, 'course.create', { code: 'BIO101', name: 'ชีววิทยา', section: '1' })).courseId;
  const rows = []; for (let i = 1; i <= (nStd || 6); i++) rows.push({ stdId: std(i), name: 'นักศึกษา ' + i });
  ok(s.api(s.T1, 'student.importCsv', { courseId: s.cid, rows }));
  ok(s.api(s.T1, 'pin.issueTemp', { courseId: s.cid, all: true })).codes.forEach(c =>
    ok(s.api('', 'pin.setWithTemp', { courseId: s.cid, stdId: c.stdId, tempPin: c.pin, newPin: PIN })));
  return s;
}
function tok(s, i) { s._tk = s._tk || {}; return s._tk[i] || (s._tk[i] = ok(s.api('', 'stu.login', { courseId: s.cid, stdId: std(i), pin: PIN })).token); }
const G = (s, a) => s.api(s.T1, 'group.assign', Object.assign({ courseId: s.cid }, a));
const L = s => ok(s.api(s.T1, 'group.list', { courseId: s.cid }));
const stdList = s => ok(s.api(s.T1, 'student.list', { courseId: s.cid }));
const noOf = (s, i) => stdList(s).students.filter(x => x.stdId === std(i))[0].groupNo;
const ids = (...n) => n.map(std);
const up = (s, i, asgId, name) => s.api(tok(s, i), 'stu.upload', { asgId, name, b64: PDF(100).toString('base64') });
const mkGroupAsg = (s, over) => s.api(s.T1, 'asg.save', Object.assign({ courseId: s.cid, title: 'โครงงาน', kind: 'group', groupMode: 'course', maxScore: 10 }, over || {}));

/* ============================================================ */
group('จัดกลุ่มในวิชา (group.*)');
test('สร้างกลุ่ม: ไม่ระบุลำดับ = ลำดับถัดไป · ระบุลำดับเองได้ · แก้ชื่อ · ลำดับผิด = E_GROUP_FIELD', () => {
  const s = world(4);
  assert.strictEqual(ok(s.api(s.T1, 'group.save', { courseId: s.cid, name: 'ทีมสตาร์ท' })).groupNo, 1);
  assert.strictEqual(ok(s.api(s.T1, 'group.save', { courseId: s.cid })).groupNo, 2);
  assert.strictEqual(ok(s.api(s.T1, 'group.save', { courseId: s.cid, groupNo: 7, name: 'เจ็ด' })).groupNo, 7);
  assert.strictEqual(ok(s.api(s.T1, 'group.save', { courseId: s.cid })).groupNo, 8, 'ถัดจากเลขมากสุด');
  const r = ok(s.api(s.T1, 'group.save', { courseId: s.cid, groupNo: 2, name: 'ทีมสอง' }));
  assert.strictEqual(r.created, false);
  assert.deepStrictEqual(L(s).groups.map(g => [g.groupNo, g.name]), [[1, 'ทีมสตาร์ท'], [2, 'ทีมสอง'], [7, 'เจ็ด'], [8, '']]);
  ['0', -1, 1.5, 'abc', 1000].forEach(v => assert.strictEqual(code(s.api(s.T1, 'group.save', { courseId: s.cid, groupNo: v, name: 'x' })), 'E_GROUP_FIELD', String(v)));
});
test('สิทธิ์: อาจารย์วิชาอื่น/นักศึกษา/ไม่ล็อกอิน ใช้ group.* ไม่ได้', () => {
  const s = world(3);
  ['group.list', 'group.save', 'group.assign', 'group.unassign', 'group.delete', 'group.setRep', 'group.import', 'group.auto'].forEach(a => {
    assert.strictEqual(code(s.api(s.T2, a, { courseId: s.cid, stdIds: ids(1), groupNo: 1, rows: [], size: 2 })), 'E_FORBIDDEN', a + ' T2');
    assert.strictEqual(code(s.api(tok(s, 1), a, { courseId: s.cid })), 'E_AUTH', a + ' นักศึกษา');
    assert.strictEqual(code(s.api('', a, { courseId: s.cid })), 'E_AUTH', a + ' ไม่ล็อกอิน');
  });
});
test('ใส่เข้ากลุ่ม: กลุ่มใหม่/กลุ่มเดิม · ย้ายกลุ่ม (1 คน 1 กลุ่ม) · student.list แสดง groupNo + รายการกลุ่ม · นำออก', () => {
  const s = world(6);
  const r = ok(G(s, { stdIds: ids(1, 2, 3), newGroup: { name: 'ก' } }));
  assert.strictEqual(r.groupNo, 1); assert.strictEqual(r.moved, 3);
  ok(G(s, { stdIds: ids(4), newGroup: { name: 'ข' } }));
  ok(G(s, { stdIds: ids(3), groupNo: 2 }));
  const sl = stdList(s);
  assert.deepStrictEqual(sl.students.map(x => x.groupNo), [1, 1, 2, 2, null, null]);
  assert.deepStrictEqual(sl.groups.map(g => [g.groupNo, g.name, g.count]), [[1, 'ก', 2], [2, 'ข', 2]]);
  assert.deepStrictEqual(L(s).ungrouped.map(x => x.stdId), ids(5, 6));
  assert.strictEqual(ok(s.api(s.T1, 'group.unassign', { courseId: s.cid, stdIds: ids(1, 4) })).moved, 2);
  assert.deepStrictEqual(stdList(s).students.map(x => x.groupNo), [null, 1, 2, null, null, null]);
  assert.strictEqual(code(G(s, { stdIds: ids(5), groupNo: 99 })), 'E_NOT_FOUND', 'กลุ่มที่ไม่มี');
  assert.strictEqual(code(G(s, { stdIds: ['999999'], groupNo: 1 })), 'E_NOT_FOUND', 'รหัสนอกวิชา');
  assert.strictEqual(code(G(s, { stdIds: [], groupNo: 1 })), 'E_BAD_REQUEST');
});
test('ตัวแทน: ตั้งได้เฉพาะสมาชิก · ย้ายตัวแทนออกจากกลุ่ม/ลบนักศึกษา = ล้างตัวแทน · ล้างด้วยค่าว่าง', () => {
  const s = world(5);
  ok(G(s, { stdIds: ids(1, 2, 3), newGroup: {} }));
  assert.strictEqual(code(s.api(s.T1, 'group.setRep', { courseId: s.cid, groupNo: 1, stdId: std(5) })), 'E_GROUP_FIELD');
  assert.strictEqual(ok(s.api(s.T1, 'group.setRep', { courseId: s.cid, groupNo: 1, stdId: std(2) })).rep, std(2));
  assert.strictEqual(L(s).groups[0].rep.stdId, std(2));
  ok(s.api(s.T1, 'group.unassign', { courseId: s.cid, stdIds: ids(2) }));
  assert.strictEqual(L(s).groups[0].rep, null);
  ok(s.api(s.T1, 'group.setRep', { courseId: s.cid, groupNo: 1, stdId: std(3) }));
  ok(s.api(s.T1, 'student.remove', { courseId: s.cid, stdId: std(3) }));
  assert.strictEqual(L(s).groups[0].rep, null, 'ลบนักศึกษาที่เป็นตัวแทน');
  ok(s.api(s.T1, 'group.setRep', { courseId: s.cid, groupNo: 1, stdId: std(1) }));
  ok(s.api(s.T1, 'group.setRep', { courseId: s.cid, groupNo: 1, stdId: '' }));
  assert.strictEqual(L(s).groups[0].rep, null);
});
test('ลบกลุ่ม: สมาชิกกลับเป็น "ยังไม่มีกลุ่ม" · กลุ่มที่ไม่มี = E_NOT_FOUND', () => {
  const s = world(4);
  ok(G(s, { stdIds: ids(1, 2), newGroup: { name: 'ก' } }));
  const r = ok(s.api(s.T1, 'group.delete', { courseId: s.cid, groupNo: 1 }));
  assert.strictEqual(r.released, 2);
  assert.deepStrictEqual(stdList(s).students.map(x => x.groupNo), [null, null, null, null]); assert.strictEqual(L(s).groups.length, 0);
  assert.strictEqual(code(s.api(s.T1, 'group.delete', { courseId: s.cid, groupNo: 1 })), 'E_NOT_FOUND');
});
test('วางจาก Excel: ตรวจก่อน (dryRun) ไม่เขียน · สร้างกลุ่มที่ยังไม่มี · ตั้งชื่อ · ข้ามแถวผิดพร้อมเหตุผล', () => {
  const s = world(5);
  const rows = [{ stdId: std(1), groupNo: 1, name: 'ทีมแรก' }, { stdId: std(2), groupNo: '1' }, { stdId: std(3), groupNo: 2 },
    { stdId: '999999', groupNo: 1 }, { stdId: std(4), groupNo: 'x' }, { stdId: std(3), groupNo: 5 }, { stdId: '@@', groupNo: 1 }];
  const d = ok(s.api(s.T1, 'group.import', { courseId: s.cid, rows, dryRun: true }));
  assert.strictEqual(d.assigned, 3); assert.strictEqual(d.created, 2); assert.strictEqual(d.skippedCount, 4); assert.strictEqual(L(s).groups.length, 0, 'dryRun ไม่เขียน');
  const r = ok(s.api(s.T1, 'group.import', { courseId: s.cid, rows }));
  assert.strictEqual(r.assigned, 3);
  assert.deepStrictEqual(L(s).groups.map(g => [g.groupNo, g.name, g.members.length]), [[1, 'ทีมแรก', 2], [2, '', 1]]);
  assert.deepStrictEqual(r.skipped.map(x => x.row), [4, 5, 6, 7]);
  assert.strictEqual(code(s.api(s.T1, 'group.import', { courseId: s.cid, rows: [] })), 'E_IMPORT');
  ok(s.api(s.T1, 'group.import', { courseId: s.cid, rows: [{ stdId: std(1), groupNo: 1, name: 'ชื่อใหม่' }] }));
  assert.strictEqual(L(s).groups[0].name, 'ชื่อใหม่');
});
test('แบ่งกลุ่มอัตโนมัติ: กระจายเท่าๆ กัน · เฉพาะคนที่ยังไม่มีกลุ่ม · ทั้งหมด (ล้างของเดิม) · สุ่มยังได้ครบทุกคน · size ผิด', () => {
  const s = world(7);
  ok(G(s, { stdIds: ids(1), newGroup: { name: 'เดิม' } }));
  const r = ok(s.api(s.T1, 'group.auto', { courseId: s.cid, size: 3, order: 'id' }));
  assert.strictEqual(r.students, 6); assert.strictEqual(r.groups, 2);
  assert.deepStrictEqual(L(s).groups.map(g => [g.groupNo, g.members.length]), [[1, 1], [2, 3], [3, 3]], 'กลุ่มเดิมไม่ถูกแตะ');
  assert.strictEqual(code(s.api(s.T1, 'group.auto', { courseId: s.cid, size: 3, order: 'id' })), 'E_GROUP_FIELD', 'ไม่เหลือใครว่าง');
  const a = ok(s.api(s.T1, 'group.auto', { courseId: s.cid, size: 3, order: 'random', scope: 'all' }));
  assert.strictEqual(a.groups, 3);
  const g = L(s).groups; assert.deepStrictEqual(g.map(x => x.members.length).sort(), [2, 2, 3]); assert.strictEqual(L(s).ungrouped.length, 0);
  assert.deepStrictEqual(g.map(x => x.groupNo), [1, 2, 3]);
  [0, 101, 1.5, 'x'].forEach(v => assert.strictEqual(code(s.api(s.T1, 'group.auto', { courseId: s.cid, size: v })), 'E_GROUP_FIELD'));
});

/* ============================================================ */
group('งานกลุ่มแบบใช้กลุ่มที่อาจารย์จัดไว้');
test('สั่งงาน: ยังไม่มีกลุ่ม = เลือกรูปแบบ course ไม่ได้ · มีแล้วได้ · groupMode ออกใน asg.get/list · งานเดี่ยวไม่มี mode', () => {
  const s = world(4);
  assert.strictEqual(code(mkGroupAsg(s)), 'E_ASG_FIELD');
  ok(G(s, { stdIds: ids(1, 2), newGroup: { name: 'ก' } }));
  const a = ok(mkGroupAsg(s));
  assert.strictEqual(a.groupMode, 'course');
  assert.strictEqual(ok(s.api(s.T1, 'asg.get', { asgId: a.asgId })).groupMode, 'course');
  assert.strictEqual(ok(s.api(s.T1, 'asg.list', { courseId: s.cid })).assignments[0].groupMode, 'course');
  const self = ok(s.api(s.T1, 'asg.save', { courseId: s.cid, title: 'จัดเอง', kind: 'group', maxScore: 10 }));
  assert.strictEqual(self.groupMode, 'self');
  const single = ok(s.api(s.T1, 'asg.save', { courseId: s.cid, title: 'เดี่ยว', kind: 'single', maxScore: 10, groupMode: 'course' }));
  assert.strictEqual(single.groupMode, '');
});
test('อาจารย์เห็นหน่วยงานตามกลุ่มที่จัดไว้ · กลุ่มว่างไม่นับ · คนไม่มีกลุ่มอยู่ใน ungrouped · ตัวแทนเป็น null ได้', () => {
  const s = world(5);
  ok(G(s, { stdIds: ids(1, 2), newGroup: { name: 'ก' } })); ok(G(s, { stdIds: ids(3), newGroup: {} })); ok(s.api(s.T1, 'group.save', { courseId: s.cid, name: 'ว่าง' }));
  const a = ok(mkGroupAsg(s));
  const r = ok(s.api(s.T1, 'asg.submissions', { asgId: a.asgId }));
  assert.deepStrictEqual(r.units.map(u => [u.groupNo, u.name, u.members.length, u.rep]), [[1, 'กลุ่ม 1 · ก', 2, null], [2, 'กลุ่ม 2', 1, null]]);
  assert.deepStrictEqual(r.ungrouped.map(x => x.stdId), ids(4, 5)); assert.strictEqual(r.stats.total, 2); assert.strictEqual(r.stats.ungrouped, 2);
  ok(s.api(s.T1, 'group.setRep', { courseId: s.cid, groupNo: 1, stdId: std(2) }));
  assert.strictEqual(ok(s.api(s.T1, 'asg.submissions', { asgId: a.asgId })).units[0].rep.stdId, std(2));
});
test('นักศึกษา: เห็นกลุ่ม/สมาชิก · ทุกคนในกลุ่มส่งและแก้ได้ · เพื่อนอีกคนเห็นงานเดียวกัน · คนไม่มีกลุ่มส่งไม่ได้ · จัดกลุ่มเองไม่ได้', () => {
  const s = world(5);
  ok(G(s, { stdIds: ids(1, 2, 3), newGroup: { name: 'ก' } }));
  const a = ok(mkGroupAsg(s));
  const t1 = ok(s.api(tok(s, 2), 'stu.task', { asgId: a.asgId }));
  assert.strictEqual(t1.fixed, true); assert.strictEqual(t1.group.groupNo, 1); assert.strictEqual(t1.group.members.length, 3); assert.strictEqual(t1.group.rep, null);
  assert.strictEqual(t1.canEdit, true); assert.deepStrictEqual(t1.candidates, []);
  const t4 = ok(s.api(tok(s, 4), 'stu.task', { asgId: a.asgId }));
  assert.strictEqual(t4.group, null); assert.strictEqual(t4.canEdit, false); assert.strictEqual(t4.whyNot, 'E_ASG_NO_GROUP'); assert.deepStrictEqual(t4.candidates, []);
  const tk = ok(s.api(tok(s, 4), 'stu.tasks', {})).tasks[0]; assert.strictEqual(tk.needsGroup, true); assert.strictEqual(tk.groupFixed, true);
  assert.strictEqual(code(up(s, 4, a.asgId, 'x.pdf')), 'E_ASG_NO_GROUP');
  ok(up(s, 2, a.asgId, 'a.pdf')); ok(s.api(tok(s, 3), 'stu.saveNote', { asgId: a.asgId, note: 'ของกลุ่ม' }));
  const t3 = ok(s.api(tok(s, 1), 'stu.task', { asgId: a.asgId }));
  assert.strictEqual(t3.sub.files.length, 1); assert.strictEqual(t3.sub.note, 'ของกลุ่ม'); assert.strictEqual(t3.submitted, true);
  const tk1 = ok(s.api(tok(s, 1), 'stu.tasks', {})).tasks[0]; assert.strictEqual(tk1.groupName, 'กลุ่ม 1 · ก'); assert.strictEqual(tk1.needsGroup, false);
  assert.strictEqual(code(s.api(tok(s, 1), 'stu.groupSave', { asgId: a.asgId, members: [std(4)] })), 'E_ASG_GROUP_FIXED');
  assert.strictEqual(code(s.api(tok(s, 4), 'stu.groupSave', { asgId: a.asgId, members: [] })), 'E_ASG_GROUP_FIXED');
  assert.strictEqual(code(s.api(tok(s, 1), 'stu.groupDelete', { asgId: a.asgId })), 'E_ASG_GROUP_FIXED');
  const sb = s.rows('AsgSubs'); assert.strictEqual(sb.length, 1); assert.strictEqual(sb[0][0], a.asgId + '|G1', 'คีย์ = asg|G<ลำดับกลุ่ม>');
  assert.strictEqual(s.rows('AsgGroups').length, 0); assert.strictEqual(s.rows('AsgMembers').length, 0);
});
test('ให้คะแนนทั้งกลุ่ม: เขียนรายคนตามสมาชิกกลุ่มที่จัดไว้ · ส่งแล้วถูกตรวจ = นักศึกษาแก้ไม่ได้', () => {
  const s = world(4);
  ok(G(s, { stdIds: ids(1, 2), newGroup: { name: 'ก' } }));
  const a = ok(mkGroupAsg(s));
  ok(up(s, 1, a.asgId, 'a.pdf'));
  const u = ok(s.api(s.T1, 'asg.submissions', { asgId: a.asgId })).units[0];
  assert.strictEqual(u.submitted, true);
  ok(s.api(s.T1, 'asg.grade', { asgId: a.asgId, grades: u.members.map(m => ({ stdId: m.stdId, score: 8 })) }));
  assert.strictEqual(ok(s.api(s.T1, 'asg.submissions', { asgId: a.asgId })).units[0].graded, true);
  assert.strictEqual(code(up(s, 2, a.asgId, 'b.pdf')), 'E_ASG_GRADED');
});
test('ล็อกรูปแบบ: ส่งงานแล้วเปลี่ยน course→self หรือ group→single ไม่ได้ · ยังไม่ส่งเปลี่ยนได้ · self→course ที่มีกลุ่มนักศึกษาจัดเองแล้วไม่ได้', () => {
  const s = world(4);
  ok(G(s, { stdIds: ids(1, 2), newGroup: {} }));
  const a = ok(mkGroupAsg(s));
  ok(up(s, 1, a.asgId, 'a.pdf'));
  assert.strictEqual(code(s.api(s.T1, 'asg.save', { asgId: a.asgId, groupMode: 'self' })), 'E_ASG_KIND_LOCKED');
  assert.strictEqual(code(s.api(s.T1, 'asg.save', { asgId: a.asgId, kind: 'single' })), 'E_ASG_KIND_LOCKED');
  const b = ok(mkGroupAsg(s, { title: 'ยังไม่ส่ง' }));
  assert.strictEqual(ok(s.api(s.T1, 'asg.save', { asgId: b.asgId, groupMode: 'self' })).groupMode, 'self');
  assert.strictEqual(ok(s.api(s.T1, 'asg.save', { asgId: b.asgId, groupMode: 'course' })).groupMode, 'course');
  const c = ok(s.api(s.T1, 'asg.save', { courseId: s.cid, title: 'จัดเอง', kind: 'group', maxScore: 10 }));
  assert.strictEqual(ok(s.api(tok(s, 3), 'stu.groupSave', { asgId: c.asgId, members: [std(4)] })).members, 2);
  assert.strictEqual(code(s.api(s.T1, 'asg.save', { asgId: c.asgId, groupMode: 'course' })), 'E_ASG_KIND_LOCKED');
});
test('ลบกลุ่มที่มีงานส่งแล้วไม่ได้ (E_GROUP_IN_USE) · ย้ายสมาชิกได้ · กลุ่มอื่นลบได้ · ลบงาน = ลบแถวส่งงาน', () => {
  const s = world(4);
  ok(G(s, { stdIds: ids(1, 2), newGroup: {} })); ok(G(s, { stdIds: ids(3), newGroup: {} }));
  const a = ok(mkGroupAsg(s));
  ok(up(s, 1, a.asgId, 'a.pdf'));
  assert.strictEqual(code(s.api(s.T1, 'group.delete', { courseId: s.cid, groupNo: 1 })), 'E_GROUP_IN_USE');
  ok(s.api(s.T1, 'group.delete', { courseId: s.cid, groupNo: 2 }));
  ok(G(s, { stdIds: ids(2), newGroup: {} }));
  assert.strictEqual(ok(s.api(tok(s, 2), 'stu.task', { asgId: a.asgId })).group.groupNo, 2, 'ลำดับใหม่ = เลขมากสุดที่เหลือ + 1');
  ok(s.api(s.T1, 'asg.delete', { asgId: a.asgId }));
  assert.strictEqual(s.rows('AsgSubs').length, 0);
});
test('ลบวิชา: CourseGroups และกลุ่มหายไปด้วย · ลบนักศึกษาทั้งกลุ่ม = กลุ่มว่างไม่โผล่ในหน่วยงาน', () => {
  const s = world(3);
  ok(G(s, { stdIds: ids(1, 2), newGroup: { name: 'ก' } }));
  const a = ok(mkGroupAsg(s));
  ok(s.api(s.T1, 'student.removeMany', { courseId: s.cid, stdIds: ids(1, 2) }));
  assert.strictEqual(ok(s.api(s.T1, 'asg.submissions', { asgId: a.asgId })).units.length, 0);
  assert.strictEqual(s.rows('CourseGroups').length, 1);
  for (let i = 0; i < 8; i++) { const r = s.api(s.T1, 'course.delete', { courseId: s.cid, confirm: 'BIO101-1' }); if (r.ok && r.data.done) break; }
  assert.strictEqual(s.rows('CourseGroups').length, 0);
});

console.log('\n' + (fail ? '✘ ล้ม ' + fail + ' ข้อ' : '✔ ผ่านทั้งหมด') + ' (' + pass + ' ผ่าน' + (fail ? ' / ' + fail + ' ล้ม' : '') + ')');
process.exit(fail ? 1 : 0);
