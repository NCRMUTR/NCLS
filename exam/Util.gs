/**************************************************************
 * File: Util.gs  (HBT Exam API v0.5.0)
 * ฟังก์ชันช่วยกลาง: ซองคำตอบ (envelope), รหัสข้อผิดพลาด, lock, แคช, กันทำงานซ้ำ, CSV
 * ยกรูปแบบมาจาก EEOS v2.1.0 (ผ่านการทดสอบแล้ว) ปรับซองคำตอบให้เป็น
 *   { ok:true, data }  |  { ok:false, error:{ code, msg, detail } }
 **************************************************************/

var U = {

  /** ---------- Response envelope ---------- */
  ok: function (data) {
    return JSON.stringify({ ok: true, data: data === undefined ? null : data });
  },

  err: function (e) {
    var code = (e && e.code) || 'E_UNKNOWN';
    var msg = (e && e.message) || String(e);
    if (!msg || msg === code) msg = U.MSG[code] || code;
    if (!(e && e.code)) {
      // ข้อผิดพลาดที่ไม่ได้ตั้งใจ: ไม่ส่งรายละเอียดภายในให้ผู้ใช้
      try { console.error(String(e && e.stack || e)); } catch (x) {}
      msg = U.MSG.E_UNKNOWN;
    }
    return JSON.stringify({ ok: false, error: { code: code, msg: msg, detail: (e && e.detail) || null } });
  },

  E: function (code, detail, fallback) {
    var e = new Error(fallback || U.MSG[code] || code);
    e.code = code;
    e.detail = detail || null;
    return e;
  },

  MSG: {
    E_UNKNOWN: 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ',
    E_BAD_REQUEST: 'คำขอไม่ถูกต้อง',
    E_NOT_FOUND: 'ไม่พบข้อมูลที่ต้องการ',
    E_REQUIRED: 'กรอกข้อมูลไม่ครบ',
    E_BUSY: 'ระบบกำลังทำงานหนัก กรุณาลองใหม่อีกครั้ง',
    E_NOT_SETUP: 'ยังไม่ได้ตั้งค่าระบบสอบ กรุณาติดต่อผู้ดูแล',
    E_AUTH: 'หมดเวลาเข้าใช้งาน กรุณาเข้าสู่ระบบใหม่',
    E_FORBIDDEN: 'ไม่มีสิทธิ์ใช้งานส่วนนี้',
    E_DISABLED: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
    E_CORE_DOWN: 'เชื่อมต่อระบบกลางไม่ได้ ลองใหม่อีกครั้ง',
    E_IMG: 'รูปภาพไม่ถูกต้อง (รับ jpg / png / gif / webp ขนาดไม่เกิน 1 MB)',
    E_DRIVE: 'ใช้ที่เก็บไฟล์ (Drive) ไม่ได้ — ผู้ดูแลต้องรัน setupExam ใหม่เพื่ออนุญาตสิทธิ์ Drive',
    E_NO_QUESTIONS: 'แบบทดสอบนี้ยังไม่มีข้อสอบ',
    E_NO_STUDENTS: 'วิชานี้ยังไม่มีรายชื่อนักศึกษา',
    E_TIME_RANGE: 'เวลาปิดต้องอยู่หลังเวลาเริ่ม',
    E_TIME_REQUIRED: 'กรุณาระบุวันที่และเวลา',
    E_CHOICES_MIN: 'ต้องมีตัวเลือกอย่างน้อย 2 ตัวเลือก',
    E_CHOICES_MAX: 'ตัวเลือกได้มากที่สุด 5 ตัวเลือก',
    E_EMPTY_Q: 'กรุณากรอกคำถาม',
    E_EMPTY_CHOICE: 'มีตัวเลือกที่ยังว่างอยู่',
    E_CSV_EMPTY: 'ไฟล์ CSV ว่างเปล่า',
    E_BAD_LINK: 'ลิงก์ไม่ถูกต้องหรือถูกยกเลิกแล้ว',
    E_SESSION_NOT_OPEN: 'ยังไม่ถึงเวลาเริ่ม',
    E_SESSION_CLOSED: 'ปิดรับการทำแล้ว',
    E_STUDENT_NOT_FOUND: 'ไม่พบรายชื่อนี้ในรายวิชา',
    E_WRONG_COURSE: 'รอบนี้ไม่ใช่ของรายวิชาที่คุณเข้าสู่ระบบ',
    E_ATTEMPT_LIMIT: 'ทำครบจำนวนครั้งที่กำหนดแล้ว',
    E_ATTEMPT_DONE: 'การทำข้อสอบนี้จบแล้ว',
    E_NO_BACK: 'รอบนี้ไม่อนุญาตให้ย้อนกลับ',
    E_CORRUPT: 'ข้อมูลการทำข้อสอบเสียหาย กรุณาแจ้งอาจารย์',
    E_QUIZ_TITLE: 'กรุณาตั้งชื่อแบบทดสอบ',
    E_DUP_QUIZ: 'มีแบบทดสอบชื่อนี้ในวิชานี้แล้ว',
    E_QUIZ_REQUIRED: 'กรุณาเลือกแบบทดสอบ',
    E_QUIZ_IN_USE: 'แบบทดสอบนี้ถูกใช้ในรอบที่ยังไม่ได้ลบ กรุณาลบรอบนั้นก่อน',
    E_NOTHING_SELECTED: 'ยังไม่ได้เลือกข้อสอบ',
    E_SCORE_VALUE: 'กรุณากำหนดคะแนนเต็มที่จะบันทึกเข้ารายวิชา (มากกว่า 0 และไม่เกิน 1000)',
    E_SCORE_MODE: 'รูปแบบการบันทึกคะแนนไม่ถูกต้อง',
    E_TOO_LATE: 'เหลือเวลาในรอบนี้น้อยเกินไป ไม่สามารถเริ่มทำได้',
    E_ROUND_LOCKED: 'รอบนี้มีนักศึกษาทำแล้ว แก้ไขส่วนนี้ไม่ได้'
  },

  /** ---------- ID / เวลา ---------- */
  uid: function (prefix) {
    return (prefix || 'ID') + '-' + Utilities.getUuid().replace(/-/g, '').substring(0, 12).toUpperCase();
  },
  nowIso: function () { return U.fmt(new Date()); },
  fmt: function (d) {
    if (!d) return '';
    if (!(d instanceof Date)) d = U.toDate(d);
    if (!d || isNaN(d.getTime())) return '';
    return Utilities.formatDate(d, APP.TZ, 'yyyy-MM-dd HH:mm:ss');
  },
  toDate: function (v) {
    if (!v && v !== 0) return null;
    if (v instanceof Date) return v;
    var s = String(v).trim();
    if (!s) return null;
    s = s.replace('T', ' ');
    var m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ ]?(\d{2})?:?(\d{2})?:?(\d{2})?/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  },

  /** อ่านค่า cell เป็นข้อความโดยใช้ "ค่าจริง" (เลขยาวไม่กลายเป็น 1.23E+12) */
  cell2str: function (v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return U.fmt(v);
    if (typeof v === 'number') return (Math.floor(v) === v && Math.abs(v) < 1e15) ? v.toFixed(0) : String(v);
    if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
    return String(v);
  },

  /** ---------- ความปลอดภัย ---------- */
  hex: function (bytes) {
    return bytes.map(function (b) { var v = (b < 0 ? b + 256 : b).toString(16); return v.length === 1 ? '0' + v : v; }).join('');
  },
  sha256: function (str) {
    return U.hex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(str), Utilities.Charset.UTF_8));
  },
  /** เทียบข้อความแบบเวลาคงที่ (กัน timing attack ตอนตรวจลายเซ็น) */
  safeEq: function (a, b) {
    a = String(a); b = String(b);
    var d = a.length ^ b.length;
    var n = Math.max(a.length, b.length);
    for (var i = 0; i < n; i++) d |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
    return d === 0;
  },
  randomHex: function (nBytes) {
    var s = '';
    while (s.length < nBytes * 2) s += Utilities.getUuid().replace(/-/g, '');
    return s.substring(0, nBytes * 2);
  },

  /** ---------- JSON / ตรวจค่า ---------- */
  json: function (o) { try { return JSON.stringify(o); } catch (e) { return ''; } },
  parse: function (s, def) { try { return s ? JSON.parse(s) : def; } catch (e) { return def; } },
  req: function (v, name) {
    if (v === null || v === undefined || String(v).trim() === '') throw U.E('E_REQUIRED', { field: name }, 'กรุณากรอก: ' + name);
    return String(v).trim();
  },
  num: function (v, def) {
    var d = (def === undefined ? 0 : def);
    if (v === null || v === undefined) return d;
    var s = String(v).replace(/,/g, '').trim();
    if (s === '') return d;
    var n = Number(s);
    return isNaN(n) ? d : n;
  },
  bool: function (v) {
    var s = String(v).toUpperCase().trim();
    return s === 'TRUE' || s === '1' || s === 'YES' || s === 'Y' || v === true;
  },
  bstr: function (v) { return U.bool(v) ? 'TRUE' : 'FALSE'; },
  clip: function (s, max) {
    s = (s === null || s === undefined) ? '' : String(s);
    var m = max || 45000;
    return s.length > m ? s.substring(0, m) : s;
  },
  normEmail: function (v) { return String(v === null || v === undefined ? '' : v).trim().toLowerCase(); },
  isEmail: function (v) { return /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/.test(v); },

  /** ---------- CSV (ใช้ตั้งแต่ขั้นถัดไป) ---------- */
  csvCell: function (v, raw) {
    var s = (v === null || v === undefined) ? '' : String(v);
    // กัน CSV injection: ข้อความที่ขึ้นต้นด้วย = + - @ จะถูก Excel ตีความเป็นสูตร
    if (!raw && typeof v === 'string' && /^[=+\-@\t]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  },
  toCsv: function (rows, raw) {
    return '﻿' + rows.map(function (r) { return r.map(function (v) { return U.csvCell(v, raw); }).join(','); }).join('\r\n');
  },

  /** ---------- Lock (เรียกซ้อนกันได้ใน execution เดียว) ---------- */
  _held: false,
  lock: function (fn, ms) {
    if (U._held) return fn();
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(ms || 20000)) throw U.E('E_BUSY');
    U._held = true;
    try { return fn(); } finally {
      U._held = false;
      try { lock.releaseLock(); } catch (e) {}
    }
  },

  /** ---------- แคช (แบ่งชิ้นอัตโนมัติ: ขีดจำกัดนับเป็นไบต์ ภาษาไทยตัวละ 3 ไบต์) ---------- */
  CHUNK: 28000,
  MAX_CHUNKS: 40,
  cGet: function (key) {
    try {
      var c = CacheService.getScriptCache();
      var head = c.get(key);
      if (!head) return null;
      if (head.charAt(0) !== '#') return head;
      var n = Number(head.substring(1)), keys = [];
      for (var i = 0; i < n; i++) keys.push(key + '~' + i);
      var parts = c.getAll(keys), out = '';
      for (var j = 0; j < n; j++) {
        if (parts[key + '~' + j] === undefined) return null;
        out += parts[key + '~' + j];
      }
      return out;
    } catch (e) { return null; }
  },
  cPut: function (key, value, sec) {
    try {
      var c = CacheService.getScriptCache();
      var s = String(value), t = sec || 21600;
      if (s.length <= U.CHUNK && s.charAt(0) !== '#') { c.put(key, s, t); return true; }
      var n = Math.ceil(s.length / U.CHUNK);
      if (n > U.MAX_CHUNKS) return false;
      var map = {};
      for (var i = 0; i < n; i++) map[key + '~' + i] = s.substr(i * U.CHUNK, U.CHUNK);
      c.putAll(map, t);
      c.put(key, '#' + n, t);
      return true;
    } catch (e) { return false; }
  },
  cDel: function (key) {
    try {
      var c = CacheService.getScriptCache();
      var head = c.get(key);
      if (head && head.charAt(0) === '#') {
        var n = Number(head.substring(1)), keys = [];
        for (var i = 0; i < n; i++) keys.push(key + '~' + i);
        c.removeAll(keys);
      }
      c.remove(key);
    } catch (e) {}
  },

  /**
   * กันทำงานซ้ำ: ถ้าคำสั่ง opId เดียวกัน (ของผู้ใช้/คำสั่งเดียวกัน) เคยสำเร็จแล้ว คืนผลเดิมทันที
   * scope = ผู้เรียก + ชื่อคำสั่ง กัน opId ชนกันข้ามผู้ใช้
   */
  once: function (scope, opId, fn) {
    if (!opId) return { __raw: U.ok(fn()) };
    var key = 'OP_' + U.sha256(String(scope) + '|' + String(opId)).substring(0, 24);
    var hit = U.cGet(key);
    if (hit) return { __raw: hit };
    var raw = U.ok(fn());
    U.cPut(key, raw, 3600);
    return { __raw: raw };
  },

  /** ---------- Base64 แบบปลอดภัยกับ URL ---------- */
  b64u: function (bytes) { return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/, ''); },
  b64uToStr: function (s) {
    s = String(s);
    while (s.length % 4) s += '=';
    return Utilities.newBlob(Utilities.base64DecodeWebSafe(s)).getDataAsString('UTF-8');
  },
  strToB64u: function (str) { return U.b64u(Utilities.newBlob(String(str)).getBytes()); },

  /** ---------- สุ่ม / ปัดเศษ ---------- */
  shuffle: function (arr) {
    var a = arr.slice();
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  },
  round2: function (v) { return Math.round(Number(v) * 100) / 100; },
  sleep: function (ms) { try { Utilities.sleep(ms); } catch (e) {} },

  /** ---------- CSV นำเข้า: เดาตัวคั่น (, ; Tab) แล้วแปลงเป็น , ก่อนอ่าน ---------- */
  parseCsv: function (text) {
    if (!text) return [];
    var t = String(text).replace(/^\uFEFF/, '');
    var d = U.sniffDelimiter(t);
    if (d !== ',') t = U.swapDelimiter(t, d);
    try { return Utilities.parseCsv(t); } catch (e) { return Utilities.parseCsv(t, ','); }
  },
  sniffDelimiter: function (text) {
    var lines = String(text).split(/\r\n|\n/).filter(function (l) { return l.trim() !== ''; }).slice(0, 10);
    if (!lines.length) return ',';
    var best = ',', bestScore = -1;
    [',', ';', '\t'].forEach(function (d) {
      var counts = lines.map(function (l) { return U.countOutsideQuotes(l, d); });
      if (!counts.some(function (c) { return c > 0; })) return;
      var max = Math.max.apply(null, counts);
      var consistent = counts.filter(function (c) { return c === max; }).length;
      var score = consistent * 10 + max;
      if (score > bestScore) { bestScore = score; best = d; }
    });
    return best;
  },
  countOutsideQuotes: function (line, delim) {
    var n = 0, q = false;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === '"') q = !q;
      else if (ch === delim && !q) n++;
    }
    return n;
  },
  swapDelimiter: function (text, delim) {
    var out = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (ch === '"') q = !q;
      out += (ch === delim && !q) ? ',' : ch;
    }
    return out;
  }
};

/** ห่อทุก API: จับ error และรองรับผลที่ผ่าน U.once แล้ว */
function API_(fn) {
  try {
    var r = fn();
    if (r && r.__raw) return r.__raw;
    return U.ok(r);
  } catch (e) {
    return U.err(e);
  }
}
