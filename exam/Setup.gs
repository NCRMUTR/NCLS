/**************************************************************
 * File: Setup.gs  (HBT Exam API v0.6.3)
 * ตั้งค่าครั้งแรก — รันจากตัวแก้ไข Apps Script เท่านั้น (ไม่มีทางเรียกจากเว็บ)
 *
 * วิธีใช้:
 *   1) ที่ Core: รันฟังก์ชัน setupShowSecret แล้วคัดลอกค่า SEC_TOKEN จาก Execution log
 *   2) ใส่ CORE_URL (Web App URL ของ Core ที่ลงท้าย /exec) และ SEC_TOKEN (ค่าที่คัดลอก) — แบบ Git/clasp: คัดลอก
 *      Setup.local.example.txt เป็น Setup.local.gs แล้วแก้ (ไฟล์นี้ไม่ขึ้น Git) · แบบเดิม: แก้ SETUP ด้านล่าง
 *   3) เลือกฟังก์ชัน setupExam แล้วกด Run (ครั้งแรกจะขอสิทธิ์ Sheets/Drive/UrlFetch/Triggers — อนุญาต)
 *   4) **ลบค่า SEC_TOKEN ออกจาก SETUP หลังรันเสร็จ** (ค่าถูกเก็บใน Script Properties แล้ว)
 *   5) รัน setupCheck เพื่อตรวจ · Deploy → Web app (Execute as: Me, Who has access: Anyone) → คัดลอก URL /exec
 *      ไปใส่ใน web/assets/config.js (EXAM_URL) และใน SETUP.EXAM_URL ของ Core (แล้วรัน setupCore ซ้ำ)
 *   รันซ้ำได้ปลอดภัย: ไม่ทับข้อมูลเดิม
 *
 * ถ้าเปลี่ยน secret ที่ Core (setupRotateSecret) ต้องใส่ค่าใหม่ที่นี่แล้วรัน setupExam ซ้ำ
 **************************************************************/

var SETUP = {
  CORE_URL: '',          // เช่น https://script.google.com/macros/s/AKfy.../exec
  SEC_TOKEN: '',         // คัดลอกจาก Core (setupShowSecret) · ลบทิ้งหลังรัน
  SPREADSHEET_ID: ''     // เว้นว่าง = สร้างไฟล์ชีตใหม่ให้
};

/**
 * รวมค่าจาก SETUP (ค่าเริ่มต้นที่อยู่ใน Git) กับ SETUP_LOCAL (ไฟล์ Setup.local.gs ที่ไม่ขึ้น Git)
 * อ่านตอนรันฟังก์ชันเท่านั้น จึงไม่ขึ้นกับลำดับไฟล์ · ค่าว่างใน SETUP_LOCAL ไม่ทับค่าใน SETUP
 * ใช้วิธีเดิมได้เช่นกัน: แก้ SETUP ตรงๆ ในตัวแก้ไข Apps Script
 */
function setupVals_() {
  var out = {}, k;
  for (k in SETUP) out[k] = SETUP[k];
  if (typeof SETUP_LOCAL !== 'undefined' && SETUP_LOCAL) {
    for (k in SETUP_LOCAL) if (SETUP_LOCAL[k] !== '' && SETUP_LOCAL[k] != null) out[k] = SETUP_LOCAL[k];
  }
  return out;
}

function setupExam() {
  var log = [];
  var s = setupVals_();
  if (s.SPREADSHEET_ID) {
    if (Db.ssId() !== s.SPREADSHEET_ID) Db.setSsId(s.SPREADSHEET_ID);
    log.push('ใช้ชีตที่ระบุ: ' + s.SPREADSHEET_ID);
  } else if (!Db.ssId()) {
    log.push('สร้างชีตใหม่: ' + Db.createDatabase('HBT_Exam — ' + APP.NAME));
  } else {
    log.push('ใช้ชีตเดิม: ' + Db.ssId());
  }
  Db.ensureSchema(true);
  log.push('ตรวจ/สร้างโครงสร้างชีตแล้ว (schema ' + Db.VERSION + ')');

  if (s.SEC_TOKEN) {
    var t = String(s.SEC_TOKEN).trim();
    if (t.length < 32) throw new Error('SEC_TOKEN สั้นผิดปกติ — คัดลอกจาก Core ให้ครบ');
    Db.setProp('SEC_TOKEN', t);
    log.push('ตั้ง SEC_TOKEN แล้ว (อย่าลืมลบค่าออกจาก SETUP)');
  } else if (!Db.prop('SEC_TOKEN')) {
    log.push('⚠ ยังไม่มี SEC_TOKEN — ใส่ค่าจาก Core แล้วรันใหม่');
  }
  if (s.CORE_URL) {
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(String(s.CORE_URL).trim())) throw new Error('CORE_URL ต้องเป็น Web App URL ที่ลงท้าย /exec');
    Db.setProp('CORE_URL', String(s.CORE_URL).trim());
    log.push('ตั้ง CORE_URL แล้ว');
  } else if (!Db.prop('CORE_URL')) {
    log.push('⚠ ยังไม่ได้ใส่ CORE_URL');
  }
  log.push(setupTriggers());
  Logger.log(log.join('\n'));
  return log;
}

/** ตัวจับเวลา 5 นาที: ปิดรอบที่เลยเวลา + ส่งคะแนนที่ค้าง (สร้างซ้ำไม่ซ้อน) */
function setupTriggers() {
  var have = ScriptApp.getProjectTriggers().filter(function (t) { return t.getHandlerFunction() === 'tick_'; });
  if (have.length) return 'ตัวจับเวลา tick_ มีอยู่แล้ว';
  ScriptApp.newTrigger('tick_').timeBased().everyMinutes(5).create();
  return 'สร้างตัวจับเวลา tick_ (ทุก 5 นาที)';
}

function setupCheck() {
  var out = [];
  function row(ok, text) { out.push((ok ? '✔ ' : '✘ ') + text); }
  row(!!Db.ssId(), 'มีไฟล์ฐานข้อมูล: ' + (Db.ssId() || '-'));
  row(!!Db.prop('SEC_TOKEN'), 'มี SEC_TOKEN (ต้องเหมือนที่ Core)');
  row(!!Db.prop('CORE_URL'), 'CORE_URL: ' + (Db.prop('CORE_URL') || '-'));
  row(ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'tick_'; }), 'มีตัวจับเวลา tick_');
  if (Db.prop('SEC_TOKEN') && Db.prop('CORE_URL')) {
    try { Core.course('__check__', false); row(true, 'เรียก Core ได้'); }
    catch (e) { row(e.code === 'E_NOT_FOUND', 'เรียก Core: ' + (e.code === 'E_NOT_FOUND' ? 'ได้ (secret ตรงกัน)' : (e.code || e.message))); }
  }
  Logger.log(out.join('\n'));
  return out;
}

/**
 * ตรวจว่าไฟล์โค้ดในโปรเจกต์ครบหรือไม่ (อ่านอย่างเดียว) — รันเมื่อเจอ "X is not defined"
 * ผลอยู่ใน Execution log: ✘ = ขาด/ว่าง/วางไม่ครบ  พร้อมบอกว่าควรอยู่ในไฟล์ไหน
 */
function setupDiag() {
  var chk = [
    ['Audit', 'Audit.gs', typeof Audit],
    ['Auth', 'Auth.gs', typeof Auth],
    ['APP', 'Config.gs', typeof APP],
    ['Config', 'Config.gs', typeof Config],
    ['Core', 'CoreLink.gs', typeof Core],
    ['Gate', 'CoreLink.gs', typeof Gate],
    ['Db', 'Db.gs', typeof Db],
    ['Purge', 'Purge.gs', typeof Purge],
    ['Img', 'Quiz.gs', typeof Img],
    ['Paper', 'Quiz.gs', typeof Paper],
    ['Questions', 'Quiz.gs', typeof Questions],
    ['Quiz', 'Quiz.gs', typeof Quiz],
    ['Report', 'Report.gs', typeof Report],
    ['Op', 'Rounds.gs', typeof Op],
    ['Rounds', 'Rounds.gs', typeof Rounds],
    ['ROUTES', 'Router.gs', typeof ROUTES],
    ['Runner', 'Runner.gs', typeof Runner],
    ['Sync', 'Sync.gs', typeof Sync],
    ['U', 'Util.gs', typeof U]
  ];
  var miss = chk.filter(function (c) { return c[2] === 'undefined'; });
  var out = miss.map(function (c) { return '✘ ขาด ' + c[0] + '  → ตรวจไฟล์ ' + c[1] + ' (ต้องมีและวางโค้ดครบทั้งไฟล์)'; });
  out.push(miss.length ? 'ขาด ' + miss.length + ' รายการ จากทั้งหมด ' + chk.length : '✔ ไฟล์โค้ดครบ (' + chk.length + ' ส่วน)');
  Logger.log(out.join('\n'));
  return out;
}
