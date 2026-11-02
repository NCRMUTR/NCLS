'use strict';
/* เซิร์ฟเวอร์จำลอง Core API สำหรับทดสอบ: ทุกคำขอ = "execution ใหม่" บน state เดียวกัน (เหมือน Apps Script จริง)
 * Google tokeninfo จำลองด้วย state.google[idToken] = { code, body } */
const { makeState, makeEnv } = require('./gas_stub.js');
const path = require('path');

const GAS_DIR = ['../gas', '../core/gas'].map(p => path.resolve(__dirname, p)).find(p => require('fs').existsSync(p));

function create(opts) {
  opts = opts || {};
  const state = makeState();
  state.google = {};
  state.alias = {};
  state.fetchHandler = (url) => {
    const m = url.match(/id_token=([^&]+)/);
    const tok = m ? decodeURIComponent(m[1]) : '';
    const g = state.google[tok];
    if (!g) return { code: 400, body: '{"error":"invalid_token"}' };
    if (g instanceof Error) return g;
    return g;
  };
  const CLIENT_ID = '1234-test.apps.googleusercontent.com';

  function ctx() { return makeEnv(state, GAS_DIR); }

  /** รัน setupCore ด้วยค่าที่กำหนด */
  function setup(over) {
    const c = ctx();
    Object.assign(c.SETUP, { GOOGLE_CLIENT_ID: CLIENT_ID, DOMAIN: 'rmutr.ac.th', FIRST_ADMIN_EMAIL: 'admin@rmutr.ac.th', FIRST_ADMIN_NAME: 'ผู้ดูแล' }, over || {});
    return c.setupCore();
  }

  function tokeninfoBody(claims) {
    const now = Math.floor(Date.now() / 1000);
    return Object.assign({
      aud: CLIENT_ID, iss: 'https://accounts.google.com', exp: String(now + 3000),
      email_verified: 'true', hd: 'rmutr.ac.th', name: 'Test User'
    }, claims);
  }
  /** ลงทะเบียน JWT ที่กำหนดเอง (e2e สร้าง JWT เอง) → คำตอบ tokeninfo ตามที่ระบุ */
  function googleTokenExact(jwt, claims, over) {
    state.google[jwt] = Object.assign({ code: 200, body: JSON.stringify(tokeninfoBody(claims)) }, over || {});
    return jwt;
  }
  /** ลงทะเบียน Google token จำลองด้วยชื่อย่อ → คืน JWT ที่ใช้ส่งจริง */
  function googleToken(key, claims, over) {
    const now = Math.floor(Date.now() / 1000);
    const body = tokeninfoBody(claims);
    // token จริงของ Google เป็น JWT: ใส่ aud/exp ที่ "ดูเข้าท่า" ไว้ใน payload เสมอ (ผ่านด่านกรองเบื้องต้น)
    // ส่วนค่าที่ใช้ทดสอบการตรวจจริงอยู่ในคำตอบ tokeninfo (body) ซึ่งแก้ได้ผ่าน claims
    const payload = Buffer.from(JSON.stringify({ aud: CLIENT_ID, exp: now + 3000, email: body.email })).toString('base64url');
    const jwt = 'h.' + payload + '.' + key;
    state.google[jwt] = Object.assign({ code: 200, body: JSON.stringify(body) }, over || {});
    state.alias[key] = jwt;
    return jwt;
  }

  /** ส่งคำขอ (วัตถุ หรือข้อความดิบ) → วัตถุคำตอบ */
  function call(body) {
    const c = ctx();
    if (body && typeof body === 'object' && body.args && typeof body.args.idToken === 'string' && state.alias[body.args.idToken]) {
      body = Object.assign({}, body, { args: Object.assign({}, body.args, { idToken: state.alias[body.args.idToken] }) });   // ชื่อย่อในเทสต์ → JWT
    }
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    const out = c.doPost({ postData: { contents: raw } });
    return JSON.parse(out.text);
  }
  function raw(body) {
    const c = ctx();
    return c.doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text;
  }
  function get() { return JSON.parse(ctx().doGet().text); }

  /** ล็อกอินด้วยอีเมลที่ระบุ → token ระบบ */
  let n = 0;
  function login(email, name) {
    const key = 'G' + (++n);
    googleToken(key, { email: email, name: name || 'Test' });
    const r = call({ action: 'auth.login', args: { idToken: key } });
    return r;
  }
  function tokenOf(email) {
    const r = login(email);
    if (!r.ok) throw new Error('login failed for ' + email + ': ' + JSON.stringify(r));
    return r.data.token;
  }
  function api(token, action, args, opId) {
    return call({ action: action, token: token, args: args || {}, opId: opId });
  }
  function rows(sheet) {
    const sh = state.sheets[sheet];
    if (!sh) return [];
    return sh.data.slice(1).filter(r => r.some(v => v !== '' && v !== undefined));
  }
  function advance(min) { state.clockMs += min * 60000; }
  return { advance, state, ctx, setup, googleToken, googleTokenExact, call, raw, get, login, tokenOf, api, rows, CLIENT_ID };
}

module.exports = { create, GAS_DIR };
