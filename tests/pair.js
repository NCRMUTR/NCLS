'use strict';
/* ตัวจำลอง 2 ระบบคุยกัน: Core (GAS #1) ↔ Exam API (GAS #2) — แต่ละระบบมี state/ชีต/ScriptProperties/แคช/Drive ของตัวเอง
 * UrlFetchApp ของแต่ละฝั่งถูกต่อสายไปยัง doPost ของอีกฝั่งแบบสั่งการทันที (เหมือน GAS เรียก GAS)
 * สวิตช์ทดสอบ: pair.mode.exam / pair.mode.core = 'ok' | 'down' (เน็ตหลุด) | 'html' (ได้หน้า HTML แทน JSON) | 'busy' (E_BUSY n ครั้งแรก) */
const path = require('path');
const { create } = require('./core_server.js');
const { makeState, makeEnv } = require('./gas_stub.js');

const EXAM_DIR = ['../exam/gas', '../exam'].map(p => path.resolve(__dirname, p)).find(p => require('fs').existsSync(path.join(p, 'Router.gs')));
const CORE_URL = 'https://script.google.com/macros/s/AKcore/exec';
const EXAM_URL = 'https://script.google.com/macros/s/AKexam/exec';

function createPair(opts) {
  opts = opts || {};
  const core = create();
  const exState = makeState();
  const pair = { core, EXAM_URL, CORE_URL, mode: { exam: 'ok', core: 'ok' }, busy: { exam: 0, core: 0 }, calls: { toExam: [], toCore: [] } };
  pair.exState = exState;

  const exCtx = () => makeEnv(exState, EXAM_DIR);
  const exRaw = body => exCtx().doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text;

  function wire(side, handler) {
    return (url, o) => {
      const other = side === 'core' ? 'exam' : 'core';
      const m = pair.mode[other];
      (side === 'core' ? pair.calls.toExam : pair.calls.toCore).push(o && o.payload ? JSON.parse(o.payload) : null);
      if (m === 'down') return new Error('DNS error: ' + url);
      if (m === 'html') return { code: 200, body: '<html><body>Sign in</body></html>' };
      if (pair.busy[other] > 0) { pair.busy[other]--; return { code: 200, body: JSON.stringify({ ok: false, error: { code: 'E_BUSY', msg: 'busy' } }) }; }
      return handler(o.payload);
    };
  }
  // Core → Exam
  const prev = core.state.fetchHandler;
  const toExam = wire('core', payload => ({ code: 200, body: exRaw(payload) }));
  core.state.fetchHandler = (url, o) => url === EXAM_URL ? toExam(url, o) : prev(url, o);
  // Exam → Core
  const toCore = wire('exam', payload => ({ code: 200, body: core.raw(payload) }));
  exState.fetchHandler = (url, o) => { if (url === CORE_URL) return toCore(url, o); throw new Error('unexpected fetch ' + url); };

  core.setup(Object.assign({ EXAM_URL: opts.noExamUrl ? '' : EXAM_URL }, opts.setup || {}));
  const c = exCtx();
  Object.assign(c.SETUP, { CORE_URL, SEC_TOKEN: opts.badSecret ? 'x'.repeat(64) : core.state.props.SEC_TOKEN });
  c.setupExam();

  pair.ex = {
    state: exState, ctx: exCtx, raw: exRaw,
    call: body => JSON.parse(exRaw(body)),
    api: (token, action, args, opId) => JSON.parse(exRaw({ action, token, args: args || {}, opId })),
    get: () => JSON.parse(exCtx().doGet().text),
    rows: sheet => { const sh = exState.sheets[sheet]; return sh ? sh.data.slice(1).filter(r => r.some(v => v !== '' && v !== undefined)) : []; },
    tick: () => exCtx().tick_()
  };
  pair.advance = min => { core.advance(min); exState.clockMs += min * 60000; };
  return pair;
}
module.exports = { createPair, EXAM_URL, CORE_URL };
