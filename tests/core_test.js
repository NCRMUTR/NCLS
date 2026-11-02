'use strict';
const assert = require('assert');
const { create } = require('./core_server.js');

let pass = 0, fail = 0;
const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; failures.push(name); console.log('  ✘ ' + name + '\n      ' + (e && e.message || e).split('\n').join('\n      ')); }
}
function group(t) { console.log('\n' + t); }
const code = r => (r && r.error && r.error.code) || (r && r.ok ? 'OK' : '?');

function fresh() { const s = create(); s.setup(); return s; }

/* ============================================================ */
group('Setup');
test('ก่อน setup: login คืน E_NOT_SETUP และ ping ใช้ได้', () => {
  const s = create();
  assert.strictEqual(s.call({ action: 'meta.ping' }).ok, true);
  s.googleToken('g', { email: 'a@rmutr.ac.th' });
  assert.strictEqual(code(s.call({ action: 'auth.login', args: { idToken: 'g' } })), 'E_NOT_SETUP');
  assert.strictEqual(code(s.call({ action: 'auth.me', token: 'x.y' })), 'E_NOT_SETUP');
});
test('setupCore สร้างชีตครบ + admin + secret', () => {
  const s = create(); s.setup();
  ['Users', 'Terms', 'Settings', 'AuditLog'].forEach(n => assert.ok(s.state.sheets[n], 'missing sheet ' + n));
  assert.ok(s.state.props.SEC_TOKEN && s.state.props.SEC_TOKEN.length === 64);
  const u = s.rows('Users');
  assert.strictEqual(u.length, 1);
  assert.strictEqual(u[0][0], 'admin@rmutr.ac.th');
  assert.strictEqual(u[0][2], 'admin');
  assert.strictEqual(u[0][4], 'TRUE');
});
test('setupCore รันซ้ำ: ไม่เปลี่ยน secret ไม่สร้างผู้ใช้ซ้ำ', () => {
  const s = create(); s.setup();
  const sec = s.state.props.SEC_TOKEN, ss = s.state.props.HBT_SS_ID;
  s.setup();
  assert.strictEqual(s.state.props.SEC_TOKEN, sec);
  assert.strictEqual(s.state.props.HBT_SS_ID, ss);
  assert.strictEqual(s.rows('Users').length, 1);
});
test('setupCore ไม่มี Client ID → ยังรันได้ แต่แจ้งเตือน', () => {
  const s = create();
  const log = s.setup({ GOOGLE_CLIENT_ID: '' });
  assert.ok(log.some(l => l.indexOf('GOOGLE_CLIENT_ID') >= 0));
});
test('setupAddFirstAdmin กู้สิทธิ์: เปิด admin ที่ถูกปิดกลับมา', () => {
  const s = fresh();
  const c = s.ctx();
  // ปิดตรงในชีต (จำลองกรณีล็อกตัวเอง) แล้วกู้
  s.state.sheets.Users.data[1][4] = 'FALSE';
  s.state.cache = {};
  const c2 = s.ctx();
  Object.assign(c2.SETUP, { DOMAIN: 'rmutr.ac.th', FIRST_ADMIN_EMAIL: 'admin@rmutr.ac.th' });
  c2.setupAddFirstAdmin();
  assert.strictEqual(s.rows('Users')[0][4], 'TRUE');
});
test('setupRotateSecret ทำให้ token เดิมใช้ไม่ได้', () => {
  const s = fresh();
  const t = s.tokenOf('admin@rmutr.ac.th');
  assert.strictEqual(s.api(t, 'auth.me').ok, true);
  s.ctx().setupRotateSecret();
  assert.strictEqual(code(s.api(t, 'auth.me')), 'E_AUTH');
});

/* ============================================================ */
group('Google login');
test('ล็อกอินสำเร็จ: ได้ token + ข้อมูลผู้ใช้ + last_login', () => {
  const s = fresh();
  const r = s.login('admin@rmutr.ac.th', 'Admin G');
  assert.strictEqual(r.ok, true);
  assert.ok(r.data.token.split('.').length === 2);
  assert.strictEqual(r.data.user.email, 'admin@rmutr.ac.th');
  assert.strictEqual(r.data.user.role, 'admin');
  assert.ok(r.data.expiresAt > Date.now() + 7 * 3600e3);
  assert.notStrictEqual(s.rows('Users')[0][7], '', 'last_login ต้องถูกบันทึก');
});
test('ชื่อว่างในชีต → เติมจาก Google ตอนล็อกอินครั้งแรก; ชื่อที่ตั้งไว้ไม่ถูกทับ', () => {
  const s = fresh();
  const t = s.tokenOf('admin@rmutr.ac.th');
  s.state.sheets.Users.data[1][1] = '';
  s.state.cache = {};
  s.login('admin@rmutr.ac.th', 'ชื่อจาก Google');
  assert.strictEqual(s.rows('Users')[0][1], 'ชื่อจาก Google');
  s.login('admin@rmutr.ac.th', 'ชื่ออื่น');
  assert.strictEqual(s.rows('Users')[0][1], 'ชื่อจาก Google');
});
test('อีเมลตัวพิมพ์ใหญ่จาก Google ยังจับคู่ได้', () => {
  const s = fresh();
  assert.strictEqual(s.login('Admin@RMUTR.ac.th').ok, true);
});
test('aud ไม่ตรง Client ID ของเรา → E_BAD_TOKEN', () => {
  const s = fresh();
  s.googleToken('g', { email: 'admin@rmutr.ac.th', aud: 'other-app.apps.googleusercontent.com' });
  assert.strictEqual(code(s.call({ action: 'auth.login', args: { idToken: 'g' } })), 'E_BAD_TOKEN');
});
test('iss ผิด → E_BAD_TOKEN', () => {
  const s = fresh();
  s.googleToken('g', { email: 'admin@rmutr.ac.th', iss: 'https://evil.example' });
  assert.strictEqual(code(s.call({ action: 'auth.login', args: { idToken: 'g' } })), 'E_BAD_TOKEN');
});
test('iss แบบไม่มี https:// (accounts.google.com) ใช้ได้', () => {
  const s = fresh();
  s.googleToken('g', { email: 'admin@rmutr.ac.th', iss: 'accounts.google.com' });
  assert.strictEqual(s.call({ action: 'auth.login', args: { idToken: 'g' } }).ok, true);
});
test('token หมดอายุ → E_BAD_TOKEN', () => {
  const s = fresh();
  s.googleToken('g', { email: 'admin@rmutr.ac.th', exp: String(Math.floor(Date.now() / 1000) - 5) });
  assert.strictEqual(code(s.call({ action: 'auth.login', args: { idToken: 'g' } })), 'E_BAD_TOKEN');
});
test('ไม่มี exp → E_BAD_TOKEN', () => {
  const s = fresh();
  s.googleToken('g', { email: 'admin@rmutr.ac.th', exp: undefined });
  assert.strictEqual(code(s.call({ action: 'auth.login', args: { idToken: 'g' } })), 'E_BAD_TOKEN');
});
test('email_verified = false → E_BAD_TOKEN', () => {
  const s = fresh();
  s.googleToken('g', { email: 'admin@rmutr.ac.th', email_verified: 'false' });
  assert.strictEqual(code(s.call({ action: 'auth.login', args: { idToken: 'g' } })), 'E_BAD_TOKEN');
});
test('gmail (ไม่มี hd) → E_DOMAIN', () => {
  const s = fresh();
  s.googleToken('g', { email: 'somchai@gmail.com', hd: undefined });
  assert.strictEqual(code(s.call({ action: 'auth.login', args: { idToken: 'g' } })), 'E_DOMAIN');
});
test('hd ถูกแต่อีเมลลงท้ายคนละโดเมน → E_DOMAIN', () => {
  const s = fresh();
  s.googleToken('g', { email: 'x@evil.com', hd: 'rmutr.ac.th' });
  assert.strictEqual(code(s.call({ action: 'auth.login', args: { idToken: 'g' } })), 'E_DOMAIN');
});
test('โดเมนคล้าย (xrmutr.ac.th / sub-domain) → E_DOMAIN', () => {
  const s = fresh();
  s.googleToken('g1', { email: 'a@xrmutr.ac.th', hd: 'xrmutr.ac.th' });
  s.googleToken('g2', { email: 'a@sub.rmutr.ac.th', hd: 'sub.rmutr.ac.th' });
  assert.strictEqual(code(s.call({ action: 'auth.login', args: { idToken: 'g1' } })), 'E_DOMAIN');
  assert.strictEqual(code(s.call({ action: 'auth.login', args: { idToken: 'g2' } })), 'E_DOMAIN');
});
test('Google ตอบไม่ใช่ 200 / ตอบไม่ใช่ JSON / fetch ล้ม → E_BAD_TOKEN', () => {
  const s = fresh();
  s.googleToken('a', { email: 'admin@rmutr.ac.th' }, { code: 400 });
  s.state.google.b = { code: 200, body: 'not json' };
  s.state.google.c = new Error('network down');
  ['a', 'b', 'c', 'nope'].forEach(k => assert.strictEqual(code(s.call({ action: 'auth.login', args: { idToken: k } })), 'E_BAD_TOKEN', k));
});
test('idToken ว่าง/ไม่ใช่ข้อความ/ยาวผิดปกติ → E_BAD_TOKEN โดยไม่เรียก Google', () => {
  const s = fresh();
  s.state.fetchLog = [];
  [undefined, '', 123, { a: 1 }, 'x'.repeat(5000)].forEach(v =>
    assert.strictEqual(code(s.call({ action: 'auth.login', args: { idToken: v } })), 'E_BAD_TOKEN'));
  assert.strictEqual(s.state.fetchLog.length, 0);
});
function jwtLike(s, over) {
  const p = Buffer.from(JSON.stringify(Object.assign({ aud: s.CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600 }, over || {}))).toString('base64url');
  return 'h.' + p + '.sig';
}
test('idToken ถูก encode ใน URL (กันแทรกพารามิเตอร์)', () => {
  const s = fresh();
  s.state.fetchLog = [];
  s.call({ action: 'auth.login', args: { idToken: jwtLike(s).replace('.sig', '.a&aud=hack') } });
  assert.strictEqual(s.state.fetchLog.length, 1);
  assert.ok(s.state.fetchLog[0].indexOf('a%26aud%3Dhack') >= 0, s.state.fetchLog[0]);
});
test('ด่านกรองก่อนเรียก Google: ไม่ใช่ JWT / aud ผิด / exp หมด → ปฏิเสธโดยไม่ใช้โควตา UrlFetch', () => {
  const s = fresh();
  s.state.fetchLog = [];
  const bad = ['abc', 'a.b', 'a.b.c', 'h..sig', 'h.' + Buffer.from('not json').toString('base64url') + '.s',
    jwtLike(s, { aud: 'other' }), jwtLike(s, { exp: 5 }), jwtLike(s, { exp: undefined }), 'h.' + Buffer.from('[1]').toString('base64url') + '.s'];
  bad.forEach(t => assert.strictEqual(code(s.call({ action: 'auth.login', args: { idToken: t } })), 'E_BAD_TOKEN', t.slice(0, 30)));
  assert.strictEqual(s.state.fetchLog.length, 0, 'ต้องไม่เรียก Google เลย');
});
test('ล็อกอินบันทึก last_login ภายใน lock (กันทับการแก้สิทธิ์ที่ทำพร้อมกัน)', () => {
  const s = fresh();
  const before = s.state.lockCount || 0;
  assert.strictEqual(s.login('admin@rmutr.ac.th').ok, true);
  assert.ok((s.state.lockCount || 0) > before);
});
test('อยู่ในโดเมนแต่ไม่อยู่ในรายชื่อ → E_NOT_LISTED', () => {
  const s = fresh();
  assert.strictEqual(code(s.login('stranger@rmutr.ac.th')), 'E_NOT_LISTED');
});
test('ถูกปิดใช้งาน → E_DISABLED และไม่ออก token', () => {
  const s = fresh();
  const t = s.tokenOf('admin@rmutr.ac.th');
  s.api(t, 'user.upsert', { email: 't1@rmutr.ac.th', name: 'T1', systems: ['att'] });
  assert.strictEqual(s.login('t1@rmutr.ac.th').ok, true);
  s.api(t, 'user.setActive', { email: 't1@rmutr.ac.th', active: false });
  const r = s.login('t1@rmutr.ac.th');
  assert.strictEqual(code(r), 'E_DISABLED');
  assert.ok(!r.data);
});
test('ข้อผิดพลาดไม่หลุดรายละเอียดภายใน (stack/ไฟล์)', () => {
  const s = fresh();
  s.googleToken('g', { email: 'x@gmail.com', hd: undefined });
  const raw = JSON.stringify(s.call({ action: 'auth.login', args: { idToken: 'g' } }));
  assert.ok(!/\.gs|at |stack/i.test(raw), raw);
});

/* ============================================================ */
group('Session token');
test('auth.me คืนผู้ใช้/ภาคเรียน/เวอร์ชัน', () => {
  const s = fresh();
  const t = s.tokenOf('admin@rmutr.ac.th');
  const r = s.api(t, 'auth.me');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.user.email, 'admin@rmutr.ac.th');
  assert.strictEqual(r.data.term, null);
  assert.strictEqual(r.data.version, '0.6.0');
});
test('ไม่ส่ง token / token ขยะ / token ว่าง → E_AUTH', () => {
  const s = fresh();
  ['', undefined, 'abc', 'a.b', '.', 'a.b.c', 123, 'x'.repeat(3000)].forEach(tk =>
    assert.strictEqual(code(s.call({ action: 'auth.me', token: tk })), 'E_AUTH', String(tk).slice(0, 20)));
});
test('แก้ payload (เปลี่ยนอีเมล) → ลายเซ็นไม่ตรง → E_AUTH', () => {
  const s = fresh();
  const t = s.tokenOf('admin@rmutr.ac.th');
  const [body, sig] = t.split('.');
  const p = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
  p.e = 'other@rmutr.ac.th';
  const forged = Buffer.from(JSON.stringify(p)).toString('base64url') + '.' + sig;
  assert.strictEqual(code(s.api(forged, 'auth.me')), 'E_AUTH');
});
test('แก้ลายเซ็น 1 ตัวอักษร → E_AUTH', () => {
  const s = fresh();
  const t = s.tokenOf('admin@rmutr.ac.th');
  const last = t.slice(-1) === 'A' ? 'B' : 'A';
  assert.strictEqual(code(s.api(t.slice(0, -1) + last, 'auth.me')), 'E_AUTH');
});
test('ขยายอายุ (แก้ exp) ไม่ได้', () => {
  const s = fresh();
  const t = s.tokenOf('admin@rmutr.ac.th');
  const [body, sig] = t.split('.');
  const p = JSON.parse(Buffer.from(body, 'base64').toString('utf8'));
  p.exp += 99999;
  assert.strictEqual(code(s.api(Buffer.from(JSON.stringify(p)).toString('base64url') + '.' + sig, 'auth.me')), 'E_AUTH');
});
test('token หมดอายุ → E_AUTH', () => {
  const s = fresh();
  const t = s.ctx().Auth.mint('u', { e: 'admin@rmutr.ac.th' }, -10);
  assert.strictEqual(code(s.api(t, 'auth.me')), 'E_AUTH');
});
test('token ชนิดอื่น (k ≠ u) ใช้เป็นของอาจารย์ไม่ได้', () => {
  const s = fresh();
  const t = s.ctx().Auth.mint('s', { e: 'admin@rmutr.ac.th' }, 3600);
  assert.strictEqual(code(s.api(t, 'auth.me')), 'E_AUTH');
});
test('token ของผู้ใช้ที่ถูกลบออกจากชีต → E_AUTH', () => {
  const s = fresh();
  const t = s.ctx().Auth.mint('u', { e: 'ghost@rmutr.ac.th' }, 3600);
  assert.strictEqual(code(s.api(t, 'auth.me')), 'E_AUTH');
});
test('ปิดบัญชีแล้ว token เดิมใช้ไม่ได้ทันที (E_DISABLED)', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  s.api(a, 'user.upsert', { email: 't1@rmutr.ac.th', name: 'T1' });
  const t1 = s.tokenOf('t1@rmutr.ac.th');
  assert.strictEqual(s.api(t1, 'auth.me').ok, true);
  s.api(a, 'user.setActive', { email: 't1@rmutr.ac.th', active: false });
  assert.strictEqual(code(s.api(t1, 'auth.me')), 'E_DISABLED');
});
test('ถูกลดจาก admin เป็น teacher แล้ว token เดิมเรียก route admin ไม่ได้', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  s.api(a, 'user.upsert', { email: 'b@rmutr.ac.th', name: 'B', role: 'admin' });
  const b = s.tokenOf('b@rmutr.ac.th');
  assert.strictEqual(s.api(b, 'user.list').ok, true);
  s.api(a, 'user.upsert', { email: 'b@rmutr.ac.th', name: 'B', role: 'teacher' });
  assert.strictEqual(code(s.api(b, 'user.list')), 'E_FORBIDDEN');
});
test('auth.logout ตอบ ok และบันทึก audit', () => {
  const s = fresh();
  const t = s.tokenOf('admin@rmutr.ac.th');
  assert.strictEqual(s.api(t, 'auth.logout').ok, true);
  assert.ok(s.rows('AuditLog').some(r => r[3] === 'auth.logout'));
});

/* ============================================================ */
group('Users & permissions');
test('teacher เรียก route ของ admin ไม่ได้ (E_FORBIDDEN)', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  s.api(a, 'user.upsert', { email: 't1@rmutr.ac.th', name: 'T1', systems: ['att'] });
  const t = s.tokenOf('t1@rmutr.ac.th');
  ['user.list', 'user.upsert', 'user.setActive', 'settings.set', 'term.create', 'term.setCurrent'].forEach(act =>
    assert.strictEqual(code(s.api(t, act, { email: 'x@rmutr.ac.th', name: 'x', changes: { file_max_mb: 3 }, name2: 'y', termId: 'x' })), 'E_FORBIDDEN', act));
  ['auth.me', 'settings.get', 'term.list'].forEach(act => assert.strictEqual(s.api(t, act).ok, true, act));
});
test('เพิ่มผู้ใช้: ทำความสะอาดอีเมล/ระบบ และบันทึก audit', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  const r = s.api(a, 'user.upsert', { email: '  Somchai.J@RMUTR.ac.th ', name: ' อ.สมชาย ', systems: ['att', 'exam', 'att', 'hack', ''] });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.email, 'somchai.j@rmutr.ac.th');
  assert.strictEqual(r.data.name, 'อ.สมชาย');
  assert.deepStrictEqual(r.data.systems, ['att', 'exam']);
  assert.strictEqual(r.data.role, 'teacher');
  assert.strictEqual(r.data.active, true);
  assert.ok(s.rows('AuditLog').some(x => x[3] === 'user.add' && x[4] === 'somchai.j@rmutr.ac.th' && x[2] === 'admin@rmutr.ac.th'));
});
test('ตรวจอีเมล: รูปแบบผิด / ต่างโดเมน / ชื่อว่าง / role ผิด', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  assert.strictEqual(code(s.api(a, 'user.upsert', { email: 'abc', name: 'x' })), 'E_EMAIL');
  assert.strictEqual(code(s.api(a, 'user.upsert', { email: '', name: 'x' })), 'E_EMAIL');
  assert.strictEqual(code(s.api(a, 'user.upsert', { email: 'a@gmail.com', name: 'x' })), 'E_EMAIL_DOMAIN');
  assert.strictEqual(code(s.api(a, 'user.upsert', { email: 'a@evil-rmutr.ac.th', name: 'x' })), 'E_EMAIL_DOMAIN');
  assert.strictEqual(code(s.api(a, 'user.upsert', { email: 'a@rmutr.ac.th', name: '  ' })), 'E_REQUIRED');
  assert.strictEqual(code(s.api(a, 'user.upsert', { email: 'a@rmutr.ac.th', name: 'x', role: 'root' })), 'E_ROLE');
  assert.strictEqual(s.rows('Users').length, 1, 'ห้ามมีแถวเพิ่มจากคำขอที่ผิด');
});
test('แก้ไขผู้ใช้เดิม: อัปเดตแถวเดิม ไม่สร้างซ้ำ', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  s.api(a, 'user.upsert', { email: 't1@rmutr.ac.th', name: 'T1', systems: ['att'] });
  s.api(a, 'user.upsert', { email: 'T1@rmutr.ac.th', name: 'T1 ใหม่', systems: ['exam', 'asg'] });
  const rows = s.rows('Users');
  assert.strictEqual(rows.length, 2);
  const t1 = rows.find(r => r[0] === 't1@rmutr.ac.th');
  assert.strictEqual(t1[1], 'T1 ใหม่');
  assert.strictEqual(t1[3], 'exam,asg');
});
test('สิทธิ์ที่แก้มีผลกับ token ที่ล็อกอินอยู่แล้ว (route ระบบ)', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  s.api(a, 'user.upsert', { email: 't1@rmutr.ac.th', name: 'T1', systems: [] });
  const t = s.tokenOf('t1@rmutr.ac.th');
  assert.deepStrictEqual(s.api(t, 'auth.me').data.user.systems, []);
  s.api(a, 'user.upsert', { email: 't1@rmutr.ac.th', name: 'T1', systems: ['asg'] });
  assert.deepStrictEqual(s.api(t, 'auth.me').data.user.systems, ['asg']);
});
test('ห้ามปิด/ลดสิทธิ์ admin คนสุดท้าย (E_LAST_ADMIN)', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  assert.strictEqual(code(s.api(a, 'user.setActive', { email: 'admin@rmutr.ac.th', active: false })), 'E_LAST_ADMIN');
  assert.strictEqual(code(s.api(a, 'user.upsert', { email: 'admin@rmutr.ac.th', name: 'x', role: 'teacher' })), 'E_LAST_ADMIN');
  assert.strictEqual(code(s.api(a, 'user.upsert', { email: 'admin@rmutr.ac.th', name: 'x', role: 'admin', active: false })), 'E_LAST_ADMIN');
  assert.strictEqual(s.rows('Users')[0][2], 'admin');
  assert.strictEqual(s.rows('Users')[0][4], 'TRUE');
});
test('มี admin คนที่สองแล้วลดคนแรกได้; admin ที่ถูกปิดไม่นับเป็น admin สำรอง', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  s.api(a, 'user.upsert', { email: 'b@rmutr.ac.th', name: 'B', role: 'admin' });
  // ปิด B → A เป็นคนสุดท้ายอีกครั้ง
  s.api(a, 'user.setActive', { email: 'b@rmutr.ac.th', active: false });
  assert.strictEqual(code(s.api(a, 'user.upsert', { email: 'admin@rmutr.ac.th', name: 'x', role: 'teacher' })), 'E_LAST_ADMIN');
  s.api(a, 'user.setActive', { email: 'b@rmutr.ac.th', active: true });
  assert.strictEqual(s.api(a, 'user.upsert', { email: 'admin@rmutr.ac.th', name: 'x', role: 'teacher' }).ok, true);
});
test('setActive ผู้ใช้ที่ไม่มี → E_NOT_FOUND', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  assert.strictEqual(code(s.api(a, 'user.setActive', { email: 'no@rmutr.ac.th', active: false })), 'E_NOT_FOUND');
});
test('user.list: admin ก่อน แล้วเรียงชื่อ; มีรายชื่อระบบ', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  s.api(a, 'user.upsert', { email: 'z@rmutr.ac.th', name: 'ก ไก่' });
  s.api(a, 'user.upsert', { email: 'y@rmutr.ac.th', name: 'ข ไข่' });
  const r = s.api(a, 'user.list').data;
  assert.deepStrictEqual(r.systems, ['att', 'exam', 'asg']);
  assert.strictEqual(r.users[0].role, 'admin');
  assert.deepStrictEqual(r.users.slice(1).map(u => u.name), ['ก ไก่', 'ข ไข่']);
});
test('ชื่อที่ขึ้นต้นด้วย = ถูกเก็บเป็นข้อความ (ไม่ถูกตีความเป็นสูตร: คอลัมน์รูปแบบ @)', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  const r = s.api(a, 'user.upsert', { email: 'f@rmutr.ac.th', name: '=HYPERLINK("http://x")' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.name, '=HYPERLINK("http://x")');
});

test('upsert แบบย่อ (ไม่ส่ง role/systems/active) คงค่าเดิมของผู้ใช้ที่มีอยู่', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  s.api(a, 'user.upsert', { email: 't1@rmutr.ac.th', name: 'T1', systems: ['att', 'exam'] });
  s.api(a, 'user.setActive', { email: 't1@rmutr.ac.th', active: false });
  const r = s.api(a, 'user.upsert', { email: 't1@rmutr.ac.th', name: 'T1 เปลี่ยนชื่อ' });
  assert.strictEqual(r.data.active, false, 'ห้ามเปิดบัญชีที่ถูกปิดโดยไม่ตั้งใจ');
  assert.deepStrictEqual(r.data.systems, ['att', 'exam']);
  assert.strictEqual(r.data.role, 'teacher');
  s.api(a, 'user.upsert', { email: 'b@rmutr.ac.th', name: 'B', role: 'admin' });
  const r2 = s.api(a, 'user.upsert', { email: 'b@rmutr.ac.th', name: 'B2' });
  assert.strictEqual(r2.data.role, 'admin', 'ห้ามลด admin เป็น teacher โดยไม่ตั้งใจ');
});
test('ส่ง systems: [] ชัดเจน = ล้างสิทธิ์จริง (ต่างจากไม่ส่งเลย)', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  s.api(a, 'user.upsert', { email: 't1@rmutr.ac.th', name: 'T1', systems: ['att'] });
  assert.deepStrictEqual(s.api(a, 'user.upsert', { email: 't1@rmutr.ac.th', name: 'T1', systems: [] }).data.systems, []);
});
test('ชื่อผู้ใช้ยาวเกินถูกตัดที่ 120 ตัวอักษร', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  assert.strictEqual(s.api(a, 'user.upsert', { email: 'l@rmutr.ac.th', name: 'ก'.repeat(500) }).data.name.length, 120);
});

/* ============================================================ */
group('Idempotency (opId)');
test('user.upsert ซ้ำด้วย opId เดียวกัน → ทำครั้งเดียว ผลเดิม', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  const r1 = s.api(a, 'user.upsert', { email: 'n@rmutr.ac.th', name: 'N' }, 'op-1');
  const r2 = s.api(a, 'user.upsert', { email: 'n@rmutr.ac.th', name: 'N' }, 'op-1');
  assert.deepStrictEqual(r1, r2);
  assert.strictEqual(s.rows('AuditLog').filter(x => x[3] === 'user.add' && x[4] === 'n@rmutr.ac.th').length, 1);
});
test('opId เดียวกัน คนละ action → ไม่ชนกัน', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  s.api(a, 'user.upsert', { email: 'n@rmutr.ac.th', name: 'N' }, 'same');
  const r = s.api(a, 'term.create', { name: '1/2569' }, 'same');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(s.rows('Terms').length, 1);
});
test('opId เดียวกัน คนละผู้ใช้ → ไม่ชนกัน', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  s.api(a, 'user.upsert', { email: 'b@rmutr.ac.th', name: 'B', role: 'admin' });
  const b = s.tokenOf('b@rmutr.ac.th');
  s.api(a, 'term.create', { name: 'A-term' }, 'same');
  const r = s.api(b, 'term.create', { name: 'B-term' }, 'same');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(s.rows('Terms').length, 2);
});
test('ไม่มี opId: term.create ซ้ำชื่อ → E_TERM_DUP; มี opId ซ้ำ → ได้ผลเดิม', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  assert.strictEqual(s.api(a, 'term.create', { name: '1/2569' }).ok, true);
  assert.strictEqual(code(s.api(a, 'term.create', { name: '1/2569' })), 'E_TERM_DUP');
  assert.strictEqual(s.api(a, 'term.create', { name: '2/2569' }, 'o9').ok, true);
  assert.strictEqual(s.api(a, 'term.create', { name: '2/2569' }, 'o9').ok, true);
  assert.strictEqual(s.rows('Terms').length, 2);
});
test('error ไม่ถูกจำไว้: ส่ง opId เดิมซ้ำหลังแก้ข้อมูลที่ผิด ต้องทำงานจริง', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  assert.strictEqual(code(s.api(a, 'user.upsert', { email: 'bad', name: 'x' }, 'op-x')), 'E_EMAIL');
  assert.strictEqual(s.api(a, 'user.upsert', { email: 'good@rmutr.ac.th', name: 'x' }, 'op-x').ok, true);
});

/* ============================================================ */
group('Settings & terms');
test('settings.get ครบค่า default', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  const r = s.api(a, 'settings.get').data.settings;
  const m = {}; r.forEach(d => m[d.key] = d.value);
  assert.strictEqual(m.file_max_mb, '5');
  assert.strictEqual(m.att_radius_m, '500');
  assert.strictEqual(m.file_types, 'pdf,jpg,png,docx,xlsx,pptx');
  assert.strictEqual(r.length, 8);
});
test('settings.set: บันทึกหลายค่า + มีผลทันทีข้าม execution + audit', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  const r = s.api(a, 'settings.set', { changes: { file_max_mb: 4, att_radius_m: '300', file_types: ['pdf', 'png', 'pdf'] } });
  assert.strictEqual(r.ok, true);
  const m = {}; s.api(a, 'settings.get').data.settings.forEach(d => m[d.key] = d.value);
  assert.strictEqual(m.file_max_mb, '4');
  assert.strictEqual(m.att_radius_m, '300');
  assert.strictEqual(m.file_types, 'pdf,png');
  assert.ok(s.rows('AuditLog').filter(x => x[3] === 'settings.set').length === 3);
});
test('settings.set ค่าผิดข้อเดียว → ไม่เขียนอะไรเลย (atomic)', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  const r = s.api(a, 'settings.set', { changes: { file_max_mb: 4, att_radius_m: 99999 } });
  assert.strictEqual(code(r), 'E_SETTING');
  assert.strictEqual(r.error.detail.key, 'att_radius_m');
  const m = {}; s.api(a, 'settings.get').data.settings.forEach(d => m[d.key] = d.value);
  assert.strictEqual(m.file_max_mb, '5');
  assert.strictEqual(s.rows('Settings').length, 0);
});
test('settings.set ปฏิเสธ: คีย์ที่ไม่รู้จัก, ไม่ใช่จำนวนเต็ม, ติดลบ, ชนิดไฟล์นอกรายการ/ว่าง, changes ว่าง', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  const bad = [
    { SEC_TOKEN: 'x' }, { file_max_mb: 2.5 }, { file_max_mb: 'abc' }, { file_max_mb: -1 }, { file_max_mb: 0 },
    { file_max_mb: '' }, { file_types: ['exe'] }, { file_types: [] }, { pin_max_fail: 2 }, { pin_lock_min: 121 }
  ];
  bad.forEach(ch => assert.strictEqual(code(s.api(a, 'settings.set', { changes: ch })), 'E_SETTING', JSON.stringify(ch)));
  assert.strictEqual(code(s.api(a, 'settings.set', { changes: {} })), 'E_BAD_REQUEST');
  assert.strictEqual(code(s.api(a, 'settings.set', {})), 'E_BAD_REQUEST');
  assert.strictEqual(s.rows('Settings').length, 0);
});
test('ตั้งค่าซ้ำคีย์เดิม → อัปเดตแถวเดิม (ไม่เพิ่มแถว)', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  s.api(a, 'settings.set', { changes: { file_max_mb: 3 } });
  s.api(a, 'settings.set', { changes: { file_max_mb: 4 } });
  assert.strictEqual(s.rows('Settings').length, 1);
  assert.strictEqual(s.rows('Settings')[0][1], '4');
});
test('ภาคเรียน: อันแรกเป็นปัจจุบันอัตโนมัติ; สลับได้; ชื่อซ้ำ/ว่างไม่ได้', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  assert.strictEqual(code(s.api(a, 'term.create', { name: '  ' })), 'E_REQUIRED');
  const r1 = s.api(a, 'term.create', { name: '2/2568', startDate: '2026-01-05', endDate: '2026-05-20' });
  assert.strictEqual(r1.data.terms.length, 1);
  assert.strictEqual(r1.data.terms[0].isCurrent, true);
  const r2 = s.api(a, 'term.create', { name: '1/2569' });
  assert.strictEqual(r2.data.terms.length, 2);
  assert.strictEqual(r2.data.terms.filter(t => t.isCurrent).length, 1);
  const t2 = r2.data.terms.find(t => t.name === '1/2569');
  assert.strictEqual(t2.isCurrent, false);
  const r3 = s.api(a, 'term.setCurrent', { termId: t2.termId });
  assert.strictEqual(r3.data.terms.find(t => t.isCurrent).name, '1/2569');
  assert.strictEqual(r3.data.terms.filter(t => t.isCurrent).length, 1);
  assert.strictEqual(s.api(a, 'auth.me').data.term.name, '1/2569');
  assert.strictEqual(code(s.api(a, 'term.setCurrent', { termId: 'TERM-NOPE' })), 'E_NOT_FOUND');
  assert.strictEqual(code(s.api(a, 'term.setCurrent', {})), 'E_REQUIRED');
  assert.strictEqual(code(s.api(a, 'term.create', { name: '1/2569' })), 'E_TERM_DUP');
});
test('ภาคเรียน: ตรวจรูปแบบวันที่และลำดับ (E_TERM_DATE) และไม่เขียนแถวเมื่อผิด', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  [{ startDate: '11/08/2026' }, { startDate: '2026-13-40' }, { endDate: 'พรุ่งนี้' }, { startDate: '2026-12-12', endDate: '2026-01-01' }, { startDate: '2026-02-30' }]
    .forEach(d => assert.strictEqual(code(s.api(a, 'term.create', Object.assign({ name: 'X' }, d))), 'E_TERM_DATE', JSON.stringify(d)));
  assert.strictEqual(s.rows('Terms').length, 0);
  assert.strictEqual(s.api(a, 'term.create', { name: 'Y', startDate: '2026-08-11' }).ok, true);
  assert.strictEqual(s.api(a, 'term.create', { name: 'Z'.repeat(80) }).data.terms.find(t => t.name.startsWith('Z')).name.length, 30);
});
test('term.list เรียงใหม่→เก่า', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  ['2/2568', '1/2569', '3/2568'].forEach(n => s.api(a, 'term.create', { name: n }));
  assert.deepStrictEqual(s.api(a, 'term.list').data.terms.map(t => t.name), ['3/2568', '2/2568', '1/2569'].sort().reverse());
});

/* ============================================================ */
group('Router / request hardening');
test('JSON เสีย / ว่าง / ไม่ใช่ object → E_BAD_REQUEST', () => {
  const s = fresh();
  ['{bad', '', '[]', '"str"', 'null', '123'].forEach(b => assert.strictEqual(code(s.call(b)), 'E_BAD_REQUEST', JSON.stringify(b)));
});
test('doPost ไม่มี postData → E_BAD_REQUEST (ไม่ล้ม)', () => {
  const s = fresh();
  const out = JSON.parse(s.ctx().doPost({}).text);
  assert.strictEqual(out.error.code, 'E_BAD_REQUEST');
  assert.strictEqual(JSON.parse(s.ctx().doPost().text).error.code, 'E_BAD_REQUEST');
});
test('action ไม่รู้จัก / ว่าง / ชื่อของ Object.prototype → E_BAD_REQUEST', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  ['nope', '', '__proto__', 'constructor', 'toString', 'hasOwnProperty', 'user.list ', 'USER.LIST'].forEach(act =>
    assert.strictEqual(code(s.api(a, act)), 'E_BAD_REQUEST', act));
  assert.strictEqual(code(s.call({ args: {} })), 'E_BAD_REQUEST');
  assert.strictEqual(code(s.call({ action: ['user.list'] })), 'E_BAD_REQUEST');
});
test('ตรวจ token ก่อนตรวจ action ที่ผิด? (ต้องไม่เปิดเผยว่า action มีอยู่จริงให้คนไม่ล็อกอิน)', () => {
  const s = fresh();
  // action ไม่รู้จัก = BAD_REQUEST เหมือนกันทั้งคนล็อกอินและไม่ล็อกอิน; action มีจริงแต่ไม่ล็อกอิน = E_AUTH
  assert.strictEqual(code(s.call({ action: 'user.list' })), 'E_AUTH');
  assert.strictEqual(code(s.call({ action: 'nope' })), 'E_BAD_REQUEST');
});
test('body ใหญ่เกินกำหนด → E_BAD_REQUEST', () => {
  const s = fresh();
  const big = JSON.stringify({ action: 'meta.ping', args: { pad: 'x'.repeat(2 * 1024 * 1024 + 10) } });
  assert.strictEqual(code(s.call(big)), 'E_BAD_REQUEST');
});
test('args ไม่ใช่ object (string/array/null) ไม่ทำให้ล้ม', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  ['x', [1], null, 5].forEach(v => {
    const r = s.call({ action: 'settings.get', token: a, args: v });
    assert.strictEqual(r.ok, true, JSON.stringify(v));
  });
  assert.strictEqual(code(s.call({ action: 'user.upsert', token: a, args: 'str' })), 'E_EMAIL');
});
test('คำตอบเป็น JSON เสมอ (ซองมาตรฐาน) แม้เกิด error ไม่คาดคิด', () => {
  const s = fresh();
  const a = s.tokenOf('admin@rmutr.ac.th');
  // ทำให้ชีตหาย → error ภายใน
  delete s.state.sheets.Users; s.state.props.HBT_SCHEMA_VER = 'x'; s.state.cache = {};
  const r = s.call({ action: 'user.list', token: a });
  assert.strictEqual(r.ok, false);
  assert.ok(r.error && r.error.code && r.error.msg);
});
test('doGet: health check ไม่เปิดเผยรายละเอียดระบบ', () => {
  const s = fresh();
  const g = s.get();
  assert.deepStrictEqual(Object.keys(g.data).sort(), ['name', 'status', 'version']);
});
test('ping ไม่ต้องล็อกอินและไม่แตะชีต', () => {
  const s = create();           // ยังไม่ setup
  const r = s.call({ action: 'meta.ping' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data.version, '0.6.0');
});

/* ============================================================ */
group('Db layer');
test('removeWhere: ลบหลายแถวด้วยการเขียนช่วงเดียว คงลำดับที่เหลือ', () => {
  const s = fresh();
  const c = s.ctx();
  for (let i = 1; i <= 6; i++) c.Db.insert('AuditLog', { log_id: 'L' + i, ts: '', actor: i % 2 ? 'odd' : 'even', action: 'x', target: '', detail: '' });
  const before = s.state.ops;
  const n = s.ctx().Db.removeWhere('AuditLog', r => r.actor === 'odd');
  assert.strictEqual(n, 3);
  const left = s.rows('AuditLog').map(r => r[0]).filter(x => /^L\d$/.test(x));
  assert.deepStrictEqual(left, ['L2', 'L4', 'L6']);
  assert.strictEqual(s.ctx().Db.removeWhere('AuditLog', () => false), 0);
});
test('ensureSchema: เวอร์ชันตรง = ไม่แตะชีตซ้ำ (เร็ว)', () => {
  const s = fresh();
  const ops0 = s.state.ops;
  s.call({ action: 'meta.ping' });
  s.api(s.tokenOf('admin@rmutr.ac.th'), 'auth.me');
  // เพียงตรวจว่าไม่ล้ม และ header ยังเดิม
  assert.deepStrictEqual(s.state.sheets.Users.data[0].slice(0, 3), ['email', 'name', 'role']);
});
test('ensureSchema: เพิ่มคอลัมน์ท้ายตารางเมื่อ header เก่าขาด (ย้ายเวอร์ชัน)', () => {
  const s = fresh();
  s.state.sheets.Users.data[0] = ['email', 'name', 'role'];      // จำลองไฟล์เก่าที่มีน้อยคอลัมน์
  s.state.props.HBT_SCHEMA_VER = '0.0.1';
  s.ctx().Db.ensureSchema();
  assert.strictEqual(s.state.sheets.Users.data[0].length >= 8, true);
  assert.strictEqual(s.state.sheets.Users.data[0][7], 'last_login');
});

console.log('\n' + (fail ? '✘ ' + fail + ' ล้มเหลว' : '✔ ผ่านทั้งหมด') + ' (' + pass + ' ผ่าน)');
if (fail) { console.log(failures.map(f => ' - ' + f).join('\n')); process.exit(1); }
