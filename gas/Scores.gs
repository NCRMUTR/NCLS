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
  function typeOut_(r) {
    return {
      typeId: r.type_id, name: r.name, pct: Number(r.pct), max: Number(r.max_score),
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
    var visible = a.visible === undefined ? (ex ? U.bool(ex.visible) : true) : U.bool(a.visible);

    var name, max;
    if (ex && ex.source !== 'MANUAL') {            // ประเภทอัตโนมัติ: แก้ได้แค่น้ำหนัก/การแสดง
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
        type_id: out, course_id: c.course_id, name: name, pct: pct, max_score: max, source: 'MANUAL', source_ref: '',
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
    var types = typesOf_(c.course_id);
    var rec = recordsOf_(c.course_id);
    var students = Students.roster(c.course_id).map(function (s) {
      var sc = {};
      types.forEach(function (t) {
        var v = rec[t.type_id + '|' + s.std_id];
        sc[t.type_id] = v === undefined ? null : v;
      });
      return { stdId: s.std_id, name: s.name, scores: sc, total: totalOf_(types, sc) };
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
  function writeRecords_(courseId, type, rows, actor) {
    if (!Array.isArray(rows) || !rows.length) throw U.E('E_BAD_REQUEST', { why: 'rows' });
    if (rows.length > MAX_ROWS) throw U.E('E_BAD_REQUEST', { why: 'too_many', max: MAX_ROWS });
    var max = Number(type.max_score);
    var existing = {};
    Db.findRows('ScoreRecords', 'type_id', type.type_id).forEach(function (r) { existing[r.std_id] = r; });
    var roster = {};
    Students.roster(courseId).forEach(function (s) { roster[s.std_id] = true; });
    var seen = {}, skipped = [], patch = {}, inserts = [], saved = 0, cleared = 0, same = 0, now = U.nowIso();

    rows.forEach(function (r, i) {
      var rowNo = i + 1, id = '';
      try { id = Students.cleanId(r && r.stdId); } catch (e) { skipped.push({ row: rowNo, stdId: String(r && r.stdId || '').substring(0, 30), why: 'รหัสนักศึกษาไม่ถูกต้อง' }); return; }
      if (!roster[id]) { skipped.push({ row: rowNo, stdId: id, why: 'ไม่อยู่ในรายชื่อวิชานี้' }); return; }
      if (seen[id]) { skipped.push({ row: rowNo, stdId: id, why: 'รหัสซ้ำ (ใช้แถวแรก)' }); return; }
      seen[id] = true;
      var ex = existing[id];
      if (isBlank_(r.score)) {
        if (ex && ex.score !== '') { patch[ex._row] = { score: '', updated_at: now, updated_by: actor }; cleared++; } else same++;
        return;
      }
      var v = parseNum_(r.score);
      if (isNaN(v)) { skipped.push({ row: rowNo, stdId: id, why: 'คะแนนไม่ใช่ตัวเลข' }); return; }
      if (v > max + EPS) { skipped.push({ row: rowNo, stdId: id, why: 'เกินคะแนนเต็ม ' + max }); return; }
      v = r2_(v);
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
    if (saved || cleared) Courses.touch(courseId);
    return { saved: saved, cleared: cleared, unchanged: same, skipped: skipped.slice(0, 200), skippedCount: skipped.length };
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

  function exportCsv(user, courseId) {
    var c = Courses.require(user, courseId);
    var tb = table(user, c.course_id);
    var head = ['รหัสนักศึกษา', 'ชื่อ-นามสกุล'].concat(tb.types.map(function (t) { return t.name + ' (เต็ม ' + t.max + ', น้ำหนัก ' + t.pct + '%)'; })).concat(['คะแนนรวม (%)']);
    var rows = [head];
    tb.students.forEach(function (s) {
      rows.push([s.stdId, s.name].concat(tb.types.map(function (t) { var v = s.scores[t.typeId]; return v === null ? '' : v; })).concat([s.total]));
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
      type_id: id, course_id: courseId, name: d.name, pct: 0, max_score: d.max || 100, source: source, source_ref: String(sourceRef || ''),
      visible: U.bstr(d.visible !== false), sort_no: sort, created_at: U.nowIso()
    });
    return Db.byId('ScoreTypes', id);
  }
  function setRecords(courseId, typeId, rows, actor) {
    var t = Db.byId('ScoreTypes', typeId);
    if (!t || t.course_id !== courseId) throw U.E('E_NOT_FOUND');
    return writeRecords_(courseId, t, rows, actor || 'system');
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
    return Db.removeWhere('ScoreRecords', function (o) { return o.course_id === courseId && set[o.std_id] === true; });
  }

  return {
    listTypes: listTypes, saveType: saveType, deleteType: deleteType, table: table, saveBulk: saveBulk, exportCsv: exportCsv,
    ensureType: ensureType, setRecords: setRecords, updateAuto: updateAuto, removeAuto: removeAuto, countForStudent: countForStudent, removeForStudents: removeForStudents
  };
})();
