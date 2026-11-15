/**************************************************************
 * File: Groups.gs  (HBT Core v0.8.0)
 * กลุ่มนักศึกษาที่อาจารย์จัดไว้ต่อวิชา (ใช้กับงานกลุ่มแบบ "ใช้กลุ่มที่จัดไว้")
 *  - กลุ่ม = ลำดับ (จำนวนเต็ม 1–999 ไม่ซ้ำในวิชา) + ชื่อ (ไม่บังคับ) + ตัวแทน (ไม่บังคับ — เป็นแค่ผู้ประสานงาน ทุกคนในกลุ่มส่งงานได้)
 *  - สมาชิก = Students.group_no (1 คนอยู่ได้กลุ่มเดียวต่อวิชา) · เก็บแถวกลุ่มใน CourseGroups (key = course_id|group_no)
 *  - ลบกลุ่มที่มีงานส่งแล้วไม่ได้ (ย้ายสมาชิกได้ — อาจารย์ตัดสินใจเอง)
 **************************************************************/

var Groups = (function () {

  var MAX_NO = 999, MAX_NAME = 60;

  function noOf_(v) {
    if (v === '' || v === null || v === undefined) return 0;
    var n = Number(v);
    return (isFinite(n) && Math.floor(n) === n && n >= 1 && n <= MAX_NO) ? n : 0;
  }
  function nameOf_(v) { return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, MAX_NAME); }
  function key_(courseId, no) { return courseId + '|' + no; }
  function gid_(no) { return 'G' + no; }

  function rowsOf_(courseId) {
    return Db.findRows('CourseGroups', 'course_id', courseId).sort(function (a, b) { return Number(a.group_no) - Number(b.group_no); });
  }
  function nextNo_(courseId) {
    var m = 0;
    rowsOf_(courseId).forEach(function (r) { m = Math.max(m, Number(r.group_no) || 0); });
    if (m + 1 > MAX_NO) throw U.E('E_GROUP_FIELD', { field: 'groupNo' }, 'สร้างกลุ่มได้ไม่เกิน ' + MAX_NO + ' กลุ่มต่อวิชา');
    return m + 1;
  }

  /** ภาพรวมกลุ่มของวิชา: groups[{no,name,rep,members:[{stdId,name}]}] (รวมกลุ่มว่าง) · ungrouped[{stdId,name}] */
  function snapshot(courseId) {
    var gr = rowsOf_(courseId), byNo = {}, groups = [], ungrouped = [];
    gr.forEach(function (r) {
      var g = { no: Number(r.group_no), name: r.name || '', rep: r.rep_std || '', members: [] };
      byNo[g.no] = g; groups.push(g);
    });
    Students.roster(courseId).forEach(function (s) {
      var n = noOf_(s.group_no), g = n ? byNo[n] : null;
      if (g) g.members.push({ stdId: s.std_id, name: s.name }); else ungrouped.push({ stdId: s.std_id, name: s.name });
    });
    return { groups: groups, ungrouped: ungrouped, byNo: byNo };
  }
  function groupOut_(g, nameOf) {
    return {
      groupNo: g.no, name: g.name, rep: g.rep ? { stdId: g.rep, name: nameOf[g.rep] || g.rep } : null,
      members: g.members
    };
  }
  function out_(courseId) {
    var sn = snapshot(courseId), nm = {};
    sn.groups.forEach(function (g) { g.members.forEach(function (m) { nm[m.stdId] = m.name; }); });
    return { groups: sn.groups.map(function (g) { return groupOut_(g, nm); }), ungrouped: sn.ungrouped };
  }

  function inUse_(courseId, no) {
    var id = gid_(no);
    return Db.findRows('AsgSubs', 'course_id', courseId).some(function (r) { return r.group_id === id; });
  }

  function list(user, a) {
    var c = Courses.require(user, a.courseId);
    return out_(c.course_id);
  }

  function create_(courseId, no, name, actor) {
    var n = no || nextNo_(courseId);
    if (Db.byId('CourseGroups', key_(courseId, n))) throw U.E('E_GROUP_FIELD', { field: 'groupNo' }, 'มีกลุ่มลำดับ ' + n + ' อยู่แล้ว');
    Db.insert('CourseGroups', { grp_key: key_(courseId, n), course_id: courseId, group_no: n, name: name, rep_std: '', created_at: U.nowIso() });
    return n;
  }

  /** สร้างหรือแก้ชื่อกลุ่ม: a = { courseId, groupNo?, name? } · ไม่ส่ง groupNo = สร้างลำดับถัดไป */
  function save(user, a) {
    var c = Courses.require(user, a.courseId), no = 0, hasNo = !(a.groupNo === undefined || a.groupNo === null || a.groupNo === '');
    if (hasNo) { no = noOf_(a.groupNo); if (!no) throw U.E('E_GROUP_FIELD', { field: 'groupNo' }, 'ลำดับกลุ่มต้องเป็นจำนวนเต็ม 1–' + MAX_NO); }
    var ex = no ? Db.byId('CourseGroups', key_(c.course_id, no)) : null;
    if (ex) {
      if (a.name !== undefined) Db.update('CourseGroups', ex.grp_key, { name: nameOf_(a.name) });
    } else {
      no = create_(c.course_id, no, nameOf_(a.name), user.email);
    }
    Courses.touch(c.course_id);
    Audit.log(user.email, ex ? 'group.rename' : 'group.create', c.course_id, { groupNo: no });
    return { groupNo: no, created: !ex };
  }

  /** ถ้าตัวแทนของกลุ่มไหนถูกย้ายออก/ลบ ให้ล้างตัวแทน */
  function clearReps_(courseId, ids, keepNo) {
    var set = {}; ids.forEach(function (i) { set[i] = true; });
    rowsOf_(courseId).forEach(function (r) {
      if (r.rep_std && set[r.rep_std] && Number(r.group_no) !== keepNo) Db.update('CourseGroups', r.grp_key, { rep_std: '' });
    });
  }
  function patchStudents_(courseId, ids, no) {
    var patch = {};
    ids.forEach(function (id) { var r = Students.find(courseId, id); if (r) patch[r._row] = { group_no: no }; });
    if (Object.keys(patch).length) Db.bulkPatch('Students', patch);
  }

  /** ใส่นักศึกษาเข้ากลุ่ม: a = { courseId, stdIds[], groupNo | newGroup:{name?} } */
  function assign(user, a) {
    var c = Courses.require(user, a.courseId), ids = Students.pickMany(c.course_id, a.stdIds), no;
    if (a.newGroup) no = create_(c.course_id, 0, nameOf_(a.newGroup.name), user.email);
    else {
      no = noOf_(a.groupNo);
      if (!no || !Db.byId('CourseGroups', key_(c.course_id, no))) throw U.E('E_NOT_FOUND');
    }
    patchStudents_(c.course_id, ids, no);
    clearReps_(c.course_id, ids, no);
    Courses.touch(c.course_id);
    Audit.log(user.email, 'group.assign', c.course_id, { groupNo: no, count: ids.length });
    return { groupNo: no, moved: ids.length };
  }

  function unassign(user, a) {
    var c = Courses.require(user, a.courseId), ids = Students.pickMany(c.course_id, a.stdIds);
    patchStudents_(c.course_id, ids, '');
    clearReps_(c.course_id, ids, 0);
    Courses.touch(c.course_id);
    Audit.log(user.email, 'group.unassign', c.course_id, { count: ids.length });
    return { moved: ids.length };
  }

  function remove(user, a) {
    var c = Courses.require(user, a.courseId), no = noOf_(a.groupNo), g = no ? Db.byId('CourseGroups', key_(c.course_id, no)) : null;
    if (!g) throw U.E('E_NOT_FOUND');
    if (inUse_(c.course_id, no)) throw U.E('E_GROUP_IN_USE');
    var ids = [];
    Students.roster(c.course_id).forEach(function (s) { if (noOf_(s.group_no) === no) ids.push(s.std_id); });
    patchStudents_(c.course_id, ids, '');
    Db.remove('CourseGroups', g.grp_key);
    Courses.touch(c.course_id);
    Audit.log(user.email, 'group.delete', c.course_id, { groupNo: no, members: ids.length });
    return { deleted: true, released: ids.length };
  }

  /** ตั้ง/ล้างตัวแทน (ผู้ประสานงาน) · stdId ว่าง = ล้าง · ต้องเป็นสมาชิกกลุ่มนั้น */
  function setRep(user, a) {
    var c = Courses.require(user, a.courseId), no = noOf_(a.groupNo), g = no ? Db.byId('CourseGroups', key_(c.course_id, no)) : null;
    if (!g) throw U.E('E_NOT_FOUND');
    var rep = '';
    if (a.stdId !== undefined && a.stdId !== null && String(a.stdId).trim() !== '') {
      rep = Students.cleanId(a.stdId);
      var s = Students.find(c.course_id, rep);
      if (!s || noOf_(s.group_no) !== no) throw U.E('E_GROUP_FIELD', { field: 'stdId' }, 'ตัวแทนต้องเป็นสมาชิกของกลุ่มนี้');
    }
    Db.update('CourseGroups', g.grp_key, { rep_std: rep });
    Audit.log(user.email, 'group.setRep', c.course_id, { groupNo: no, rep: rep });
    return { groupNo: no, rep: rep };
  }

  /**
   * วางจาก Excel: rows = [{ stdId, groupNo, name? }] (name = ชื่อกลุ่ม ไม่บังคับ) · dryRun = ดูผลก่อน
   * กลุ่มที่ยังไม่มีจะถูกสร้างให้ · แถวที่ผิดข้ามและรายงาน
   */
  function importRows(user, a) {
    var c = Courses.require(user, a.courseId), rows = a.rows;
    if (!Array.isArray(rows) || !rows.length) throw U.E('E_IMPORT', null, 'ไม่พบข้อมูลที่จะนำเข้า');
    if (rows.length > 1000) throw U.E('E_IMPORT', { max: 1000 }, 'นำเข้าได้ครั้งละไม่เกิน 1000 แถว');
    var have = {}, names = {}, skipped = [], seen = {}, valid = [];
    rowsOf_(c.course_id).forEach(function (r) { have[Number(r.group_no)] = r; });
    rows.forEach(function (r, i) {
      var id = '', no = 0;
      try { id = Students.cleanId(r && r.stdId); } catch (e) { skipped.push({ row: i + 1, stdId: String(r && r.stdId || '').substring(0, 30), why: 'รหัสนักศึกษาไม่ถูกต้อง' }); return; }
      if (!Students.find(c.course_id, id)) { skipped.push({ row: i + 1, stdId: id, why: 'ไม่อยู่ในรายชื่อวิชานี้' }); return; }
      no = noOf_(r.groupNo);
      if (!no) { skipped.push({ row: i + 1, stdId: id, why: 'ลำดับกลุ่มต้องเป็นจำนวนเต็ม 1–' + MAX_NO }); return; }
      if (seen[id]) { skipped.push({ row: i + 1, stdId: id, why: 'รหัสซ้ำ (ใช้แถวแรก)' }); return; }
      seen[id] = true;
      var nm = nameOf_(r.name);
      if (nm && !names[no]) names[no] = nm;
      valid.push({ stdId: id, no: no });
    });
    var newNos = {}, renamed = 0;
    valid.forEach(function (v) { if (!have[v.no]) newNos[v.no] = true; });
    Object.keys(names).forEach(function (n) { if (have[n] && have[n].name !== names[n]) renamed++; });
    var plan = { assigned: valid.length, created: Object.keys(newNos).length, renamed: renamed, skipped: skipped.slice(0, 200), skippedCount: skipped.length, dryRun: U.bool(a.dryRun) };
    if (plan.dryRun || !valid.length) return plan;
    var now = U.nowIso();
    Object.keys(newNos).forEach(function (n) {
      Db.insert('CourseGroups', { grp_key: key_(c.course_id, n), course_id: c.course_id, group_no: Number(n), name: names[n] || '', rep_std: '', created_at: now });
    });
    Object.keys(names).forEach(function (n) { if (have[n] && have[n].name !== names[n]) Db.update('CourseGroups', have[n].grp_key, { name: names[n] }); });
    var patch = {}, moved = [];
    valid.forEach(function (v) { var s = Students.find(c.course_id, v.stdId); patch[s._row] = { group_no: v.no }; moved.push(v.stdId); });
    Db.bulkPatch('Students', patch);
    valid.forEach(function (v) { clearReps_(c.course_id, [v.stdId], v.no); });
    Courses.touch(c.course_id);
    Audit.log(user.email, 'group.import', c.course_id, { assigned: plan.assigned, created: plan.created, skipped: plan.skippedCount });
    return plan;
  }

  /**
   * แบ่งกลุ่มอัตโนมัติ: a = { courseId, size (คนต่อกลุ่ม), order:'id'|'random', scope:'ungrouped'|'all' }
   * scope=all จะล้างกลุ่มเดิมทั้งหมดก่อน (ห้ามถ้ามีกลุ่มที่ส่งงานแล้ว)
   */
  function auto(user, a) {
    var c = Courses.require(user, a.courseId), size = Number(a.size);
    if (!isFinite(size) || Math.floor(size) !== size || size < 1 || size > 100) throw U.E('E_GROUP_FIELD', { field: 'size' }, 'จำนวนคนต่อกลุ่มต้องเป็นจำนวนเต็ม 1–100');
    var all = a.scope === 'all', random = a.order === 'random';
    var sn = snapshot(c.course_id);
    if (all) sn.groups.forEach(function (g) { if (inUse_(c.course_id, g.no)) throw U.E('E_GROUP_IN_USE'); });
    var pool = all ? Students.roster(c.course_id).map(function (s) { return s.std_id; }) : sn.ungrouped.map(function (s) { return s.stdId; });
    if (!pool.length) throw U.E('E_GROUP_FIELD', { field: 'pool' }, all ? 'ยังไม่มีนักศึกษา' : 'ไม่มีนักศึกษาที่ยังไม่มีกลุ่ม');
    if (random) for (var i = pool.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)), t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
    var k = Math.ceil(pool.length / size);
    if (all) {
      Db.removeWhere('CourseGroups', function (o) { return o.course_id === c.course_id; });
      patchStudents_(c.course_id, Students.roster(c.course_id).map(function (s) { return s.std_id; }), '');
    }
    var start = all ? 1 : nextNo_(c.course_id);
    if (start + k - 1 > MAX_NO) throw U.E('E_GROUP_FIELD', { field: 'size' }, 'กลุ่มมากเกินไป — เพิ่มจำนวนคนต่อกลุ่ม');
    var now = U.nowIso(), base = Math.floor(pool.length / k), extra = pool.length % k, pos = 0, inserts = [], patch = {};
    for (var g = 0; g < k; g++) {
      var no = start + g, n = base + (g < extra ? 1 : 0);
      inserts.push({ grp_key: key_(c.course_id, no), course_id: c.course_id, group_no: no, name: '', rep_std: '', created_at: now });
      for (var m = 0; m < n; m++) { var s = Students.find(c.course_id, pool[pos++]); patch[s._row] = { group_no: no }; }
    }
    Db.insertMany('CourseGroups', inserts);
    Db.bulkPatch('Students', patch);
    Courses.touch(c.course_id);
    Audit.log(user.email, 'group.auto', c.course_id, { groups: k, students: pool.length, scope: all ? 'all' : 'ungrouped' });
    return { groups: k, students: pool.length };
  }

  /** นักศึกษาถูกลบออกจากวิชา → ถ้าเป็นตัวแทนกลุ่ม ให้ล้างตัวแทน */
  function dropReps(courseId, stdIds) { clearReps_(courseId, stdIds, 0); }

  return {
    list: list, save: save, assign: assign, unassign: unassign, remove: remove, setRep: setRep, importRows: importRows, auto: auto,
    snapshot: snapshot, dropReps: dropReps, noOf: noOf_, gid: gid_
  };
})();
