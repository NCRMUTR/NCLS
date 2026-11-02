/* ค่าตั้งต้นของเว็บ — ไม่ใช่ความลับ (Client ID และ URL ของ Web App เป็นข้อมูลสาธารณะอยู่แล้ว)
 * แก้ 2 ค่านี้หลัง deploy Apps Script และสร้าง OAuth Client ID ตาม README */
window.HBT_CONFIG = {
  GOOGLE_CLIENT_ID: '',   // เช่น 1234567890-abcdef.apps.googleusercontent.com
  CORE_URL: '',           // Web App URL ของ Core API  เช่น https://script.google.com/macros/s/AKfy.../exec
  EXAM_URL: ''            // Web App URL ของ Exam API (ระบบสอบออนไลน์ — GAS แยกอีกโปรเจกต์) เว้นว่างถ้าไม่ใช้ระบบสอบ
};
