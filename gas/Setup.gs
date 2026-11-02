/**************************************************************
 * File: Setup.gs  (HBT Core v0.6.3)
 * ตั้งค่าครั้งแรก — รันจากตัวแก้ไข Apps Script เท่านั้น (ไม่มีทางเรียกจากเว็บ)
 *
 * วิธีใช้:
 *   1) ใส่ค่า Client ID, อีเมลผู้ดูแลคนแรก — แบบ Git/clasp: คัดลอก Setup.local.example.txt เป็น Setup.local.gs แล้วแก้
 *      (ไฟล์นี้ไม่ขึ้น Git) · แบบเดิม: แก้ SETUP ด้านล่างในตัวแก้ไข Apps Script
 *   2) เลือกฟังก์ชัน  setupCore  แล้วกด Run (ครั้งแรกจะขอสิทธิ์ — อนุญาต)
 *   3) ดูผลที่ Execution log แล้วรัน setupCheck เพื่อตรวจซ้ำ
 *   รันซ้ำได้ปลอดภัย: ไม่ทับข้อมูลเดิม ไม่เปลี่ยน secret เดิม
 *
 * ไม่มีรหัสผ่านตั้งต้นของผู้ดูแล — ตัวตนคือบัญชี Google ที่ลงทะเบียนเป็น admin เท่านั้น
 **************************************************************/

var SETUP = {
  GOOGLE_CLIENT_ID: '',            // จาก Google Cloud Console → Credentials → OAuth client ID (Web)
  DOMAIN: 'rmutr.ac.th',           // โดเมนอีเมลที่อนุญาต (ตรวจที่ server)
  FIRST_ADMIN_EMAIL: '',           // อีเมลผู้ดูแลระบบคนแรก เช่น somchai@rmutr.ac.th
  FIRST_ADMIN_NAME: '',            // ชื่อที่แสดง
  SPREADSHEET_ID: '',              // เว้นว่าง = สร้างไฟล์ชีตใหม่ให้  (ใส่ ID ถ้าต้องการใช้ไฟล์ที่มีอยู่แล้ว)
  EXAM_URL: ''                     // Web App URL ของ Exam API (ลงท้าย /exec) — เว้นว่างได้ถ้ายังไม่ใช้ระบบสอบ
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

function setupCore() {
  var log = [];
  var s = setupVals_();

  // 1) ฐานข้อมูล
  if (s.SPREADSHEET_ID) {
    if (Db.ssId() !== s.SPREADSHEET_ID) Db.setSsId(s.SPREADSHEET_ID);
    log.push('ใช้ชีตที่ระบุ: ' + s.SPREADSHEET_ID);
  } else if (!Db.ssId()) {
    log.push('สร้างชีตใหม่: ' + Db.createDatabase('HBT_Core — ' + APP.NAME));
  } else {
    log.push('ใช้ชีตเดิม: ' + Db.ssId());
  }
  Db.ensureSchema(true);
  log.push('ตรวจ/สร้างโครงสร้างชีตแล้ว (schema ' + Db.VERSION + ')');

  // 2) secret สำหรับเซ็น token — สร้างครั้งเดียว (รันซ้ำไม่เปลี่ยน)
  if (!Db.prop('SEC_TOKEN')) {
    Db.setProp('SEC_TOKEN', U.randomHex(32));
    log.push('สร้าง SEC_TOKEN ใหม่');
  } else {
    log.push('มี SEC_TOKEN อยู่แล้ว (ไม่เปลี่ยน)');
  }
  // 2.1) pepper ของแฮช PIN นักศึกษา — ห้ามเปลี่ยน/ลบภายหลัง (PIN ทุกคนจะใช้ไม่ได้)
  if (!Db.prop('SEC_PIN')) {
    Db.setProp('SEC_PIN', U.randomHex(32));
    log.push('สร้าง SEC_PIN ใหม่ (ห้ามเปลี่ยน/ลบ)');
  } else {
    log.push('มี SEC_PIN อยู่แล้ว (ไม่เปลี่ยน)');
  }

  // 3) ค่าที่ห้ามแก้ผ่านเว็บ
  if (!s.DOMAIN) throw new Error('กรุณาระบุ SETUP.DOMAIN');
  Config.set('DOMAIN', String(s.DOMAIN).trim().toLowerCase().replace(/^@/, ''));
  if (s.GOOGLE_CLIENT_ID) {
    Config.set('GOOGLE_CLIENT_ID', String(s.GOOGLE_CLIENT_ID).trim());
    log.push('ตั้ง GOOGLE_CLIENT_ID แล้ว');
  } else if (!Config.get('GOOGLE_CLIENT_ID')) {
    log.push('⚠ ยังไม่ได้ใส่ GOOGLE_CLIENT_ID — ล็อกอินจะยังใช้ไม่ได้');
  }

  // 3.1) Exam API (ถ้ามี): ใช้ตอนลบนักศึกษา/รีเซ็ต เพื่อลบผลสอบตาม
  if (s.EXAM_URL) {
    var eu = String(s.EXAM_URL).trim();
    if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(eu)) throw new Error('EXAM_URL ต้องเป็น Web App URL ที่ลงท้าย /exec');
    Config.set('EXAM_URL', eu);
    log.push('ตั้ง EXAM_URL แล้ว');
  } else if (!Config.get('EXAM_URL')) {
    log.push('ยังไม่ได้ตั้ง EXAM_URL (ข้ามระบบสอบ)');
  }

  // 4) ผู้ดูแลคนแรก
  if (s.FIRST_ADMIN_EMAIL) {
    var a = setupAddFirstAdmin_();
    log.push('ผู้ดูแล: ' + a.email + ' (' + a.name + ')');
  } else if (!hasActiveAdmin_()) {
    log.push('⚠ ยังไม่มีผู้ดูแลที่ใช้งานอยู่ — ใส่ FIRST_ADMIN_EMAIL แล้วรันใหม่');
  }

  Logger.log(log.join('\n'));
  return log;
}

function hasActiveAdmin_() {
  return Db.all('Users').some(function (r) { return r.role === 'admin' && U.bool(r.active); });
}

function setupAddFirstAdmin_() {
  var sv = setupVals_();
  var email = U.normEmail(sv.FIRST_ADMIN_EMAIL);
  var name = String(sv.FIRST_ADMIN_NAME || '').trim() || email.split('@')[0];
  var ex = Db.byId('Users', email);
  if (ex && ex.name) name = ex.name;
  var u = Users.upsert('setup', {
    email: email, name: name, role: 'admin', active: true,
    systems: APP.SYSTEMS
  });
  Audit.log('setup', 'setup.admin', email, '');
  return u;
}

/** ใช้กู้กรณีผู้ดูแลทุกคนถูกปิด/ลืม: ใส่ FIRST_ADMIN_EMAIL แล้วรันฟังก์ชันนี้ */
function setupAddFirstAdmin() {
  if (!setupVals_().FIRST_ADMIN_EMAIL) throw new Error('กรุณาใส่ FIRST_ADMIN_EMAIL (Setup.local.gs หรือ SETUP)');
  var u = setupAddFirstAdmin_();
  Logger.log('เพิ่ม/เปิดใช้ผู้ดูแล: ' + u.email);
  return u;
}

/**
 * แสดง SEC_TOKEN ใน Execution log เพื่อคัดลอกไปใส่ SETUP.SEC_TOKEN ของ Exam API (secret ต้องเหมือนกัน)
 * ดู log ได้เฉพาะผู้มีสิทธิ์แก้โปรเจกต์ · คัดลอกแล้วอย่าส่งต่อ/แปะที่อื่น
 */
function setupShowSecret() {
  var s = Db.prop('SEC_TOKEN');
  if (!s) throw new Error('ยังไม่มี SEC_TOKEN — รัน setupCore ก่อน');
  Logger.log('SEC_TOKEN = ' + s);
  return s;
}

/**
 * ตรวจว่าไฟล์โค้ดในโปรเจกต์ครบหรือไม่ (อ่านอย่างเดียว) — รันเมื่อเจอ "X is not defined"
 * ผลอยู่ใน Execution log: ✘ = ขาด/ว่าง/วางไม่ครบ  พร้อมบอกว่าควรอยู่ในไฟล์ไหน
 */
function setupDiag() {
  var chk = [
    ['Assignments', 'Assignments.gs', typeof Assignments],
    ['Attendance', 'Attendance.gs', typeof Attendance],
    ['Auth', 'Auth.gs', typeof Auth],
    ['APP', 'Config.gs', typeof APP],
    ['Config', 'Config.gs', typeof Config],
    ['Courses', 'Courses.gs', typeof Courses],
    ['Db', 'Db.gs', typeof Db],
    ['ExamLink', 'ExamLink.gs', typeof ExamLink],
    ['Pin', 'Pin.gs', typeof Pin],
    ['Reset', 'Reset.gs', typeof Reset],
    ['ROUTES', 'Router.gs', typeof ROUTES],
    ['Scores', 'Scores.gs', typeof Scores],
    ['SETTING_DEFS', 'Settings.gs', typeof SETTING_DEFS],
    ['Settings', 'Settings.gs', typeof Settings],
    ['Terms', 'Settings.gs', typeof Terms],
    ['STUDENT_CASCADE', 'Students.gs', typeof STUDENT_CASCADE],
    ['Students', 'Students.gs', typeof Students],
    ['Audit', 'Users.gs', typeof Audit],
    ['Users', 'Users.gs', typeof Users],
    ['U', 'Util.gs', typeof U]
  ];
  var miss = chk.filter(function (c) { return c[2] === 'undefined'; });
  var out = miss.map(function (c) { return '✘ ขาด ' + c[0] + '  → ตรวจไฟล์ ' + c[1] + ' (ต้องมีและวางโค้ดครบทั้งไฟล์)'; });
  out.push(miss.length ? 'ขาด ' + miss.length + ' รายการ จากทั้งหมด ' + chk.length : '✔ ไฟล์โค้ดครบ (' + chk.length + ' ส่วน)');
  Logger.log(out.join('\n'));
  return out;
}

/** ตรวจความพร้อม (อ่านอย่างเดียว) */
function setupCheck() {
  var out = [];
  function row(ok, text) { out.push((ok ? '✔ ' : '✘ ') + text); }
  row(!!Db.ssId(), 'มีไฟล์ฐานข้อมูล: ' + (Db.ssId() || '-'));
  row(!!Db.prop('SEC_TOKEN'), 'มี SEC_TOKEN');
  row(!!Db.prop('SEC_PIN'), 'มี SEC_PIN (ใช้แฮช PIN นักศึกษา — ห้ามเปลี่ยน/ลบ)');
  row(true, 'EXAM_URL: ' + (Config.get('EXAM_URL') || 'ยังไม่ตั้ง (ไม่ใช้ระบบสอบ)'));
  row(!!Config.get('DOMAIN'), 'โดเมน: ' + (Config.get('DOMAIN') || '-'));
  row(!!Config.get('GOOGLE_CLIENT_ID'), 'GOOGLE_CLIENT_ID: ' + (Config.get('GOOGLE_CLIENT_ID') ? 'ตั้งแล้ว' : 'ยังไม่ตั้ง'));
  var admins = 0;
  try { Db.ensureSchema(); admins = Db.all('Users').filter(function (r) { return r.role === 'admin' && U.bool(r.active); }).length; } catch (e) {}
  row(admins > 0, 'ผู้ดูแลที่ใช้งานอยู่: ' + admins);
  Logger.log(out.join('\n'));
  return out;
}

/**
 * เปลี่ยน secret → token ทุกใบ (รวมที่ Exam API ถ้าแชร์ secret) ใช้ไม่ได้ทันที ทุกคนต้องล็อกอินใหม่
 * ใช้เมื่อสงสัยว่า secret รั่ว  ⚠ ถ้าใช้ Exam API ต้องคัดลอกค่าใหม่ไปใส่ที่นั่นด้วย
 */
function setupRotateSecret() {
  Db.setProp('SEC_TOKEN', U.randomHex(32));
  Logger.log('เปลี่ยน SEC_TOKEN แล้ว — ทุกคนต้องล็อกอินใหม่');
}
