'use strict';
/* ทดสอบขั้น 3: เช็คชื่อ (เฟส เวลา · พัก/ต่อ · GPS · เครื่อง · PIN · แก้ย้อนหลัง · นำเข้า · คะแนน · สิทธิ์)
 * หมายเหตุ: ชุดนี้รันทีละคำขอ (ไม่มีการขนานจริง) — ความถูกต้องใต้โหลดพร้อมกันต้องทดสอบบน Apps Script จริง */
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

const LAT = 13.7563, LNG = 100.5018;            // ห้องเรียนสมมติ
const NEAR = { lat: LAT + 0.0005, lng: LNG };   // ~55 ม.
const FAR = { lat: LAT + 0.01, lng: LNG };      // ~1.1 กม.
const D = n => 'device-' + String(n).padStart(4, '0');

function world(nStd) {
  const s = create(); s.setup();
  s.A = s.tokenOf('admin@rmutr.ac.th');
  ok(s.api(s.A, 'term.create', { name: '1/2569' }));
  ['t1', 't2'].forEach(n => ok(s.api(s.A, 'user.upsert', { email: n + '@rmutr.ac.th', name: 'อาจารย์ ' + n, systems: ['att', 'exam', 'asg'] })));
  ok(s.api(s.A, 'user.upsert', { email: 't3@rmutr.ac.th', name: 'อาจารย์ t3', systems: ['exam'] }));
  s.T1 = s.tokenOf('t1@rmutr.ac.th'); s.T2 = s.tokenOf('t2@rmutr.ac.th'); s.T3 = s.tokenOf('t3@rmutr.ac.th');
  s.cid = ok(s.api(s.T1, 'course.create', { code: 'BIO101', name: 'ชีววิทยา', section: '1' })).courseId;
  const rows = []; for (let i = 1; i <= (nStd || 4); i++) rows.push({ stdId: String(660000 + i), name: 'นักศึกษา ' + i });
  ok(s.api(s.T1, 'student.importCsv', { courseId: s.cid, rows }));
  return s;
}
const std = i => String(660000 + i);
function open(s, extra) { return ok(s.api(s.T1, 'att.open', Object.assign({ courseId: s.cid }, extra || {}))); }
function ci(s, sid, i, dev, extra) {
  return s.api('', 'att.checkIn', Object.assign({ sessionId: sid, stdId: std(i), deviceId: D(dev) }, extra || {}));
}
/** เช็คชื่อครั้งแรก (ยังไม่มี PIN → ตั้งพร้อมกัน) */
function first(s, sid, i, dev, extra) { return ci(s, sid, i, dev, Object.assign({ newPin: '1234' }, extra || {})); }
const fmtLocal = ms => { const d = new Date(ms), p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()); };
const recs = s => s.rows('AttRecords');
const sess = s => s.rows('AttSessions');

/* ============================================================ */
group('เปิดคาบ · สิทธิ์');
test('เปิดคาบ: ค่าเริ่มต้น 10/20 นาที รัศมี 500 · เปิดซ้ำขณะยังเปิด = E_ATT_OPEN_EXISTS', () => {
  const s = world();
  const o = open(s, { lat: LAT, lng: LNG });
  assert.strictEqual(o.status, 'open'); assert.strictEqual(o.normalMin, 10); assert.strictEqual(o.closeMin, 20);
  assert.strictEqual(o.radiusM, 500); assert.strictEqual(o.phase, 'normal'); assert.strictEqual(o.hasLocation, true);
  const r = s.api(s.T1, 'att.open', { courseId: s.cid });
  assert.strictEqual(code(r), 'E_ATT_OPEN_EXISTS'); assert.strictEqual(r.error.detail.sessionId, o.sessionId);
  assert.strictEqual(sess(s).length, 1);
});
test('เปิดคาบ: พิกัดไม่ครบ/นอกช่วง/รัศมีผิด/เวลาผิด → ปฏิเสธ ไม่เขียนแถว', () => {
  const s = world();
  const bad = [
    [{ lat: LAT }, 'E_ATT_LOC'], [{ lat: 91, lng: 100 }, 'E_ATT_LOC'], [{ lat: 0, lng: 0 }, 'E_ATT_LOC'], [{ lat: 'x', lng: 1 }, 'E_ATT_LOC'],
    [{ lat: LAT, lng: LNG, radiusM: 5 }, 'E_ATT_LOC'], [{ lat: LAT, lng: LNG, radiusM: 9999 }, 'E_ATT_LOC'], [{ lat: LAT, lng: LNG, radiusM: 50.5 }, 'E_ATT_LOC'],
    [{ normalMin: 30, closeMin: 20 }, 'E_ATT_TIME'], [{ closeMin: 601 }, 'E_ATT_TIME'], [{ normalMin: -1 }, 'E_ATT_TIME'],
    [{ startAt: '2020-01-01 08:00' }, 'E_ATT_TIME'], [{ startAt: 'พรุ่งนี้' }, 'E_ATT_TIME'], [{ startAt: fmtLocal(Date.now() + 13 * 3600000) }, 'E_ATT_TIME']
  ];
  bad.forEach(([a, c]) => assert.strictEqual(code(s.api(s.T1, 'att.open', Object.assign({ courseId: s.cid }, a))), c, JSON.stringify(a)));
  assert.strictEqual(sess(s).length, 0);
});
test('สิทธิ์: ไม่ล็อกอิน E_AUTH · อาจารย์ที่ไม่มีสิทธิ์ระบบ att E_FORBIDDEN · อาจารย์อื่นไม่ใช่เจ้าของวิชา E_FORBIDDEN · admin ได้', () => {
  const s = world(); const o = open(s);
  ['att.open', 'att.live', 'att.report', 'att.close'].forEach(a => assert.strictEqual(code(s.api('', a, { courseId: s.cid, sessionId: o.sessionId })), 'E_AUTH', a));
  assert.strictEqual(code(s.api(s.T3, 'att.live', { sessionId: o.sessionId })), 'E_FORBIDDEN');
  ['att.live', 'att.close', 'att.pause', 'att.setStatus'].forEach(a =>
    assert.strictEqual(code(s.api(s.T2, a, { sessionId: o.sessionId, stdId: std(1), status: 'normal' })), 'E_FORBIDDEN', a));
  ['att.report', 'att.sessions', 'att.exportCsv', 'att.current', 'att.deleteEmpty'].forEach(a =>
    assert.strictEqual(code(s.api(s.T2, a, { courseId: s.cid })), 'E_FORBIDDEN', a));
  assert.strictEqual(code(s.api(s.T2, 'att.open', { courseId: s.cid })), 'E_FORBIDDEN');
  ok(s.api(s.A, 'att.live', { sessionId: o.sessionId }));
  ok(s.api(s.A, 'att.report', { courseId: s.cid }));
});
test('info (สาธารณะ): ไม่เปิดเผยพิกัดห้อง · คาบที่ไม่มี → E_NOT_FOUND', () => {
  const s = world(); const o = open(s, { lat: LAT, lng: LNG });
  const r = ok(s.api('', 'att.info', { sessionId: o.sessionId }));
  assert.strictEqual(r.hasLocation, true); assert.strictEqual(r.course.code, 'BIO101');
  const dump = JSON.stringify(r);
  assert.ok(dump.indexOf('13.75') < 0 && dump.indexOf('100.50') < 0 && dump.indexOf('radius') < 0);
  assert.strictEqual(code(s.api('', 'att.info', { sessionId: 'nope' })), 'E_NOT_FOUND');
});

/* ============================================================ */
group('เฟสเวลา: ปกติ → สาย → ปิด · พัก/ต่อ');
test('ปกติ ≤10 นาที · สาย ≤20 นาที · เกินนั้นปิดรับและคาบปิดเอง', () => {
  const s = world();
  const o = open(s);
  assert.strictEqual(ok(first(s, o.sessionId, 1, 1)).status, 'normal');
  s.advance(11);
  assert.strictEqual(ok(s.api('', 'att.info', { sessionId: o.sessionId })).phase, 'late');
  assert.strictEqual(ok(first(s, o.sessionId, 2, 2)).status, 'late');
  s.advance(10);                                   // รวม 21 นาที
  assert.strictEqual(code(first(s, o.sessionId, 3, 3)), 'E_ATT_CLOSED');
  assert.strictEqual(sess(s)[0][4], 'closed', 'ต้องปิดเข้าชีตจริง');
  assert.strictEqual(recs(s).length, 2);
});
test('เช็คก่อนเวลาเริ่ม (startAt อนาคต) นับเป็นปกติ', () => {
  const s = world();
  const o = open(s, { startAt: fmtLocal(Date.now() + 30 * 60000) });
  assert.strictEqual(ok(first(s, o.sessionId, 1, 1)).status, 'normal');
});
test('ปิดเองแบบ lazy: current/live หลังเลยเวลา → คาบปิด + คะแนนซิงก์ · ไม่ต้องมีใครกดปิด', () => {
  const s = world();
  const o = open(s); first(s, o.sessionId, 1, 1);
  s.advance(25);
  assert.strictEqual(ok(s.api(s.T1, 'att.current', { courseId: s.cid })).session, null);
  const lv = ok(s.api(s.T1, 'att.live', { sessionId: o.sessionId }));
  assert.strictEqual(lv.session.status, 'closed'); assert.strictEqual(lv.counts.absent, 3); assert.strictEqual(lv.counts.waiting, 0);
  assert.strictEqual(s.rows('ScoreTypes').filter(r => r[3] === 'ATT' || r.indexOf('ATT') >= 0).length, 1);
});
test('พักคาบ: เวลาหยุดเดิน · เช็คไม่ได้ (E_ATT_PAUSED) · ไม่ปิดเอง · ต่อแล้วเส้นตายเลื่อนตามเวลาที่พัก', () => {
  const s = world();
  const o = open(s);
  s.advance(5);
  ok(s.api(s.T1, 'att.pause', { sessionId: o.sessionId }));
  s.advance(60);
  assert.strictEqual(code(first(s, o.sessionId, 1, 1)), 'E_ATT_PAUSED');
  assert.strictEqual(ok(s.api('', 'att.info', { sessionId: o.sessionId })).phase, 'normal');
  assert.strictEqual(ok(s.api(s.T1, 'att.current', { courseId: s.cid })).session.status, 'paused');
  assert.strictEqual(code(s.api(s.T1, 'att.pause', { sessionId: o.sessionId })), 'E_ATT_STATE');
  const r = ok(s.api(s.T1, 'att.resume', { sessionId: o.sessionId }));
  assert.ok(Math.abs(r.pauseOffsetMin - 60) < 0.1, 'offset=' + r.pauseOffsetMin);
  s.advance(4);                                     // ใช้ไปจริง 9 นาที < 10
  assert.strictEqual(ok(first(s, o.sessionId, 1, 1)).status, 'normal');
  s.advance(2);                                     // 11 นาที
  assert.strictEqual(ok(first(s, o.sessionId, 2, 2)).status, 'late');
  assert.strictEqual(code(s.api(s.T1, 'att.resume', { sessionId: o.sessionId })), 'E_ATT_STATE');
});
test('ปิดคาบที่พักอยู่ได้ · ปิดซ้ำไม่ error · นักศึกษาเช็คไม่ได้หลังปิด', () => {
  const s = world(); const o = open(s);
  ok(s.api(s.T1, 'att.pause', { sessionId: o.sessionId }));
  assert.strictEqual(ok(s.api(s.T1, 'att.close', { sessionId: o.sessionId })).status, 'closed');
  assert.strictEqual(ok(s.api(s.T1, 'att.close', { sessionId: o.sessionId })).status, 'closed');
  assert.strictEqual(code(first(s, o.sessionId, 1, 1)), 'E_ATT_CLOSED');
  assert.strictEqual(ok(s.api(s.T1, 'att.open', { courseId: s.cid })).status, 'open', 'ปิดแล้วเปิดใหม่ได้');
});

/* ============================================================ */
group('GPS · ซ้ำ · นักศึกษา');
test('GPS: ต้องมีพิกัดเมื่อคาบกำหนดไว้ · ไกลเกินรัศมีโดน E_ATT_OUT_OF_RANGE (บอกระยะ) · ใกล้ผ่าน', () => {
  const s = world(); const o = open(s, { lat: LAT, lng: LNG, radiusM: 200 });
  assert.strictEqual(code(first(s, o.sessionId, 1, 1)), 'E_ATT_GPS_REQUIRED');
  assert.strictEqual(code(first(s, o.sessionId, 1, 1, { lat: 'abc', lng: 1 })), 'E_ATT_GPS_REQUIRED');
  const far = first(s, o.sessionId, 1, 1, FAR);
  assert.strictEqual(code(far), 'E_ATT_OUT_OF_RANGE'); assert.ok(far.error.detail.distance > 1000); assert.strictEqual(far.error.detail.radius, 200);
  assert.strictEqual(recs(s).length, 0); assert.strictEqual(s.rows('StudentPIN').length, 0, 'ไม่ผ่านพิกัดต้องไม่ตั้ง PIN');
  assert.strictEqual(ok(first(s, o.sessionId, 1, 1, NEAR)).status, 'normal');
});
test('คาบไม่กำหนดพิกัด: เช็คได้โดยไม่ส่งพิกัด', () => {
  const s = world(); const o = open(s);
  assert.strictEqual(ok(first(s, o.sessionId, 1, 1)).status, 'normal');
});
test('เช็คซ้ำ: ได้ผลเดิม already:true ไม่เกิดแถวซ้ำ · ซ้ำแม้ส่งจากเครื่องอื่น', () => {
  const s = world(); const o = open(s);
  ok(first(s, o.sessionId, 1, 1));
  const r = ok(ci(s, o.sessionId, 1, 1));
  assert.strictEqual(r.already, true); assert.strictEqual(r.status, 'normal');
  assert.strictEqual(ok(ci(s, o.sessionId, 1, 2)).already, true);
  assert.strictEqual(recs(s).length, 1);
});
test('รหัสนักศึกษา: ไม่อยู่ในวิชา / รูปแบบเพี้ยน → E_NOT_FOUND · deviceId ผิดรูป → E_ATT_DEVICE', () => {
  const s = world(); const o = open(s);
  assert.strictEqual(code(first(s, o.sessionId, 99, 1)), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api('', 'att.checkIn', { sessionId: o.sessionId, stdId: '<x>', deviceId: D(1), newPin: '1234' })), 'E_NOT_FOUND');
  ['', 'short', 'has space!!', 'x'.repeat(65), null].forEach(d =>
    assert.strictEqual(code(s.api('', 'att.checkIn', { sessionId: o.sessionId, stdId: std(1), deviceId: d, newPin: '1234' })), 'E_ATT_DEVICE', String(d)));
  assert.strictEqual(code(s.api('', 'att.checkIn', { sessionId: 'nope', stdId: std(1), deviceId: D(1) })), 'E_NOT_FOUND');
});
test('นักศึกษาวิชาอื่นที่รหัสเดียวกัน ไม่เช็คในคาบนี้ได้ถ้าไม่อยู่ในรายชื่อ', () => {
  const s = world();
  const c2 = ok(s.api(s.T2, 'course.create', { code: 'CHM1', name: 'เคมี', section: '1' })).courseId;
  ok(s.api(s.T2, 'student.importCsv', { courseId: c2, rows: [{ stdId: '770001', name: 'คนอื่น' }] }));
  const o = open(s);
  assert.strictEqual(code(s.api('', 'att.checkIn', { sessionId: o.sessionId, stdId: '770001', deviceId: D(1), newPin: '1234' })), 'E_NOT_FOUND');
});

/* ============================================================ */
group('PIN ตอนเช็คชื่อ');
test('ยังไม่มี PIN: ต้องส่ง newPin (E_ATT_PIN_REQUIRED mode=set) · ตั้งแล้ว pinJustSet · เครื่องถูกจำ', () => {
  const s = world(); const o = open(s);
  const r = ci(s, o.sessionId, 1, 1);
  assert.strictEqual(code(r), 'E_ATT_PIN_REQUIRED'); assert.strictEqual(r.error.detail.mode, 'set');
  assert.strictEqual(recs(s).length, 0);
  assert.strictEqual(code(ci(s, o.sessionId, 1, 1, { newPin: '12' })), 'E_PIN_FORMAT');
  assert.strictEqual(recs(s).length, 0); assert.strictEqual(s.rows('StudentPIN').length, 0);
  const ok1 = ok(ci(s, o.sessionId, 1, 1, { newPin: '4321' }));
  assert.strictEqual(ok1.pinJustSet, true);
  assert.strictEqual(s.rows('StudentDevices').length, 1);
  assert.ok(JSON.stringify(s.rows('StudentPIN')).indexOf('4321') < 0, 'ห้ามเก็บ PIN จริง');
});
test('มี PIN + เครื่องที่เคยยืนยัน → ไม่ถาม PIN · เครื่องใหม่ → mode=enter · ผิด E_PIN_BAD · ถูกผ่าน', () => {
  const s = world(); const o = open(s); first(s, o.sessionId, 1, 1);
  ok(s.api(s.T1, 'att.close', { sessionId: o.sessionId }));
  const o2 = open(s);
  assert.strictEqual(ok(ci(s, o2.sessionId, 1, 1)).already, false, 'เครื่องเดิมไม่ต้อง PIN');
  ok(s.api(s.T1, 'att.close', { sessionId: o2.sessionId }));
  const o3 = open(s);
  const r = ci(s, o3.sessionId, 1, 2);
  assert.strictEqual(code(r), 'E_ATT_PIN_REQUIRED'); assert.strictEqual(r.error.detail.mode, 'enter');
  assert.strictEqual(code(ci(s, o3.sessionId, 1, 2, { pin: '9999' })), 'E_PIN_BAD');
  assert.strictEqual(ok(ci(s, o3.sessionId, 1, 2, { pin: '1234' })).status, 'normal');
  assert.strictEqual(s.rows('StudentDevices').length, 2);
});
test('ใส่ PIN ผิดครบ → E_PIN_LOCKED แม้ใส่ถูกก็ยังล็อก · ครบเวลาแล้วปลดเอง', () => {
  const s = world(); const o = open(s); first(s, o.sessionId, 1, 1);
  ok(s.api(s.T1, 'att.close', { sessionId: o.sessionId }));
  const o2 = open(s);
  for (let i = 0; i < 4; i++) assert.strictEqual(code(ci(s, o2.sessionId, 1, 2, { pin: '0000' })), 'E_PIN_BAD');
  assert.strictEqual(code(ci(s, o2.sessionId, 1, 2, { pin: '0000' })), 'E_PIN_LOCKED');
  assert.strictEqual(code(ci(s, o2.sessionId, 1, 2, { pin: '1234' })), 'E_PIN_LOCKED');
  assert.strictEqual(ok(ci(s, o2.sessionId, 1, 1)).already, false, 'เครื่องที่จำไว้ไม่ต้องใช้ PIN จึงไม่ติดล็อก');
  s.advance(16);
  assert.strictEqual(ok(ci(s, o2.sessionId, 1, 2, { pin: '1234' })).status, 'normal');
});
test('อาจารย์ออกรหัสชั่วคราว (reset): ลืมเครื่องที่จำไว้ · เช็คชื่อต้อง tempPin+newPin (mode=temp) · ตั้งใหม่แล้วใช้ได้', () => {
  const s = world(); const o = open(s); first(s, o.sessionId, 1, 1);
  ok(s.api(s.T1, 'att.close', { sessionId: o.sessionId }));
  assert.strictEqual(s.rows('StudentDevices').length, 1);
  const t = ok(s.api(s.T1, 'pin.issueTemp', { courseId: s.cid, stdId: std(1) })).codes[0].pin;
  assert.strictEqual(s.rows('StudentDevices').length, 0, 'ต้องลืมเครื่อง');
  const o2 = open(s);
  const r = ci(s, o2.sessionId, 1, 1);
  assert.strictEqual(code(r), 'E_ATT_PIN_REQUIRED'); assert.strictEqual(r.error.detail.mode, 'temp');
  assert.strictEqual(code(ci(s, o2.sessionId, 1, 1, { tempPin: '0000' === t ? '1111' : '0000', newPin: '5555' })), 'E_PIN_TEMP');
  assert.strictEqual(recs(s).length, 1, 'มีแต่แถวคาบแรก');
  const g = ok(ci(s, o2.sessionId, 1, 1, { tempPin: t, newPin: '5555' }));
  assert.strictEqual(g.pinJustSet, true);
  ok(s.api(s.T1, 'att.close', { sessionId: o2.sessionId }));
  const o3 = open(s);
  assert.strictEqual(code(ci(s, o3.sessionId, 1, 7)), 'E_ATT_PIN_REQUIRED');
  assert.strictEqual(ok(ci(s, o3.sessionId, 1, 7, { pin: '5555' })).status, 'normal');
});
test('จำเครื่องได้สูงสุด 3 เครื่อง (เก่าสุดถูกลืม)', () => {
  const s = world();
  for (let k = 1; k <= 4; k++) {
    const o = open(s);
    ok(k === 1 ? first(s, o.sessionId, 1, k) : ci(s, o.sessionId, 1, k, { pin: '1234' }));
    s.advance(1); ok(s.api(s.T1, 'att.close', { sessionId: o.sessionId })); s.advance(1);
  }
  const d = s.rows('StudentDevices').map(r => r[2]).sort();
  assert.deepStrictEqual(d, [D(2), D(3), D(4)]);
});

/* ============================================================ */
group('1 เครื่อง : 1 คน · ขออนุมัติจากอาจารย์');
function conflictWorld() {
  const s = world(); const o = open(s);
  ok(first(s, o.sessionId, 1, 1)); s.o = o; return s;
}
test('คนที่ 2 ใช้เครื่องเดียวกัน → E_ATT_DEVICE_CONFLICT (บอกชื่อ) · ไม่ตั้ง PIN ไม่เขียนแถว', () => {
  const s = conflictWorld();
  const r = first(s, s.o.sessionId, 2, 1);
  assert.strictEqual(code(r), 'E_ATT_DEVICE_CONFLICT'); assert.strictEqual(r.error.detail.usedByName, 'นักศึกษา 1');
  assert.strictEqual(recs(s).length, 1); assert.strictEqual(s.rows('StudentPIN').length, 1);
});
test('ขออนุมัติ → อาจารย์เห็นในหน้าสด → อนุมัติ → เช็คผ่าน (บันทึกว่าอาจารย์อนุมัติ) · ใช้ได้ครั้งเดียว', () => {
  const s = conflictWorld();
  const rq = ok(s.api('', 'att.requestOverride', { sessionId: s.o.sessionId, stdId: std(2), deviceId: D(1) }));
  assert.strictEqual(rq.status, 'open');
  assert.strictEqual(ok(s.api('', 'att.requestOverride', { sessionId: s.o.sessionId, stdId: std(2), deviceId: D(1) })).requestId, rq.requestId, 'ขอซ้ำ = ใบเดิม');
  assert.strictEqual(ok(s.api('', 'att.approvalStatus', { requestId: rq.requestId })).status, 'open');
  const lv = ok(s.api(s.T1, 'att.live', { sessionId: s.o.sessionId }));
  assert.strictEqual(lv.approvals.length, 1); assert.strictEqual(lv.approvals[0].name, 'นักศึกษา 2'); assert.strictEqual(lv.approvals[0].usedByName, 'นักศึกษา 1');
  assert.strictEqual(code(s.api(s.T2, 'att.decide', { requestId: rq.requestId, approve: true })), 'E_FORBIDDEN');
  assert.strictEqual(code(s.api('', 'att.decide', { requestId: rq.requestId, approve: true })), 'E_AUTH');
  assert.strictEqual(ok(s.api(s.T1, 'att.decide', { requestId: rq.requestId, approve: true })).status, 'approved');
  assert.strictEqual(ok(s.api('', 'att.approvalStatus', { requestId: rq.requestId })).status, 'approved');
  assert.strictEqual(ok(first(s, s.o.sessionId, 2, 1)).status, 'normal');
  assert.ok(recs(s).some(r => r[3] === std(2) && String(r[9]).indexOf('อนุมัติ') >= 0));
  assert.strictEqual(ok(s.api('', 'att.approvalStatus', { requestId: rq.requestId })).status, 'used');
  assert.strictEqual(code(first(s, s.o.sessionId, 3, 1)), 'E_ATT_DEVICE_CONFLICT', 'คนที่ 3 ใช้ใบของคนที่ 2 ไม่ได้');
});
test('ปฏิเสธ → ยังชน · อนุมัติแล้วเกิน 5 นาที → ใช้ไม่ได้ · ใบรอเกิน 2 นาที → expired และ decide ไม่ได้', () => {
  const s = conflictWorld();
  const a = ok(s.api('', 'att.requestOverride', { sessionId: s.o.sessionId, stdId: std(2), deviceId: D(1) })).requestId;
  assert.strictEqual(ok(s.api(s.T1, 'att.decide', { requestId: a, approve: false })).status, 'denied');
  assert.strictEqual(code(first(s, s.o.sessionId, 2, 1)), 'E_ATT_DEVICE_CONFLICT');
  assert.strictEqual(code(s.api(s.T1, 'att.decide', { requestId: a, approve: true })), 'E_ATT_REQ', 'ตัดสินแล้วเปลี่ยนไม่ได้');
  const b = ok(s.api('', 'att.requestOverride', { sessionId: s.o.sessionId, stdId: std(3), deviceId: D(1) })).requestId;
  ok(s.api(s.T1, 'att.decide', { requestId: b, approve: true }));
  s.advance(1.5); ok(s.api(s.T1, 'att.live', { sessionId: s.o.sessionId }));
  s.advance(4);                                    // อนุมัติไปแล้ว 5.5 นาที
  assert.strictEqual(ok(s.api('', 'att.approvalStatus', { requestId: b })).status, 'expired');
  assert.strictEqual(code(first(s, s.o.sessionId, 3, 1)), 'E_ATT_DEVICE_CONFLICT');
  const c = ok(s.api('', 'att.requestOverride', { sessionId: s.o.sessionId, stdId: std(4), deviceId: D(1) })).requestId;
  s.advance(2.5);
  assert.strictEqual(ok(s.api('', 'att.approvalStatus', { requestId: c })).status, 'expired');
  assert.strictEqual(code(s.api(s.T1, 'att.decide', { requestId: c, approve: true })), 'E_ATT_REQ');
});
test('ขออนุมัติโดยไม่ได้ชนเครื่องจริง (เครื่องว่าง / เครื่องของตัวเอง) → E_ATT_REQ · ปิดคาบแล้วขอไม่ได้', () => {
  const s = conflictWorld();
  assert.strictEqual(code(s.api('', 'att.requestOverride', { sessionId: s.o.sessionId, stdId: std(2), deviceId: D(9) })), 'E_ATT_REQ');
  assert.strictEqual(code(s.api('', 'att.requestOverride', { sessionId: s.o.sessionId, stdId: std(1), deviceId: D(1) })), 'E_ATT_REQ');
  assert.strictEqual(code(s.api('', 'att.requestOverride', { sessionId: s.o.sessionId, stdId: std(99), deviceId: D(1) })), 'E_NOT_FOUND');
  ok(s.api(s.T1, 'att.close', { sessionId: s.o.sessionId }));
  assert.strictEqual(code(s.api('', 'att.requestOverride', { sessionId: s.o.sessionId, stdId: std(2), deviceId: D(1) })), 'E_ATT_CLOSED');
});
test('เครื่องเดียวกันในคาบอื่นเป็นอิสระ (ข้อจำกัดนับต่อคาบ)', () => {
  const s = conflictWorld();
  ok(s.api(s.T1, 'att.close', { sessionId: s.o.sessionId }));
  const o2 = open(s);
  assert.strictEqual(ok(first(s, o2.sessionId, 2, 1)).status, 'normal');
});

/* ============================================================ */
group('แก้ย้อนหลัง · นำเข้า · ลบ');
test('setStatus: เปลี่ยนสถานะแต่เก็บหลักฐานสแกนเดิม · ลา → note · ขาด → ลบแถว · เพิ่มคนที่ไม่ได้มา = MANUAL', () => {
  const s = world(); const o = open(s, { lat: LAT, lng: LNG });
  ok(first(s, o.sessionId, 1, 1, NEAR));
  const before = recs(s)[0].slice();
  ok(s.api(s.T1, 'att.setStatus', { sessionId: o.sessionId, stdId: std(1), status: 'late' }));
  const after = recs(s)[0];
  assert.strictEqual(after[5], 'late'); assert.strictEqual(after[4], before[4], 'เวลาเดิม'); assert.strictEqual(after[6], before[6], 'พิกัดเดิม'); assert.strictEqual(after[8], D(1), 'เครื่องเดิม');
  ok(s.api(s.T1, 'att.setStatus', { sessionId: o.sessionId, stdId: std(2), status: 'leave' }));
  const r2 = recs(s).filter(r => r[3] === std(2))[0];
  assert.strictEqual(r2[5], 'leave'); assert.strictEqual(r2[10], 'MANUAL'); assert.strictEqual(r2[9], 'ลา');
  ok(s.api(s.T1, 'att.setStatus', { sessionId: o.sessionId, stdId: std(2), status: 'absent' }));
  assert.strictEqual(recs(s).length, 1);
  ok(s.api(s.T1, 'att.setStatus', { sessionId: o.sessionId, stdId: std(2), status: 'absent' }));   // ซ้ำได้
  assert.strictEqual(code(s.api(s.T1, 'att.setStatus', { sessionId: o.sessionId, stdId: std(1), status: 'weird' })), 'E_ATT_STATUS');
  assert.strictEqual(code(s.api(s.T1, 'att.setStatus', { sessionId: o.sessionId, stdId: std(99), status: 'normal' })), 'E_NOT_FOUND');
});
test('นำเข้า dryRun ไม่เขียนอะไร · นำเข้าจริงสร้างคาบ manual ที่ปิดแล้ว · แถวเสียถูกข้ามพร้อมเหตุผล', () => {
  const s = world();
  const rows = [{ stdId: std(1), score: 1 }, { stdId: std(2), status: 'สาย' }, { stdId: std(3), score: '0' }, { stdId: std(4), status: 'ลา' },
    { stdId: std(1), score: 0 }, { stdId: '999999', score: 1 }, { stdId: std(2) , status: 'มั่ว' }, { stdId: 'a b', score: 1 }];
  const dry = ok(s.api(s.T1, 'att.import', { courseId: s.cid, date: '2026-08-10', rows, dryRun: true }));
  assert.strictEqual(sess(s).length, 0);
  assert.strictEqual(dry.imported, 4); assert.strictEqual(dry.skippedCount, 4);
  assert.deepStrictEqual([dry.normal, dry.late, dry.leave, dry.absent], [1, 1, 1, 1]);
  const r = ok(s.api(s.T1, 'att.import', { courseId: s.cid, date: '2026-08-10', rows }));
  assert.strictEqual(sess(s).length, 1); assert.strictEqual(sess(s)[0][3], 'manual'); assert.strictEqual(sess(s)[0][4], 'closed');
  assert.strictEqual(recs(s).length, 3, 'ขาดไม่มีแถว');
  assert.ok(r.sessionId);
  assert.strictEqual(code(s.api(s.T1, 'att.import', { courseId: s.cid, date: '2026-13-40', rows })), 'E_IMPORT');
  assert.strictEqual(code(s.api(s.T1, 'att.import', { courseId: s.cid, date: '2026-08-10', rows: [] })), 'E_IMPORT');
  assert.strictEqual(code(s.api(s.T1, 'att.import', { courseId: s.cid, date: '2026-08-10', rows: [{ stdId: '999999', score: 1 }] })), 'E_IMPORT');
  assert.strictEqual(code(s.api(s.T1, 'att.import', { courseId: s.cid, date: '2026-08-10', rows: new Array(1001).fill({ stdId: std(1), score: 1 }) })), 'E_IMPORT');
  assert.strictEqual(code(s.api(s.T2, 'att.import', { courseId: s.cid, date: '2026-08-10', rows })), 'E_FORBIDDEN');
});
test('ลบคาบ: เปิดอยู่/พักอยู่ลบไม่ได้ · ปิดแล้วลบได้ พร้อมแถวเช็คชื่อ เครื่อง คำขอ · คะแนนคำนวณใหม่', () => {
  const s = world(); const o = open(s);
  first(s, o.sessionId, 1, 1); s.api('', 'att.requestOverride', { sessionId: o.sessionId, stdId: std(2), deviceId: D(1) });
  assert.strictEqual(code(s.api(s.T1, 'att.deleteSession', { sessionId: o.sessionId })), 'E_ATT_STILL_OPEN');
  ok(s.api(s.T1, 'att.pause', { sessionId: o.sessionId }));
  assert.strictEqual(code(s.api(s.T1, 'att.deleteSession', { sessionId: o.sessionId })), 'E_ATT_STILL_OPEN');
  ok(s.api(s.T1, 'att.close', { sessionId: o.sessionId }));
  assert.strictEqual(code(s.api(s.T2, 'att.deleteSession', { sessionId: o.sessionId })), 'E_FORBIDDEN');
  assert.strictEqual(ok(s.api(s.T1, 'att.deleteSession', { sessionId: o.sessionId })).deletedRecords, 1);
  assert.strictEqual(sess(s).length, 0); assert.strictEqual(recs(s).length, 0);
  assert.strictEqual(s.rows('AttDevices').length, 0); assert.strictEqual(s.rows('AttApprovals').length, 0);
});
test('deleteEmpty: ลบเฉพาะคาบที่ปิดแล้วและไม่มีใครเช็ค', () => {
  const s = world();
  const a = open(s); ok(s.api(s.T1, 'att.close', { sessionId: a.sessionId }));
  const b = open(s); first(s, b.sessionId, 1, 1); ok(s.api(s.T1, 'att.close', { sessionId: b.sessionId }));
  const c = open(s);
  assert.strictEqual(ok(s.api(s.T1, 'att.deleteEmpty', { courseId: s.cid })).deleted, 1);
  assert.deepStrictEqual(sess(s).map(r => r[0]).sort(), [b.sessionId, c.sessionId].sort());
});

/* ============================================================ */
group('รายงาน · คะแนน · CSV');
function scoreOf(s, i) {
  const t = ok(s.api(s.T1, 'score.table', { courseId: s.cid }));
  const ty = t.types.filter(x => x.source === 'ATT')[0];
  return { ty, v: ty ? t.students.filter(x => x.stdId === std(i))[0].scores[ty.typeId] : undefined };
}
test('คะแนนเช็คชื่อ = (ปกติ1 สาย0.5 ลา1 ขาด0) ÷ จำนวนคาบที่ปิด ×100 · ประเภท ATT น้ำหนักเริ่ม 0 · แก้มือไม่ได้', () => {
  const s = world();
  const o1 = open(s); first(s, o1.sessionId, 1, 1); first(s, o1.sessionId, 2, 2); first(s, o1.sessionId, 3, 3);
  assert.strictEqual(s.rows('ScoreTypes').length, 0, 'คาบยังเปิด = ยังไม่คิดคะแนน');
  ok(s.api(s.T1, 'att.close', { sessionId: o1.sessionId }));
  const o2 = open(s); s.advance(12);
  ci(s, o2.sessionId, 1, 1);                         // สาย (เครื่องเดิมไม่ต้อง PIN)
  ok(s.api(s.T1, 'att.setStatus', { sessionId: o2.sessionId, stdId: std(3), status: 'leave' }));
  ok(s.api(s.T1, 'att.close', { sessionId: o2.sessionId }));
  const a = scoreOf(s, 1), b = scoreOf(s, 2), c = scoreOf(s, 3), d = scoreOf(s, 4);
  assert.strictEqual(a.ty.pct, 0); assert.strictEqual(a.ty.max, 100);
  assert.strictEqual(a.v, 75); assert.strictEqual(b.v, 50); assert.strictEqual(c.v, 100); assert.strictEqual(d.v, 0);
  assert.strictEqual(code(s.api(s.T1, 'score.saveBulk', { courseId: s.cid, typeId: a.ty.typeId, rows: [{ stdId: std(1), score: 5 }] })), 'E_SCORE_AUTO');
  assert.strictEqual(code(s.api(s.T1, 'score.deleteType', { courseId: s.cid, typeId: a.ty.typeId })), 'E_SCORE_AUTO');
  const rp = ok(s.api(s.T1, 'att.report', { courseId: s.cid }));
  assert.strictEqual(rp.totalSessions, 2); assert.strictEqual(rp.weightPct, 0);
  assert.deepStrictEqual(rp.students[0].records, ['normal', 'late']); assert.strictEqual(rp.students[0].percent, 75);
  assert.deepStrictEqual(rp.students[3].counts, { normal: 0, late: 0, leave: 0, absent: 2 });
  ok(s.api(s.T1, 'score.saveType', { courseId: s.cid, typeId: a.ty.typeId, name: 'เช็คชื่อ', pct: 10, max: 100 }));
  assert.strictEqual(ok(s.api(s.T1, 'att.report', { courseId: s.cid })).weightPct, 10);
  assert.strictEqual(scoreOf(s, 1).ty.pct, 10);
});
test('แก้สถานะ/ลบคาบ/นำเข้า/ลบนักศึกษา แล้วคะแนนเช็คชื่อตามมา', () => {
  const s = world();
  const o = open(s); first(s, o.sessionId, 1, 1); ok(s.api(s.T1, 'att.close', { sessionId: o.sessionId }));
  assert.strictEqual(scoreOf(s, 1).v, 100);
  ok(s.api(s.T1, 'att.setStatus', { sessionId: o.sessionId, stdId: std(1), status: 'late' }));
  assert.strictEqual(scoreOf(s, 1).v, 50);
  ok(s.api(s.T1, 'att.import', { courseId: s.cid, date: '2026-08-01', rows: [{ stdId: std(2), score: 1 }] }));
  assert.strictEqual(scoreOf(s, 1).v, 25); assert.strictEqual(scoreOf(s, 2).v, 50);
  ok(s.api(s.T1, 'att.deleteSession', { sessionId: o.sessionId }));
  assert.strictEqual(scoreOf(s, 1).v, 0); assert.strictEqual(scoreOf(s, 2).v, 100);
  const im = s.rows('AttSessions')[0][0];
  ok(s.api(s.T1, 'att.deleteSession', { sessionId: im }));
  assert.strictEqual(scoreOf(s, 2).v, null, 'ไม่มีคาบเหลือ = ล้างคะแนน');
});
test('ลบนักศึกษา: impact แจ้งจำนวนประวัติเช็คชื่อ · ลบแล้วแถวเช็คชื่อ/เครื่อง/คำขอของคนนั้นหาย คนอื่นอยู่', () => {
  const s = world(); const o = open(s); first(s, o.sessionId, 1, 1); first(s, o.sessionId, 2, 2);
  ok(s.api(s.T1, 'att.close', { sessionId: o.sessionId }));
  const im = ok(s.api(s.T1, 'student.impact', { courseId: s.cid, stdId: std(1) }));
  assert.strictEqual(im.items.filter(x => x.key === 'attendance')[0].count, 1);
  ok(s.api(s.T1, 'student.remove', { courseId: s.cid, stdId: std(1) }));
  assert.deepStrictEqual(recs(s).map(r => r[3]), [std(2)]);
  assert.strictEqual(s.rows('AttDevices').length, 1);
});
test('exportCsv: หัวตารางตามวันที่ · ชื่อที่ขึ้นต้นด้วย = + - @ ถูกกัน CSV injection · ชื่อไฟล์ปลอดภัย', () => {
  const s = world();
  ok(s.api(s.T1, 'student.add', { courseId: s.cid, stdId: '660099', name: '=HYPERLINK("http://x","y")' }));
  ok(s.api(s.T1, 'att.import', { courseId: s.cid, date: '2026-08-10', rows: [{ stdId: std(1), score: 1 }, { stdId: '660099', score: 1 }] }));
  const r = ok(s.api(s.T1, 'att.exportCsv', { courseId: s.cid }));
  assert.strictEqual(r.filename, 'BIO101-1-attendance.csv');
  const lines = r.csv.replace(/^﻿/, '').split(/\r?\n/);
  assert.ok(lines[0].indexOf('2026-08-10') >= 0);
  assert.ok(lines.some(l => l.indexOf('นักศึกษา 1') >= 0 && l.indexOf('ปกติ') >= 0));
  assert.ok(!/(^|,)"?=HYPERLINK/.test(r.csv), 'สูตรต้องถูกทำให้เป็นข้อความ');
  assert.ok(r.csv.indexOf("'=HYPERLINK") >= 0);
});
test('studentDetail: รายคาบของนักศึกษาคนเดียว · ไม่อยู่ในวิชา E_NOT_FOUND', () => {
  const s = world(); const o = open(s); first(s, o.sessionId, 1, 1); ok(s.api(s.T1, 'att.close', { sessionId: o.sessionId }));
  const d = ok(s.api(s.T1, 'att.studentDetail', { courseId: s.cid, stdId: std(1) }));
  assert.strictEqual(d.sessions.length, 1); assert.strictEqual(d.sessions[0].status, 'normal');
  assert.strictEqual(code(s.api(s.T1, 'att.studentDetail', { courseId: s.cid, stdId: std(77) })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api(s.T2, 'att.studentDetail', { courseId: s.cid, stdId: std(1) })), 'E_FORBIDDEN');
});
test('หน้าสด: สถานะรายคน waiting→normal/late · นับถูก · isNew ชี้คนล่าสุด', () => {
  const s = world(); const o = open(s);
  first(s, o.sessionId, 1, 1); s.advance(0.1); first(s, o.sessionId, 2, 2);
  const lv = ok(s.api(s.T1, 'att.live', { sessionId: o.sessionId }));
  assert.deepStrictEqual([lv.counts.total, lv.counts.normal, lv.counts.waiting, lv.counts.absent], [4, 2, 2, 0]);
  assert.strictEqual(lv.students.filter(x => x.isNew).length, 1);
  assert.strictEqual(lv.students.filter(x => x.status === 'waiting').length, 2);
});

/* ============================================================ */
group('ระบบ');
test('อัปเกรด v0.2.0 → v0.3.0: สร้างชีตเช็คชื่อให้ครั้งเดียว ข้อมูลเดิมอยู่ครบ', () => {
  const s = world();
  const names = ['AttSessions', 'AttRecords', 'AttDevices', 'StudentDevices', 'AttApprovals'];
  names.forEach(n => delete s.state.sheets[n]);
  s.state.props.HBT_SCHEMA_VER = '0.2.0';
  const o = open(s);
  names.forEach(n => assert.ok(s.state.sheets[n], n));
  assert.strictEqual(sess(s).length, 1); assert.strictEqual(s.rows('Students').length, 4);
  assert.ok(o.sessionId);
});
test('เช็คชื่อ 60 คน ต่อเนื่อง: ไม่เกิดแถวซ้ำ เครื่องไม่ชน (จำลองลำดับ ไม่ใช่การขนานจริง)', () => {
  const s = world(60); const o = open(s);
  for (let i = 1; i <= 60; i++) ok(first(s, o.sessionId, i, i));
  for (let i = 1; i <= 60; i++) assert.strictEqual(ok(ci(s, o.sessionId, i, i)).already, true);
  assert.strictEqual(recs(s).length, 60); assert.strictEqual(s.rows('AttDevices').length, 60);
  assert.strictEqual(new Set(recs(s).map(r => r[0])).size, 60);
});
test('audit: เปิด/ปิด/อนุมัติ/แก้สถานะ ถูกบันทึก · ไม่มี PIN ในบันทึก', () => {
  const s = world(); const o = open(s); first(s, o.sessionId, 1, 1);
  ok(s.api(s.T1, 'att.setStatus', { sessionId: o.sessionId, stdId: std(1), status: 'late' }));
  ok(s.api(s.T1, 'att.close', { sessionId: o.sessionId }));
  const dump = JSON.stringify(s.rows('AuditLog'));
  ['att.open', 'att.setStatus', 'att.close'].forEach(a => assert.ok(dump.indexOf(a) >= 0, a));
  assert.ok(dump.indexOf('1234') < 0);
});

console.log('\n' + (fail ? '✘ ' + fail + ' ล้มเหลว (' + pass + ' ผ่าน)\n - ' + failures.join('\n - ') : '✔ ผ่านทั้งหมด (' + pass + ' ผ่าน)'));
process.exit(fail ? 1 : 0);
