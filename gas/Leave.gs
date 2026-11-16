/**************************************************************
 * File: Leave.gs  (HBT Core v0.11.0)
 * ใบลานักศึกษา: นักศึกษาส่งใบลาเข้าวิชา (แนบฟอร์มที่กรอกแล้ว + หลักฐานเพิ่มได้) → อาจารย์เจ้าของวิชา อนุมัติ/ไม่อนุมัติ → สรุปการลา
 *  - ใบลาที่อนุมัติ "ไม่กระทบคะแนน" (อาจารย์พิจารณาท้ายเทอม) · รายงานเช็คชื่อแสดง "ล" ให้คาบที่ไม่มีบันทึกเช็คชื่อและตรงวันลา (คำนวณตอนอ่าน ไม่เขียนลง AttRecords)
 *  - ไฟล์เก็บใน Drive โฟลเดอร์ HBT_Leave (ไม่แชร์ลิงก์) ดึงผ่าน API เป็น base64 · ใบรับรองแพทย์ = ข้อมูลสุขภาพ: เห็นเฉพาะอาจารย์เจ้าของวิชา/admin + บันทึก Audit
 *  - แบบฟอร์มของ admin เก็บไฟล์เดียว (id/ชื่อ/ชนิดใน ScriptProperties LEAVE_FORM_*) นักศึกษาดาวน์โหลดได้โดยไม่ล็อกอิน (pub.leaveForm)
 *  - ชนิดไฟล์/ขนาด/เช็คหัวไฟล์ ใช้ตัวช่วยเดียวกับส่งงาน (Assignments.fileKit)
 **************************************************************/

var Leave = (function () {

  var TYPES = ['sick', 'personal'], STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];
  var MAX_REASON = 1000, MAX_NOTE = 300, MAX_DAYS = 14, MAX_DAYS_TEACHER = 60, PER_DAY = 5, DUP_SEC = 60;
  var FOLDER_NAME = 'HBT_Leave';

  function kit_() { return Assignments.fileKit; }
  function pad_(n) { return (n < 10 ? '0' : '') + n; }
  function clip_(v, n) { return String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().substring(0, n); }
  function oneLine_(v, n) { return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, n); }
  function ymdOk_(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && Terms.validYmd(s); }
  function utc_(ymd) { var p = ymd.split('-'); return Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function addDays_(ymd, n) { var d = new Date(utc_(ymd) + n * 86400000); return d.getUTCFullYear() + '-' + pad_(d.getUTCMonth() + 1) + '-' + pad_(d.getUTCDate()); }
  function dayDiff_(a, b) { return Math.round((utc_(b) - utc_(a)) / 86400000); }
  function today_() { return U.nowIso().substring(0, 10); }
  function hmOk_(s) { var m = /^(\d{2}):(\d{2})$/.exec(s); return !!m && Number(m[1]) <= 23 && Number(m[2]) <= 59; }
  function warnLimit_() { var n = Number(Settings.get('att_warn_absent')); return isFinite(n) && n >= 1 ? n : 2; }

  /* ---------- Drive ---------- */
  function folder_() {
    try {
      var id = Db.prop('DRV_LEAVE');
      if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* ถูกลบ/ย้าย → หาใหม่ */ } }
      var it = DriveApp.getFoldersByName(FOLDER_NAME);
      var f = it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
      Db.setProp('DRV_LEAVE', f.getId());
      return f;
    } catch (e) { throw kit_().driveErr(e); }
  }
  /** ตรวจไฟล์ที่ส่งมา a = { name, b64 } → { name, ext, mime, bytes } หรือโยน error (ตรวจเหมือนส่งงาน) */
  function readUpload_(a) {
    var kit = kit_(), lim = kit.limits();
    var name = kit.cleanName(a.name), ext = kit.extOf(name);
    if (!name || !kit.types[ext] || lim.types.indexOf(ext) < 0) throw U.E('E_ASG_FILE_TYPE', { allowed: lim.types }, 'รับเฉพาะไฟล์ ' + lim.types.join(', '));
    var b64 = a.b64;
    if (typeof b64 !== 'string' || !b64.length || !/^[A-Za-z0-9+\/=\s]+$/.test(b64)) throw U.E('E_ASG_FILE_BAD');
    if (b64.length * 0.75 > lim.maxBytes + 4096) throw U.E('E_ASG_FILE_SIZE', { maxMb: lim.maxMb }, 'ไฟล์ใหญ่เกิน ' + lim.maxMb + ' MB');
    var bytes;
    try { bytes = Utilities.base64Decode(b64.replace(/\s+/g, '')); } catch (e) { throw U.E('E_ASG_FILE_BAD'); }
    if (!bytes.length) throw U.E('E_ASG_FILE_BAD');
    if (bytes.length > lim.maxBytes) throw U.E('E_ASG_FILE_SIZE', { maxMb: lim.maxMb }, 'ไฟล์ใหญ่เกิน ' + lim.maxMb + ' MB');
    if (!kit.magicOk(kit.types[ext].magic, bytes)) throw U.E('E_ASG_FILE_BAD');
    return { name: name, ext: ext, mime: kit.types[ext].mime, bytes: bytes };
  }
  function putFile_(up, prefix) {
    try { return folder_().createFile(Utilities.newBlob(up.bytes, up.mime, prefix + '_' + Date.now().toString(36) + '_' + up.name)); }
    catch (e) { throw kit_().driveErr(e); }
  }
  function trash_(id) { kit_().trashFile(id); }
  function bytesOf_(driveId) {
    try { return DriveApp.getFileById(driveId).getBlob().getBytes(); } catch (e) { throw U.E('E_NOT_FOUND', { why: 'drive' }); }
  }

  /* ---------- ผลลัพธ์ ---------- */
  function fileOut_(id, name, size) { return id ? { name: name, size: Number(size) || 0 } : null; }
  function out_(r) {
    return {
      leaveId: r.leave_id, courseId: r.course_id, stdId: r.std_id, type: r.type, dateFrom: r.date_from, dateTo: r.date_to,
      allDay: U.bool(r.all_day), timeFrom: r.time_from, timeTo: r.time_to, reason: r.reason, status: r.status, teacherNote: r.teacher_note,
      form: fileOut_(r.form_drive_id, r.form_name, r.form_size), extra: fileOut_(r.extra_drive_id, r.extra_name, r.extra_size),
      createdAt: r.created_at, updatedAt: r.updated_at, decidedBy: r.decided_by, decidedAt: r.decided_at, source: r.source,
      days: dayDiff_(r.date_from, r.date_to) + 1
    };
  }
  function courseOut_(c) { return { courseId: c.course_id, code: c.code, name: c.name, section: c.section }; }

  /* ---------- ตรวจข้อมูลที่ส่งมา ---------- */
  /** teacher = true → ไม่จำกัดช่วงย้อนหลัง/ล่วงหน้า (อาจารย์บันทึกแทนตามใบกระดาษ) */
  function fields_(a, teacher) {
    var type = String(a.type || '');
    if (TYPES.indexOf(type) < 0) throw U.E('E_LEAVE_FIELD', { field: 'type' }, 'เลือกชนิดการลา (ลาป่วย/ลากิจ)');
    var from = String(a.dateFrom || '').trim(), to = String(a.dateTo || a.dateFrom || '').trim();
    if (!ymdOk_(from) || !ymdOk_(to)) throw U.E('E_LEAVE_FIELD', { field: 'date' }, 'วันที่ไม่ถูกต้อง');
    if (to < from) throw U.E('E_LEAVE_FIELD', { field: 'date' }, 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม');
    var maxDays = teacher ? MAX_DAYS_TEACHER : MAX_DAYS;
    if (dayDiff_(from, to) + 1 > maxDays) throw U.E('E_LEAVE_FIELD', { field: 'date', max: maxDays }, 'ลาครั้งละไม่เกิน ' + maxDays + ' วัน');
    if (!teacher) {
      var t = today_(), past = Number(Settings.get('leave_past_days')), fut = Number(Settings.get('leave_future_days'));
      if (from < addDays_(t, -past) || to > addDays_(t, fut)) {
        throw U.E('E_LEAVE_DATE', { past: past, future: fut }, 'ส่งใบลาย้อนหลังได้ไม่เกิน ' + past + ' วัน และล่วงหน้าไม่เกิน ' + fut + ' วัน');
      }
    }
    var allDay = a.allDay === undefined || a.allDay === null || a.allDay === '' ? true : U.bool(a.allDay), tf = '', tt = '';
    if (!allDay) {
      tf = String(a.timeFrom || '').trim(); tt = String(a.timeTo || '').trim();
      if (!hmOk_(tf) || !hmOk_(tt) || tt <= tf) throw U.E('E_LEAVE_FIELD', { field: 'time' }, 'เวลาเรียนที่ลาไม่ถูกต้อง (เวลาสิ้นสุดต้องหลังเวลาเริ่ม)');
    }
    return { type: type, from: from, to: to, allDay: allDay, tf: tf, tt: tt, reason: clip_(a.reason, MAX_REASON) };
  }
  function timeOverlap_(x, y) {          // x, y = แถวหรือ fields: ถ้าฝั่งใดลาทั้งวัน = ทับกัน
    var xa = x.all_day !== undefined ? U.bool(x.all_day) : x.allDay, ya = y.all_day !== undefined ? U.bool(y.all_day) : y.allDay;
    if (xa || ya) return true;
    var xf = x.time_from !== undefined ? x.time_from : x.tf, xt = x.time_to !== undefined ? x.time_to : x.tt;
    var yf = y.time_from !== undefined ? y.time_from : y.tf, yt = y.time_to !== undefined ? y.time_to : y.tt;
    return xf < yt && yf < xt;
  }
  /** ตรวจก่อนบันทึก (เรียกซ้ำใน lock) → คืนแถวซ้ำ (กดซ้ำ) หรือ null · โยน E_LEAVE_OVERLAP / E_LEAVE_LIMIT */
  function guard_(courseId, stdId, f, checkLimit) {
    var mine = Db.findRows('LeaveRequests', 'std_id', stdId).filter(function (r) { return r.course_id === courseId; });
    var now = Date.now(), dup = mine.filter(function (r) {
      var t = U.toDate(r.created_at);
      return r.status === 'pending' && r.type === f.type && r.date_from === f.from && r.date_to === f.to && U.bool(r.all_day) === f.allDay &&
        (r.time_from || '') === f.tf && (r.time_to || '') === f.tt && t && now - t.getTime() < DUP_SEC * 1000;
    })[0];
    if (dup) return dup;
    mine.forEach(function (r) {
      if ((r.status === 'pending' || r.status === 'approved') && r.date_from <= f.to && f.from <= r.date_to && timeOverlap_(r, f)) throw U.E('E_LEAVE_OVERLAP');
    });
    if (checkLimit) {
      var today = today_();
      if (mine.filter(function (r) { return String(r.created_at).substring(0, 10) === today; }).length >= PER_DAY) throw U.E('E_LEAVE_LIMIT', { max: PER_DAY });
    }
    return null;
  }
  function studentCourse_(s) {
    var c = Db.byId('Courses', s.courseId), cur = Terms.current();
    if (!c || !cur || c.term_id !== cur.termId || c.reset_at) throw U.E('E_NOT_FOUND');
    return c;
  }
  function pickIds_(ids) {
    if (!Array.isArray(ids) || !ids.length) throw U.E('E_BAD_REQUEST', null, 'ยังไม่ได้เลือกใบลา');
    if (ids.length > 300) throw U.E('E_BAD_REQUEST', { max: 300 }, 'เลือกได้ครั้งละไม่เกิน 300 ใบ');
    var set = {}; ids.forEach(function (i) { set[String(i)] = true; });
    return set;
  }

  /* ============================== สาธารณะ / admin ============================== */
  function formMeta_() {
    var id = Db.prop('LEAVE_FORM_ID');
    return id ? { id: id, name: Db.prop('LEAVE_FORM_NAME'), mime: Db.prop('LEAVE_FORM_MIME'), size: Number(Db.prop('LEAVE_FORM_SIZE')) || 0, at: Db.prop('LEAVE_FORM_AT') } : null;
  }
  /** ข้อมูลสำหรับหน้าส่งใบลา (ไม่ล็อกอิน) */
  function info() {
    var m = formMeta_(), lim = kit_().limits();
    return {
      notice: Settings.get('leave_notice'), hasForm: !!m, formName: m ? m.name : '', formSize: m ? m.size : 0, formAt: m ? m.at : '',
      types: lim.types, maxMb: lim.maxMb, pastDays: Number(Settings.get('leave_past_days')), futureDays: Number(Settings.get('leave_future_days')), maxDays: MAX_DAYS
    };
  }
  /** ดาวน์โหลดแบบฟอร์ม (ไม่ล็อกอิน) */
  function formGet() {
    var m = formMeta_();
    if (!m) throw U.E('E_LEAVE_NO_FORM');
    var bytes = bytesOf_(m.id);
    return { name: m.name, mime: m.mime, size: bytes.length, b64: Utilities.base64Encode(bytes) };
  }
  /** admin อัปโหลด/แทนที่แบบฟอร์ม a = { name, b64 } */
  function formSet(user, a) {
    var up = readUpload_(a), file = putFile_(up, 'FORM'), old = Db.prop('LEAVE_FORM_ID');
    Db.setProps({ LEAVE_FORM_ID: file.getId(), LEAVE_FORM_NAME: up.name, LEAVE_FORM_MIME: up.mime, LEAVE_FORM_SIZE: String(up.bytes.length), LEAVE_FORM_AT: U.nowIso() });
    if (old && old !== file.getId()) trash_(old);
    Audit.log(user.email, 'leave.formSet', file.getId(), { name: up.name, size: up.bytes.length });
    return info();
  }
  function formDelete(user) {
    var old = Db.prop('LEAVE_FORM_ID');
    Db.setProps({ LEAVE_FORM_ID: '', LEAVE_FORM_NAME: '', LEAVE_FORM_MIME: '', LEAVE_FORM_SIZE: '', LEAVE_FORM_AT: '' });
    if (old) trash_(old);
    Audit.log(user.email, 'leave.formDelete', old || '', '');
    return info();
  }

  /* ============================== นักศึกษา ============================== */
  /** ส่งใบลา a = { type, dateFrom, dateTo, allDay, timeFrom, timeTo, reason, name, b64 }  (name+b64 = ฟอร์มลาที่กรอกแล้ว บังคับ) */
  function submit(s, a) {
    var c = studentCourse_(s), f = fields_(a, false);
    var up = readUpload_(a);                                           // 1) ตรวจทุกอย่างก่อนแตะ Drive
    var dup0 = guard_(c.course_id, s.stdId, f, true);
    if (dup0) return { leaveId: dup0.leave_id, duplicate: true };
    var file = putFile_(up, s.stdId + '_F');                           // 2) ส่งขึ้น Drive นอก lock
    try {
      return U.lock(function () {                                      // 3) บันทึกแถวใน lock (ตรวจซ้ำกับข้อมูลสด)
        Db.flush();
        var dup = guard_(c.course_id, s.stdId, f, true);
        if (dup) { trash_(file.getId()); return { leaveId: dup.leave_id, duplicate: true }; }
        var id = U.uid('LV'), now = U.nowIso();
        Db.insert('LeaveRequests', {
          leave_id: id, course_id: c.course_id, std_id: s.stdId, type: f.type, date_from: f.from, date_to: f.to, all_day: U.bstr(f.allDay),
          time_from: f.tf, time_to: f.tt, reason: f.reason, status: 'pending', teacher_note: '',
          form_drive_id: file.getId(), form_name: up.name, form_size: up.bytes.length, form_mime: up.mime,
          extra_drive_id: '', extra_name: '', extra_size: 0, extra_mime: '',
          created_at: now, updated_at: now, decided_by: '', decided_at: '', source: 'STUDENT'
        });
        Courses.touch(c.course_id);
        Audit.log(s.stdId + '@' + s.courseId, 'leave.submit', id, { type: f.type, from: f.from, to: f.to });
        return { leaveId: id, sent: true };
      }, 30000);
    } catch (e) { trash_(file.getId()); throw e; }
  }

  /** แนบ/แทนที่หลักฐานเพิ่ม (ช่อง 2) ของใบลาที่ยังรออนุมัติ a = { leaveId, name, b64 } */
  function attach(s, a) {
    var r0 = Db.byId('LeaveRequests', String(a.leaveId || ''));
    if (!r0 || r0.course_id !== s.courseId || r0.std_id !== s.stdId) throw U.E('E_NOT_FOUND');
    if (r0.status !== 'pending') throw U.E('E_LEAVE_STATE');
    var up = readUpload_(a), file = putFile_(up, s.stdId + '_X');
    try {
      return U.lock(function () {
        Db.flush();
        var r = Db.byId('LeaveRequests', r0.leave_id);
        if (!r || r.status !== 'pending') throw U.E('E_LEAVE_STATE');
        var old = r.extra_drive_id;
        Db.update('LeaveRequests', r.leave_id, { extra_drive_id: file.getId(), extra_name: up.name, extra_size: up.bytes.length, extra_mime: up.mime, updated_at: U.nowIso() });
        if (old) trash_(old);
        Audit.log(s.stdId + '@' + s.courseId, 'leave.attach', r.leave_id, { size: up.bytes.length });
        return { attached: true, extra: { name: up.name, size: up.bytes.length } };
      }, 30000);
    } catch (e) { trash_(file.getId()); throw e; }
  }

  function mine(s) {
    var rows = Db.findRows('LeaveRequests', 'std_id', s.stdId).filter(function (r) { return r.course_id === s.courseId; })
      .sort(function (x, y) { return x.created_at < y.created_at ? 1 : -1; }).slice(0, 50);
    return { leaves: rows.map(out_) };
  }

  function cancel(s, a) {
    var r = Db.byId('LeaveRequests', String(a.leaveId || ''));
    if (!r || r.course_id !== s.courseId || r.std_id !== s.stdId) throw U.E('E_NOT_FOUND');
    if (r.status === 'cancelled') return { cancelled: true };
    if (r.status !== 'pending') throw U.E('E_LEAVE_STATE');
    Db.update('LeaveRequests', r.leave_id, { status: 'cancelled', updated_at: U.nowIso(), form_drive_id: '', extra_drive_id: '' });
    trash_(r.form_drive_id); trash_(r.extra_drive_id);               // ยกเลิกแล้วไม่เก็บไฟล์ไว้ (ข้อมูลสุขภาพ)
    Courses.touch(r.course_id);
    Audit.log(s.stdId + '@' + s.courseId, 'leave.cancel', r.leave_id, '');
    return { cancelled: true };
  }

  /* ============================== อาจารย์ ============================== */
  function list(user, a) {
    var c = Courses.require(user, a.courseId), names = {}, counts = { pending: 0, approved: 0, rejected: 0, cancelled: 0, total: 0 };
    Students.roster(c.course_id).forEach(function (s) { names[s.std_id] = s.name; });
    var rows = Db.findRows('LeaveRequests', 'course_id', c.course_id).sort(function (x, y) { return x.created_at < y.created_at ? 1 : -1; }).map(function (r) {
      var o = out_(r); o.stdName = names[r.std_id] || r.std_id; counts.total++; counts[o.status] = (counts[o.status] || 0) + 1; return o;
    });
    return { course: courseOut_(c), leaves: rows, counts: counts, warnAbsent: warnLimit_() };
  }

  /** อนุมัติ/ไม่อนุมัติหลายใบพร้อมกัน a = { courseId, leaveIds[], status:'approved'|'rejected', note? } · เปลี่ยนคำตัดสินภายหลังได้ (ใบที่ยกเลิกแล้วแก้ไม่ได้) */
  function decide(user, a) {
    var c = Courses.require(user, a.courseId), set = pickIds_(a.leaveIds), st = String(a.status || '');
    if (st !== 'approved' && st !== 'rejected') throw U.E('E_LEAVE_FIELD', { field: 'status' });
    var note = oneLine_(a.note, MAX_NOTE), now = U.nowIso(), patch = {}, n = 0, skipped = 0;
    Db.findRows('LeaveRequests', 'course_id', c.course_id).forEach(function (r) {
      if (!set[r.leave_id]) return;
      if (r.status === 'cancelled') { skipped++; return; }
      if (r.status === st && (r.teacher_note || '') === note) return;
      patch[r._row] = { status: st, teacher_note: note, decided_by: user.email, decided_at: now, updated_at: now }; n++;
    });
    if (n) { Db.bulkPatch('LeaveRequests', patch); Courses.touch(c.course_id); }
    Audit.log(user.email, 'leave.decide', c.course_id, { status: st, changed: n, skipped: skipped });
    return { changed: n, skipped: skipped };
  }

  function fileGet(user, a) {
    var r = Db.byId('LeaveRequests', U.req(a.leaveId, 'leaveId'));
    if (!r) throw U.E('E_NOT_FOUND');
    Courses.require(user, r.course_id);
    var slot = a.slot === 'extra' ? 'extra' : 'form', id = r[slot + '_drive_id'];
    if (!id) throw U.E('E_NOT_FOUND');
    var bytes = bytesOf_(id);
    Audit.log(user.email, 'leave.fileGet', r.leave_id, { slot: slot });
    return { name: r[slot + '_name'], mime: r[slot + '_mime'], size: bytes.length, b64: Utilities.base64Encode(bytes) };
  }

  /** อาจารย์บันทึกการลาแทนนักศึกษา (ใบกระดาษ ฯลฯ): a = { courseId, stdId, type, dateFrom, dateTo, allDay, timeFrom, timeTo, reason, status? 'approved'(เริ่มต้น)|'pending' } */
  function create(user, a) {
    var c = Courses.require(user, a.courseId), std;
    try { std = Students.cleanId(a.stdId); } catch (e) { throw U.E('E_NOT_FOUND'); }
    if (!Students.find(c.course_id, std)) throw U.E('E_NOT_FOUND');
    var f = fields_(a, true), st = a.status === 'pending' ? 'pending' : 'approved';
    guard_(c.course_id, std, f, false);
    var id = U.uid('LV'), now = U.nowIso();
    Db.insert('LeaveRequests', {
      leave_id: id, course_id: c.course_id, std_id: std, type: f.type, date_from: f.from, date_to: f.to, all_day: U.bstr(f.allDay),
      time_from: f.tf, time_to: f.tt, reason: f.reason, status: st, teacher_note: '',
      form_drive_id: '', form_name: '', form_size: 0, form_mime: '', extra_drive_id: '', extra_name: '', extra_size: 0, extra_mime: '',
      created_at: now, updated_at: now, decided_by: st === 'approved' ? user.email : '', decided_at: st === 'approved' ? now : '', source: 'TEACHER'
    });
    Courses.touch(c.course_id);
    Audit.log(user.email, 'leave.create', id, { std: std, type: f.type, status: st });
    return { leaveId: id };
  }

  function dropRows_(rows) {
    rows.forEach(function (r) { trash_(r.form_drive_id); trash_(r.extra_drive_id); });
    var set = {}; rows.forEach(function (r) { set[r.leave_id] = true; });
    return Db.removeWhere('LeaveRequests', function (o) { return set[o.leave_id] === true; });
  }
  function remove(user, a) {
    var c = Courses.require(user, a.courseId), set = pickIds_(a.leaveIds);
    var rows = Db.findRows('LeaveRequests', 'course_id', c.course_id).filter(function (r) { return set[r.leave_id]; });
    var n = dropRows_(rows);
    if (n) Courses.touch(c.course_id);
    Audit.log(user.email, 'leave.delete', c.course_id, { count: n });
    return { removed: n };
  }

  function emptyStat_() { return { sick: { count: 0, days: 0 }, personal: { count: 0, days: 0 }, pending: 0, rejected: 0 }; }
  /** นับใบลารายคนของวิชา { stdId: { sick:{count,days}, personal:{count,days}, pending, rejected } } — ครั้ง/วันนับเฉพาะใบที่อนุมัติ (ใช้หน้าสรุปการลา/หน้าสรุปคะแนน) */
  function statsByStd(courseId) {
    var m = {};
    Db.findRows('LeaveRequests', 'course_id', courseId).forEach(function (r) {
      var o = m[r.std_id] || (m[r.std_id] = emptyStat_());
      if (r.status === 'approved') { var b = o[r.type]; if (b) { b.count++; b.days += dayDiff_(r.date_from, r.date_to) + 1; } }
      else if (r.status === 'pending') o.pending++;
      else if (r.status === 'rejected') o.rejected++;
    });
    return m;
  }

  /** สรุปการลารายคน (เฉพาะใบที่อนุมัติ นับครั้ง/วัน) + สถิติเช็คชื่อ (ขาด/เปอร์เซ็นต์) + ธงขาดเกินเกณฑ์ */
  function summary(user, a) {
    var c = Courses.require(user, a.courseId), warn = warnLimit_();
    var st = Attendance.statsAll(c.course_id), by = statsByStd(c.course_id);
    var students = Students.roster(c.course_id).map(function (s) {
      var l = by[s.std_id] || emptyStat_(), o = { stdId: s.std_id, name: s.name, sick: l.sick, personal: l.personal, pending: l.pending, rejected: l.rejected };
      var x = st.byStd[s.std_id] || { normal: 0, late: 0, leave: 0, absent: 0, percent: null };
      o.attend = { normal: x.normal, late: x.late, leave: x.leave, absent: x.absent, percent: x.percent };
      o.over = x.absent > warn;
      return o;
    });
    return { course: courseOut_(c), students: students, warnAbsent: warn, totalSessions: st.totalSessions };
  }
  function exportCsv(user, a) {
    var sm = summary(user, a), c = sm.course;
    var rows = [['รหัสนักศึกษา', 'ชื่อ-นามสกุล', 'ลาป่วย (ครั้ง)', 'ลาป่วย (วัน)', 'ลากิจ (ครั้ง)', 'ลากิจ (วัน)', 'รวมวันลา', 'รออนุมัติ', 'ไม่อนุมัติ', 'ขาด (ครั้ง)', 'เข้าเรียน (%)', 'ขาดเกินเกณฑ์']];
    sm.students.forEach(function (s) {
      rows.push([s.stdId, s.name, s.sick.count, s.sick.days, s.personal.count, s.personal.days, s.sick.days + s.personal.days, s.pending, s.rejected, s.attend.absent, s.attend.percent === null ? '' : s.attend.percent, s.over ? 'ใช่' : '']);
    });
    var safe = (c.code + '-' + c.section).replace(/[^A-Za-z0-9ก-๙._-]+/g, '_');
    Audit.log(user.email, 'leave.exportCsv', c.courseId, { rows: sm.students.length });
    return { filename: safe + '-leave.csv', csv: U.toCsv(rows) };
  }

  /* ============================== ผูกกับระบบอื่น ============================== */
  /** ใบลาที่อนุมัติของวิชา → { stdId: [{from,to,allDay,tf,tt,type}] } (Attendance ใช้แสดง "ล") */
  function approvedMap(courseId) {
    var m = {};
    Db.findRows('LeaveRequests', 'course_id', courseId).forEach(function (r) {
      if (r.status !== 'approved') return;
      (m[r.std_id] = m[r.std_id] || []).push({ from: r.date_from, to: r.date_to, allDay: U.bool(r.all_day), tf: r.time_from, tt: r.time_to, type: r.type });
    });
    return m;
  }
  /** ใบลา (จาก approvedMap) ครอบคลุมคาบวันที่ date (+เวลาเริ่ม startAt 'yyyy-MM-dd HH:mm:ss' ถ้ามี) ไหม */
  function covers(list, date, startAt) {
    if (!list || !date) return false;
    var hm = startAt && String(startAt).length >= 16 ? String(startAt).substring(11, 16) : '';
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (date < x.from || date > x.to) continue;
      if (x.allDay || !hm) return true;               // ลาทั้งวัน หรือคาบไม่มีเวลาเริ่ม (นำเข้าย้อนหลัง) = จับตามวัน
      if (hm >= x.tf && hm < x.tt) return true;
    }
    return false;
  }
  function newCounts() {
    var m = {};
    Db.all('LeaveRequests').forEach(function (r) { if (r.status === 'pending') m[r.course_id] = (m[r.course_id] || 0) + 1; });
    return m;
  }
  /** ลบนักศึกษา → ใบลา+ไฟล์ของเขาหายไปด้วย */
  function countForStudent(courseId, stdId) {
    return Db.findRows('LeaveRequests', 'std_id', stdId).filter(function (r) { return r.course_id === courseId; }).length;
  }
  function removeForStudents(courseId, stdIds) {
    var set = {}; stdIds.forEach(function (i) { set[i] = true; });
    return dropRows_(Db.findRows('LeaveRequests', 'course_id', courseId).filter(function (r) { return set[r.std_id] === true; }));
  }
  /** ไฟล์ Drive ของใบลาในวิชา (ใช้ตอนรีเซ็ต/ลบวิชา) → [{ leaveId, ids[] }] เฉพาะที่ยังมีไฟล์ */
  function driveIds(courseId) {
    return Db.findRows('LeaveRequests', 'course_id', courseId).filter(function (r) { return r.form_drive_id || r.extra_drive_id; })
      .map(function (r) { return { leaveId: r.leave_id, ids: [r.form_drive_id, r.extra_drive_id].filter(function (x) { return x; }) }; });
  }

  return {
    info: info, formGet: formGet, formSet: formSet, formDelete: formDelete,
    submit: submit, attach: attach, mine: mine, cancel: cancel,
    list: list, decide: decide, fileGet: fileGet, create: create, remove: remove, summary: summary, exportCsv: exportCsv,
    approvedMap: approvedMap, statsByStd: statsByStd, covers: covers, newCounts: newCounts, countForStudent: countForStudent, removeForStudents: removeForStudents, driveIds: driveIds
  };
})();
