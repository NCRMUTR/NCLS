// โหลดไฟล์ .gs แต่ละไฟล์เป็นสคริปต์แยก (เหมือน Apps Script V8) ในลำดับสุ่ม แล้วดูว่าไฟล์ไหนพังตอนโหลด
const fs = require('fs'), vm = require('vm'), path = require('path');
const dir = path.resolve(process.argv[2]), rounds = +process.argv[3] || 200;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.gs'));
const srcs = Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
function shuffle(a, seed) { a = a.slice(); let s = seed; const r = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const bad = {};
const orders = [files.slice().sort(), files.slice().sort().reverse()];
for (let i = 0; i < rounds; i++) orders.push(shuffle(files, i + 1));
for (const ord of orders) {
  const ctx = vm.createContext({ console, Logger: { log() {} }, PropertiesService: {}, SpreadsheetApp: {}, CacheService: {}, LockService: {}, Utilities: {}, Session: {}, UrlFetchApp: {}, ScriptApp: {}, DriveApp: {}, Drive: {}, HtmlService: {}, ContentService: {} });
  for (const f of ord) {
    try { vm.runInContext(srcs[f], ctx, { filename: f }); }
    catch (e) { const k = f + ' :: ' + e.message; (bad[k] = bad[k] || []).push(ord.indexOf(f)); }
  }
}
const keys = Object.keys(bad);
console.log(path.basename(dir) + ': โหลด ' + orders.length + ' ลำดับ ข้อผิดพลาดตอนโหลด ' + keys.length);
keys.forEach(k => console.log('  ', k, '×', bad[k].length));

if (keys.length) process.exit(1);
