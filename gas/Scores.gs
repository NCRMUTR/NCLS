/**************************************************************
 * File: Scores.gs  (HBT Core v0.3.0)
 * จุดรวมคะแนนของทุกระบบ
 *   ประเภทคะแนน (ScoreTypes): source = MANUAL (อาจารย์กรอกเอง) | ATT | EXAM | ASSIGN (ระบบอื่นสร้างอัตโนมัติ ขั้นถัดไป)
 *   คะแนนดิบ (ScoreRecords): เก็บ "คะแนนที่ได้" ไม่ใช่ % · คะแนนเต็มอยู่ที่ประเภท (max_score)
 *   คะแนนรวม = Σ (ได้ ÷ เต็ม × น้ำหนัก%) · น้ำหนักรวมทุกประเภท ≤ 100%
 *   ประเภทอัตโนมัติ: อาจารย์แก้ได้เฉพาะน้ำหนัก% และการแสดงให้นักศึกษา — แก้คะแนนในตารางนี้ไม่ได้
 **************************************************************/

var Scores = (function () {

  var EPS = 1e-9;
  var MAX_ROWS = 2000;

  function r2_(n) { return Math.round(n * 100) / 100; }

  /** ตัวเลขแบบเข้ม: number หรือข้อความ 12 / 12.5 (ไม่รับ 1,5 / 1e3 / ติดลบ / ว่างเปล่า) */
  function parseNum_(v) {
    if (typeof v === 'number') return isFinite(v) ? v : NaN;
    if (typeof v !== 'string') return NaN;
    var s = v.trim();
    return /^\d+(\.\d+)?$/.test(s) ? Number(s) : NaN;
  }
  function isBlank_(v) {
    if (v === null || v === undefined) return true;
    var s = String(v).trim();
    return s === '' || s === '-' || s === '—';
  }

  function typesOf_(courseId) {
    return Db.findRows('ScoreTypes', 'course_id', courseId).sort(function (a, b) {
      var d = Number(a.sort_no) - Number(b.sort_no);
      return d !== 0 ? d : (a.created_at < b.created_at ? -1 : 1);
    });
  }
  /** หมวดคะแนน 5 แบบ: att เข้าเรียน · asg คะแนนเก็บ(งาน) · exam คะแนนทดสอบ · mid กลางภาค · final ปลายภาค (other = ประเภทกรอกเองแบบเดิม) */
  var FIXED = { mid: { ref: 'MID', name: 'สอบกลางภาค' }, final: { ref: 'FINAL', name: 'สอบปลายภาค' } };
  function fixedRef_(r) { return r.source === 'MANUAL' && (r.source_ref === 'MID' || r.source_ref === 'FINAL'); }
  function catOf_(r) {
    if (r.source === 'ATT') return 'att';
    if (r.source === 'ASSIGN') return 'asg';
    if (r.source === 'EXAM') return 'exam';
    if (r.source_ref === 'MID') return 'mid';
    if (r.source_ref === 'FINAL') return 'final';
    return 'other';
  }
  function typeOut_(r) {
    return {
      typeId: r.type_id, name: r.name, pct: Number(r.pct), max: Number(r.max_score), cat: catOf_(r),
      source: r.source, sourceRef: r.source_ref, visible: U.bool(r.visible), auto: r.source !== 'MANUAL'
    };
  }
  function totalPct_(types, exceptId) {
    var t = 0;
    types.forEach(function (r) { if (r.type_id !== exceptId) t += Number(r.pct) || 0; });
    return t;
  }

  function listTypes(user, courseId) {
    var c = Courses.require(user, courseId);
    var types = typesOf_(c.course_id);
    var tot = totalPct_(types, '');
    return { types: types.map(typeOut_), totalPct: r2_(tot), remainPct: r2_(100 - tot) };
  }

  function saveType(user, a) {
    var c = Courses.require(user, a.courseId);
    var types = typesOf_(c.course_id);
    var ex = null;
    if (a.typeId) {
      ex = types.filter(function (t) { return t.type_id === String(a.typeId); })[0];
      if (!ex) throw U.E('E_NOT_FOUND');
    }
    var pct = parseNum_(a.pct);
    if (isNaN(pct) || pct < 0 || pct > 100) throw U.E('E_SCORE_TYPE', { field: 'pct' }, 'น้ำหนักต้องเป็นตัวเลข 0–100');
    pct = r2_(pct);
    var visible = a.visible === undefined ? (ex ? U.bool(ex.visible) : false) : U.bool(a.visible);   // ค่าเริ่มต้น: ไม่แสดงให้นักศึกษา

    var cat = a.cat ? String(a.cat) : '', name, max, ref = '';
    if (!ex && cat) {                              // สร้างประเภทสอบกลางภาค/ปลายภาค (ชื่อ/คะแนนเต็มคงที่ = 100 → ค่าที่ import คือ %)
      if (!FIXED[cat]) throw U.E('E_SCORE_TYPE', { field: 'cat' }, 'ประเภทคะแนนไม่ถูกต้อง');
      if (types.some(function (t) { return t.source === 'MANUAL' && t.source_ref === FIXED[cat].ref; })) throw U.E('E_SCORE_TYPE', { field: 'cat' }, 'มีประเภทนี้อยู่แล้ว');
      name = FIXED[cat].name; max = 100; ref = FIXED[cat].ref;
    } else if (ex && (ex.source !== 'MANUAL' || fixedRef_(ex))) {   // ประเภทอัตโนมัติ/กลางภาค/ปลายภาค: แก้ได้แค่น้ำหนัก/การแสดง
      name = ex.name; max = Number(ex.max_score);
    } else {
      name = String(a.name === undefined || a.name === null ? '' : a.name).replace(/\s+/g, ' ').trim();
      if (!name || name.length > 60) throw U.E('E_SCORE_TYPE', { field: 'name' }, 'ชื่อประเภทคะแนนต้องมี 1–60 ตัวอักษร');
      max = a.max === undefined || a.max === null || a.max === '' ? (pct > 0 ? pct : 100) : parseNum_(a.max);
      if (isNaN(max) || max <= 0 || max > 1000) throw U.E('E_SCORE_TYPE', { field: 'max' }, 'คะแนนเต็มต้องเป็นตัวเลขมากกว่า 0 และไม่เกิน 1000');
      max = r2_(max);
      var lower = name.toLowerCase();
      if (types.some(function (t) { return t.type_id !== (ex ? ex.type_id : '') && t.name.toLowerCase() === lower; })) {
        throw U.E('E_SCORE_TYPE', { field: 'name' }, 'มีประเภทคะแนนชื่อนี้อยู่แล้ว');
      }
      if (ex && max < Number(ex.max_score) - EPS) {   // ลดคะแนนเต็มจนคะแนนที่กรอกไว้เกินเต็ม = ปฏิเสธ (ไม่แก้ข้อมูลเงียบๆ)
        var over = Db.findRows('ScoreRecords', 'type_id', ex.type_id).filter(function (r) { return r.score !== '' && Number(r.score) > max + EPS; });
        if (over.length) throw U.E('E_SCORE_TYPE', { field: 'max', over: over.length }, 'มีคะแนน ' + over.length + ' รายการที่เกินคะแนนเต็มใหม่ แก้คะแนนเหล่านั้นก่อน');
      }
    }
    var total = totalPct_(types, ex ? ex.type_id : '') + pct;
    if (total > 100 + EPS) {
      var remain = r2_(100 - totalPct_(types, ex ? ex.type_id : ''));
      throw U.E('E_SCORE_PCT', { total: r2_(total), remain: remain }, 'น้ำหนักรวมเกิน 100% (ประเภทนี้ใส่ได้อีกไม่เกิน ' + remain + '%)');
    }
    var out;
    if (ex) {
      Db.update('ScoreTypes', ex.type_id, { name: name, pct: pct, max_score: max, visible: U.bstr(visible) });
      out = ex.type_id;
    } else {
      out = U.uid('SCT');
      var sort = types.reduce(function (m, t) { return Math.max(m, Number(t.sort_no) || 0); }, 0) + 1;
      Db.insert('ScoreTypes', {
        type_id: out, course_id: c.course_id, name: name, pct: pct, max_score: max, source: 'MANUAL', source_ref: ref,
        visible: U.bstr(visible), sort_no: sort, created_at: U.nowIso()
      });
    }
    Courses.touch(c.course_id);
    Audit.log(user.email, ex ? 'score.type.update' : 'score.type.create', out, { name: name, pct: pct, max: max });
    var res = listTypes(user, c.course_id);
    res.typeId = out;                       // ประเภทที่เพิ่งบันทึก (หน้าเว็บใช้ไฮไลต์/โฟกัส)
    return res;
  }

  function deleteType(user, a) {
    var c = Courses.require(user, a.courseId);
    var t = Db.byId('ScoreTypes', String(a.typeId || ''));
    if (!t || t.course_id !== c.course_id) throw U.E('E_NOT_FOUND');
    if (t.source !== 'MANUAL') throw U.E('E_SCORE_AUTO');
    var n = Db.removeWhere('ScoreRecords', function (o) { return o.type_id === t.type_id; });
    Db.remove('ScoreTypes', t.type_id);
    Courses.touch(c.course_id);
    Audit.log(user.email, 'score.type.delete', t.type_id, { name: t.name, records: n });
    return listTypes(user, c.course_id);
  }

  function recordsOf_(courseId) {
    var m = {};
    Db.findRows('ScoreRecords', 'course_id', courseId).forEach(function (r) {
      if (r.score !== '') m[r.type_id + '|' + r.std_id] = Number(r.score);
    });
    return m;
  }
  function totalOf_(types, scores) {
    var t = 0;
    types.forEach(function (ty) {
      var v = scores[ty.type_id];
      if (v !== null && v !== undefined) t += (v / Number(ty.max_score)) * Number(ty.pct);
    });
    return r2_(t);
  }

  function table(user, courseId) {
    var c = Courses.require(user, courseId);
    Attendance.sweep(c.course_id);               // คาบที่หมดเวลาสายแล้วปิดและคิดคะแนนก่อนแสดงตาราง
    var types = typesOf_(c.course_id);
    var rec = recordsOf_(c.course_id);
    var students = Students.roster(c.course_id).map(function (s) {
      var sc = {}, pc = {};
      types.forEach(function (t) {
        var v = rec[t.type_id + '|' + s.std_id];
        sc[t.type_id] = v === undefined ? null : v;
        pc[t.type_id] = v === undefined ? null : r2_(v / Number(t.max_score) * 100);   // % ของรายการนั้น (หน้าคะแนนแสดงค่านี้)
      });
      return { stdId: s.std_id, name: s.name, scores: sc, pcts: pc, total: totalOf_(types, sc) };
    });
    var tot = totalPct_(types, '');
    return {
      course: { courseId: c.course_id, code: c.code, name: c.name, section: c.section },
      types: types.map(typeOut_), students: students, totalPct: r2_(tot)
    };
  }

  /**
   * เขียนคะแนนหลายคน (ใช้ทั้งหน้าวางจาก Excel และระบบอื่นที่คำนวณคะแนนเอง)
   * rows: [{stdId, score}] · score ว่าง/null = ล้างคะแนน · ผิดแถวไหน ข้ามแถวนั้นและรายงาน (แถวอื่นยังบันทึก)
   */
  function writeRecords_(courseId, type, rows, actor, honorLock) {
    if (!Array.isArray(rows) || !rows.length) throw U.E('E_BAD_REQUEST', { why: 'rows' });
    if (rows.length > MAX_ROWS) throw U.E('E_BAD_REQUEST', { why: 'too_many', max: MAX_ROWS });
    var max = Number(type.max_score);
    var existing = {};
    Db.findRows('ScoreRecords', 'type_id', type.type_id).forEach(function (r) { existing[r.std_id] = r; });
    var roster = {};
    Students.roster(courseId).forEach(function (s) { roster[s.std_id] = true; });
    var seen = {}, skipped = [], patch = {}, inserts = [], saved = 0, cleared = 0, same = 0, kept = 0, now = U.nowIso();

    rows.forEach(function (r, i) {
      var rowNo = i + 1, id = '';
      try { id = Students.cleanId(r && r.stdId); } catch (e) { skipped.push({ row: rowNo, stdId: String(r && r.stdId || '').substring(0, 30), why: 'รหัสนักศึกษาไม่ถูกต้อง' }); return; }
      if (!roster[id]) { skipped.push({ row: rowNo, stdId: id, why: 'ไม่อยู่ในรายชื่อวิชานี้' }); return; }
      if (seen[id]) { skipped.push({ row: rowNo, stdId: id, why: 'รหัสซ้ำ (ใช้แถวแรก)' }); return; }
      seen[id] = true;
      var ex = existing[id];
      var blank = isBlank_(r.score), v = '';
      if (!blank) {
        v = parseNum_(r.score);
        if (isNaN(v)) { skipped.push({ row: rowNo, stdId: id, why: 'คะแนนไม่ใช่ตัวเลข' }); return; }
        if (v > max + EPS) { skipped.push({ row: rowNo, stdId: id, why: 'เกินคะแนนเต็ม ' + max }); return; }
        v = r2_(v);
      }
      if (honorLock && ex && U.bool(ex.locked)) {          // อาจารย์ปรับทับไว้ → ไม่แตะคะแนน แค่จำค่าที่ระบบคิดล่าสุด (ไว้เทียบ/คืนค่า)
        if (String(ex.auto_value) !== String(v)) patch[ex._row] = { auto_value: v };
        kept++; return;
      }
      if (blank) {
        if (ex && ex.score !== '') { patch[ex._row] = { score: '', updated_at: now, updated_by: actor }; cleared++; } else same++;
        return;
      }
      if (ex) {
        if (ex.score !== '' && Number(ex.score) === v) { same++; return; }
        patch[ex._row] = { score: v, updated_at: now, updated_by: actor };
      } else {
        inserts.push({ rec_key: type.type_id + '|' + id, course_id: courseId, type_id: type.type_id, std_id: id, score: v, updated_at: now, updated_by: actor });
      }
      saved++;
    });
    if (Object.keys(patch).length) Db.bulkPatch('ScoreRecords', patch);
    if (inserts.length) Db.insertMany('ScoreRecords', inserts);
    if (saved || cleared || Object.keys(patch).length) Courses.touch(courseId);
    return { saved: saved, cleared: cleared, unchanged: same, kept: kept, skipped: skipped.slice(0, 200), skippedCount: skipped.length };
  }

  function saveBulk(user, a) {
    var c = Courses.require(user, a.courseId);
    var t = Db.byId('ScoreTypes', String(a.typeId || ''));
    if (!t || t.course_id !== c.course_id) throw U.E('E_NOT_FOUND');
    if (t.source !== 'MANUAL') throw U.E('E_SCORE_AUTO');
    var res = writeRecords_(c.course_id, t, a.rows, user.email);
    Audit.log(user.email, 'score.saveBulk', t.type_id, { saved: res.saved, cleared: res.cleared, skipped: res.skippedCount });
    return res;
  }

  /* ============ สรุปคะแนน · ปรับทับ · คะแนนปรับ · เกณฑ์เกรด (v0.10.0) ============ */
  var GRADE_ORDER = ['A', 'B+', 'B', 'C+', 'C', 'D+', 'D'];
  var DEFAULT_CUTS = { 'A': 80, 'B+': 75, 'B': 70, 'C+': 65, 'C': 60, 'D+': 55, 'D': 50 };

  function validCuts_(o) {
    var prev = 101;
    for (var i = 0; i < GRADE_ORDER.length; i++) {
      var v = o ? Number(o[GRADE_ORDER[i]]) : NaN;
      if (!isFinite(v) || v < 0 || v > 100 || v >= prev) return false;
      prev = v;
    }
    return true;
  }
  function scaleOf_(courseId) {
    var r = Db.byId('GradeScale', courseId);
    if (r && r.cuts) { try { var o = JSON.parse(r.cuts); if (validCuts_(o)) return o; } catch (e) { /* ใช้ค่าเริ่มต้น */ } }
    return Object.assign({}, DEFAULT_CUTS);
  }
  function gradeFor_(total, cuts) {
    for (var i = 0; i < GRADE_ORDER.length; i++) if (total + EPS >= Number(cuts[GRADE_ORDER[i]])) return GRADE_ORDER[i];
    return 'F';
  }

  /** ตั้ง/ดู/คืนค่าเริ่มต้นของเกณฑ์เกรด: a = { courseId, cuts?: {A:80,...} | null(คืนค่าเริ่มต้น) } */
  function gradeScale(user, a) {
    var c = Courses.require(user, a.courseId);
    if (a.cuts !== undefined) {
      var ex = Db.byId('GradeScale', c.course_id);
      if (a.cuts === null) { if (ex) Db.remove('GradeScale', c.course_id); }
      else {
        var cuts = {};
        GRADE_ORDER.forEach(function (k) { var v = parseNum_(a.cuts && a.cuts[k]); cuts[k] = isNaN(v) ? NaN : r2_(v); });
        if (!validCuts_(cuts)) throw U.E('E_SCORE_FIELD', { field: 'cuts' }, 'เกณฑ์เกรดต้องเป็นตัวเลข 0–100 และไล่จากมากไปน้อย (A > B+ > B > C+ > C > D+ > D)');
        var row = { cuts: JSON.stringify(cuts), updated_at: U.nowIso(), updated_by: user.email };
        if (ex) Db.update('GradeScale', c.course_id, row); else Db.insert('GradeScale', Object.assign({ course_id: c.course_id }, row));
      }
      Courses.touch(c.course_id);
      Audit.log(user.email, 'score.gradeScale', c.course_id, a.cuts === null ? 'default' : '');
    }
    return { cuts: scaleOf_(c.course_id), defaults: DEFAULT_CUTS, order: GRADE_ORDER };
  }

  /** คะแนนปรับรายคน (+/-) บวกเข้าคะแนนรวม (% ของวิชา) · a = { courseId, rows:[{stdId, points, reason?}] } · points ว่าง/0 = ลบคะแนนปรับ */
  function adjust(user, a) {
    var c = Courses.require(user, a.courseId), rows = a.rows;
    if (!Array.isArray(rows) || !rows.length) throw U.E('E_BAD_REQUEST', { why: 'rows' });
    if (rows.length > MAX_ROWS) throw U.E('E_BAD_REQUEST', { why: 'too_many', max: MAX_ROWS });
    var roster = {}, seen = {}, skipped = [], saved = 0, cleared = 0, now = U.nowIso();
    Students.roster(c.course_id).forEach(function (s) { roster[s.std_id] = true; });
    rows.forEach(function (r, i) {
      var id;
      try { id = Students.cleanId(r && r.stdId); } catch (e) { skipped.push({ row: i + 1, stdId: String(r && r.stdId || '').substring(0, 30), why: 'รหัสนักศึกษาไม่ถูกต้อง' }); return; }
      if (!roster[id]) { skipped.push({ row: i + 1, stdId: id, why: 'ไม่อยู่ในรายชื่อวิชานี้' }); return; }
      if (seen[id]) { skipped.push({ row: i + 1, stdId: id, why: 'รหัสซ้ำ (ใช้แถวแรก)' }); return; }
      seen[id] = true;
      var key = c.course_id + '|' + id, ex = Db.byId('ScoreAdjust', key), raw = r.points, p = 0;
      if (!isBlank_(raw)) {
        var sgn = typeof raw === 'string' && /^\s*-/.test(raw) ? -1 : 1;
        p = typeof raw === 'number' ? raw : parseNum_(String(raw).replace(/^\s*[+-]/, ''));
        if (typeof raw !== 'number') p = isNaN(p) ? NaN : p * sgn;
        if (isNaN(p) || Math.abs(p) > 100) { skipped.push({ row: i + 1, stdId: id, why: 'คะแนนปรับต้องเป็นตัวเลข −100 ถึง +100' }); return; }
        p = r2_(p);
      }
      if (p === 0) { if (ex) { Db.remove('ScoreAdjust', key); cleared++; } return; }
      var reason = String(r.reason === undefined || r.reason === null ? '' : r.reason).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200);
      var row = { points: p, reason: reason, updated_at: now, updated_by: user.email };
      if (ex) Db.update('ScoreAdjust', key, row); else Db.insert('ScoreAdjust', Object.assign({ adj_key: key, course_id: c.course_id, std_id: id }, row));
      saved++;
    });
    if (saved || cleared) Courses.touch(c.course_id);
    Audit.log(user.email, 'score.adjust', c.course_id, { saved: saved, cleared: cleared });
    return { saved: saved, cleared: cleared, skipped: skipped.slice(0, 100), skippedCount: skipped.length };
  }

  /**
   * ปรับคะแนนทับค่าของระบบ (เช็คชื่อ/งาน/สอบ): a = { courseId, typeId, rows:[{stdId, score, reason?}] }
   *   score ว่าง = คืนค่าระบบ · ค่าที่ปรับถูกล็อก — ซิงก์อัตโนมัติรอบถัดไปไม่ทับ (แต่จำค่าระบบล่าสุดไว้เทียบ)
   *   ประเภทที่กรอกเอง (MANUAL) ใช้เส้นทางเดิม (saveBulk) — ที่นี่รับเหมือนกันเพื่อให้หน้าเว็บเรียกที่เดียว
   */
  function override(user, a) {
    var c = Courses.require(user, a.courseId), t = Db.byId('ScoreTypes', String(a.typeId || ''));
    if (!t || t.course_id !== c.course_id) throw U.E('E_NOT_FOUND');
    if (t.source === 'MANUAL') {
      var m = writeRecords_(c.course_id, t, a.rows, user.email, false);
      Audit.log(user.email, 'score.saveBulk', t.type_id, { saved: m.saved, cleared: m.cleared, skipped: m.skippedCount });
      return { saved: m.saved, restored: 0, unchanged: m.unchanged, skipped: m.skipped, skippedCount: m.skippedCount };
    }
    var rows = a.rows;
    if (!Array.isArray(rows) || !rows.length) throw U.E('E_BAD_REQUEST', { why: 'rows' });
    if (rows.length > MAX_ROWS) throw U.E('E_BAD_REQUEST', { why: 'too_many', max: MAX_ROWS });
    var max = Number(t.max_score), existing = {}, roster = {};
    Db.findRows('ScoreRecords', 'type_id', t.type_id).forEach(function (r) { existing[r.std_id] = r; });
    Students.roster(c.course_id).forEach(function (s) { roster[s.std_id] = true; });
    var seen = {}, skipped = [], patch = {}, inserts = [], saved = 0, restored = 0, same = 0, now = U.nowIso();
    rows.forEach(function (r, i) {
      var id;
      try { id = Students.cleanId(r && r.stdId); } catch (e) { skipped.push({ row: i + 1, stdId: String(r && r.stdId || '').substring(0, 30), why: 'รหัสนักศึกษาไม่ถูกต้อง' }); return; }
      if (!roster[id]) { skipped.push({ row: i + 1, stdId: id, why: 'ไม่อยู่ในรายชื่อวิชานี้' }); return; }
      if (seen[id]) { skipped.push({ row: i + 1, stdId: id, why: 'รหัสซ้ำ (ใช้แถวแรก)' }); return; }
      seen[id] = true;
      var ex = existing[id], locked = !!(ex && U.bool(ex.locked));
      if (isBlank_(r.score)) {                                           // คืนค่าระบบ
        if (!locked) { same++; return; }
        patch[ex._row] = { score: ex.auto_value, locked: '', reason: '', updated_at: now, updated_by: user.email }; restored++; return;
      }
      var v = parseNum_(r.score);
      if (isNaN(v)) { skipped.push({ row: i + 1, stdId: id, why: 'คะแนนไม่ใช่ตัวเลข' }); return; }
      if (v > max + EPS) { skipped.push({ row: i + 1, stdId: id, why: 'เกินคะแนนเต็ม ' + max }); return; }
      v = r2_(v);
      var reason = String(r.reason === undefined || r.reason === null ? '' : r.reason).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().substring(0, 200);
      if (ex) {
        if (!locked && ex.score !== '' && Number(ex.score) === v) { same++; return; }                // เท่าค่าระบบอยู่แล้ว ไม่ต้องล็อก
        if (locked && Number(ex.score) === v && String(ex.reason) === reason) { same++; return; }
        patch[ex._row] = { score: v, locked: U.bstr(true), auto_value: locked ? ex.auto_value : ex.score, reason: reason, updated_at: now, updated_by: user.email };
      } else {
        inserts.push({ rec_key: t.type_id + '|' + id, course_id: c.course_id, type_id: t.type_id, std_id: id, score: v, updated_at: now, updated_by: user.email, auto_value: '', locked: U.bstr(true), reason: reason });
      }
      saved++;
    });
    if (Object.keys(patch).length) Db.bulkPatch('ScoreRecords', patch);
    if (inserts.length) Db.insertMany('ScoreRecords', inserts);
    if (saved || restored) Courses.touch(c.course_id);
    Audit.log(user.email, 'score.override', t.type_id, { saved: saved, restored: restored, skipped: skipped.length });
    return { saved: saved, restored: restored, unchanged: same, skipped: skipped.slice(0, 100), skippedCount: skipped.length };
  }

  function statOf_(vals) {
    if (!vals.length) return { n: 0, mean: null, min: null, max: null };
    var s = 0, mn = vals[0], mx = vals[0];
    vals.forEach(function (v) { s += v; if (v < mn) mn = v; if (v > mx) mx = v; });
    return { n: vals.length, mean: r2_(s / vals.length), min: r2_(mn), max: r2_(mx) };
  }

  /** หน้าสรุปคะแนนรายวิชา: ทุกคน × ทุกประเภท (+ธงที่อาจารย์ปรับ/ค่าของระบบ) + คะแนนปรับ + คะแนนรวม + เกรด + สถิติ */
  function summary(user, courseId) {
    var c = Courses.require(user, courseId);
    Attendance.sweep(c.course_id);
    var types = typesOf_(c.course_id), recs = {}, adj = {}, cuts = scaleOf_(c.course_id);
    Db.findRows('ScoreRecords', 'course_id', c.course_id).forEach(function (r) { recs[r.type_id + '|' + r.std_id] = r; });
    Db.findRows('ScoreAdjust', 'course_id', c.course_id).forEach(function (r) { adj[r.std_id] = r; });
    var perType = {}; types.forEach(function (t) { perType[t.type_id] = []; });
    var lvStats = Leave.statsByStd(c.course_id);      // ข้อมูลการลา (แสดงอย่างเดียว ไม่เข้าสูตรคะแนน)
    var totals = [], grades = { A: 0, 'B+': 0, B: 0, 'C+': 0, C: 0, 'D+': 0, D: 0, F: 0 }, ungraded = 0;
    var students = Students.roster(c.course_id).map(function (s) {
      var cells = {}, base = 0, any = false;
      types.forEach(function (t) {
        var r = recs[t.type_id + '|' + s.std_id], max = Number(t.max_score), has = !!(r && r.score !== '' && r.score !== null && r.score !== undefined);
        var v = has ? Number(r.score) : null, locked = !!(r && U.bool(r.locked));
        if (has) { base += (v / max) * Number(t.pct); any = true; perType[t.type_id].push(v); }
        cells[t.type_id] = { v: v, p: has ? r2_(v / max * 100) : null, locked: locked, auto: locked ? (r.auto_value === '' || r.auto_value === undefined ? null : Number(r.auto_value)) : null, reason: locked ? (r.reason || '') : '' };
      });
      base = r2_(base);
      var aj = adj[s.std_id], pts = aj ? Number(aj.points) || 0 : 0, total = r2_(base + pts);
      var graded = any || pts !== 0, grade = graded ? gradeFor_(total, cuts) : '';
      if (graded) { totals.push(total); grades[grade]++; } else ungraded++;
      return { stdId: s.std_id, name: s.name, cells: cells, base: base, adjust: aj ? { points: pts, reason: aj.reason || '' } : null, total: total, grade: grade, leave: lvStats[s.std_id] || null };
    });
    var tot = totalPct_(types, '');
    return {
      course: { courseId: c.course_id, code: c.code, name: c.name, section: c.section },
      types: types.map(function (t) { var o = typeOut_(t); o.stats = statOf_(perType[t.type_id]); return o; }),
      totalPct: r2_(tot), students: students,
      stats: Object.assign(statOf_(totals), { grades: grades, ungraded: ungraded }),
      scale: { cuts: cuts, defaults: DEFAULT_CUTS, order: GRADE_ORDER }
    };
  }

  function exportCsv(user, courseId) {
    var c = Courses.require(user, courseId);
    var sm = summary(user, c.course_id);
    var tb = { types: sm.types, students: sm.students.map(function (s) {
      var pcts = {}; sm.types.forEach(function (t) { pcts[t.typeId] = s.cells[t.typeId].p; });
      return { stdId: s.stdId, name: s.name, pcts: pcts, total: s.base, adj: s.adjust ? s.adjust.points : '', final: s.total, grade: s.grade };
    }) };
    var head = ['รหัสนักศึกษา', 'ชื่อ-นามสกุล'].concat(tb.types.map(function (t) { return t.name + ' (% ของรายการ, สัดส่วน ' + t.pct + '%)'; })).concat(['คะแนนรวม (%)', 'คะแนนปรับ (+/-)', 'คะแนนรวมหลังปรับ (%)', 'เกรด']);
    var rows = [head];
    tb.students.forEach(function (s) {
      rows.push([s.stdId, s.name].concat(tb.types.map(function (t) { var v = s.pcts[t.typeId]; return v === null ? '' : v; })).concat([s.total, s.adj, s.final, s.grade]));
    });
    var safe = (c.code + '-' + c.section).replace(/[^A-Za-z0-9ก-๙._-]+/g, '_');
    Audit.log(user.email, 'score.exportCsv', c.course_id, { rows: tb.students.length });
    return { filename: safe + '-scores.csv', csv: U.toCsv(rows) };
  }

  /* ---------- สำหรับโมดูลอื่น (เช็คชื่อ/สอบ/ส่งงาน) ---------- */

  /** หา/สร้างประเภทคะแนนอัตโนมัติ (น้ำหนักเริ่มต้น 0% — อาจารย์ตั้งเองในหน้าคะแนนรวม) */
  function ensureType(courseId, source, sourceRef, d) {
    if (['ATT', 'EXAM', 'ASSIGN'].indexOf(source) < 0) throw U.E('E_SCORE_TYPE');
    var found = typesOf_(courseId).filter(function (t) { return t.source === source && t.source_ref === String(sourceRef || ''); })[0];
    if (found) return found;
    var id = U.uid('SCT');
    var sort = typesOf_(courseId).reduce(function (m, t) { return Math.max(m, Number(t.sort_no) || 0); }, 0) + 1;
    Db.insert('ScoreTypes', {
      type_id: id, course_id: courseId, name: d.name, pct: d.pct || 0, max_score: d.max || 100, source: source, source_ref: String(sourceRef || ''),
      visible: U.bstr(d.visible === true), sort_no: sort, created_at: U.nowIso()      // ค่าเริ่มต้น: ไม่แสดงให้นักศึกษา
    });
    return Db.byId('ScoreTypes', id);
  }

  /** ตรวจเฉยๆ ว่าตั้งสัดส่วน pct ให้รายการนี้ได้ไหม (น้ำหนักรวมไม่เกิน 100%) · ไม่ผ่าน = โยน E_SCORE_TYPE / E_SCORE_PCT */
  function checkPct(courseId, pct, source, sourceRef) {
    var p = parseNum_(pct);
    if (isNaN(p) || p < 0 || p > 100) throw U.E('E_SCORE_TYPE', { field: 'pct' }, 'สัดส่วนต้องเป็นตัวเลข 0–100');
    p = r2_(p);
    var types = typesOf_(courseId), ex = source ? types.filter(function (t) { return t.source === source && t.source_ref === String(sourceRef || ''); })[0] : null;
    var rest = totalPct_(types, ex ? ex.type_id : '');
    if (rest + p > 100 + EPS) throw U.E('E_SCORE_PCT', { total: r2_(rest + p), remain: r2_(100 - rest) }, 'สัดส่วนรวมเกิน 100% (รายการนี้ใส่ได้อีกไม่เกิน ' + r2_(100 - rest) + '%)');
    return p;
  }
  /** ตั้งสัดส่วน % ของประเภทอัตโนมัติ (เช่น งานแต่ละงาน) · ไม่มีประเภทอยู่ = ไม่ทำอะไร */
  function setAutoPct(courseId, source, sourceRef, pct) {
    var p = checkPct(courseId, pct, source, sourceRef);
    var t = typesOf_(courseId).filter(function (x) { return x.source === source && x.source_ref === String(sourceRef || ''); })[0];
    if (t) Db.update('ScoreTypes', t.type_id, { pct: p });
    return p;
  }
  /** { sourceRef: pct } ของประเภทอัตโนมัติชนิดหนึ่งในวิชา (ใช้แสดงในรายการงาน) */
  function pctMap(courseId, source) {
    var m = {};
    typesOf_(courseId).forEach(function (t) { if (t.source === source) m[t.source_ref] = Number(t.pct) || 0; });
    return m;
  }
  function setRecords(courseId, typeId, rows, actor) {
    var t = Db.byId('ScoreTypes', typeId);
    if (!t || t.course_id !== courseId) throw U.E('E_NOT_FOUND');
    return writeRecords_(courseId, t, rows, actor || 'system', true);        // ซิงก์อัตโนมัติ: เคารพค่าที่อาจารย์ปรับทับ (locked)
  }

  /** ปรับชื่อ/คะแนนเต็มของประเภทอัตโนมัติ (เช่น แก้ชื่องาน) */
  function updateAuto(courseId, source, sourceRef, patch) {
    var t = typesOf_(courseId).filter(function (x) { return x.source === source && x.source_ref === String(sourceRef || ''); })[0];
    if (!t) return null;
    var p = {};
    if (patch.name !== undefined) p.name = patch.name;
    if (patch.max !== undefined) p.max_score = patch.max;
    if (Object.keys(p).length) Db.update('ScoreTypes', t.type_id, p);
    return Db.byId('ScoreTypes', t.type_id);
  }
  /** ลบประเภทอัตโนมัติพร้อมคะแนนทั้งหมด (เช่น ลบงาน) */
  function removeAuto(courseId, source, sourceRef) {
    var t = typesOf_(courseId).filter(function (x) { return x.source === source && x.source_ref === String(sourceRef || ''); })[0];
    if (!t) return 0;
    var n = Db.removeWhere('ScoreRecords', function (o) { return o.type_id === t.type_id; });
    Db.remove('ScoreTypes', t.type_id);
    return n;
  }

  function countForStudent(courseId, stdId) {
    return Db.findRows('ScoreRecords', 'std_id', stdId).filter(function (r) { return r.course_id === courseId && r.score !== ''; }).length;
  }
  function removeForStudents(courseId, stdIds) {
    var set = {};
    stdIds.forEach(function (id) { set[id] = true; });
    Db.removeWhere('ScoreAdjust', function (o) { return o.course_id === courseId && set[o.std_id] === true; });
    return Db.removeWhere('ScoreRecords', function (o) { return o.course_id === courseId && set[o.std_id] === true; });
  }

  return {
    summary: summary, override: override, adjust: adjust, gradeScale: gradeScale,
    listTypes: listTypes, saveType: saveType, deleteType: deleteType, table: table, saveBulk: saveBulk, exportCsv: exportCsv,
    ensureType: ensureType, checkPct: checkPct, setAutoPct: setAutoPct, pctMap: pctMap, setRecords: setRecords, updateAuto: updateAuto, removeAuto: removeAuto, countForStudent: countForStudent, removeForStudents: removeForStudents
  };
})();
