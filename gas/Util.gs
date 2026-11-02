/**************************************************************
 * File: Util.gs  (HBT Core v0.1.0)
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
    E_NOT_SETUP: 'ยังไม่ได้ตั้งค่าระบบ กรุณาติดต่อผู้ดูแล',
    E_AUTH: 'หมดเวลาเข้าใช้งาน กรุณาเข้าสู่ระบบใหม่',
    E_FORBIDDEN: 'ไม่มีสิทธิ์ใช้งานส่วนนี้',
    E_BAD_TOKEN: 'ยืนยันตัวตนกับ Google ไม่สำเร็จ กรุณาลองใหม่',
    E_DOMAIN: 'ใช้ได้เฉพาะบัญชีอีเมลของมหาวิทยาลัย',
    E_NOT_LISTED: 'บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
    E_DISABLED: 'บัญชีนี้ถูกปิดใช้งาน กรุณาติดต่อผู้ดูแลระบบ',
    E_EMAIL: 'รูปแบบอีเมลไม่ถูกต้อง',
    E_EMAIL_DOMAIN: 'อีเมลต้องลงท้ายด้วยโดเมนของมหาวิทยาลัย',
    E_ROLE: 'บทบาทไม่ถูกต้อง',
    E_LAST_ADMIN: 'ต้องมีผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน',
    E_SETTING: 'ค่าตั้งค่าไม่ถูกต้อง',
    E_TERM_NAME: 'กรุณาระบุชื่อภาคเรียน',
    E_TERM_DUP: 'มีภาคเรียนชื่อนี้แล้ว',
    E_NO_TERM: 'ยังไม่ได้ตั้งภาคเรียนปัจจุบัน ให้ผู้ดูแลระบบตั้งก่อน',
    E_COURSE_FIELD: 'ข้อมูลรายวิชาไม่ถูกต้อง',
    E_COURSE_DUP: 'มีรายวิชารหัสและกลุ่มนี้ในภาคเรียนนี้แล้ว',
    E_STD_ID: 'รหัสนักศึกษาต้องเป็นตัวเลขหรือตัวอักษร 4–20 ตัว',
    E_STD_NAME: 'กรุณากรอกชื่อ-นามสกุลนักศึกษา (ไม่เกิน 120 ตัวอักษร)',
    E_STUDENT_DUP: 'มีรหัสนักศึกษานี้ในรายวิชาแล้ว',
    E_IMPORT: 'ข้อมูลนำเข้าไม่ถูกต้อง',
    E_PIN_FORMAT: 'PIN ต้องเป็นตัวเลข 4 หลัก',
    E_PIN_BAD: 'PIN ไม่ถูกต้อง',
    E_PIN_LOCKED: 'ใส่ PIN ผิดหลายครั้ง ถูกล็อกชั่วคราว',
    E_PIN_NONE: 'ยังไม่ได้ตั้ง PIN ให้ตั้งด้วยรหัสชั่วคราวจากอาจารย์ก่อน',
    E_PIN_TEMP: 'รหัสชั่วคราวไม่ถูกต้องหรือหมดอายุ',
    E_PIN_SAME: 'PIN ใหม่ต้องไม่ซ้ำ PIN เดิม',
    E_SCORE_TYPE: 'ข้อมูลประเภทคะแนนไม่ถูกต้อง',
    E_SCORE_PCT: 'น้ำหนักรวมของทุกประเภทต้องไม่เกิน 100%',
    E_SCORE_VALUE: 'คะแนนไม่ถูกต้อง',
    E_SCORE_AUTO: 'ประเภทคะแนนนี้คำนวณอัตโนมัติ แก้ไม่ได้',
    E_ATT_CLOSED: 'คาบนี้ปิดรับเช็คชื่อแล้ว',
    E_ATT_PAUSED: 'อาจารย์พักการเช็คชื่อชั่วคราว รอสักครู่',
    E_ATT_GPS_REQUIRED: 'คาบนี้ต้องเปิดตำแหน่ง (GPS) เพื่อเช็คชื่อ',
    E_ATT_OUT_OF_RANGE: 'คุณอยู่นอกพื้นที่ห้องเรียน',
    E_ATT_DEVICE: 'ระบุเครื่องไม่ได้ ลองรีเฟรชหน้าแล้วทำใหม่',
    E_ATT_DEVICE_CONFLICT: 'เครื่องนี้ถูกใช้เช็คชื่อให้คนอื่นแล้ว',
    E_ATT_PIN_REQUIRED: 'ต้องใส่ PIN',
    E_ATT_OPEN_EXISTS: 'วิชานี้มีคาบที่เปิดอยู่แล้ว ปิดคาบนั้นก่อน',
    E_ATT_STILL_OPEN: 'คาบนี้ยังเปิดอยู่ ปิดคาบก่อนจึงลบได้',
    E_ATT_TIME: 'เวลาไม่ถูกต้อง',
    E_ATT_LOC: 'ตำแหน่งหรือรัศมีไม่ถูกต้อง',
    E_ATT_STATUS: 'สถานะไม่ถูกต้อง (ปกติ/สาย/ลา/ขาด)',
    E_ATT_STATE: 'สถานะคาบไม่ตรงกับการกระทำนี้ (อาจมีคนเปลี่ยนไปแล้ว ลองโหลดใหม่)',
    E_ATT_REQ: 'คำขอไม่ถูกต้องหรือหมดอายุ',
    E_DRIVE: 'ใช้ที่เก็บไฟล์ (Drive) ไม่ได้ — ผู้ดูแลต้องรัน setupCore ใหม่เพื่ออนุญาตสิทธิ์ Drive',
    E_ASG_FIELD: 'ข้อมูลงานไม่ถูกต้อง',
    E_ASG_KIND_LOCKED: 'มีคนส่งงานหรือจับกลุ่มแล้ว เปลี่ยนประเภทงาน (เดี่ยว/กลุ่ม) ไม่ได้',
    E_ASG_MAX_LOW: 'คะแนนเต็มต่ำกว่าคะแนนที่ให้ไปแล้ว',
    E_ASG_CLOSED: 'งานนี้ปิดรับแล้ว',
    E_ASG_GRADED: 'งานนี้ตรวจให้คะแนนแล้ว แก้ไขไม่ได้ ติดต่ออาจารย์',
    E_ASG_NOT_GROUP: 'งานนี้ไม่ใช่งานกลุ่ม',
    E_ASG_NO_GROUP: 'งานกลุ่ม: ต้องสร้างกลุ่มก่อนส่งงาน',
    E_ASG_NOT_REP: 'งานกลุ่มส่งได้เฉพาะตัวแทนกลุ่ม',
    E_ASG_GROUP: 'จัดกลุ่มไม่ได้',
    E_ASG_HAS_SUB: 'กลุ่มนี้ส่งงานแล้ว ลบกลุ่มไม่ได้ (ลบไฟล์ที่ส่งก่อน)',
    E_ASG_FILE_TYPE: 'ชนิดไฟล์ไม่รับ',
    E_ASG_FILE_SIZE: 'ไฟล์ใหญ่เกินกำหนด',
    E_ASG_FILE_COUNT: 'ส่งไฟล์ได้ไม่เกินจำนวนที่กำหนด ลบไฟล์เดิมก่อน',
    E_ASG_FILE_BAD: 'ไฟล์เสียหรือเนื้อไฟล์ไม่ตรงกับชนิดที่ระบุ',
    E_COURSE_RESETTING: 'วิชานี้กำลังถูกลบโดยผู้ดูแลระบบ',
    E_RESET_CONFIRM: 'ข้อความยืนยันไม่ตรง — ไม่ได้ลบอะไร',
    E_TERM_CURRENT: 'ลบภาคเรียนปัจจุบันไม่ได้ — ตั้งภาคเรียนอื่นเป็นปัจจุบันก่อน',
    E_TERM_HAS_COURSES: 'ภาคเรียนนี้ยังมีรายวิชาอยู่ — ลบรายวิชาให้หมดก่อน',
    E_EXAM_DOWN: 'ติดต่อระบบสอบไม่ได้ จึงลบ/ตรวจข้อมูลการสอบไม่ได้ ลองใหม่อีกครั้ง',
    E_TERM_DATE: 'วันที่ภาคเรียนไม่ถูกต้อง (ต้องเป็นปี-เดือน-วัน และวันสิ้นสุดไม่ก่อนวันเริ่ม)'
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
  sleep: function (ms) { try { Utilities.sleep(ms); } catch (e) {} },
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
  strToB64u: function (str) { return U.b64u(Utilities.newBlob(String(str)).getBytes()); }
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
