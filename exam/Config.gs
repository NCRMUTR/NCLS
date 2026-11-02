/**************************************************************
 * File: Config.gs  (HBT Exam API v0.5.0)
 * ค่าคงที่ + ค่าตั้งค่าที่เก็บใน ScriptProperties
 *
 * Exam API = GAS แยกจาก Core (แยกโควตา/คิวเขียน เพราะสอบมีคนเข้าพร้อมกันเยอะ)
 *   - ใช้ SEC_TOKEN ตัวเดียวกับ Core → รับ token อาจารย์ (u) และนักศึกษา (s) ที่ Core ออกให้ได้เลย
 *   - รายวิชา/รายชื่อ/สิทธิ์ ถามจาก Core ผ่าน token บริการ (x) ไม่แตะชีตของ Core ตรง ๆ
 *   - คะแนนรอบสอบส่งกลับ Core เข้าประเภทคะแนน EXAM
 **************************************************************/

var APP = {
  NAME: 'HBT Exam API',
  VERSION: '0.6.0',
  TZ: 'Asia/Bangkok',
  MAX_BODY: 1 * 1024 * 1024,                // คำขอทั่วไป
  MAX_BODY_BIG: 9 * 1024 * 1024,            // เฉพาะ route ที่ประกาศ big:true (บันทึกข้อสอบพร้อมรูป)
  SVC_TTL_SEC: 300,                         // อายุ token บริการ (x) ที่ออกเอง
  ACCESS_CACHE_SEC: 60,                     // สิทธิ์อาจารย์ที่ถามจาก Core จำไว้ (ตรงกับ USER_CACHE_SEC ของ Core)
  COURSE_CACHE_SEC: 300,
  ROSTER_CACHE_SEC: 120,
  ATTEMPT_TTL_MIN_SEC: 30 * 60,             // token ทำข้อสอบ (a) อายุอย่างน้อย
  ATTEMPT_TTL_MAX_SEC: 12 * 3600,           //   และไม่เกิน
  ATTEMPT_TTL_PAD_SEC: 30 * 60,             //   เผื่อหลังเวลาปิดรอบ
  IMG_FOLDER: 'HBT_Exam_Images',
  IMG_MAX_BYTES: 1024 * 1024                // รูปในข้อสอบ (หลังย่อที่เบราว์เซอร์) ต่อรูป
};

var Config = {
  get: function (key) { return Db.prop('CFG_' + key); },
  set: function (key, value) { Db.setProp('CFG_' + key, value); return value; }
};
