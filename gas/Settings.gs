/**************************************************************
 * File: Settings.gs  (HBT Core v0.1.0)
 * ค่าตั้งค่าที่ admin แก้ได้จากหน้าเว็บ (ชีต Settings) + ภาคเรียน (Terms)
 * ค่าที่เสี่ยงล็อกตัวเอง (Client ID, โดเมน, secret) ไม่อยู่ที่นี่ — แก้ได้เฉพาะใน Apps Script (Setup.gs)
 **************************************************************/

var SETTING_DEFS = [
  { key: 'file_max_mb', label: 'ขนาดไฟล์สูงสุดต่อไฟล์ (MB)', group: 'ไฟล์งานนักศึกษา', type: 'int', min: 1, max: 6, def: '5' },
  { key: 'file_max_count', label: 'จำนวนไฟล์สูงสุดต่อการส่ง', group: 'ไฟล์งานนักศึกษา', type: 'int', min: 1, max: 10, def: '5' },
  { key: 'file_types', label: 'ชนิดไฟล์ที่รับ', group: 'ไฟล์งานนักศึกษา', type: 'list', options: ['pdf', 'jpg', 'png', 'docx', 'xlsx', 'pptx'], def: 'pdf,jpg,png,docx,xlsx,pptx' },
  { key: 'att_radius_m', label: 'รัศมีเช็คชื่อเริ่มต้น (เมตร)', group: 'เช็คชื่อ', type: 'int', min: 10, max: 5000, def: '500' },
  { key: 'att_normal_min', label: 'นับเป็นปกติ (นาทีหลังเริ่ม)', group: 'เช็คชื่อ', type: 'int', min: 1, max: 180, def: '10' },
  { key: 'att_close_min', label: 'ปิดรับ (นาทีหลังเริ่ม)', group: 'เช็คชื่อ', type: 'int', min: 1, max: 300, def: '20' },
  { key: 'pin_max_fail', label: 'ใส่ PIN ผิดได้กี่ครั้งก่อนล็อก', group: 'PIN นักศึกษา', type: 'int', min: 3, max: 10, def: '5' },
  { key: 'pin_lock_min', label: 'ล็อกกี่นาที', group: 'PIN นักศึกษา', type: 'int', min: 1, max: 120, def: '15' }
];

var Settings = (function () {

  function def_(key) {
    for (var i = 0; i < SETTING_DEFS.length; i++) if (SETTING_DEFS[i].key === key) return SETTING_DEFS[i];
    return null;
  }

  function stored_() {
    var c = U.cGet('SET_ALL');
    if (c) { var o = U.parse(c, null); if (o) return o; }
    var map = {};
    Db.all('Settings').forEach(function (r) { map[r.key] = r.value; });
    U.cPut('SET_ALL', JSON.stringify(map), 60);
    return map;
  }

  function get(key) {
    var d = def_(key);
    if (!d) throw U.E('E_SETTING', { key: key });
    var m = stored_();
    return m[key] !== undefined && m[key] !== '' ? m[key] : d.def;
  }

  function getAll() {
    var m = stored_();
    return SETTING_DEFS.map(function (d) {
      var v = m[d.key] !== undefined && m[d.key] !== '' ? m[d.key] : d.def;
      return { key: d.key, label: d.label, group: d.group, type: d.type, min: d.min, max: d.max, options: d.options, def: d.def, value: v };
    });
  }

  function normalize_(d, value) {
    if (d.type === 'int') {
      var n = Number(String(value).trim());
      if (!isFinite(n) || Math.floor(n) !== n || n < d.min || n > d.max) throw U.E('E_SETTING', { key: d.key, min: d.min, max: d.max });
      return String(n);
    }
    if (d.type === 'list') {
      var items = (Array.isArray(value) ? value : String(value).split(',')).map(function (s) { return String(s).trim(); })
        .filter(function (s) { return s; });
      var out = [];
      items.forEach(function (s) {
        if (d.options.indexOf(s) < 0) throw U.E('E_SETTING', { key: d.key, bad: s });
        if (out.indexOf(s) < 0) out.push(s);
      });
      if (!out.length) throw U.E('E_SETTING', { key: d.key });
      return out.join(',');
    }
    return String(value);
  }

  /** ตรวจค่าโดยไม่เขียน (ผิดแล้ว throw E_SETTING) */
  function check(key, value) {
    var d = def_(key);
    if (!d) throw U.E('E_SETTING', { key: key });
    return normalize_(d, value);
  }

  function set(actor, key, value) {
    var d = def_(key);
    if (!d) throw U.E('E_SETTING', { key: key });
    var v = normalize_(d, value);
    if (Db.byId('Settings', key)) Db.update('Settings', key, { value: v, updated_at: U.nowIso(), updated_by: actor });
    else Db.insert('Settings', { key: key, value: v, updated_at: U.nowIso(), updated_by: actor });
    U.cDel('SET_ALL');
    Audit.log(actor, 'settings.set', key, v);
    return v;
  }

  return { get: get, getAll: getAll, set: set, check: check };
})();

var Terms = (function () {

  /** yyyy-mm-dd ที่เป็นวันจริง (ไม่รับ 2026-02-30 ที่ Date เลื่อนเป็นเดือนถัดไปให้เอง) */
  function validYmd_(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return false;
    var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
    var dt = new Date(Date.UTC(y, mo - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
  }

  function out_(r) {
    return { termId: r.term_id, name: r.name, startDate: r.start_date, endDate: r.end_date, status: r.status, isCurrent: U.bool(r.is_current) };
  }
  function list() {
    return Db.all('Terms').map(out_).sort(function (a, b) { return a.name < b.name ? 1 : -1; });
  }
  function current() {
    var l = Db.all('Terms').filter(function (r) { return U.bool(r.is_current); });
    return l.length ? out_(l[0]) : null;
  }
  function create(actor, a) {
    var name = U.clip(U.req(a.name, 'ชื่อภาคเรียน'), 30);
    var sd = String(a.startDate || '').trim(), ed = String(a.endDate || '').trim();
    [sd, ed].forEach(function (d) {
      if (d && !validYmd_(d)) throw U.E('E_TERM_DATE');
    });
    if (sd && ed && ed < sd) throw U.E('E_TERM_DATE');
    var rows = Db.all('Terms');
    if (rows.some(function (r) { return r.name === name; })) throw U.E('E_TERM_DUP');
    var first = rows.length === 0;
    var id = U.uid('TERM');
    Db.insert('Terms', {
      term_id: id, name: name, start_date: sd, end_date: ed,
      status: 'open', is_current: U.bstr(first), created_at: U.nowIso()
    });
    Audit.log(actor, 'term.create', id, name);
    return out_(Db.byId('Terms', id));
  }
  function setCurrent(actor, termId) {
    var t = Db.byId('Terms', termId);
    if (!t) throw U.E('E_NOT_FOUND');
    var patch = {};
    Db.all('Terms').forEach(function (r) { patch[r._row] = { is_current: U.bstr(r.term_id === termId) }; });
    Db.bulkPatch('Terms', patch);
    Audit.log(actor, 'term.setCurrent', termId, t.name);
    return list();
  }
  return { list: list, current: current, create: create, setCurrent: setCurrent, validYmd: validYmd_ };
})();
