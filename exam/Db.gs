/**************************************************************
 * File: Db.gs  (HBT Exam API v0.5.0)
 * ชั้นฐานข้อมูล Google Sheets (ชุดเดียวกับ HBT Core — ยกมาจาก EEOS v2.1.0)
 *  - อ่านด้วย getValues() (ค่าจริง) ไม่ใช่ค่าที่ตาเห็น
 *  - update() อ่านแถวจริงก่อนเขียนเสมอ
 *  - rowById()/findRows() ใช้ TextFinder ไม่อ่านทั้งชีต
 *  - bulkPatch()/removeWhere() เขียนทีละคอลัมน์/ทั้งช่วง ไม่ deleteRow ทีละแถว
 *  - คอลัมน์ใหม่ต้อง "ต่อท้าย" เท่านั้น + SCHEMA_VERSION ใหม่ = สร้างชีต/คอลัมน์ที่ขาดให้เอง
 **************************************************************/

var Db = (function () {

  var T = { TEXT: 'TEXT', NUM: 'NUM', INT: 'INT', DATETIME: 'DATETIME', BOOL: 'BOOL', JSON: 'JSON' };

  /* คอลัมน์ใหม่ต้อง "ต่อท้าย" เท่านั้น ห้ามแทรกกลาง · course_id = รหัสรายวิชาของ HBT Core */
  var SCHEMA = {
    Quizzes: {
      pk: 'quiz_id',
      cols: [
        ['quiz_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['title', T.TEXT, 260],
        ['note', T.TEXT, 300], ['status', T.TEXT, 90],
        ['created_at', T.DATETIME, 160], ['updated_at', T.DATETIME, 160],
        ['question_count', T.INT, 100]
      ]
    },
    Questions: {
      pk: 'question_id',
      cols: [
        ['question_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['quiz_id', T.TEXT, 170], ['q_no', T.INT, 70],
        ['q_type', T.TEXT, 90], ['q_text', T.TEXT, 400], ['q_image_id', T.TEXT, 200],
        ['score', T.NUM, 80], ['explain_text', T.TEXT, 340], ['explain_image_id', T.TEXT, 200],
        ['status', T.TEXT, 90], ['created_at', T.DATETIME, 160], ['updated_at', T.DATETIME, 160]
      ]
    },
    Choices: {
      pk: 'choice_id',
      cols: [
        ['choice_id', T.TEXT, 170], ['question_id', T.TEXT, 170], ['course_id', T.TEXT, 170],
        ['c_idx', T.INT, 70], ['c_type', T.TEXT, 90], ['c_text', T.TEXT, 340],
        ['c_image_id', T.TEXT, 200], ['is_correct', T.BOOL, 90]
      ]
    },
    Rounds: {                         // รอบฝึกทำ (PRACTISE) / รอบสอบ (TEST)
      pk: 'session_id',
      cols: [
        ['session_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['quiz_id', T.TEXT, 170], ['mode', T.TEXT, 100],
        ['title', T.TEXT, 220], ['start_at', T.DATETIME, 160], ['end_at', T.DATETIME, 160],
        ['sec_per_question', T.INT, 110], ['total_minutes', T.INT, 110],
        ['allow_back', T.BOOL, 90], ['shuffle_q', T.BOOL, 90], ['shuffle_c', T.BOOL, 90],
        ['lock_tab', T.BOOL, 90], ['max_violations', T.INT, 110], ['tts', T.BOOL, 80],
        ['resume', T.BOOL, 80], ['max_attempts', T.INT, 100], ['status', T.TEXT, 100],
        ['token', T.TEXT, 200], ['created_at', T.DATETIME, 160],
        ['opened_at', T.DATETIME, 160], ['closed_at', T.DATETIME, 160],
        ['stat_json', T.JSON, 260],
        ['score_mode', T.TEXT, 100], ['score_value', T.NUM, 100],
        ['sync_state', T.TEXT, 100], ['sync_at', T.DATETIME, 160], ['sync_note', T.TEXT, 300]
      ]
    },
    Attempts: {
      pk: 'attempt_id',
      cols: [
        ['attempt_id', T.TEXT, 170], ['session_id', T.TEXT, 170], ['course_id', T.TEXT, 170],
        ['mode', T.TEXT, 100], ['std_id', T.TEXT, 130],
        ['student_name', T.TEXT, 240], ['status', T.TEXT, 110],
        ['started_at', T.DATETIME, 160], ['last_seen_at', T.DATETIME, 160],
        ['submitted_at', T.DATETIME, 160], ['cur_index', T.INT, 90],
        ['total_score', T.NUM, 100], ['max_score', T.NUM, 100],
        ['correct_count', T.INT, 100], ['wrong_count', T.INT, 100],
        ['unanswered_count', T.INT, 110], ['duration_sec', T.INT, 110],
        ['violations', T.INT, 90], ['state_json', T.JSON, 300],
        ['answers_json', T.JSON, 300],
        ['course_score', T.NUM, 100], ['course_max', T.NUM, 100], ['ans_written', T.TEXT, 90]
      ]
    },
    Answers: {                        // บันทึกรายข้อไว้ตรวจย้อนหลัง · เขียนตอนปิดรอบ (ไม่ใช่ตอนตอบ)
      pk: 'answer_id',
      cols: [
        ['answer_id', T.TEXT, 170], ['attempt_id', T.TEXT, 170], ['session_id', T.TEXT, 170],
        ['course_id', T.TEXT, 170], ['std_id', T.TEXT, 130], ['question_id', T.TEXT, 170],
        ['q_no', T.INT, 70], ['selected_idx', T.INT, 100], ['is_correct', T.BOOL, 90],
        ['score_got', T.NUM, 90], ['score_max', T.NUM, 90],
        ['time_spent_sec', T.INT, 110], ['answered_at', T.DATETIME, 160]
      ]
    },
    AuditLog: {
      pk: 'log_id',
      cols: [
        ['log_id', T.TEXT, 170], ['ts', T.DATETIME, 160], ['actor', T.TEXT, 220],
        ['action', T.TEXT, 160], ['target', T.TEXT, 220], ['detail', T.TEXT, 420]
      ]
    }
  };

  var FORMAT = { TEXT: '@', JSON: '@', DATETIME: '@', BOOL: '@', NUM: '0.##', INT: '0' };
  var SCHEMA_VERSION = '0.5.0';

  var _ss = null, _checked = false, _cache = {}, _props = null, _idx = {};

  /* ---------- ScriptProperties (อ่านครั้งเดียวต่อ execution) ---------- */
  function props_() {
    if (!_props) _props = PropertiesService.getScriptProperties().getProperties();
    return _props;
  }
  function prop(key) { return props_()[key] || ''; }
  function setProp(key, value) {
    PropertiesService.getScriptProperties().setProperty(key, String(value));
    props_()[key] = String(value);
  }
  function setProps(map) {
    PropertiesService.getScriptProperties().setProperties(map, false);
    var p = props_();
    Object.keys(map).forEach(function (k) { p[k] = String(map[k]); });
  }
  function delProp(key) {
    PropertiesService.getScriptProperties().deleteProperty(key);
    delete props_()[key];
  }

  function ssId() { return prop('EXAM_SS_ID'); }

  function setSsId(id) {
    setProp('EXAM_SS_ID', id);
    setProp('EXAM_SCHEMA_VER', '');
    _ss = null; _checked = false; _cache = {}; _idx = {};
  }

  function ss() {
    if (_ss) return _ss;
    var id = ssId();
    if (!id) throw U.E('E_NOT_SETUP');
    _ss = SpreadsheetApp.openById(id);
    return _ss;
  }

  /** สร้างไฟล์ฐานข้อมูลใหม่ (เรียกจาก Setup เท่านั้น) */
  function createDatabase(name) {
    var book = SpreadsheetApp.create(name || ('HBT_Exam — ' + APP.NAME));
    book.setSpreadsheetTimeZone(APP.TZ);
    setSsId(book.getId());
    return book.getId();
  }

  /* ---------- บังคับชนิด cell เป็นบล็อก ---------- */
  function ensureFormat(name, upToRow) {
    var key = 'EXAM_FMT_' + name;
    var done = Number(prop(key) || 0);
    if (upToRow <= done) return;
    var sh = ss().getSheetByName(name);
    if (!sh) return;
    var target = Math.max(upToRow, 2) + 500;
    if (sh.getMaxRows() < target) sh.insertRowsAfter(sh.getMaxRows(), target - sh.getMaxRows());
    var start = Math.max(2, done + 1);
    var n = target - start + 1;
    if (n > 0) {
      var pattern = SCHEMA[name].cols.map(function (c) { return FORMAT[c[1]] || '@'; });
      var grid = [];
      for (var i = 0; i < n; i++) grid.push(pattern);
      sh.getRange(start, 1, n, pattern.length).setNumberFormats(grid);
    }
    setProp(key, target);
  }

  /* ---------- โครงสร้าง ---------- */
  function ensureSchema(force) {
    if (_checked && !force) return ssId();
    if (!force && ssId() && prop('EXAM_SCHEMA_VER') === SCHEMA_VERSION) { _checked = true; return ssId(); }
    // ย้ายโครงสร้างต้องทำใน lock: กันสอง execution แรกหลังอัปเดตโค้ดสร้างชีตซ้ำพร้อมกัน
    return U.lock(function () {
      _props = null;                                    // อ่านค่าสดหลังได้ lock (อีกคนอาจย้ายเสร็จแล้ว)
      if (!force && ssId() && prop('EXAM_SCHEMA_VER') === SCHEMA_VERSION) { _checked = true; return ssId(); }
      return migrate_();
    });
  }

  function migrate_() {
    var book = ss();
    var fmtReset = {};
    Object.keys(SCHEMA).forEach(function (name) {
      var def = SCHEMA[name];
      var sh = book.getSheetByName(name);
      if (!sh) sh = book.insertSheet(name);
      var headers = def.cols.map(function (c) { return c[0]; });
      if (sh.getMaxColumns() < headers.length) sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
      var cur = sh.getLastColumn() > 0 ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
      var same = cur.length >= headers.length && headers.every(function (h, i) { return cur[i] === h; });
      if (!same) {
        sh.getRange(1, 1, 1, headers.length).setValues([headers]);
        sh.getRange(1, 1, 1, headers.length).setFontFamily('Arial').setFontWeight('bold').setFontSize(10)
          .setBackground('#0F766E').setFontColor('#FFFFFF').setVerticalAlignment('middle').setWrap(false);
        def.cols.forEach(function (c, i) { try { sh.setColumnWidth(i + 1, c[2] || 140); } catch (e) {} });
      }
      if (sh.getFrozenRows() < 1) sh.setFrozenRows(1);
      fmtReset['EXAM_FMT_' + name] = '0';
    });
    setProps(fmtReset);
    Object.keys(SCHEMA).forEach(function (name) {
      ensureFormat(name, Math.max(book.getSheetByName(name).getLastRow(), 500));
    });
    var def1 = book.getSheetByName('Sheet1') || book.getSheetByName('ชีต1');
    if (def1 && book.getSheets().length > 1 && def1.getLastRow() === 0) book.deleteSheet(def1);

    _checked = true;
    _cache = {}; _idx = {};
    setProp('EXAM_SCHEMA_VER', SCHEMA_VERSION);
    return ssId();
  }

  function sheet(name) {
    ensureSchema();
    var sh = ss().getSheetByName(name);
    if (!sh) throw U.E('E_NOT_FOUND', { sheet: name });
    return sh;
  }
  function cols(name) { return SCHEMA[name].cols.map(function (c) { return c[0]; }); }

  /* ---------- อ่าน ---------- */
  function all(name) {
    if (_cache[name]) return _cache[name];
    var sh = sheet(name), last = sh.getLastRow(), hs = cols(name);
    if (last < 2) { _cache[name] = []; return []; }
    var values = sh.getRange(2, 1, last - 1, hs.length).getValues();
    var out = [], map = {};
    for (var r = 0; r < values.length; r++) {
      var row = values[r], o = { _row: r + 2 }, empty = true;
      for (var c = 0; c < hs.length; c++) {
        o[hs[c]] = U.cell2str(row[c]);
        if (o[hs[c]] !== '') empty = false;
      }
      if (!empty) { out.push(o); map[o[SCHEMA[name].pk]] = o._row; }
    }
    _cache[name] = out;
    _idx[name] = map;
    return out;
  }
  function where(name, pred) { return all(name).filter(pred); }

  function rowById(name, id) {
    if (_idx[name] && _idx[name][id]) return _idx[name][id];
    var sh = sheet(name), last = sh.getLastRow();
    if (last < 2) return 0;
    var pkCol = cols(name).indexOf(SCHEMA[name].pk) + 1;
    var found = sh.getRange(2, pkCol, last - 1, 1).createTextFinder(String(id)).matchCase(true).matchEntireCell(true).findNext();
    var row = found ? found.getRow() : 0;
    if (row) { _idx[name] = _idx[name] || {}; _idx[name][id] = row; }
    return row;
  }
  /** ใช้เลขแถวที่รู้อยู่แล้ว (จากแคช) ไม่ต้องค้นใหม่ — ผู้เรียกต้องตรวจเองว่าแถวตรง */
  function hintRow(name, id, row) { _idx[name] = _idx[name] || {}; _idx[name][id] = row; }
  function readRow(name, row) {
    var hs = cols(name);
    var vals = sheet(name).getRange(row, 1, 1, hs.length).getValues()[0];
    var o = { _row: row };
    hs.forEach(function (h, i) { o[h] = U.cell2str(vals[i]); });
    return o;
  }
  function byId(name, id) {
    if (_cache[name]) {
      var list = _cache[name], pk = SCHEMA[name].pk;
      for (var i = 0; i < list.length; i++) if (list[i][pk] === id) return list[i];
      return null;
    }
    var row = rowById(name, id);
    if (!row) return null;
    var rec = readRow(name, row);
    // ตรวจค่าจริงซ้ำอีกชั้น (กันกรณี TextFinder ให้ผลคลาดเคลื่อน)
    return rec[SCHEMA[name].pk] === String(id) ? rec : null;
  }
  function findRows(name, colName, value) {
    var sh = sheet(name), last = sh.getLastRow();
    if (last < 2) return [];
    var ci = cols(name).indexOf(colName) + 1;
    if (ci < 1) throw U.E('E_NOT_FOUND', { col: colName });
    var hits = sh.getRange(2, ci, last - 1, 1).createTextFinder(String(value)).matchCase(true).matchEntireCell(true).findAll();
    return hits.map(function (h) { return readRow(name, h.getRow()); })
      .filter(function (r) { return r[colName] === String(value); });
  }

  /* ---------- เขียน ---------- */
  function rowValues(name, obj) {
    return cols(name).map(function (k) {
      var v = obj[k];
      return (v === null || v === undefined) ? '' : U.clip(String(v));
    });
  }
  function insert(name, obj) {
    var sh = sheet(name);
    ensureFormat(name, sh.getLastRow() + 1);
    sh.appendRow(rowValues(name, obj));
    delete _cache[name]; delete _idx[name];
    obj._row = sh.getLastRow();
    return obj;
  }
  function insertMany(name, objs) {
    if (!objs || !objs.length) return 0;
    var sh = sheet(name), start = sh.getLastRow() + 1;
    ensureFormat(name, start + objs.length);
    var data = objs.map(function (o) { return rowValues(name, o); });
    sh.getRange(start, 1, data.length, cols(name).length).setValues(data);
    delete _cache[name]; delete _idx[name];
    return data.length;
  }
  function update(name, id, patch) {
    var row = rowById(name, id);
    if (!row) throw U.E('E_NOT_FOUND', { table: name, id: id });
    var sh = sheet(name), hs = cols(name);
    var cur = sh.getRange(row, 1, 1, hs.length).getValues()[0];
    var out = hs.map(function (k, i) {
      var v = (patch[k] !== undefined) ? patch[k] : U.cell2str(cur[i]);
      return (v === null || v === undefined) ? '' : U.clip(String(v));
    });
    sh.getRange(row, 1, 1, hs.length).setValues([out]);
    delete _cache[name];
    return true;
  }
  /** แก้หลายแถวทีละ "คอลัมน์" rowPatch = { <เลขแถว>: { col: value } } */
  function bulkPatch(name, rowPatch) {
    var rows = Object.keys(rowPatch).map(Number);
    if (!rows.length) return 0;
    var sh = sheet(name), last = sh.getLastRow();
    if (last < 2) return 0;
    var hs = cols(name), touched = {};
    rows.forEach(function (r) { Object.keys(rowPatch[r]).forEach(function (k) { touched[k] = true; }); });
    Object.keys(touched).forEach(function (k) {
      var ci = hs.indexOf(k) + 1;
      if (ci < 1) return;
      var rng = sh.getRange(2, ci, last - 1, 1), vals = rng.getValues();
      rows.forEach(function (r) {
        if (rowPatch[r][k] === undefined) return;
        var v = rowPatch[r][k];
        if (r - 2 >= 0 && r - 2 < vals.length) vals[r - 2][0] = (v === null) ? '' : v;
      });
      rng.setValues(vals);
    });
    delete _cache[name];
    return rows.length;
  }
  function remove(name, id) {
    var row = rowById(name, id);
    if (!row) return false;
    sheet(name).deleteRow(row);
    delete _cache[name]; delete _idx[name];
    return true;
  }
  /**
   * ลบหลายแถวด้วยการเขียนทับช่วงที่เหลือครั้งเดียว (ไม่ deleteRow ทีละแถว)
   * pred(record) = true คือแถวที่ต้องลบ · คืนจำนวนที่ลบ
   */
  function removeWhere(name, pred) {
    var sh = sheet(name), last = sh.getLastRow(), hs = cols(name);
    if (last < 2) return 0;
    var rng = sh.getRange(2, 1, last - 1, hs.length), values = rng.getValues();
    var keep = [], removed = 0;
    values.forEach(function (row) {
      var o = {};
      hs.forEach(function (h, i) { o[h] = U.cell2str(row[i]); });
      if (pred(o)) removed++; else keep.push(row);
    });
    if (!removed) return 0;
    var blank = [];
    for (var i = 0; i < removed; i++) blank.push(hs.map(function () { return ''; }));
    var out = keep.concat(blank);
    rng.setValues(out);
    delete _cache[name]; delete _idx[name];
    return removed;
  }
  function flush() { _cache = {}; _idx = {}; }
  function reloadProps() { _props = null; }
  function resetRuntime() { _ss = null; _checked = false; _cache = {}; _idx = {}; _props = null; }

  return {
    T: T, SCHEMA: SCHEMA, VERSION: SCHEMA_VERSION,
    createDatabase: createDatabase, ssId: ssId, setSsId: setSsId, ensureSchema: ensureSchema, sheet: sheet, cols: cols,
    all: all, where: where, byId: byId, rowById: rowById, readRow: readRow, hintRow: hintRow, findRows: findRows,
    insert: insert, insertMany: insertMany, update: update, bulkPatch: bulkPatch,
    remove: remove, removeWhere: removeWhere, flush: flush, resetRuntime: resetRuntime,
    reloadProps: reloadProps, prop: prop, setProp: setProp, setProps: setProps, delProp: delProp
  };
})();
