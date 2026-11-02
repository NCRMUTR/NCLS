'use strict';
const crypto = require('crypto');
const vm = require('vm');
const fs = require('fs');
const path = require('path');

function colLetter() {}

function makeState() {
  return { sheets: {}, order: [], props: {}, cache: {}, ssId: null, drive: {}, drv: { folders: {}, files: {}, n: 0, failCreate: false, failFolder: false }, ops: 0, clockMs: 0 };
}

function makeEnv(state, srcDir) {
  const pad = (n, w = 2) => String(n).padStart(w, '0');
  const fmtDate = (d, tz, f) => f
    .replace('yyyy', d.getFullYear()).replace('MM', pad(d.getMonth() + 1)).replace('dd', pad(d.getDate()))
    .replace('HH', pad(d.getHours())).replace('mm', pad(d.getMinutes())).replace('ss', pad(d.getSeconds()));

  class Range {
    constructor(sh, r, c, nr, nc) { this.sh = sh; this.r = r; this.c = c; this.nr = nr || 1; this.nc = nc || 1; }
    getValues() {
      state.ops++;
      const out = [];
      for (let i = 0; i < this.nr; i++) {
        const row = [];
        for (let j = 0; j < this.nc; j++) {
          const rr = this.sh.data[this.r - 1 + i];
          const v = rr ? rr[this.c - 1 + j] : '';
          row.push(v === undefined || v === null ? '' : v);
        }
        out.push(row);
      }
      return out;
    }
    setValues(vals) {
      state.ops++;
      for (let i = 0; i < vals.length; i++) {
        const rowIdx = this.r - 1 + i;
        while (this.sh.data.length <= rowIdx) this.sh.data.push([]);
        for (let j = 0; j < vals[i].length; j++) this.sh.data[rowIdx][this.c - 1 + j] = vals[i][j];
      }
      return this;
    }
    setValue(v) { return this.setValues([[v]]); }
    setNumberFormats() { return this; } setNumberFormat() { return this; }
    setFontFamily() { return this; } setFontWeight() { return this; } setFontSize() { return this; }
    setBackground() { return this; } setFontColor() { return this; } setVerticalAlignment() { return this; } setWrap() { return this; }
    getRow() { return this.r; }
    createTextFinder(text) {
      const self = this; let entire = false;
      const f = {
        matchEntireCell(b) { entire = b; return f; },
        matchCase(b) { return f; },
        _hits() {
          const hits = [];
          for (let i = 0; i < self.nr; i++) {
            const rr = self.sh.data[self.r - 1 + i];
            const v = rr ? rr[self.c - 1] : '';
            const s = (v === undefined || v === null) ? '' : String(v);
            if (entire ? s === String(text) : s.indexOf(String(text)) > -1) hits.push(new Range(self.sh, self.r + i, self.c, 1, 1));
          }
          return hits;
        },
        findNext() { state.ops++; return f._hits()[0] || null; },
        findAll() { state.ops++; return f._hits(); }
      };
      return f;
    }
  }
  class Sheet {
    constructor(name) { this.name = name; this.data = []; this.maxRows = 1000; this.maxCols = 26; this.frozen = 0; }
    getMaxColumns() { return this.maxCols; } insertColumnsAfter(a, n) { this.maxCols += n; }
    getMaxRows() { return this.maxRows; } insertRowsAfter(a, n) { this.maxRows += n; }
    getLastColumn() { let m = 0; this.data.forEach(r => { for (let i = r.length - 1; i >= 0; i--) if (r[i] !== '' && r[i] !== undefined) { m = Math.max(m, i + 1); break; } }); return m; }
    getLastRow() { for (let i = this.data.length - 1; i >= 0; i--) if (this.data[i].some(v => v !== '' && v !== undefined && v !== null)) return i + 1; return 0; }
    getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
    getFrozenRows() { return this.frozen; } setFrozenRows(n) { this.frozen = n; }
    setColumnWidth() {}
    appendRow(vals) { state.ops++; const r = this.getLastRow(); while (this.data.length <= r) this.data.push([]); this.data[r] = vals.slice(); }
    deleteRow(r) { this.data.splice(r - 1, 1); }
    deleteRows(r, n) { this.data.splice(r - 1, n); }
  }
  class Spreadsheet {
    constructor() { this.id = 'SS' + crypto.randomBytes(8).toString('hex') + 'xxxxxxxxxxxx'; }
    getId() { return this.id; }
    setSpreadsheetTimeZone() {}
    getSheetByName(n) { return state.sheets[n] || null; }
    insertSheet(n) { const s = new Sheet(n); state.sheets[n] = s; state.order.push(n); return s; }
    getSheets() { return state.order.map(n => state.sheets[n]); }
    deleteSheet(s) { delete state.sheets[s.name]; state.order = state.order.filter(n => n !== s.name); }
  }
  const theSS = new Spreadsheet();
  state.ssId = state.ssId || theSS.id;

  const CHAR_LIMIT_BYTES = 100 * 1024;
  // แคชมี TTL จริง (ตามนาฬิกาจำลอง state.clockMs) — ค่าใน state.cache ยังเป็นข้อความธรรมดา (เทสต์เก่าอ่านตรงได้) หมดอายุเก็บแยกใน state.cacheExp
  state.cacheExp = state.cacheExp || {};
  const nowMs = () => Date.now() + state.clockMs;
  const alive = k => k in state.cache && !(state.cacheExp[k] && state.cacheExp[k] < nowMs());
  const cacheApi = {
    get: k => (alive(k) ? state.cache[k] : null),
    put: (k, v, sec) => { if (Buffer.byteLength(String(v), 'utf8') > CHAR_LIMIT_BYTES) throw new Error('Argument too large: value'); state.cache[k] = String(v); state.cacheExp[k] = nowMs() + (sec ? Math.min(sec, 21600) : 600) * 1000; },
    getAll: ks => { const o = {}; ks.forEach(k => { if (alive(k)) o[k] = state.cache[k]; }); return o; },
    putAll: (m, sec) => { Object.keys(m).forEach(k => cacheApi.put(k, m[k], sec)); },
    remove: k => { delete state.cache[k]; delete state.cacheExp[k]; },
    removeAll: ks => ks.forEach(k => cacheApi.remove(k))
  };

  // นาฬิกาจำลอง: state.clockMs = ระยะเลื่อนเวลา (ms) ใช้กับ Date.now() และ new Date() ที่ไม่ใส่อาร์กิวเมนต์ ภายในสคริปต์ GAS เท่านั้น
  class FakeDate extends Date {
    constructor(...a) { if (a.length === 0) super(Date.now() + state.clockMs); else super(...a); }
    static now() { return Date.now() + state.clockMs; }
  }
  const sandbox = {
    console, Date: FakeDate, Math, JSON, Object, Array, String, Number, Boolean, RegExp, Error, isNaN, parseInt, parseFloat,
    SpreadsheetApp: {
      create: () => theSS,
      openById: () => theSS
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperties: () => Object.assign({}, state.props),
      setProperty: (k, v) => { state.props[k] = String(v); },
      setProperties: (m) => { Object.keys(m).forEach(k => { state.props[k] = String(m[k]); }); },
      deleteProperty: k => { delete state.props[k]; }
    }) },
    CacheService: { getScriptCache: () => cacheApi },
    LockService: { getScriptLock: () => ({ tryLock: () => { state.lockCount = (state.lockCount || 0) + 1; return true; }, releaseLock: () => {} }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      sleep: () => {},
      formatDate: fmtDate,
      computeDigest: (alg, str) => Array.from(crypto.createHash('sha256').update(String(str), 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      base64Decode: s => Array.from(Buffer.from(s, 'base64')),
      base64EncodeWebSafe: bytes => Buffer.from(bytes.map(b => b & 255)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => Array.from(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')).map(b => b > 127 ? b - 256 : b),
      computeHmacSha256Signature: (value, key) => Array.from(crypto.createHmac('sha256', String(key)).update(String(value), 'utf8').digest()).map(b => b > 127 ? b - 256 : b),
      base64Encode: bytes => Buffer.from(Array.from(bytes).map(b => b & 255)).toString('base64'),
      newBlob: (data, mime, name) => {
        const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from((data || []).map(b => b & 255));
        return { getBytes: () => Array.from(buf).map(b => b > 127 ? b - 256 : b), getDataAsString: () => buf.toString('utf8'), getContentType: () => mime || '', getName: () => name || '' };
      },
      parseCsv: (text) => {
        const rows = []; let row = [], cur = '', q = false;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
          else if (ch === '"') q = true;
          else if (ch === ',') { row.push(cur); cur = ''; }
          else if (ch === '\n') { row.push(cur); rows.push(row); row = []; cur = ''; }
          else if (ch !== '\r') cur += ch;
        }
        if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
        return rows;
      }
    },
    DriveApp: (() => {
      // Drive จำลองในหน่วยความจำ: โฟลเดอร์/ไฟล์/ถังขยะ + สวิตช์ทำให้ล้มเหลว (failFolder / failCreate)
      const D = state.drv;
      const sgn = buf => Array.from(buf).map(b => b > 127 ? b - 256 : b);
      const mkBlob = (buf, mime, name) => ({ getBytes: () => sgn(buf), getContentType: () => mime || '', getName: () => name || '' });
      const folderObj = id => ({
        getId: () => id,
        setTrashed: t => { D.folders[id].trashed = !!t; },
        createFolder: name => { if (D.failFolder) throw new Error('Drive down'); const fid = 'FLD' + (++D.n); D.folders[fid] = { name, parent: id, trashed: false }; return folderObj(fid); },
        createFile: blob => {
          if (D.failCreate) throw new Error('Service invoked too many times: Drive');
          const fid = 'FIL' + (++D.n); const bytes = blob.getBytes();
          D.files[fid] = { name: blob.getName ? blob.getName() : '', mime: blob.getContentType ? blob.getContentType() : '', buf: Buffer.from(bytes.map(b => b & 255)), folder: id, trashed: false };
          if (D.onCreate) { const h = D.onCreate; D.onCreate = null; h(); }
          return fileObj(fid);
        }
      });
      const fileObj = id => ({
        getId: () => id,
        getName: () => D.files[id].name,
        setTrashed: t => { D.files[id].trashed = !!t; },
        setSharing: () => {},
        getBlob: () => mkBlob(D.files[id].buf, D.files[id].mime, D.files[id].name)
      });
      return {
        getFolderById: id => { if (!D.folders[id]) throw new Error('No item with the given ID could be found'); return folderObj(id); },
        getFoldersByName: name => { const ids = Object.keys(D.folders).filter(k => D.folders[k].name === name && !D.folders[k].trashed && !D.folders[k].parent); let i = 0; return { hasNext: () => i < ids.length, next: () => folderObj(ids[i++]) }; },
        createFolder: name => { if (D.failFolder) throw new Error('Drive down'); const fid = 'FLD' + (++D.n); D.folders[fid] = { name, parent: '', trashed: false }; return folderObj(fid); },
        getFileById: id => { if (!D.files[id]) throw new Error('No item with the given ID could be found'); return fileObj(id); },
        Access: {}, Permission: {}
      };
    })(),
    // Drive advanced service (Drive.Files.remove = ลบถาวรข้ามถังขยะ) · D.noAdvanced = จำลองว่าไม่ได้เปิดบริการ · D.slowMs = แต่ละครั้งใช้เวลาเท่านี้ (นาฬิกาจำลอง)
    Drive: { Files: { remove: id => {
      const D = state.drv;
      if (D.noAdvanced) throw new Error('ReferenceError: Drive is not defined');
      if (D.failRemove) throw new Error('Service error: Drive');
      if (D.slowMs) state.clockMs += D.slowMs;
      D.removeCalls = (D.removeCalls || 0) + 1;
      if (D.files[id]) { delete D.files[id]; return; }
      if (D.folders[id]) {
        const kill = fid => { Object.keys(D.files).forEach(k => { if (D.files[k].folder === fid) delete D.files[k]; }); Object.keys(D.folders).forEach(k => { if (D.folders[k].parent === fid) { kill(k); delete D.folders[k]; } }); };
        kill(id); delete D.folders[id]; return;
      }
      throw new Error('File not found: ' + id);
    } } },
    ScriptApp: {
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/AAA/exec' }),
      getProjectTriggers: () => (state.triggers || []).map(h => ({ getHandlerFunction: () => h })),
      newTrigger: (h) => ({ timeBased() { return this; }, everyMinutes() { return this; }, create() { (state.triggers = state.triggers || []).push(h); } })
    },
    MailApp: { sendEmail: () => {} },
    UrlFetchApp: { fetch: (url, opts) => {
      state.fetchLog = state.fetchLog || []; state.fetchLog.push(url);
      if (!state.fetchHandler) throw new Error('no fetch handler');
      const r = state.fetchHandler(url, opts);
      if (r instanceof Error) throw r;
      return { getResponseCode: () => r.code, getContentText: () => r.body };
    } },
    ContentService: { MimeType: { JSON: 'JSON' }, createTextOutput: (t) => ({ text: t, setMimeType() { return this; } }) },
    HtmlService: {}, Logger: { log: () => {} }
  };
  const ctx = vm.createContext(sandbox);
  const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.gs')).sort((a, b) => (a === 'Util.gs' ? -1 : b === 'Util.gs' ? 1 : a.localeCompare(b)));
  // Code.gs defines APP; order doesn't matter for function declarations, but `var X = ...` objects referencing others only at call time.
  const src = files.map(f => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n;\n');
  vm.runInContext(src, ctx, { filename: 'gas-all.js' });
  return ctx;
}
module.exports = { makeState, makeEnv };
