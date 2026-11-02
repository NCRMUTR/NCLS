'use strict';
/* เซิร์ฟเวอร์ทดสอบ e2e: เสิร์ฟ core/web + POST /api = doPost ของ GAS (stub) + ปุ่มควบคุมสำหรับเตรียมข้อมูล */
const http = require('http'), fs = require('fs'), path = require('path');
const { createPair } = require('./pair.js');
const WEB = ['../web', '../core/web'].map(p => path.resolve(__dirname, p)).find(p => fs.existsSync(p));
let P = createPair(), S = P.core;
let apiCount = 0;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json' };

function body(req) { return new Promise(r => { let b = ''; req.on('data', d => b += d); req.on('end', () => r(b)); }); }
function send(res, code, text, type) { res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(text); }

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/api') { apiCount++; return send(res, 200, S.raw(await body(req))); }
    if (req.method === 'POST' && url.pathname === '/__reset') {
      const o = JSON.parse((await body(req)) || '{}'); P = createPair({ setup: o.setup || {} }); S = P.core; apiCount = 0; return send(res, 200, '{"ok":true}');
    }
    if (req.method === 'POST' && url.pathname === '/__google') {
      const o = JSON.parse(await body(req)); S.googleTokenExact(o.key, o.claims, o.over); return send(res, 200, '{"ok":true}');
    }
    if (req.method === 'POST' && url.pathname === '/__seed') {      // {as, action, args}
      const o = JSON.parse(await body(req)); const t = S.tokenOf(o.as); return send(res, 200, JSON.stringify(S.api(t, o.action, o.args || {})));
    }
    if (req.method === 'POST' && url.pathname === '/__token') {      // ขอ token ระบบของอีเมล (ใช้ปลอมเซสชัน)
      const o = JSON.parse(await body(req)); return send(res, 200, JSON.stringify({ token: S.tokenOf(o.email) }));
    }
    if (req.method === 'POST' && url.pathname === '/__advance') {     // เลื่อนนาฬิกา server จำลอง (นาที)
      const o = JSON.parse(await body(req)); P.advance(Number(o.min) || 0); return send(res, 200, '{"ok":true}');
    }
    if (req.method === 'POST' && url.pathname === '/exam') return send(res, 200, P.ex.raw(await body(req)));          // Exam API (Web App แยก)
    if (req.method === 'POST' && url.pathname === '/__exseed') {      // {as, action, args} เรียก Exam ด้วย token อาจารย์
      const o = JSON.parse(await body(req)); return send(res, 200, JSON.stringify(P.ex.api(S.tokenOf(o.as), o.action, o.args || {})));
    }
    if (req.method === 'POST' && url.pathname === '/__mode') {        // {exam?:'ok'|'down'|'html', core?:...}
      const o = JSON.parse(await body(req)); Object.assign(P.mode, o); return send(res, 200, '{"ok":true}');
    }
    if (req.method === 'POST' && url.pathname === '/__tick') return send(res, 200, JSON.stringify(P.ex.tick()));
    if (req.method === 'GET' && url.pathname === '/__exrows') return send(res, 200, JSON.stringify(P.ex.rows(url.searchParams.get('sheet'))));
    if (req.method === 'GET' && url.pathname === '/__exdrive') {
      const D = P.exState.drv;
      return send(res, 200, JSON.stringify({ files: Object.keys(D.files).map(k => ({ id: k, trashed: D.files[k].trashed, size: D.files[k].buf.length })) }));
    }
    if (req.method === 'GET' && url.pathname === '/__rows') {
      return send(res, 200, JSON.stringify(S.rows(url.searchParams.get('sheet'))));
    }
    if (req.method === 'GET' && url.pathname === '/__drive') {        // สถานะ Drive จำลอง
      const D = S.state.drv;
      return send(res, 200, JSON.stringify({ files: Object.keys(D.files).map(k => ({ id: k, name: D.files[k].name, size: D.files[k].buf.length, mime: D.files[k].mime, trashed: D.files[k].trashed, head: D.files[k].buf.slice(0, 4).toString('hex') })), folders: Object.keys(D.folders).map(k => Object.assign({ id: k }, D.folders[k])) }));
    }
    if (req.method === 'GET' && url.pathname === '/__count') return send(res, 200, JSON.stringify({ apiCount }));
    if (req.method === 'GET') {
      let p = decodeURIComponent(url.pathname); if (p === '/') p = '/index.html';
      const f = path.resolve(WEB, '.' + p);
      if (!f.startsWith(WEB + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) return send(res, 404, 'not found', 'text/plain');
      return send(res, 200, fs.readFileSync(f), TYPES[path.extname(f)] || 'application/octet-stream');
    }
    send(res, 404, 'not found', 'text/plain');
  } catch (e) { send(res, 500, JSON.stringify({ err: String(e && e.stack || e) })); }
}).listen(0, '127.0.0.1', function () { console.log('READY ' + this.address().port); });
