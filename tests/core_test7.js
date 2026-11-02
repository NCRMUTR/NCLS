'use strict';
/* v0.6.3: ค่า SETUP แยกไว้ใน Setup.local.gs (SETUP_LOCAL) — ไฟล์นี้ไม่ขึ้น Git แต่ clasp ดันขึ้น Apps Script
 * ตรวจ: ใช้ค่าจาก SETUP_LOCAL ได้ · ค่าว่างไม่ทับค่าเริ่มต้น · วิธีเดิม (แก้ SETUP ตรงๆ) ยังใช้ได้ · ไม่มีไฟล์ local ก็ทำงานได้ */
const assert = require('assert'), fs = require('fs'), os = require('os'), path = require('path');
const { makeState, makeEnv } = require('./gas_stub.js');
let pass = 0, fail = 0;
function test(name, fn) { try { fn(); pass++; console.log('  ✔ ' + name); } catch (e) { fail++; console.log('  ✘ ' + name + '\n      ' + (e && e.stack || e).split('\n').slice(0, 6).join('\n      ')); } }

const CORE = path.resolve(__dirname, fs.existsSync(path.resolve(__dirname, '../gas')) ? '../gas' : '../core/gas');
const EXAM = path.resolve(__dirname, fs.existsSync(path.resolve(__dirname, '../exam/Setup.gs')) ? '../exam' : '../exam/gas');
function withLocal(src, localSrc) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'hbt-local-'));
  fs.readdirSync(src).filter(f => f.endsWith('.gs')).forEach(f => fs.copyFileSync(path.join(src, f), path.join(d, f)));
  if (localSrc) fs.writeFileSync(path.join(d, 'Setup.local.gs'), localSrc);
  return d;
}

console.log('\nv0.6.3 Setup.local.gs');
test('Core: setupCore ใช้ค่าจาก SETUP_LOCAL (Client ID + ผู้ดูแลคนแรก) โดยไม่แก้ SETUP', () => {
  const d = withLocal(CORE, "var SETUP_LOCAL = { GOOGLE_CLIENT_ID: '999-x.apps.googleusercontent.com', FIRST_ADMIN_EMAIL: 'Boss@RMUTR.ac.th', FIRST_ADMIN_NAME: 'หัวหน้า', DOMAIN: '', EXAM_URL: '' };");
  const c = makeEnv(makeState(), d);
  assert.strictEqual(c.SETUP.GOOGLE_CLIENT_ID, '', 'SETUP ใน Git ต้องว่าง');
  c.setupCore();
  assert.strictEqual(c.Config.get('GOOGLE_CLIENT_ID'), '999-x.apps.googleusercontent.com');
  assert.strictEqual(c.Config.get('DOMAIN'), 'rmutr.ac.th', 'ค่าว่างใน local ต้องไม่ทับ DOMAIN เริ่มต้น');
  const u = c.Users.get('boss@rmutr.ac.th');
  assert.ok(u && u.role === 'admin' && u.active && u.name === 'หัวหน้า', JSON.stringify(u));
});
test('Core: ไม่มี Setup.local.gs → ยังใช้วิธีเดิม (แก้ SETUP ตรงๆ) ได้', () => {
  const d = withLocal(CORE, null);
  const c = makeEnv(makeState(), d);
  Object.assign(c.SETUP, { GOOGLE_CLIENT_ID: '1-a.apps.googleusercontent.com', FIRST_ADMIN_EMAIL: 'a@rmutr.ac.th' });
  c.setupCore();
  assert.strictEqual(c.Config.get('GOOGLE_CLIENT_ID'), '1-a.apps.googleusercontent.com');
  assert.ok(c.Users.get('a@rmutr.ac.th'));
});
test('Core: ไม่ใส่อีเมลผู้ดูแลเลย → setupAddFirstAdmin แจ้งให้ใส่ (ไม่พังด้วย TypeError)', () => {
  const c = makeEnv(makeState(), withLocal(CORE, null));
  assert.throws(() => c.setupAddFirstAdmin(), /FIRST_ADMIN_EMAIL/);
});
test('Core: setupAddFirstAdmin (กู้ผู้ดูแล) อ่านจาก SETUP_LOCAL ได้', () => {
  const st = makeState();
  const c1 = makeEnv(st, withLocal(CORE, "var SETUP_LOCAL = { GOOGLE_CLIENT_ID: '1-a.apps.googleusercontent.com', FIRST_ADMIN_EMAIL: 'x@rmutr.ac.th' };"));
  c1.setupCore();
  const c2 = makeEnv(st, withLocal(CORE, "var SETUP_LOCAL = { FIRST_ADMIN_EMAIL: 'y@rmutr.ac.th', FIRST_ADMIN_NAME: 'วาย' };"));
  const u = c2.setupAddFirstAdmin();
  assert.strictEqual(u.email, 'y@rmutr.ac.th'); assert.strictEqual(u.role, 'admin');
});
test('Exam: setupExam ใช้ CORE_URL/SEC_TOKEN จาก SETUP_LOCAL', () => {
  const tok = 'a'.repeat(64), url = 'https://script.google.com/macros/s/AKfyTEST/exec';
  const st = makeState();
  const c = makeEnv(st, withLocal(EXAM, "var SETUP_LOCAL = { CORE_URL: '" + url + "', SEC_TOKEN: '" + tok + "' };"));
  c.setupExam();
  assert.strictEqual(c.Db.prop('SEC_TOKEN'), tok); assert.strictEqual(c.Db.prop('CORE_URL'), url);
});
test('Exam: ลบ SEC_TOKEN ออกจาก local แล้วรันซ้ำ → ค่าเดิมใน Script Properties ยังอยู่', () => {
  const tok = 'b'.repeat(64), url = 'https://script.google.com/macros/s/AKfyTEST/exec', st = makeState();
  makeEnv(st, withLocal(EXAM, "var SETUP_LOCAL = { CORE_URL: '" + url + "', SEC_TOKEN: '" + tok + "' };")).setupExam();
  const c2 = makeEnv(st, withLocal(EXAM, "var SETUP_LOCAL = { CORE_URL: '" + url + "', SEC_TOKEN: '' };"));
  c2.setupExam();
  assert.strictEqual(c2.Db.prop('SEC_TOKEN'), tok);
});
test('ไฟล์ .gs ของ Core/Exam ใน Git ไม่มีความลับ: SETUP ว่าง และไม่มี Setup.local.gs ปนอยู่', () => {
  [CORE, EXAM].forEach(dir => {
    assert.ok(!fs.existsSync(path.join(dir, 'Setup.local.gs')), dir + ' มี Setup.local.gs');
    const m = fs.readFileSync(path.join(dir, 'Setup.gs'), 'utf8').match(/var SETUP = \{[\s\S]*?\n\};/)[0];
    const vals = [...m.matchAll(/(\w+):\s*'([^']*)'/g)].filter(x => x[1] !== 'DOMAIN');
    vals.forEach(v => assert.strictEqual(v[2], '', v[1] + ' ต้องว่างใน Git'));
  });
});


console.log('\nsetupDiag (ตรวจไฟล์โค้ดขาด)');
function withoutFile(src, name) { const d = withLocal(src, null); fs.unlinkSync(path.join(d, name)); return d; }
test('Core: ไฟล์ครบ → setupDiag รายงานครบ', () => {
  const r = makeEnv(makeState(), withLocal(CORE, null)).setupDiag();
  assert.ok(/ครบ/.test(r[r.length - 1]) && r.length === 1, JSON.stringify(r));
});
test('Core: ขาด Users.gs → setupDiag ชี้ Users และ Audit พร้อมชื่อไฟล์', () => {
  const r = makeEnv(makeState(), withoutFile(CORE, 'Users.gs')).setupDiag();
  assert.ok(r.some(x => /ขาด Users/.test(x) && /Users\.gs/.test(x)), JSON.stringify(r));
  assert.ok(r.some(x => /ขาด Audit/.test(x)), JSON.stringify(r));
});
test('Exam: ไฟล์ครบ → ครบ · ขาด Quiz.gs → ชี้ Quiz/Questions', () => {
  const ok = makeEnv(makeState(), withLocal(EXAM, null)).setupDiag();
  assert.ok(/ครบ/.test(ok[ok.length - 1]) && ok.length === 1, JSON.stringify(ok));
  const r = makeEnv(makeState(), withoutFile(EXAM, 'Quiz.gs')).setupDiag();
  assert.ok(r.some(x => /ขาด Questions/.test(x) && /Quiz\.gs/.test(x)), JSON.stringify(r));
});
test('รายชื่อใน setupDiag ครบตามตัวแปรระดับบนสุดของทุกไฟล์ (กันลืมเพิ่มเมื่อมีโมดูลใหม่)', () => {
  [[CORE, 'Setup.gs'], [EXAM, 'Setup.gs']].forEach(([dir]) => {
    const names = new Set(); let diag = '';
    fs.readdirSync(dir).filter(f => f.endsWith('.gs')).forEach(f => {
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      if (f === 'Setup.gs') diag = t;
      for (const m of t.matchAll(/^(?:var|const|let) ([A-Za-z_]+) *=/gm)) if (m[1] !== 'SETUP') names.add(m[1]);
    });
    names.forEach(n => assert.ok(diag.includes("['" + n + "',"), dir + ': setupDiag ไม่ได้ตรวจ ' + n));
  });
});

console.log('\n' + (fail ? '✘ ล้ม ' + fail + ' ข้อ' : '✔ ผ่านทั้งหมด') + ' (' + pass + '/' + (pass + fail) + ' ผ่าน)');
process.exit(fail ? 1 : 0);
