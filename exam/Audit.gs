/**************************************************************
 * File: Audit.gs  (HBT Exam API v0.5.0) — บันทึกกิจกรรมของอาจารย์/ระบบ (เขียนไม่สำเร็จต้องไม่ทำให้งานหลักล้ม)
 **************************************************************/
var Audit = {
  log: function (actor, action, target, detail) {
    try {
      Db.insert('AuditLog', {
        log_id: U.uid('LOG'), ts: U.nowIso(), actor: actor || '-', action: action || '-',
        target: target || '', detail: U.clip(typeof detail === 'string' ? detail : U.json(detail), 3000)
      });
    } catch (e) { /* log ต้องไม่ทำให้ระบบล้ม */ }
  }
};
