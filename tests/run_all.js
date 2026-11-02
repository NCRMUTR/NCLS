'use strict';
/* รันชุดทดสอบฝั่งเซิร์ฟเวอร์ทั้งหมด (ไม่ต้องติดตั้งอะไร ใช้ Node ≥ 18) — ต้องผ่านทั้งหมดก่อน push ทุกครั้ง
 *   node tests/run_all.js
 * ชุดทดสอบเบราว์เซอร์ (tests/e2e_*.py) แยก: ต้องมี Python + Playwright ดู README ท้ายไฟล์ */
const { spawnSync } = require('child_process');
const path = require('path');
const jobs = [
  ['core_test.js'], ['core_test2.js'], ['core_test3.js'], ['core_test4.js'], ['core_test5.js'], ['core_test6.js'], ['core_test7.js'],
  ['load_order.js', '../gas', '100'], ['load_order.js', '../exam', '100']
];
let bad = 0;
for (const [file, ...args] of jobs) {
  const r = spawnSync(process.execPath, [path.join(__dirname, file), ...args], { cwd: __dirname, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const lines = (r.stdout || '').trim().split('\n');
  const last = lines[lines.length - 1] || '';
  const ok = r.status === 0;
  if (!ok) bad++;
  console.log((ok ? '✔ ' : '✘ ') + [file].concat(args).join(' ').padEnd(34) + last.replace(/\s+/g, ' ').slice(0, 90));
  if (!ok) console.log((r.stdout || '').split('\n').filter(l => /✘/.test(l)).slice(0, 12).join('\n') + '\n' + (r.stderr || '').slice(0, 600));
}
console.log(bad ? '\n✘ ล้ม ' + bad + ' ชุด — ห้าม push' : '\n✔ ผ่านทุกชุด');
process.exit(bad ? 1 : 0);
