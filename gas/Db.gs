/**************************************************************
 * File: Db.gs  (HBT Core v0.1.0)
 * ชั้นฐานข้อมูล Google Sheets (ยกจาก EEOS v2.1.0 + ปรับเป็นของ Core)
 *  - อ่านด้วย getValues() (ค่าจริง) ไม่ใช่ค่าที่ตาเห็น
 *  - update() อ่านแถวจริงก่อนเขียนเสมอ
 *  - rowById()/findRows() ใช้ TextFinder ไม่อ่านทั้งชีต
 *  - bulkPatch()/removeWhere() เขียนทีละคอลัมน์/ทั้งช่วง ไม่ deleteRow ทีละแถว
 *  - คอลัมน์ใหม่ต้อง "ต่อท้าย" เท่านั้น + SCHEMA_VERSION ใหม่ = สร้างชีต/คอลัมน์ที่ขาดให้เอง
 **************************************************************/

var Db = (function () {

  var T = { TEXT: 'TEXT', NUM: 'NUM', INT: 'INT', DATETIME: 'DATETIME', BOOL: 'BOOL', JSON: 'JSON' };

  /* ขั้นถัดไปจะเพิ่มตาราง Att*, Assignments, Submissions, BackupLog ... ต่อท้ายตรงนี้ (ห้ามแทรกกลาง/เปลี่ยนลำดับคอลัมน์เดิม) */
  var SCHEMA = {
    Users: {
      pk: 'email',
      cols: [
        ['email', T.TEXT, 240], ['name', T.TEXT, 220], ['role', T.TEXT, 90],
        ['systems', T.TEXT, 160], ['active', T.BOOL, 80],
        ['added_at', T.DATETIME, 160], ['added_by', T.TEXT, 220], ['last_login', T.DATETIME, 160]
      ]
    },
    Terms: {
      pk: 'term_id',
      cols: [
        ['term_id', T.TEXT, 170], ['name', T.TEXT, 140], ['start_date', T.TEXT, 120], ['end_date', T.TEXT, 120],
        ['status', T.TEXT, 90], ['is_current', T.BOOL, 90], ['created_at', T.DATETIME, 160]
      ]
    },
    Settings: {
      pk: 'key',
      cols: [['key', T.TEXT, 220], ['value', T.TEXT, 320], ['updated_at', T.DATETIME, 160], ['updated_by', T.TEXT, 220]]
    },
    AuditLog: {
      pk: 'log_id',
      cols: [
        ['log_id', T.TEXT, 170], ['ts', T.DATETIME, 160], ['actor', T.TEXT, 220],
        ['action', T.TEXT, 160], ['target', T.TEXT, 220], ['detail', T.TEXT, 420]
      ]
    },

    /* ---------- v0.2.0 ข้อมูลกลาง ---------- */
    Courses: {
      pk: 'course_id',
      cols: [
        ['course_id', T.TEXT, 170], ['term_id', T.TEXT, 170], ['code', T.TEXT, 110], ['name', T.TEXT, 260],
        ['section', T.TEXT, 80], ['owner_email', T.TEXT, 240], ['created_at', T.DATETIME, 160], ['last_change_at', T.DATETIME, 160],
        ['backup_at', T.DATETIME, 160], ['reset_at', T.DATETIME, 160], ['reset_by', T.TEXT, 220]      // v0.6.0
      ]
    },
    Students: {                       // รายชื่อนักศึกษาต่อวิชา · row_key = course_id|std_id
      pk: 'row_key',
      cols: [
        ['row_key', T.TEXT, 260], ['course_id', T.TEXT, 170], ['std_id', T.TEXT, 130], ['name', T.TEXT, 260], ['added_at', T.DATETIME, 160]
      ]
    },
    StudentPIN: {                     // 1 คน 1 PIN ใช้ทุกวิชา/ทุกระบบ · เก็บเฉพาะแฮช (SHA-256 + salt + pepper)
      pk: 'std_id',
      cols: [
        ['std_id', T.TEXT, 130], ['hash', T.TEXT, 300], ['salt', T.TEXT, 140], ['set_at', T.DATETIME, 160],
        ['temp_hash', T.TEXT, 300], ['temp_salt', T.TEXT, 140], ['temp_expires_at', T.DATETIME, 160]
      ]
    },
    PinRequests: {
      pk: 'req_id',
      cols: [
        ['req_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['std_id', T.TEXT, 130], ['at', T.DATETIME, 160], ['status', T.TEXT, 90]
      ]
    },
    ScoreTypes: {
      pk: 'type_id',
      cols: [
        ['type_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['name', T.TEXT, 260], ['pct', T.NUM, 90], ['max_score', T.NUM, 100],
        ['source', T.TEXT, 100], ['source_ref', T.TEXT, 200], ['visible', T.BOOL, 80], ['sort_no', T.INT, 80], ['created_at', T.DATETIME, 160]
      ]
    },
    ScoreRecords: {                   // คะแนนดิบ (ไม่ใช่ %) · rec_key = type_id|std_id
      pk: 'rec_key',
      cols: [
        ['rec_key', T.TEXT, 300], ['course_id', T.TEXT, 170], ['type_id', T.TEXT, 170], ['std_id', T.TEXT, 130],
        ['score', T.NUM, 90], ['updated_at', T.DATETIME, 160], ['updated_by', T.TEXT, 220]
      ]
    },

    /* ---------- v0.3.0 เช็คชื่อ ---------- */
    AttSessions: {                    // 1 แถว = 1 คาบ · kind: live (สแกน) | manual (นำเข้าย้อนหลัง) · status: open | paused | closed
      pk: 'session_id',
      cols: [
        ['session_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['date', T.TEXT, 110], ['kind', T.TEXT, 80], ['status', T.TEXT, 80],
        ['opened_at', T.DATETIME, 160], ['closed_at', T.DATETIME, 160], ['lat', T.TEXT, 110], ['lng', T.TEXT, 110], ['radius_m', T.TEXT, 90],
        ['start_at', T.DATETIME, 160], ['normal_min', T.TEXT, 90], ['close_min', T.TEXT, 90], ['paused_at', T.DATETIME, 160],
        ['pause_offset_min', T.TEXT, 100], ['created_by', T.TEXT, 220]
      ]
    },
    AttRecords: {                     // ขาด = ไม่มีแถว · rec_key = session_id|std_id · status: normal | late | leave · source: SCAN | MANUAL | IMPORT
      pk: 'rec_key',
      cols: [
        ['rec_key', T.TEXT, 280], ['session_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['std_id', T.TEXT, 130], ['at', T.DATETIME, 160],
        ['status', T.TEXT, 80], ['lat', T.TEXT, 110], ['lng', T.TEXT, 110], ['device_id', T.TEXT, 280], ['note', T.TEXT, 260], ['source', T.TEXT, 90]
      ]
    },
    AttDevices: {                     // กัน 1 เครื่อง : 1 คน ต่อคาบ · dev_key = session_id|device_id
      pk: 'dev_key',
      cols: [
        ['dev_key', T.TEXT, 300], ['session_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['device_id', T.TEXT, 280], ['std_id', T.TEXT, 130], ['at', T.DATETIME, 160]
      ]
    },
    StudentDevices: {                 // เครื่องที่นักศึกษาเคยยืนยัน PIN แล้ว (จำไว้ไม่เกิน 3 เครื่อง) · dev_key = std_id|device_id
      pk: 'dev_key',
      cols: [
        ['dev_key', T.TEXT, 320], ['std_id', T.TEXT, 130], ['device_id', T.TEXT, 280], ['first_at', T.DATETIME, 160], ['last_at', T.DATETIME, 160]
      ]
    },
    AttApprovals: {                   // คำขอใช้เครื่องร่วมกัน · status: open | approved | denied | used
      pk: 'req_id',
      cols: [
        ['req_id', T.TEXT, 170], ['session_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['std_id', T.TEXT, 130], ['device_id', T.TEXT, 280],
        ['at', T.DATETIME, 160], ['status', T.TEXT, 90], ['decided_by', T.TEXT, 220], ['decided_at', T.DATETIME, 160]
      ]
    },

    /* ---------- v0.4.0 ส่งงาน ---------- */
    Assignments: {                    // kind: single | group · status: open | closed (ปิดเอง) · เฟสเวลา (open/late/closed) คำนวณจาก due_at/close_at/late_ok ที่ server
      pk: 'asg_id',
      cols: [
        ['asg_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['code', T.TEXT, 100], ['title', T.TEXT, 260], ['description', T.TEXT, 420],
        ['kind', T.TEXT, 80], ['max_score', T.NUM, 90], ['due_at', T.TEXT, 150], ['late_ok', T.BOOL, 80], ['close_at', T.TEXT, 150],
        ['status', T.TEXT, 80], ['max_group', T.INT, 90], ['show_grades', T.BOOL, 90], ['link_url', T.TEXT, 300], ['folder_id', T.TEXT, 240],
        ['created_by', T.TEXT, 220], ['created_at', T.DATETIME, 160], ['updated_at', T.DATETIME, 160]
      ]
    },
    AsgGroups: {                      // งานกลุ่ม: 1 กลุ่ม = ตัวแทน 1 คน + สมาชิก (ดู AsgMembers)
      pk: 'group_id',
      cols: [
        ['group_id', T.TEXT, 170], ['asg_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['name', T.TEXT, 200], ['rep_std', T.TEXT, 130], ['created_at', T.DATETIME, 160]
      ]
    },
    AsgMembers: {                     // mem_key = asg_id|std_id → 1 คนอยู่ได้กลุ่มเดียวต่องาน (กันซ้ำด้วยคีย์)
      pk: 'mem_key',
      cols: [
        ['mem_key', T.TEXT, 300], ['asg_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['group_id', T.TEXT, 170], ['std_id', T.TEXT, 130]
      ]
    },
    AsgSubs: {                        // งานที่ส่ง: sub_key = asg_id|std_id (เดี่ยว) หรือ asg_id|group_id (กลุ่ม)
      pk: 'sub_key',
      cols: [
        ['sub_key', T.TEXT, 320], ['asg_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['group_id', T.TEXT, 170], ['owner_std', T.TEXT, 130],
        ['note', T.TEXT, 420], ['link', T.TEXT, 300], ['first_at', T.DATETIME, 160], ['updated_at', T.DATETIME, 160]
      ]
    },
    AsgFiles: {                       // ไฟล์ในงานที่ส่ง (เก็บจริงใน Drive ส่วนกลาง) · เพิ่มได้หลายไฟล์ต่อการส่ง
      pk: 'file_id',
      cols: [
        ['file_id', T.TEXT, 170], ['sub_key', T.TEXT, 320], ['asg_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['name', T.TEXT, 300],
        ['size', T.INT, 100], ['mime', T.TEXT, 200], ['drive_id', T.TEXT, 240], ['uploaded_at', T.DATETIME, 160], ['uploaded_by', T.TEXT, 130]
      ]
    },
    AsgGrades: {                      // คะแนน/ความเห็นรายคน (งานกลุ่มให้ทั้งกลุ่มหรือรายบุคคลก็เขียนเป็นรายคนเสมอ) · gr_key = asg_id|std_id
      pk: 'gr_key',
      cols: [
        ['gr_key', T.TEXT, 300], ['asg_id', T.TEXT, 170], ['course_id', T.TEXT, 170], ['std_id', T.TEXT, 130], ['score', T.NUM, 90],
        ['feedback', T.TEXT, 420], ['graded_by', T.TEXT, 220], ['graded_at', T.DATETIME, 160]
      ]
    }
  };

  var FORMAT = { TEXT: '@', JSON: '@', DATETIME: '@', BOOL: '@', NUM: '0.##', INT: '0' };
  var SCHEMA_VERSION = '0.6.0';

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

  function ssId() { return prop('HBT_SS_ID'); }

  function setSsId(id) {
    setProp('HBT_SS_ID', id);
    setProp('HBT_SCHEMA_VER', '');
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
    var book = SpreadsheetApp.create(name || ('HBT_Core — ' + APP.NAME));
    book.setSpreadsheetTimeZone(APP.TZ);
    setSsId(book.getId());
    return book.getId();
  }

  /* ---------- บังคับชนิด cell เป็นบล็อก ---------- */
  function ensureFormat(name, upToRow) {
    var key = 'HBT_FMT_' + name;
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
    if (!force && ssId() && prop('HBT_SCHEMA_VER') === SCHEMA_VERSION) { _checked = true; return ssId(); }
    // ย้ายโครงสร้างต้องทำใน lock: กันสอง execution แรกหลังอัปเดตโค้ดสร้างชีตซ้ำพร้อมกัน
    return U.lock(function () {
      _props = null;                                    // อ่านค่าสดหลังได้ lock (อีกคนอาจย้ายเสร็จแล้ว)
      if (!force && ssId() && prop('HBT_SCHEMA_VER') === SCHEMA_VERSION) { _checked = true; return ssId(); }
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
      fmtReset['HBT_FMT_' + name] = '0';
    });
    setProps(fmtReset);
    Object.keys(SCHEMA).forEach(function (name) {
      ensureFormat(name, Math.max(book.getSheetByName(name).getLastRow(), 500));
    });
    var def1 = book.getSheetByName('Sheet1') || book.getSheetByName('ชีต1');
    if (def1 && book.getSheets().length > 1 && def1.getLastRow() === 0) book.deleteSheet(def1);

    _checked = true;
    _cache = {}; _idx = {};
    setProp('HBT_SCHEMA_VER', SCHEMA_VERSION);
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
    all: all, where: where, byId: byId, rowById: rowById, readRow: readRow, findRows: findRows,
    insert: insert, insertMany: insertMany, update: update, bulkPatch: bulkPatch,
    remove: remove, removeWhere: removeWhere, flush: flush, resetRuntime: resetRuntime,
    reloadProps: reloadProps, prop: prop, setProp: setProp, setProps: setProps, delProp: delProp
  };
})();
