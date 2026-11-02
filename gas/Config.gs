/**************************************************************
 * File: Config.gs  (HBT Core v0.1.0)
 * ค่าคงที่ของระบบ + ค่าตั้งค่าที่เก็บใน ScriptProperties
 **************************************************************/

var APP = {
  NAME: 'HBT Teaching System',
  VERSION: '0.6.0',
  TZ: 'Asia/Bangkok',
  SYSTEMS: ['att', 'exam', 'asg'],           // ระบบที่กำหนดสิทธิ์ให้อาจารย์ได้
  ROLES: ['admin', 'teacher'],
  TOKEN_TTL_SEC: 8 * 3600,                    // อายุ token อาจารย์
  USER_CACHE_SEC: 60,                         // สิทธิ์ที่ admin เปลี่ยน มีผลภายในเวลานี้
  MAX_BODY: 2 * 1024 * 1024,                  // ขนาด request ทั่วไปสูงสุด
  MAX_BODY_BIG: 9 * 1024 * 1024,              // เฉพาะ route ที่ประกาศ big:true (อัปโหลดไฟล์งาน base64: ไฟล์ ≤ 6 MB)
  MAX_FILE_MB: 6                              // เพดานขนาดไฟล์ที่ตั้งค่าได้ (ต้องสอดคล้อง MAX_BODY_BIG)
};

/** ค่าตั้งค่าที่ "ห้ามแก้ผ่านหน้าเว็บ" (เสี่ยงล็อกตัวเอง) เก็บใน ScriptProperties คีย์ CFG_* */
var Config = {
  get: function (key) { return Db.prop('CFG_' + key); },
  set: function (key, value) { Db.setProp('CFG_' + key, value); return value; }
};
