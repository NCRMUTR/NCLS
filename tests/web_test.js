'use strict';
/* ทดสอบตรรกะฝั่งเว็บที่ไม่ต้องใช้เบราว์เซอร์: listkit (ค้นหา/เรียง/เลือก/ทำทีละรายการ) · ไวยากรณ์ของ JS ทุกไฟล์ใน web/assets */
const assert = require('assert');
const fs = require('fs'), path = require('path'), vm = require('vm');

let pass = 0, fail = 0; const failures = [];
function test(name, fn) {
  try { fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; failures.push(name); console.log('  ✘ ' + name + '\n      ' + (e && e.stack || e).split('\n').slice(0, 4).join('\n      ')); }
}
async function atest(name, fn) {
  try { await fn(); pass++; console.log('  ✔ ' + name); }
  catch (e) { fail++; failures.push(name); console.log('  ✘ ' + name + '\n      ' + (e && e.stack || e).split('\n').slice(0, 4).join('\n      ')); }
}

const dir = path.join(__dirname, '..', 'web', 'assets');
const ctx = { window: { HBT: { esc: s => String(s) } } };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(dir, 'listkit.js'), 'utf8'), ctx);
const L = ctx.window.HBT.listKit;
const rows = () => [{ id: '660010', n: 'สมชาย', c: 3 }, { id: '660002', n: 'กานดา', c: 10 }, { id: '660001', n: 'นภา', c: 2 }];
const mk = () => L({ id: r => r.id, search: r => r.id + ' ' + r.n, sorts: [{ k: 'id', label: 'รหัส', fn: r => r.id }, { k: 'n', label: 'ชื่อ', fn: r => r.n }, { k: 'c', label: 'จำนวน', fn: r => r.c }], sort: 'id' });

(async () => {
  console.log('\nlistkit');
  test('เรียงตามรหัส/ชื่อ (ภาษาไทย)/ตัวเลข · สลับทิศทาง · เรียงเลขเป็นตัวเลขไม่ใช่ข้อความ', () => {
    const k = mk();
    assert.deepStrictEqual(k.view(rows()).map(r => r.id), ['660001', '660002', '660010']);
    k.st.sort = 'n'; assert.deepStrictEqual(k.view(rows()).map(r => r.n), ['กานดา', 'นภา', 'สมชาย']);
    k.st.dir = -1; assert.deepStrictEqual(k.view(rows()).map(r => r.n), ['สมชาย', 'นภา', 'กานดา']);
    k.st.sort = 'c'; k.st.dir = 1; assert.deepStrictEqual(k.view(rows()).map(r => r.c), [2, 3, 10]);
  });
  test('ค้นหา: ไม่สนตัวพิมพ์ · ตรงบางส่วน · ว่าง = ทั้งหมด · ไม่แก้ข้อมูลต้นทาง', () => {
    const k = mk(), all = rows();
    k.st.q = '6600'; assert.strictEqual(k.view(all).length, 3);
    k.st.q = 'กาน'; assert.deepStrictEqual(k.view(all).map(r => r.id), ['660002']);
    k.st.q = 'zzz'; assert.strictEqual(k.view(all).length, 0);
    k.st.q = ''; assert.strictEqual(k.view(all).length, 3); assert.strictEqual(all[0].id, '660010');
  });
  test('ที่เลือก: selected เฉพาะที่ยังอยู่ · prune ตัดรายการที่หายแล้ว · clear', () => {
    const k = mk(), all = rows();
    k.st.sel = { '660010': 1, '660002': 1, 'gone': 1 };
    assert.strictEqual(k.selected(all).length, 2);
    k.prune(all); assert.deepStrictEqual(Object.keys(k.st.sel).sort(), ['660002', '660010']);
    k.clear(); assert.strictEqual(Object.keys(k.st.sel).length, 0);
  });
  test('cb: ช่องติ๊กมีรหัสและสถานะที่เลือก', () => {
    const k = mk(); k.st.sel = { '660001': 1 };
    assert.ok(/data-lk-pick="660001"[^>]*checked/.test(k.cb({ id: '660001' }, 'นภา')));
    assert.ok(!/checked/.test(k.cb({ id: '660002' })));
  });
  await atest('batch: ทำทีละรายการตามลำดับ · บางรายการล้มไม่หยุด · สรุป ok/failed · รายงานความคืบหน้า', async () => {
    const order = [], prog = [];
    const r = await L.batch(['a', 'b', 'c', 'd'], id => { order.push(id); return id === 'b' || id === 'd' ? Promise.reject(new Error('x' + id)) : Promise.resolve(); }, (i, n) => prog.push(i + '/' + n));
    assert.deepStrictEqual(order, ['a', 'b', 'c', 'd']); assert.strictEqual(r.ok, 2);
    assert.strictEqual(JSON.stringify(r.failed.map(f => f.id)), '["b","d"]'); assert.strictEqual(r.failed[0].err.message, 'xb');
    assert.deepStrictEqual(prog, ['1/4', '2/4', '3/4', '4/4']);
  });

  console.log('\nไฟล์ JS ของหน้าเว็บ');
  test('ทุกไฟล์ใน web/assets/*.js มีไวยากรณ์ถูกต้อง', () => {
    const bad = [];
    fs.readdirSync(dir).filter(f => f.endsWith('.js')).forEach(f => { try { new vm.Script(fs.readFileSync(path.join(dir, f), 'utf8'), { filename: f }); } catch (e) { bad.push(f + ': ' + e.message); } });
    assert.deepStrictEqual(bad, []);
  });
  test('หน้า HTML ที่ใช้ listkit โหลดสคริปต์ listkit.js (students/exam/att/asg)', () => {
    ['students', 'exam', 'att', 'asg'].forEach(p => assert.ok(fs.readFileSync(path.join(__dirname, '..', 'web', 't', p + '.html'), 'utf8').includes('assets/listkit.js'), p));
  });

  test('ทุกหน้า HTML โหลดสคริปต์ช่วย (listkit/csv/backup-lib) ครบตามที่สคริปต์ของหน้านั้นเรียกใช้', () => {
    const root = path.join(__dirname, '..', 'web'), bad = [];
    const need = { 'HBT.listKit': 'listkit.js', 'HBT.csv': 'csv.js', 'HBT.backup': 'backup-lib.js' };
    const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.html') ? [path.join(d, e.name)] : []);
    walk(root).forEach(h => {
      const html = fs.readFileSync(h, 'utf8');
      const loaded = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => path.basename(m[1]));
      loaded.forEach(js => {
        const f = path.join(dir, js); if (!fs.existsSync(f)) return;
        if (['csv.js', 'listkit.js', 'backup-lib.js'].includes(js)) return;
        const src = fs.readFileSync(f, 'utf8');
        Object.keys(need).forEach(k => { if (src.includes(k) && !loaded.includes(need[k])) bad.push(path.relative(root, h) + ' ใช้ ' + k + ' ใน ' + js + ' แต่ไม่โหลด ' + need[k]); });
      });
    });
    assert.deepStrictEqual(bad, []);
  });
  test('HBT.qs อยู่ใน ui.js (ไม่พึ่ง csv.js)', () => {
    assert.ok(fs.readFileSync(path.join(dir, 'ui.js'), 'utf8').includes('HBT.qs = '));
    assert.ok(!fs.readFileSync(path.join(dir, 'csv.js'), 'utf8').includes('HBT.qs = '));
  });

  console.log('\n' + (fail ? '✘ มีข้อล้มเหลว ' + fail + ' ข้อ: ' + failures.join(' | ') : '✔ ผ่านทั้งหมด (' + pass + ' ผ่าน)'));
  process.exit(fail ? 1 : 0);
})();
