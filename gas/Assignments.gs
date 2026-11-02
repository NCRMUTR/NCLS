/**************************************************************
 * File: Assignments.gs  (HBT Core v0.4.0)
 * ส่งงาน: อาจารย์สั่งงาน (เดี่ยว/กลุ่ม) → นักศึกษาเข้าด้วยลิงก์ถาวร + รหัสงาน + ชื่อ + PIN → ส่งข้อความ/ลิงก์/ไฟล์
 *
 * ที่เก็บ : Assignments · AsgGroups · AsgMembers · AsgSubs · AsgFiles · AsgGrades (ชีต) · ไฟล์จริงใน Drive ส่วนกลาง (HBT_Files/…)
 * ตัวตนนักศึกษา: stu.login (PIN) → token ชนิด 's' อายุ 2 ชม. — ไม่ต้องใส่ PIN ซ้ำทุกคำสั่ง แต่ token ใช้ได้เฉพาะวิชาของตัวเอง
 *
 * เฟสเวลา (คำนวณที่ server)  open → (เลย due) late [ถ้ารับช้า] → closed [เลย close_at หรืออาจารย์กดปิด]
 * กติกา
 *   - ส่งซ้ำ = แก้ได้จนกว่างานปิดหรืออาจารย์ให้คะแนนแล้ว (ลบไฟล์เก่า/เพิ่มไฟล์ใหม่ · เวลาส่ง = เวลาแก้ล่าสุด)
 *   - งานกลุ่ม: ตัวแทนสร้างกลุ่มและเลือกสมาชิก · 1 คนอยู่ได้กลุ่มเดียวต่องาน (คีย์ asg|std กันซ้ำ) · ส่งได้เฉพาะตัวแทน
 *   - คะแนนเขียนเป็นรายคนเสมอ (ให้ทั้งกลุ่ม = เขียนค่าเดียวกันให้ทุกคน) แล้วซิงก์เข้าประเภทคะแนน ASSIGN (น้ำหนักเริ่ม 0%)
 *   - ไฟล์: ชนิด/ขนาด/จำนวนตามหน้าตั้งค่า · ตรวจ "ไบต์หัวไฟล์" ตรงกับชนิด · ที่เก็บ = Drive ของเจ้าของ Web App (ไม่แชร์สาธารณะ)
 *     อาจารย์ดาวน์โหลดผ่าน asg.fileGet (ผ่านสิทธิ์ระบบ) · อัปโหลดไป Drive "นอก lock" แล้วค่อยล็อกตอนบันทึกแถว (ไม่บล็อกเช็คชื่อของคนอื่น)
 *   - ไฟล์ที่ถูกลบ/แทนที่ → ถังขยะของ Drive (ลบถาวรเป็นหน้าที่ของ admin รีเซ็ต — ขั้นถัดไป)
 **************************************************************/

var Assignments = (function () {

  var KINDS = ['single', 'group'];
  var ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';            // ไม่มี I O L 0 1 (อ่านสับสน)
  var TYPES = {                                             // ชนิดไฟล์ที่รองรับ (ตามหน้าตั้งค่า file_types) → mime + ไบต์หัวไฟล์
    pdf:  { mime: 'application/pdf', magic: 'pdf' },
    jpg:  { mime: 'image/jpeg', magic: 'jpg' },
    png:  { mime: 'image/png', magic: 'png' },
    docx: { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', magic: 'zip' },
    xlsx: { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', magic: 'zip' },
    pptx: { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', magic: 'zip' }
  };
  var DUP_SEC = 60;

  function r2_(n) { return Math.round(n * 100) / 100; }
  function ms_(v) { var d = U.toDate(v); return d ? d.getTime() : NaN; }
  function bool_(v, def) { return (v === undefined || v === null || v === '') ? def : U.bool(v); }
  function clip_(v, n) { return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').substring(0, n); }
  function oneLine_(v, n) { return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, n); }
  function key_(asgId, id) { return asgId + '|' + id; }

  /* ---------- เวลา / เฟส ---------- */
  function when_(v, field) {
    if (v === undefined || v === null || String(v).trim() === '') return '';
    var m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/.exec(String(v).trim());
    if (!m || !Terms.validYmd(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) throw U.E('E_ASG_FIELD', { field: field }, 'วัน-เวลาไม่ถูกต้อง (ปี-เดือน-วัน ชั่วโมง:นาที)');
    return m[1] + ' ' + m[2] + ':' + m[3] + ':00';
  }
  /** open | late | closed */
  function phase_(a, nowMs) {
    if (a.status === 'closed') return 'closed';
    var close = ms_(a.close_at), due = ms_(a.due_at);
    if (!isNaN(close) && nowMs > close) return 'closed';
    if (!isNaN(due) && nowMs > due) return U.bool(a.late_ok) ? 'late' : 'closed';
    return 'open';
  }
  function isLate_(a, updatedAt) { var due = ms_(a.due_at), u = ms_(updatedAt); return !isNaN(due) && !isNaN(u) && u > due; }

  /* ---------- อ่านข้อมูลของวิชา (ครั้งเดียวต่อคำขอ) ---------- */
  function load_(courseId) {
    var L = { roster: Students.roster(courseId), names: {}, subs: {}, grades: {}, groups: {}, members: {}, files: {} };
    L.roster.forEach(function (s) { L.names[s.std_id] = s.name; });
    function bucket(o, k) { return o[k] || (o[k] = {}); }
    Db.findRows('AsgSubs', 'course_id', courseId).forEach(function (r) { bucket(L.subs, r.asg_id)[r.sub_key] = r; });
    Db.findRows('AsgGrades', 'course_id', courseId).forEach(function (r) { bucket(L.grades, r.asg_id)[r.std_id] = r; });
    Db.findRows('AsgGroups', 'course_id', courseId).forEach(function (r) { bucket(L.groups, r.asg_id)[r.group_id] = r; });
    Db.findRows('AsgMembers', 'course_id', courseId).forEach(function (r) { (L.members[r.asg_id] = L.members[r.asg_id] || []).push(r); });
    Db.findRows('AsgFiles', 'course_id', courseId).forEach(function (r) { var b = bucket(L.files, r.asg_id); (b[r.sub_key] = b[r.sub_key] || []).push(r); });
    return L;
  }
  function nameOf_(L, std) { return L.names[std] || std; }
  function gradeOf_(L, asgId, std) { var g = (L.grades[asgId] || {})[std]; return g && g.score !== '' ? g : null; }

  function filesOut_(rows) {
    return (rows || []).slice().sort(function (a, b) { return a.uploaded_at < b.uploaded_at ? -1 : 1; })
      .map(function (f) { return { fileId: f.file_id, name: f.name, size: Number(f.size) || 0, uploadedAt: f.uploaded_at }; });
  }
  function hasContent_(sub, files) { return !!sub && ((files && files.length) || sub.note || sub.link); }

  /** หน่วยงาน: เดี่ยว = นักศึกษา 1 คน · กลุ่ม = 1 กลุ่ม  (+ รายชื่อคนที่ยังไม่มีกลุ่ม) */
  function units_(a, L) {
    var asgId = a.asg_id, subs = L.subs[asgId] || {}, files = L.files[asgId] || {}, out = [], ungrouped = [];
    if (a.kind === 'single') {
      L.roster.forEach(function (st) {
        var k = key_(asgId, st.std_id);
        out.push({ subKey: k, groupId: '', name: st.name, rep: st.std_id, members: [st.std_id], sub: subs[k] || null, files: files[k] || [] });
      });
      return { units: out, ungrouped: ungrouped };
    }
    var inGroup = {}, byGroup = {};
    (L.members[asgId] || []).forEach(function (m) { inGroup[m.std_id] = true; (byGroup[m.group_id] = byGroup[m.group_id] || []).push(m.std_id); });
    var groups = L.groups[asgId] || {};
    Object.keys(groups).sort(function (x, y) { return groups[x].created_at < groups[y].created_at ? -1 : 1; }).forEach(function (gid) {
      var g = groups[gid], k = key_(asgId, gid), mem = (byGroup[gid] || []).slice().sort();
      out.push({ subKey: k, groupId: gid, name: g.name || ('กลุ่มของ ' + nameOf_(L, g.rep_std)), rep: g.rep_std, members: mem, sub: subs[k] || null, files: files[k] || [] });
    });
    L.roster.forEach(function (st) { if (!inGroup[st.std_id]) ungrouped.push({ stdId: st.std_id, name: st.name }); });
    return { units: out, ungrouped: ungrouped };
  }
  function allGraded_(L, asgId, u) { return u.members.length > 0 && u.members.every(function (s) { return !!gradeOf_(L, asgId, s); }); }
  function anyGraded_(L, asgId, u) { return u.members.some(function (s) { return !!gradeOf_(L, asgId, s); }); }

  /* ---------- Drive ---------- */
  function driveErr_(e) { return (e && e.code) ? e : U.E('E_DRIVE', { why: String(e && e.message || e).substring(0, 200) }); }
  function rootFolder_() {
    try {
      var id = Db.prop('DRV_ROOT');
      if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* ถูกลบ/ย้าย → หาใหม่ */ } }
      var it = DriveApp.getFoldersByName('HBT_Files');
      var f = it.hasNext() ? it.next() : DriveApp.createFolder('HBT_Files');
      Db.setProp('DRV_ROOT', f.getId());
      return f;
    } catch (e) { throw driveErr_(e); }
  }
  function trashFile_(driveId) { try { if (driveId) DriveApp.getFileById(driveId).setTrashed(true); } catch (e) { /* ไฟล์หายไปแล้ว ไม่เป็นไร */ } }
  function trashFolder_(id) { try { if (id) DriveApp.getFolderById(id).setTrashed(true); } catch (e) { /* ignore */ } }

  /* ---------- รหัสงาน ---------- */
  function genCode_() {
    for (var n = 0; n < 30; n++) {
      var hex = U.randomHex(8), s = '';
      for (var i = 0; i < 6; i++) s += ALPHA.charAt(parseInt(hex.substr(i * 2, 2), 16) % ALPHA.length);
      var code = s.substring(0, 3) + '-' + s.substring(3);
      if (!Db.findRows('Assignments', 'code', code).length) return code;
    }
    throw U.E('E_BUSY');
  }
  function normCode_(v) {
    var s = String(v === undefined || v === null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
    return s.length === 6 ? s.substring(0, 3) + '-' + s.substring(3) : '';
  }

  function limits_() {
    var mb = Math.min(Number(Settings.get('file_max_mb')) || 5, APP.MAX_FILE_MB);
    var types = String(Settings.get('file_types') || '').split(',').map(function (x) { return x.trim().toLowerCase(); }).filter(function (x) { return TYPES[x]; });
    return { maxMb: mb, maxBytes: mb * 1024 * 1024, maxCount: Number(Settings.get('file_max_count')) || 5, types: types };
  }

  /* ---------- ผลลัพธ์ ---------- */
  function asgOut_(a) {
    return {
      asgId: a.asg_id, courseId: a.course_id, code: a.code, title: a.title, description: a.description, kind: a.kind,
      maxScore: Number(a.max_score), dueAt: a.due_at, lateOk: U.bool(a.late_ok), closeAt: a.close_at, status: a.status,
      phase: phase_(a, Date.now()), maxGroup: Number(a.max_group) || 5, showGrades: U.bool(a.show_grades), linkUrl: a.link_url,
      createdAt: a.created_at, updatedAt: a.updated_at
    };
  }
  function statsOf_(a, L) {
    var u = units_(a, L), st = { total: u.units.length, submitted: 0, late: 0, toGrade: 0, graded: 0, ungrouped: u.ungrouped.length };
    u.units.forEach(function (x) {
      if (!hasContent_(x.sub, x.files)) return;
      st.submitted++;
      if (isLate_(a, x.sub.updated_at)) st.late++;
      if (allGraded_(L, a.asg_id, x)) st.graded++; else st.toGrade++;
    });
    return st;
  }

  /** งาน + ตรวจสิทธิ์ (เจ้าของวิชาหรือ admin) */
  function asgFor_(user, asgId) {
    var a = Db.byId('Assignments', U.req(asgId, 'asgId'));
    if (!a) throw U.E('E_NOT_FOUND');
    Courses.require(user, a.course_id);
    return a;
  }

  /* ============================== อาจารย์ ============================== */
  function list(user, a) {
    var c = Courses.require(user, a.courseId), L = load_(c.course_id);
    var rows = Db.findRows('Assignments', 'course_id', c.course_id).sort(function (x, y) { return x.created_at < y.created_at ? 1 : -1; }).map(function (r) {
      var o = asgOut_(r); o.stats = statsOf_(r, L); return o;
    });
    return { assignments: rows, students: L.roster.length, tid: Courses.tidOf(c.owner_email) };
  }

  function get(user, a) {
    var r = asgFor_(user, a.asgId), L = load_(r.course_id), o = asgOut_(r);
    o.stats = statsOf_(r, L); o.limits = limits_();
    var co = Db.byId('Courses', r.course_id);
    o.tid = Courses.tidOf(co.owner_email); o.course = { courseId: co.course_id, code: co.code, name: co.name, section: co.section };
    return o;
  }

  function save(user, a) {
    var ex = a.asgId ? asgFor_(user, a.asgId) : null;
    var c = ex ? Db.byId('Courses', ex.course_id) : Courses.require(user, a.courseId);
    var title = oneLine_(a.title !== undefined ? a.title : (ex ? ex.title : ''), 150);
    if (!title) throw U.E('E_ASG_FIELD', { field: 'title' }, 'กรุณากรอกชื่องาน');
    var desc = clip_(a.description !== undefined ? a.description : (ex ? ex.description : ''), 4000);
    var kind = a.kind !== undefined ? String(a.kind) : (ex ? ex.kind : 'single');
    if (KINDS.indexOf(kind) < 0) throw U.E('E_ASG_FIELD', { field: 'kind' }, 'ประเภทงานต้องเป็น เดี่ยว หรือ กลุ่ม');
    var maxScore = a.maxScore !== undefined && a.maxScore !== '' ? Number(a.maxScore) : (ex ? Number(ex.max_score) : 10);
    if (isNaN(maxScore) || maxScore <= 0 || maxScore > 1000) throw U.E('E_ASG_FIELD', { field: 'maxScore' }, 'คะแนนเต็มต้องเป็นตัวเลข 0.01–1000');
    maxScore = r2_(maxScore);
    var dueAt = a.dueAt !== undefined ? when_(a.dueAt, 'dueAt') : (ex ? ex.due_at : '');
    var closeAt = a.closeAt !== undefined ? when_(a.closeAt, 'closeAt') : (ex ? ex.close_at : '');
    if (dueAt && closeAt && ms_(closeAt) < ms_(dueAt)) throw U.E('E_ASG_FIELD', { field: 'closeAt' }, 'วันปิดรับต้องไม่ก่อนกำหนดส่ง');
    var lateOk = bool_(a.lateOk, ex ? U.bool(ex.late_ok) : false);
    var maxGroup = a.maxGroup !== undefined && a.maxGroup !== '' ? Number(a.maxGroup) : (ex ? Number(ex.max_group) || 5 : 5);
    if (isNaN(maxGroup) || Math.floor(maxGroup) !== maxGroup || maxGroup < 1 || maxGroup > 30) throw U.E('E_ASG_FIELD', { field: 'maxGroup' }, 'จำนวนสมาชิกกลุ่มต้องเป็นจำนวนเต็ม 1–30');
    var showGrades = bool_(a.showGrades, ex ? U.bool(ex.show_grades) : true);
    var link = a.linkUrl !== undefined ? oneLine_(a.linkUrl, 500) : (ex ? ex.link_url : '');
    if (link && !/^https?:\/\/[^\s]{3,}$/i.test(link)) throw U.E('E_ASG_FIELD', { field: 'linkUrl' }, 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://');
    var now = U.nowIso();

    if (!ex) {
      var code = genCode_();
      var folder;
      try { folder = rootFolder_().createFolder((c.code + '-' + c.section + '_' + code).replace(/[\\\/:*?"<>|]+/g, '_')); } catch (e) { throw driveErr_(e); }
      var id = U.uid('ASG');
      Db.insert('Assignments', {
        asg_id: id, course_id: c.course_id, code: code, title: title, description: desc, kind: kind, max_score: maxScore, due_at: dueAt,
        late_ok: U.bstr(lateOk), close_at: closeAt, status: 'open', max_group: maxGroup, show_grades: U.bstr(showGrades), link_url: link,
        folder_id: folder.getId(), created_by: user.email, created_at: now, updated_at: now
      });
      Scores.ensureType(c.course_id, 'ASSIGN', id, { name: title, max: maxScore });
      Courses.touch(c.course_id);
      Audit.log(user.email, 'asg.create', id, { course: c.course_id, code: code, kind: kind });
      return get(user, { asgId: id });
    }

    var L = load_(ex.course_id);
    if (kind !== ex.kind) {
      var us = units_(ex, L);
      var used = us.units.some(function (u) { return hasContent_(u.sub, u.files); }) || (L.members[ex.asg_id] || []).length || Object.keys(L.groups[ex.asg_id] || {}).length;
      if (used) throw U.E('E_ASG_KIND_LOCKED');
    }
    if (maxScore < Number(ex.max_score)) {
      var g = L.grades[ex.asg_id] || {};
      Object.keys(g).forEach(function (k) { if (g[k].score !== '' && Number(g[k].score) > maxScore) throw U.E('E_ASG_MAX_LOW'); });
    }
    Db.update('Assignments', ex.asg_id, {
      title: title, description: desc, kind: kind, max_score: maxScore, due_at: dueAt, late_ok: U.bstr(lateOk), close_at: closeAt,
      max_group: maxGroup, show_grades: U.bstr(showGrades), link_url: link, updated_at: now
    });
    Scores.updateAuto(ex.course_id, 'ASSIGN', ex.asg_id, { name: title, max: maxScore });
    Courses.touch(ex.course_id);
    Audit.log(user.email, 'asg.update', ex.asg_id, '');
    return get(user, { asgId: ex.asg_id });
  }

  function setStatus(user, a) {
    var r = asgFor_(user, a.asgId), closed = U.bool(a.closed);
    Db.update('Assignments', r.asg_id, { status: closed ? 'closed' : 'open', updated_at: U.nowIso() });
    Audit.log(user.email, closed ? 'asg.close' : 'asg.reopen', r.asg_id, '');
    return get(user, { asgId: r.asg_id });
  }

  /** ลบงานถาวร: แถวทั้งหมด + คะแนน + ไฟล์ (ลง Drive ถังขยะ) */
  function remove(user, a) {
    var r = asgFor_(user, a.asgId);
    var files = Db.findRows('AsgFiles', 'asg_id', r.asg_id);
    files.forEach(function (f) { trashFile_(f.drive_id); });
    Db.removeWhere('AsgFiles', function (o) { return o.asg_id === r.asg_id; });
    Db.removeWhere('AsgSubs', function (o) { return o.asg_id === r.asg_id; });
    Db.removeWhere('AsgGrades', function (o) { return o.asg_id === r.asg_id; });
    Db.removeWhere('AsgMembers', function (o) { return o.asg_id === r.asg_id; });
    Db.removeWhere('AsgGroups', function (o) { return o.asg_id === r.asg_id; });
    var sc = Scores.removeAuto(r.course_id, 'ASSIGN', r.asg_id);
    Db.remove('Assignments', r.asg_id);
    trashFolder_(r.folder_id);
    Courses.touch(r.course_id);
    Audit.log(user.email, 'asg.delete', r.asg_id, { files: files.length, scores: sc });
    return { deletedFiles: files.length };
  }

  function submissions(user, a) {
    var r = asgFor_(user, a.asgId), L = load_(r.course_id), u = units_(r, L);
    var units = u.units.map(function (x) {
      var has = hasContent_(x.sub, x.files);
      return {
        subKey: x.subKey, groupId: x.groupId, name: x.name, rep: x.groupId ? { stdId: x.rep, name: nameOf_(L, x.rep) } : null,
        members: x.members.map(function (s) {
          var g = (L.grades[r.asg_id] || {})[s];
          return { stdId: s, name: nameOf_(L, s), score: g && g.score !== '' ? Number(g.score) : null, feedback: g ? g.feedback : '' };
        }),
        submitted: !!has, note: has ? x.sub.note : '', link: has ? x.sub.link : '', firstAt: has ? x.sub.first_at : '', updatedAt: has ? x.sub.updated_at : '',
        late: has ? isLate_(r, x.sub.updated_at) : false, files: has ? filesOut_(x.files) : [], graded: allGraded_(L, r.asg_id, x)
      };
    });
    return { assignment: asgOut_(r), units: units, ungrouped: u.ungrouped, stats: statsOf_(r, L) };
  }

  function fileGet(user, a) {
    var f = Db.byId('AsgFiles', U.req(a.fileId, 'fileId'));
    if (!f) throw U.E('E_NOT_FOUND');
    Courses.require(user, f.course_id);
    var bytes;
    try { bytes = DriveApp.getFileById(f.drive_id).getBlob().getBytes(); } catch (e) { throw U.E('E_NOT_FOUND', { why: 'drive' }); }
    Audit.log(user.email, 'asg.fileGet', f.file_id, '');
    return { name: f.name, mime: f.mime, size: bytes.length, b64: Utilities.base64Encode(bytes) };
  }

  /** ให้คะแนน/ความเห็น: grades = [{stdId, score, feedback}] (ว่างทั้งคู่ = ลบ) · งานกลุ่มให้ทั้งกลุ่ม = ส่งรายชื่อสมาชิกทุกคนพร้อมคะแนนเดียวกัน */
  function grade(user, a) {
    var r = asgFor_(user, a.asgId), rows = a.grades;
    if (!Array.isArray(rows) || !rows.length) throw U.E('E_BAD_REQUEST', { why: 'grades' });
    if (rows.length > 1000) throw U.E('E_BAD_REQUEST', { why: 'too_many', max: 1000 });
    var max = Number(r.max_score), roster = {};
    Students.roster(r.course_id).forEach(function (s) { roster[s.std_id] = true; });
    var seen = {}, skipped = [], sync = [], saved = 0, cleared = 0, now = U.nowIso();
    rows.forEach(function (x, i) {
      var id;
      try { id = Students.cleanId(x && x.stdId); } catch (e) { skipped.push({ row: i + 1, stdId: String(x && x.stdId || '').substring(0, 30), why: 'รหัสนักศึกษาไม่ถูกต้อง' }); return; }
      if (!roster[id]) { skipped.push({ row: i + 1, stdId: id, why: 'ไม่อยู่ในรายชื่อวิชานี้' }); return; }
      if (seen[id]) { skipped.push({ row: i + 1, stdId: id, why: 'รหัสซ้ำ (ใช้แถวแรก)' }); return; }
      seen[id] = true;
      var raw = x.score, blank = (raw === undefined || raw === null || String(raw).trim() === ''), score = '';
      if (!blank) {
        score = Number(String(raw).replace(/,/g, ''));
        if (isNaN(score) || score < 0) { skipped.push({ row: i + 1, stdId: id, why: 'คะแนนไม่ถูกต้อง' }); return; }
        if (score > max + 1e-9) { skipped.push({ row: i + 1, stdId: id, why: 'เกินคะแนนเต็ม ' + max }); return; }
        score = r2_(score);
      }
      var fb = oneLine_(x.feedback, 1000), k = key_(r.asg_id, id), ex = Db.byId('AsgGrades', k);
      if (blank && !fb) { if (ex) { Db.remove('AsgGrades', k); } cleared++; sync.push({ stdId: id, score: '' }); return; }
      var row = { score: score, feedback: fb, graded_by: user.email, graded_at: now };
      if (ex) Db.update('AsgGrades', k, row);
      else Db.insert('AsgGrades', Object.assign({ gr_key: k, asg_id: r.asg_id, course_id: r.course_id, std_id: id }, row));
      saved++; sync.push({ stdId: id, score: score });
    });
    var type = Scores.ensureType(r.course_id, 'ASSIGN', r.asg_id, { name: r.title, max: max });
    if (sync.length) Scores.setRecords(r.course_id, type.type_id, sync, 'assignment');
    Courses.touch(r.course_id);
    Audit.log(user.email, 'asg.grade', r.asg_id, { saved: saved, cleared: cleared, skipped: skipped.length });
    return { saved: saved, cleared: cleared, skipped: skipped.slice(0, 100), skippedCount: skipped.length };
  }

  /* ============================== นักศึกษา ============================== */
  /** หาจากรหัสงาน + อาจารย์ที่เลือก (ไม่ล็อกอิน) */
  function resolve(a) {
    var code = normCode_(a.code);
    if (!code) throw U.E('E_NOT_FOUND');
    var r = Db.findRows('Assignments', 'code', code)[0], cur = Terms.current();
    if (!r || !cur) throw U.E('E_NOT_FOUND');
    var c = Db.byId('Courses', r.course_id);
    if (!c || c.term_id !== cur.termId || Courses.tidOf(c.owner_email) !== String(a.tid || '')) throw U.E('E_NOT_FOUND');
    return { asgId: r.asg_id, courseId: c.course_id, title: r.title, kind: r.kind, phase: phase_(r, Date.now()), course: { code: c.code, name: c.name, section: c.section } };
  }

  function asgOfStudent_(s, asgId) {
    var r = Db.byId('Assignments', String(asgId || ''));
    if (!r || r.course_id !== s.courseId) throw U.E('E_NOT_FOUND');
    return r;
  }
  /** หน่วยงานของนักศึกษาคนนี้ (เดี่ยว = ตัวเอง · กลุ่ม = กลุ่มที่อยู่ หรือ null) */
  function myUnit_(a, std, L) {
    var u = units_(a, L).units;
    if (a.kind === 'single') return u.filter(function (x) { return x.rep === std; })[0] || null;
    return u.filter(function (x) { return x.members.indexOf(std) >= 0; })[0] || null;
  }

  function stuTasks(s) {
    var L = load_(s.courseId);
    var rows = Db.findRows('Assignments', 'course_id', s.courseId).sort(function (x, y) { return x.created_at < y.created_at ? 1 : -1; }).map(function (a) {
      var u = myUnit_(a, s.stdId, L), has = u && hasContent_(u.sub, u.files), g = gradeOf_(L, a.asg_id, s.stdId), show = U.bool(a.show_grades);
      return {
        asgId: a.asg_id, code: a.code, title: a.title, kind: a.kind, maxScore: Number(a.max_score), dueAt: a.due_at, closeAt: a.close_at,
        lateOk: U.bool(a.late_ok), phase: phase_(a, Date.now()), submitted: !!has, updatedAt: has ? u.sub.updated_at : '', late: has ? isLate_(a, u.sub.updated_at) : false,
        needsGroup: a.kind === 'group' && !u, groupName: a.kind === 'group' && u ? u.name : '',
        graded: !!g, score: g && show ? Number(g.score) : null
      };
    });
    return { me: { stdId: s.stdId, name: s.name }, tasks: rows };
  }

  function canEdit_(a, u, std, L) {
    var ph = phase_(a, Date.now());
    if (ph === 'closed') return { ok: false, code: 'E_ASG_CLOSED' };
    if (a.kind === 'group') {
      if (!u) return { ok: false, code: 'E_ASG_NO_GROUP' };
      if (u.rep !== std) return { ok: false, code: 'E_ASG_NOT_REP' };
    }
    if (u && anyGraded_(L, a.asg_id, u)) return { ok: false, code: 'E_ASG_GRADED' };
    return { ok: true };
  }

  function stuTask(s, a) {
    var r = asgOfStudent_(s, a.asgId), L = load_(s.courseId), u = myUnit_(r, s.stdId, L), ed = canEdit_(r, u, s.stdId, L);
    var o = asgOut_(r); delete o.courseId; delete o.createdAt; delete o.updatedAt; delete o.status;
    var has = u && hasContent_(u.sub, u.files);
    var g = gradeOf_(L, r.asg_id, s.stdId), gr = (L.grades[r.asg_id] || {})[s.stdId];
    var out = {
      asg: o, me: { stdId: s.stdId, name: s.name }, limits: limits_(),
      group: null, candidates: [],
      sub: has ? { note: u.sub.note, link: u.sub.link, firstAt: u.sub.first_at, updatedAt: u.sub.updated_at, late: isLate_(r, u.sub.updated_at), files: filesOut_(u.files) } : null,
      canEdit: ed.ok, whyNot: ed.ok ? '' : ed.code,
      grade: g && U.bool(r.show_grades) ? { score: Number(g.score), feedback: gr.feedback } : null, graded: !!g
    };
    if (r.kind === 'group') {
      if (u) {
        out.group = {
          groupId: u.groupId, name: u.name, rep: { stdId: u.rep, name: nameOf_(L, u.rep) }, isRep: u.rep === s.stdId,
          members: u.members.map(function (m) { return { stdId: m, name: nameOf_(L, m) }; })
        };
      }
      var ug = units_(r, L).ungrouped;
      // ตัวแทน (หรือคนที่ยังไม่มีกลุ่ม) เลือกสมาชิกจากคนที่ยังว่างอยู่
      if (!u || u.rep === s.stdId) out.candidates = ug.filter(function (x) { return x.stdId !== s.stdId; });
    }
    return out;
  }

  /** ตัวแทนสร้าง/แก้กลุ่ม  a = { asgId, name?, members:[stdId] }  (ไม่ต้องใส่ตัวเอง) */
  function stuGroupSave(s, a) {
    var r = asgOfStudent_(s, a.asgId);
    if (r.kind !== 'group') throw U.E('E_ASG_NOT_GROUP');
    if (phase_(r, Date.now()) === 'closed') throw U.E('E_ASG_CLOSED');
    var L = load_(s.courseId), mine = myUnit_(r, s.stdId, L);
    if (mine && mine.rep !== s.stdId) throw U.E('E_ASG_NOT_REP');
    if (mine && anyGraded_(L, r.asg_id, mine)) throw U.E('E_ASG_GRADED');
    var want = [], seen = {}; seen[s.stdId] = true;
    (Array.isArray(a.members) ? a.members : []).forEach(function (m) {
      var id;
      try { id = Students.cleanId(m); } catch (e) { throw U.E('E_ASG_GROUP', { stdId: String(m).substring(0, 30) }, 'รหัสสมาชิกไม่ถูกต้อง'); }
      if (!seen[id]) { seen[id] = true; want.push(id); }
    });
    var max = Number(r.max_group) || 5;
    if (want.length + 1 > max) throw U.E('E_ASG_GROUP', { max: max }, 'กลุ่มนี้มีสมาชิกได้ไม่เกิน ' + max + ' คน (รวมตัวแทน)');
    var take = {};
    (L.members[r.asg_id] || []).forEach(function (m) { take[m.std_id] = m.group_id; });
    want.forEach(function (id) {
      if (!L.names[id]) throw U.E('E_ASG_GROUP', { stdId: id }, 'ไม่พบรหัส ' + id + ' ในวิชานี้');
      if (take[id] && (!mine || take[id] !== mine.groupId)) throw U.E('E_ASG_GROUP', { stdId: id }, L.names[id] + ' อยู่ในกลุ่มอื่นแล้ว');
    });
    var name = oneLine_(a.name, 60), now = U.nowIso(), gid;
    if (!mine) {
      gid = U.uid('GRP');
      Db.insert('AsgGroups', { group_id: gid, asg_id: r.asg_id, course_id: r.course_id, name: name, rep_std: s.stdId, created_at: now });
      Db.insert('AsgMembers', { mem_key: key_(r.asg_id, s.stdId), asg_id: r.asg_id, course_id: r.course_id, group_id: gid, std_id: s.stdId });
    } else {
      gid = mine.groupId;
      Db.update('AsgGroups', gid, { name: name });
    }
    var cur = mine ? mine.members : [s.stdId];
    cur.forEach(function (id) { if (id !== s.stdId && want.indexOf(id) < 0) Db.remove('AsgMembers', key_(r.asg_id, id)); });
    want.forEach(function (id) {
      if (cur.indexOf(id) < 0) Db.insert('AsgMembers', { mem_key: key_(r.asg_id, id), asg_id: r.asg_id, course_id: r.course_id, group_id: gid, std_id: id });
    });
    Audit.log(s.stdId + '@' + s.courseId, mine ? 'asg.groupEdit' : 'asg.groupCreate', r.asg_id, { group: gid, members: want.length + 1 });
    return { groupId: gid, members: want.length + 1 };
  }

  function stuGroupDelete(s, a) {
    var r = asgOfStudent_(s, a.asgId);
    if (r.kind !== 'group') throw U.E('E_ASG_NOT_GROUP');
    var L = load_(s.courseId), u = myUnit_(r, s.stdId, L);
    if (!u) throw U.E('E_ASG_NO_GROUP');
    if (u.rep !== s.stdId) throw U.E('E_ASG_NOT_REP');
    if (phase_(r, Date.now()) === 'closed') throw U.E('E_ASG_CLOSED');
    if (anyGraded_(L, r.asg_id, u)) throw U.E('E_ASG_GRADED');
    if (hasContent_(u.sub, u.files)) throw U.E('E_ASG_HAS_SUB');
    if (u.sub) Db.remove('AsgSubs', u.subKey);
    Db.removeWhere('AsgMembers', function (o) { return o.group_id === u.groupId; });
    Db.remove('AsgGroups', u.groupId);
    Audit.log(s.stdId + '@' + s.courseId, 'asg.groupDelete', r.asg_id, { group: u.groupId });
    return { deleted: true };
  }

  /* ---------- ไฟล์ ---------- */
  function cleanFileName_(v) {
    var n = String(v === undefined || v === null ? '' : v).replace(/^.*[\\\/]/, '').replace(/[\u0000-\u001f\u007f<>:"|?*]+/g, '_').replace(/\s+/g, ' ').trim();
    if (!n || n.length > 200) n = n.substring(n.length - 120);
    return n;
  }
  function extOf_(name) { var m = /\.([A-Za-z0-9]{1,5})$/.exec(name); var e = m ? m[1].toLowerCase() : ''; return e === 'jpeg' ? 'jpg' : e; }
  function magicOk_(kind, b) {
    function x(i) { return (b[i] === undefined ? -1 : b[i] & 255); }
    if (kind === 'pdf') return x(0) === 0x25 && x(1) === 0x50 && x(2) === 0x44 && x(3) === 0x46;
    if (kind === 'png') return x(0) === 0x89 && x(1) === 0x50 && x(2) === 0x4E && x(3) === 0x47;
    if (kind === 'jpg') return x(0) === 0xFF && x(1) === 0xD8 && x(2) === 0xFF;
    if (kind === 'zip') return x(0) === 0x50 && x(1) === 0x4B && x(2) === 0x03 && x(3) === 0x04;
    return false;
  }

  /** ตรวจว่านักศึกษาแก้งานนี้ได้ไหม → { a, u, L } หรือโยน error */
  function editCtx_(s, asgId) {
    var r = asgOfStudent_(s, asgId), L = load_(s.courseId), u = myUnit_(r, s.stdId, L), ed = canEdit_(r, u, s.stdId, L);
    if (!ed.ok) throw U.E(ed.code);
    return { a: r, u: u, L: L, subKey: u.subKey };
  }
  function upsertSub_(ctx, s, patch) {
    var now = U.nowIso(), ex = Db.byId('AsgSubs', ctx.subKey);
    if (ex) { Db.update('AsgSubs', ctx.subKey, Object.assign({ updated_at: now }, patch)); return; }
    Db.insert('AsgSubs', Object.assign({
      sub_key: ctx.subKey, asg_id: ctx.a.asg_id, course_id: ctx.a.course_id, group_id: ctx.u.groupId, owner_std: s.stdId,
      note: '', link: '', first_at: now, updated_at: now
    }, patch));
  }

  /** อัปโหลด 1 ไฟล์  a = { asgId, name, b64 } → เพิ่มเข้างานที่ส่ง */
  function stuUpload(s, a) {
    var lim = limits_(), pre = editCtx_(s, a.asgId);                         // 1) ตรวจสิทธิ์/เฟส ก่อนแตะไฟล์
    var name = cleanFileName_(a.name), ext = extOf_(name);
    if (!name || !TYPES[ext] || lim.types.indexOf(ext) < 0) throw U.E('E_ASG_FILE_TYPE', { allowed: lim.types }, 'รับเฉพาะไฟล์ ' + lim.types.join(', '));
    var b64 = a.b64;
    if (typeof b64 !== 'string' || !b64.length || !/^[A-Za-z0-9+\/=\s]+$/.test(b64)) throw U.E('E_ASG_FILE_BAD');
    if (b64.length * 0.75 > lim.maxBytes + 4096) throw U.E('E_ASG_FILE_SIZE', { maxMb: lim.maxMb }, 'ไฟล์ใหญ่เกิน ' + lim.maxMb + ' MB');
    var bytes;
    try { bytes = Utilities.base64Decode(b64.replace(/\s+/g, '')); } catch (e) { throw U.E('E_ASG_FILE_BAD'); }
    if (!bytes.length) throw U.E('E_ASG_FILE_BAD');
    if (bytes.length > lim.maxBytes) throw U.E('E_ASG_FILE_SIZE', { maxMb: lim.maxMb }, 'ไฟล์ใหญ่เกิน ' + lim.maxMb + ' MB');
    if (!magicOk_(TYPES[ext].magic, bytes)) throw U.E('E_ASG_FILE_BAD');
    var exist = pre.L.files[pre.a.asg_id] ? (pre.L.files[pre.a.asg_id][pre.subKey] || []) : [];
    var dup = exist.filter(function (f) { return f.name === name && Number(f.size) === bytes.length && (Date.now() - ms_(f.uploaded_at)) < DUP_SEC * 1000; })[0];
    if (dup) return { fileId: dup.file_id, name: dup.name, size: Number(dup.size), uploadedAt: dup.uploaded_at, duplicate: true };
    if (exist.length >= lim.maxCount) throw U.E('E_ASG_FILE_COUNT', { max: lim.maxCount });

    var file;                                                                 // 2) ส่งขึ้น Drive นอก lock
    try {
      var folder = DriveApp.getFolderById(pre.a.folder_id);
      var dn = s.stdId + '_' + Date.now().toString(36) + '_' + name;
      file = folder.createFile(Utilities.newBlob(bytes, TYPES[ext].mime, dn));
    } catch (e) { throw driveErr_(e); }

    try {                                                                     // 3) บันทึกแถวใน lock (อ่านสดซ้ำอีกรอบ)
      return U.lock(function () {
        Db.flush();
        var ctx = editCtx_(s, a.asgId), cnt = Db.findRows('AsgFiles', 'sub_key', ctx.subKey).length;
        if (cnt >= lim.maxCount) throw U.E('E_ASG_FILE_COUNT', { max: lim.maxCount });
        var id = U.uid('FIL'), now = U.nowIso();
        upsertSub_(ctx, s, {});
        Db.insert('AsgFiles', {
          file_id: id, sub_key: ctx.subKey, asg_id: ctx.a.asg_id, course_id: ctx.a.course_id, name: name, size: bytes.length,
          mime: TYPES[ext].mime, drive_id: file.getId(), uploaded_at: now, uploaded_by: s.stdId
        });
        Audit.log(s.stdId + '@' + s.courseId, 'asg.upload', ctx.a.asg_id, { file: id, size: bytes.length });
        return { fileId: id, name: name, size: bytes.length, uploadedAt: now };
      }, 30000);
    } catch (e) { trashFile_(file.getId()); throw e; }
  }

  function stuRemoveFile(s, a) {
    var f = Db.byId('AsgFiles', String(a.fileId || ''));
    if (!f || f.course_id !== s.courseId) throw U.E('E_NOT_FOUND');
    var ctx = editCtx_(s, f.asg_id);
    if (f.sub_key !== ctx.subKey) throw U.E('E_FORBIDDEN');
    trashFile_(f.drive_id);
    Db.remove('AsgFiles', f.file_id);
    var sub = Db.byId('AsgSubs', ctx.subKey);
    if (sub && !sub.note && !sub.link && !Db.findRows('AsgFiles', 'sub_key', ctx.subKey).length) Db.remove('AsgSubs', ctx.subKey);
    Audit.log(s.stdId + '@' + s.courseId, 'asg.removeFile', f.asg_id, { file: f.file_id });
    return { removed: true };
  }

  function stuSaveNote(s, a) {
    var ctx = editCtx_(s, a.asgId);
    var note = clip_(a.note, 2000).trim(), link = oneLine_(a.link, 500);
    if (link && !/^https?:\/\/[^\s]{3,}$/i.test(link)) throw U.E('E_ASG_FIELD', { field: 'link' }, 'ลิงก์ต้องขึ้นต้นด้วย http:// หรือ https://');
    var hasFiles = Db.findRows('AsgFiles', 'sub_key', ctx.subKey).length > 0;
    if (!note && !link && !hasFiles) {
      if (Db.byId('AsgSubs', ctx.subKey)) Db.remove('AsgSubs', ctx.subKey);
      return { saved: false };
    }
    upsertSub_(ctx, s, { note: note, link: link });
    Audit.log(s.stdId + '@' + s.courseId, 'asg.note', ctx.a.asg_id, '');
    return { saved: true, updatedAt: Db.byId('AsgSubs', ctx.subKey).updated_at };
  }

  /* ---------- ผูกกับการลบนักศึกษา (STUDENT_CASCADE) ---------- */
  function countForStudent(courseId, stdId) {
    var n = 0;
    Db.findRows('AsgGrades', 'std_id', stdId).forEach(function (r) { if (r.course_id === courseId) n++; });
    Db.findRows('AsgSubs', 'owner_std', stdId).forEach(function (r) { if (r.course_id === courseId && !r.group_id) n++; });
    Db.findRows('AsgMembers', 'std_id', stdId).forEach(function (r) { if (r.course_id === courseId) n++; });
    return n;
  }
  function removeForStudents(courseId, stdIds) {
    var set = {}; stdIds.forEach(function (i) { set[i] = true; });
    var n = 0;
    // งานเดี่ยวของคนที่ถูกลบ: ลบงานที่ส่ง + ไฟล์
    var drop = Db.findRows('AsgSubs', 'course_id', courseId).filter(function (r) { return !r.group_id && set[r.owner_std]; });
    drop.forEach(function (r) {
      Db.findRows('AsgFiles', 'sub_key', r.sub_key).forEach(function (f) { trashFile_(f.drive_id); });
      Db.removeWhere('AsgFiles', function (o) { return o.sub_key === r.sub_key; });
      Db.remove('AsgSubs', r.sub_key); n++;
    });
    n += Db.removeWhere('AsgGrades', function (o) { return o.course_id === courseId && set[o.std_id] === true; });
    // กลุ่ม: เอาออกจากสมาชิก · ถ้าตัวแทนถูกลบ ให้สมาชิกคนอื่นรับช่วง · ถ้าไม่เหลือใครลบกลุ่ม+งานที่ส่ง
    var gone = Db.findRows('AsgMembers', 'course_id', courseId).filter(function (m) { return set[m.std_id]; });
    var touched = {}; gone.forEach(function (m) { touched[m.group_id] = true; });
    n += Db.removeWhere('AsgMembers', function (o) { return o.course_id === courseId && set[o.std_id] === true; });
    Object.keys(touched).forEach(function (gid) {
      var g = Db.byId('AsgGroups', gid); if (!g) return;
      var left = Db.findRows('AsgMembers', 'group_id', gid).map(function (m) { return m.std_id; }).sort();
      if (!left.length) {
        var sk = key_(g.asg_id, gid);
        Db.findRows('AsgFiles', 'sub_key', sk).forEach(function (f) { trashFile_(f.drive_id); });
        Db.removeWhere('AsgFiles', function (o) { return o.sub_key === sk; });
        if (Db.byId('AsgSubs', sk)) Db.remove('AsgSubs', sk);
        Db.remove('AsgGroups', gid);
      } else if (set[g.rep_std]) {
        Db.update('AsgGroups', gid, { rep_std: left[0] });
        var sk2 = key_(g.asg_id, gid); if (Db.byId('AsgSubs', sk2)) Db.update('AsgSubs', sk2, { owner_std: left[0] });
      }
    });
    return n;
  }

  return {
    list: list, get: get, save: save, setStatus: setStatus, remove: remove, submissions: submissions, fileGet: fileGet, grade: grade,
    resolve: resolve, stuTasks: stuTasks, stuTask: stuTask, stuUpload: stuUpload, stuRemoveFile: stuRemoveFile, stuSaveNote: stuSaveNote,
    stuGroupSave: stuGroupSave, stuGroupDelete: stuGroupDelete, countForStudent: countForStudent, removeForStudents: removeForStudents, phase: phase_
  };
})();
