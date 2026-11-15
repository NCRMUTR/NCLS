'use strict';
/* ทดสอบ v0.10.0: หน้าสรุปคะแนน (score.summary) · ปรับคะแนนทับค่าระบบ (score.override) · คะแนนปรับรายคน (score.adjust) · เกณฑ์เกรด (score.gradeScale)
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

/** วิชา 4 คน · ประเภทกรอกเอง "กลางภาค" 50% เต็ม 100 · งาน (ASSIGN) 50% เต็ม 10 */
function world() {
  const s = create(); s.setup();
  s.A = s.tokenOf('admin@rmutr.ac.th');
  ok(s.api(s.A, 'term.create', { name: '1/2569' }));
  ['t1', 't2'].forEach(n => ok(s.api(s.A, 'user.upsert', { email: n + '@rmutr.ac.th', name: 'อาจารย์ ' + n, systems: ['att', 'exam', 'asg'] })));
  s.T1 = s.tokenOf('t1@rmutr.ac.th'); s.T2 = s.tokenOf('t2@rmutr.ac.th');
  s.cid = ok(s.api(s.T1, 'course.create', { code: 'BIO101', name: 'ชีววิทยา', section: '1' })).courseId;
  const rows = []; for (let i = 1; i <= 4; i++) rows.push({ stdId: std(i), name: 'นักศึกษา ' + i });
  ok(s.api(s.T1, 'student.importCsv', { courseId: s.cid, rows }));
  s.mid = ok(s.api(s.T1, 'score.saveType', { courseId: s.cid, name: 'กลางภาค', pct: 50, max: 100 })).typeId;
  s.asg = ok(s.api(s.T1, 'asg.save', { courseId: s.cid, title: 'รายงาน', kind: 'single', maxScore: 10, pct: 50, requireFile: false })).asgId;
  return s;
}
const grade = (s, i, sc) => ok(s.api(s.T1, 'asg.grade', { asgId: s.asg, grades: [{ stdId: std(i), score: sc }] }));
const mid = (s, i, sc) => ok(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: s.mid, rows: [{ stdId: std(i), score: sc }] }));
const SM = s => ok(s.api(s.T1, 'score.summary', { courseId: s.cid }));
const row = (s, i) => SM(s).students.filter(x => x.stdId === std(i))[0];
const asgType = s => SM(s).types.filter(t => t.source === 'ASSIGN')[0].typeId;
const ov = (s, rows, typeId) => s.api(s.T1, 'score.override', { courseId: s.cid, typeId: typeId || asgType(s), rows });

/* ============================================================ */
group('สรุปคะแนนรายวิชา');
test('score.summary: ทุกคน × ทุกประเภท · คะแนนรวม = Σ ได้÷เต็ม×สัดส่วน · เกรดตามเกณฑ์เริ่มต้น · สถิติ · คนไม่มีคะแนน = ไม่ตัดเกรด', () => {
  const s = world();
  mid(s, 1, 90); grade(s, 1, 9);                      // 45 + 45 = 90 → A
  mid(s, 2, 60); grade(s, 2, 6);                      // 30 + 30 = 60 → C
  mid(s, 3, 40);                                      // 20 → F
  const r = SM(s);
  assert.deepStrictEqual(r.types.map(t => [t.name, t.pct, t.max]), [['กลางภาค', 50, 100], ['รายงาน', 50, 10]]);
  assert.strictEqual(r.totalPct, 100);
  const by = i => r.students.filter(x => x.stdId === std(i))[0];
  assert.deepStrictEqual([by(1).total, by(1).grade, by(2).total, by(2).grade, by(3).total, by(3).grade], [90, 'A', 60, 'C', 20, 'F']);
  assert.strictEqual(by(4).grade, ''); assert.strictEqual(by(4).total, 0);
  assert.strictEqual(by(1).cells[s.mid].v, 90); assert.strictEqual(by(1).cells[s.mid].locked, false); assert.strictEqual(by(3).cells[asgType(s)].v, null);
  assert.strictEqual(by(1).adjust, null);
  assert.deepStrictEqual([r.stats.n, r.stats.mean, r.stats.min, r.stats.max, r.stats.ungraded], [3, 56.67, 20, 90, 1]);
  assert.deepStrictEqual([r.stats.grades.A, r.stats.grades.C, r.stats.grades.F, r.stats.grades.B], [1, 1, 1, 0]);
  const ms = r.types.filter(t => t.typeId === s.mid)[0].stats;
  assert.deepStrictEqual([ms.n, ms.mean, ms.min, ms.max], [3, 63.33, 40, 90]);
  assert.deepStrictEqual(r.scale.cuts, { A: 80, 'B+': 75, B: 70, 'C+': 65, C: 60, 'D+': 55, D: 50 });
});
test('สิทธิ์: เฉพาะเจ้าของวิชา/admin · ไม่ล็อกอิน/อาจารย์วิชาอื่นไม่ได้', () => {
  const s = world();
  ['score.summary', 'score.override', 'score.adjust', 'score.gradeScale'].forEach(a => {
    assert.strictEqual(code(s.api(s.T2, a, { courseId: s.cid, typeId: s.mid, rows: [{ stdId: std(1), score: 1, points: 1 }] })), 'E_FORBIDDEN', a);
    assert.strictEqual(code(s.api('', a, { courseId: s.cid })), 'E_AUTH', a);
  });
  assert.strictEqual(code(s.api(s.A, 'score.summary', { courseId: s.cid })), 'OK');
});

/* ============================================================ */
group('ปรับคะแนนทับค่าของระบบ (override)');
test('ปรับช่องอัตโนมัติ: ล็อก + จำค่าระบบ + เหตุผล · ซิงก์ครั้งถัดไปไม่ทับ แต่ค่าระบบอัปเดต · คืนค่าระบบได้', () => {
  const s = world();
  grade(s, 1, 6);
  const r = ok(ov(s, [{ stdId: std(1), score: 9, reason: '  ทำงานเพิ่ม  ' }]));
  assert.strictEqual(r.saved, 1);
  let c = row(s, 1).cells[asgType(s)];
  assert.deepStrictEqual([c.v, c.locked, c.auto, c.reason], [9, true, 6, 'ทำงานเพิ่ม']);
  assert.strictEqual(row(s, 1).total, 22.5 * 2 === 45 ? 45 : -1, 'ได้ 9/10 × 50 = 45');
  grade(s, 1, 4);                                      // ระบบตรวจงานใหม่ → ค่าระบบเปลี่ยน แต่ค่าที่ปรับไม่ถูกทับ
  c = row(s, 1).cells[asgType(s)];
  assert.deepStrictEqual([c.v, c.locked, c.auto], [9, true, 4]);
  const back = ok(ov(s, [{ stdId: std(1), score: '' }]));
  assert.strictEqual(back.restored, 1);
  c = row(s, 1).cells[asgType(s)];
  assert.deepStrictEqual([c.v, c.locked, c.auto, c.reason], [4, false, null, '']);
  grade(s, 1, 5); assert.strictEqual(row(s, 1).cells[asgType(s)].v, 5, 'ปลดล็อกแล้วซิงก์ทับได้ตามปกติ');
});
test('ปรับช่องที่ระบบยังไม่มีค่า (ว่าง) ได้ · เลิกปรับ = กลับเป็นว่าง · เหตุผลไม่บังคับ · ค่าเท่าของระบบไม่ล็อก', () => {
  const s = world();
  ok(ov(s, [{ stdId: std(2), score: 7 }]));
  let c = row(s, 2).cells[asgType(s)];
  assert.deepStrictEqual([c.v, c.locked, c.auto, c.reason], [7, true, null, '']);
  ok(ov(s, [{ stdId: std(2), score: '' }]));
  assert.strictEqual(row(s, 2).cells[asgType(s)].v, null);
  grade(s, 3, 8);
  const same = ok(ov(s, [{ stdId: std(3), score: 8 }]));
  assert.strictEqual(same.saved, 0); assert.strictEqual(same.unchanged, 1); assert.strictEqual(row(s, 3).cells[asgType(s)].locked, false);
  assert.strictEqual(ok(ov(s, [{ stdId: std(4), score: '' }])).unchanged, 1, 'ไม่มีอะไรให้คืน');
});
test('ตรวจข้อมูล: เกินคะแนนเต็ม · ไม่ใช่ตัวเลข · ไม่อยู่ในวิชา · รหัสซ้ำ → ข้ามพร้อมเหตุผล แถวอื่นยังบันทึก', () => {
  const s = world();
  const r = ok(ov(s, [{ stdId: std(1), score: 11 }, { stdId: std(2), score: 'abc' }, { stdId: '999999', score: 5 }, { stdId: std(3), score: 5 }, { stdId: std(3), score: 6 }, { stdId: '@@', score: 1 }]));
  assert.strictEqual(r.saved, 1); assert.strictEqual(r.skippedCount, 5);
  assert.deepStrictEqual(r.skipped.map(x => x.row), [1, 2, 3, 5, 6]);
  assert.strictEqual(row(s, 3).cells[asgType(s)].v, 5);
  assert.strictEqual(code(ov(s, [])), 'E_BAD_REQUEST');
  assert.strictEqual(code(ok2(s.api(s.T1, 'score.override', { courseId: s.cid, typeId: 'NOPE', rows: [{ stdId: std(1), score: 1 }] }))), 'E_NOT_FOUND');
  function ok2(r) { return r; }
});
test('ประเภทกรอกเอง (MANUAL) เรียกผ่าน score.override ได้เหมือนกัน (ไม่ล็อก) · เกินเต็ม 100 ถูกข้าม', () => {
  const s = world();
  const r = ok(ov(s, [{ stdId: std(1), score: 70 }, { stdId: std(2), score: 120 }], s.mid));
  assert.strictEqual(r.saved, 1); assert.strictEqual(r.skippedCount, 1);
  const c = row(s, 1).cells[s.mid]; assert.deepStrictEqual([c.v, c.locked], [70, false]);
});

/* ============================================================ */
group('คะแนนปรับรายคน (adjust)');
test('บวก/ลบเข้าคะแนนรวม + เหตุผลไม่บังคับ · เกรดคิดจากคะแนนหลังปรับ · ใส่ 0/ว่าง = ลบ · รับข้อความ "+3" "-2.5"', () => {
  const s = world();
  mid(s, 1, 100); grade(s, 1, 7);                    // 50 + 35 = 85 → A
  mid(s, 2, 100); grade(s, 2, 4);                    // 50 + 20 = 70 → B
  const r = ok(s.api(s.T1, 'score.adjust', { courseId: s.cid, rows: [{ stdId: std(1), points: -6, reason: 'ไม่ช่วยงานกลุ่ม' }, { stdId: std(2), points: '+5.5' }, { stdId: std(3), points: '-2.5' }] }));
  assert.strictEqual(r.saved, 3);
  let a = row(s, 1); assert.deepStrictEqual([a.base, a.adjust.points, a.adjust.reason, a.total, a.grade], [85, -6, 'ไม่ช่วยงานกลุ่ม', 79, 'B+']);
  a = row(s, 2); assert.deepStrictEqual([a.base, a.adjust.points, a.adjust.reason, a.total, a.grade], [70, 5.5, '', 75.5, 'B+']);
  a = row(s, 3); assert.deepStrictEqual([a.base, a.total, a.grade], [0, -2.5, 'F'], 'มีคะแนนปรับอย่างเดียวก็ถูกตัดเกรด');
  assert.strictEqual(row(s, 4).grade, '');
  const c = ok(s.api(s.T1, 'score.adjust', { courseId: s.cid, rows: [{ stdId: std(1), points: 0 }, { stdId: std(3), points: '' }] }));
  assert.strictEqual(c.cleared, 2); assert.strictEqual(row(s, 1).adjust, null); assert.strictEqual(row(s, 1).grade, 'A');
  assert.strictEqual(s.rows('ScoreAdjust').length, 1);
});
test('ตรวจข้อมูล: เกิน ±100 · ไม่ใช่ตัวเลข · ไม่อยู่ในวิชา · ซ้ำ → ข้ามพร้อมเหตุผล · ทับค่าเดิมได้', () => {
  const s = world();
  const r = ok(s.api(s.T1, 'score.adjust', { courseId: s.cid, rows: [{ stdId: std(1), points: 101 }, { stdId: std(2), points: 'x' }, { stdId: '999999', points: 1 }, { stdId: std(3), points: 2 }, { stdId: std(3), points: 3 }] }));
  assert.strictEqual(r.saved, 1); assert.strictEqual(r.skippedCount, 4); assert.strictEqual(row(s, 3).adjust.points, 2);
  ok(s.api(s.T1, 'score.adjust', { courseId: s.cid, rows: [{ stdId: std(3), points: 4, reason: 'แก้' }] }));
  assert.deepStrictEqual([row(s, 3).adjust.points, row(s, 3).adjust.reason], [4, 'แก้']); assert.strictEqual(s.rows('ScoreAdjust').length, 1);
  assert.strictEqual(code(s.api(s.T1, 'score.adjust', { courseId: s.cid, rows: [] })), 'E_BAD_REQUEST');
});

/* ============================================================ */
group('เกณฑ์เกรด');
test('ตั้งเกณฑ์เอง → เกรดเปลี่ยนตาม · ขอบ = เท่ากับเกณฑ์ได้เกรดนั้น · เกณฑ์ผิด (ไม่ไล่ลง/นอก 0–100/ไม่ครบ) = E_SCORE_FIELD · คืนค่าเริ่มต้น', () => {
  const s = world();
  mid(s, 1, 100); grade(s, 1, 8);                    // 90
  mid(s, 2, 100); grade(s, 2, 6);                    // 80
  assert.strictEqual(row(s, 2).grade, 'A');
  const cuts = { A: 90, 'B+': 85, B: 80, 'C+': 70, C: 60, 'D+': 55, D: 50 };
  const r = ok(s.api(s.T1, 'score.gradeScale', { courseId: s.cid, cuts }));
  assert.deepStrictEqual(r.cuts, cuts);
  assert.deepStrictEqual([row(s, 1).grade, row(s, 2).grade], ['A', 'B']);
  assert.deepStrictEqual(SM(s).scale.cuts, cuts);
  [{ ...cuts, B: 85 }, { ...cuts, A: 101 }, { ...cuts, D: -1 }, { ...cuts, C: 'x' }, { A: 90 }].forEach(bad =>
    assert.strictEqual(code(s.api(s.T1, 'score.gradeScale', { courseId: s.cid, cuts: bad })), 'E_SCORE_FIELD', JSON.stringify(bad)));
  assert.deepStrictEqual(SM(s).scale.cuts, cuts, 'ค่าผิดไม่ทับของเดิม');
  const d = ok(s.api(s.T1, 'score.gradeScale', { courseId: s.cid, cuts: null }));
  assert.strictEqual(d.cuts.A, 80); assert.strictEqual(row(s, 2).grade, 'A'); assert.strictEqual(s.rows('GradeScale').length, 0);
  assert.strictEqual(ok(s.api(s.T1, 'score.gradeScale', { courseId: s.cid })).cuts.B, 70, 'ไม่ส่ง cuts = อ่านอย่างเดียว');
});

/* ============================================================ */
group('ส่งออก/ลบ');
test('exportCsv มีคะแนนปรับ/คะแนนหลังปรับ/เกรด · ลบนักศึกษา = คะแนนปรับหายตาม · ลบวิชา = ScoreAdjust/GradeScale หาย', () => {
  const s = world();
  mid(s, 1, 100); grade(s, 1, 7);
  ok(s.api(s.T1, 'score.adjust', { courseId: s.cid, rows: [{ stdId: std(1), points: -5 }, { stdId: std(2), points: 3 }] }));
  ok(s.api(s.T1, 'score.gradeScale', { courseId: s.cid, cuts: { A: 90, 'B+': 85, B: 80, 'C+': 70, C: 60, 'D+': 55, D: 50 } }));
  const lines = ok(s.api(s.T1, 'score.exportCsv', { courseId: s.cid })).csv.replace(/^﻿/, '').split('\r\n');
  assert.ok(/คะแนนปรับ.*คะแนนรวมหลังปรับ.*เกรด$/.test(lines[0]), lines[0]);
  assert.ok(lines[1].startsWith(std(1)) && lines[1].endsWith(',85,-5,80,B'), lines[1]);
  ok(s.api(s.T1, 'student.remove', { courseId: s.cid, stdId: std(2) }));
  assert.strictEqual(s.rows('ScoreAdjust').length, 1);
  for (let i = 0; i < 8; i++) { const r = s.api(s.T1, 'course.delete', { courseId: s.cid, confirm: 'BIO101-1' }); if (r.ok && r.data.done) break; }
  assert.strictEqual(s.rows('ScoreAdjust').length, 0); assert.strictEqual(s.rows('GradeScale').length, 0);
});

console.log('\n' + (fail ? '✘ ล้ม ' + fail + ' ข้อ' : '✔ ผ่านทั้งหมด') + ' (' + pass + ' ผ่าน' + (fail ? ' / ' + fail + ' ล้ม' : '') + ')');
process.exit(fail ? 1 : 0);
