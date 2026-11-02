/**************************************************************
 * File: Courses.gs  (HBT Core v0.3.0)
 * รายวิชา (ต่อภาคเรียน) — เจ้าของคนเดียว (owner_email)
 *  - อาจารย์เห็น/แก้เฉพาะวิชาของตัวเอง · admin เห็นและช่วยแก้ได้ทุกวิชา
 *  - ไม่มีการลบรายวิชาจากหน้าเว็บ: ลบได้เฉพาะตอน admin รีเซ็ตภาคเรียน (ขั้นถัดไป)
 *  - courseId เป็นรหัสสุ่ม (ไม่ผูกกับชื่อ) เพื่อให้แก้รหัส/กลุ่มได้โดยไม่กระทบข้อมูลที่อ้างถึง
 **************************************************************/

var Courses = (function () {

  function out_(r, counts) {
    var t = r.term_id ? Db.byId('Terms', r.term_id) : null;
    return {
      courseId: r.course_id, termId: r.term_id, termName: t ? t.name : '',
      code: r.code, name: r.name, section: r.section, ownerEmail: r.owner_email,
      students: counts ? (counts[r.course_id] || 0) : undefined,
      createdAt: r.created_at, lastChangeAt: r.last_change_at, backupAt: r.backup_at, resetting: !!r.reset_at
    };
  }

  function studentCounts_() {
    var m = {};
    Db.all('Students').forEach(function (s) { m[s.course_id] = (m[s.course_id] || 0) + 1; });
    return m;
  }

  /** คืนแถวรายวิชา ถ้าผู้ใช้เป็นเจ้าของหรือเป็น admin (ไม่งั้น E_FORBIDDEN) */
  function require_(user, courseId) {
    var id = U.req(courseId, 'courseId');
    var r = Db.byId('Courses', id);
    if (!r) throw U.E('E_NOT_FOUND');
    if (user.role !== 'admin' && r.owner_email !== user.email) throw U.E('E_FORBIDDEN');
    if (r.reset_at) throw U.E('E_COURSE_RESETTING');        // admin กำลังลบวิชานี้ (ดู Reset.gs)
    return r;
  }

  function clean_(a) {
    var code = String(a.code === undefined || a.code === null ? '' : a.code).replace(/\s+/g, '').toUpperCase();
    var name = String(a.name === undefined || a.name === null ? '' : a.name).replace(/\s+/g, ' ').trim();
    var section = String(a.section === undefined || a.section === null ? '' : a.section).replace(/\s+/g, '').trim();
    if (!code || code.length > 20) throw U.E('E_COURSE_FIELD', { field: 'code' }, 'รหัสวิชาต้องมี 1–20 ตัวอักษร');
    if (!name || name.length > 150) throw U.E('E_COURSE_FIELD', { field: 'name' }, 'ชื่อวิชาต้องมี 1–150 ตัวอักษร');
    if (!section || section.length > 10) throw U.E('E_COURSE_FIELD', { field: 'section' }, 'กลุ่มเรียนต้องมี 1–10 ตัวอักษร');
    return { code: code, name: name, section: section };
  }

  function dup_(owner, termId, code, section, exceptId) {
    return Db.all('Courses').some(function (r) {
      return r.course_id !== exceptId && r.owner_email === owner && r.term_id === termId && r.code === code && r.section === section;
    });
  }

  /** รายวิชาของผู้ใช้ในภาคเรียนที่ระบุ (ค่าเริ่มต้น = ภาคเรียนปัจจุบัน) · admin ส่ง all:true เพื่อดูทุกคน */
  function list(user, a) {
    var term = a.termId ? Db.byId('Terms', String(a.termId)) : Terms.current();
    var termId = term ? (term.term_id || term.termId) : '';
    var termName = term ? term.name : '';
    if (a.termId && !term) throw U.E('E_NOT_FOUND');
    var all = user.role === 'admin' && U.bool(a.all);
    var counts = studentCounts_();
    var rows = Db.all('Courses').filter(function (r) {
      return r.term_id === termId && (all || r.owner_email === user.email);
    }).sort(function (x, y) { return (x.code + '-' + x.section) < (y.code + '-' + y.section) ? -1 : 1; });
    return {
      term: term ? { termId: termId, name: termName } : null,
      courses: rows.map(function (r) { return out_(r, counts); })
    };
  }

  function get(user, courseId) {
    var r = require_(user, courseId);
    var counts = studentCounts_();
    var c = out_(r, counts);
    var roster = Db.findRows('Students', 'course_id', r.course_id);
    var st = Pin.statuses(roster.map(function (s) { return s.std_id; }));
    c.pinSet = roster.filter(function (s) { return st[s.std_id] === 'set'; }).length;
    c.scoreTypes = Db.all('ScoreTypes').filter(function (t) { return t.course_id === r.course_id; }).length;
    return c;
  }

  function create(user, a) {
    var cur = Terms.current();
    var termId = a.termId ? String(a.termId) : (cur ? cur.termId : '');
    if (!termId) throw U.E('E_NO_TERM');
    if (!Db.byId('Terms', termId)) throw U.E('E_NOT_FOUND');
    var f = clean_(a);
    if (dup_(user.email, termId, f.code, f.section, '')) throw U.E('E_COURSE_DUP');
    var id = U.uid('CRS'), now = U.nowIso();
    Db.insert('Courses', {
      course_id: id, term_id: termId, code: f.code, name: f.name, section: f.section,
      owner_email: user.email, created_at: now, last_change_at: now
    });
    Audit.log(user.email, 'course.create', id, f.code + '-' + f.section);
    return out_(Db.byId('Courses', id), {});
  }

  function update(user, a) {
    var r = require_(user, a.courseId);
    var f = clean_({
      code: a.code === undefined ? r.code : a.code,
      name: a.name === undefined ? r.name : a.name,
      section: a.section === undefined ? r.section : a.section
    });
    if (dup_(r.owner_email, r.term_id, f.code, f.section, r.course_id)) throw U.E('E_COURSE_DUP');
    Db.update('Courses', r.course_id, { code: f.code, name: f.name, section: f.section, last_change_at: U.nowIso() });
    Audit.log(user.email, 'course.update', r.course_id, f.code + '-' + f.section);
    return out_(Db.byId('Courses', r.course_id), studentCounts_());
  }

  /** บันทึกว่าข้อมูลในวิชามีการเปลี่ยน (ใช้เทียบกับเวลาสำรองข้อมูลในขั้นถัดไป) */
  function touch(courseId) {
    try { Db.update('Courses', courseId, { last_change_at: U.nowIso() }); } catch (e) {}
  }

  /** ---------- สำหรับหน้านักศึกษา (ไม่ต้องล็อกอิน) ---------- */
  function tid_(email) { return U.sha256('tid|' + email).substring(0, 12); }

  function pubTeachers() {
    var cur = Terms.current();
    if (!cur) return { teachers: [] };
    var seen = {}, out = [];
    Db.all('Courses').forEach(function (r) {
      if (r.term_id !== cur.termId || seen[r.owner_email] || r.reset_at) return;
      var u = Users.get(r.owner_email);
      if (!u || !u.active) return;
      seen[r.owner_email] = true;
      out.push({ tid: tid_(r.owner_email), name: u.name });
    });
    out.sort(function (a, b) { return a.name.localeCompare(b.name, 'th'); });
    return { teachers: out };
  }

  function pubCourses(tid) {
    var cur = Terms.current();
    if (!cur) return { courses: [] };
    var t = String(tid || '');
    var out = Db.all('Courses').filter(function (r) { return r.term_id === cur.termId && !r.reset_at && tid_(r.owner_email) === t; })
      .map(function (r) { return { courseId: r.course_id, code: r.code, name: r.name, section: r.section }; });
    out.sort(function (a, b) { return (a.code + a.section) < (b.code + b.section) ? -1 : 1; });
    return { courses: out };
  }

  return { list: list, get: get, create: create, update: update, require: require_, touch: touch, pubTeachers: pubTeachers, pubCourses: pubCourses, tidOf: tid_ };
})();
