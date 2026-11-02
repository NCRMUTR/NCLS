/**************************************************************
 * File: Users.gs  (HBT Core v0.1.0)
 * ผู้ใช้และสิทธิ์ (ชีต Users) + บันทึกกิจกรรม (AuditLog)
 *  - admin เพิ่มอีเมลอาจารย์เอง และกำหนดระบบที่ใช้ได้ (att / exam / asg)
 *  - ปิดใช้งาน = ล็อกอินไม่ได้ ไม่ลบข้อมูล
 *  - ต้องมี admin ที่ active อย่างน้อย 1 คนเสมอ
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

var Users = (function () {

  function fromRow_(r) {
    return {
      email: r.email, name: r.name, role: r.role,
      systems: r.systems ? r.systems.split(',').filter(function (s) { return s; }) : [],
      active: U.bool(r.active), addedAt: r.added_at, lastLogin: r.last_login
    };
  }

  /** อ่านผู้ใช้ผ่านแคช 60 วินาที (คืน null ถ้าไม่มี) */
  function get(email) {
    email = U.normEmail(email);
    if (!email) return null;
    var key = 'USR_' + email;
    var c = U.cGet(key);
    if (c) {
      var o = U.parse(c, null);
      if (o) return o.none ? null : o;
    }
    var r = Db.byId('Users', email);
    var u = r ? fromRow_(r) : null;
    U.cPut(key, JSON.stringify(u || { none: true }), APP.USER_CACHE_SEC);
    return u;
  }

  function touchLogin(email, name) {
    var patch = { last_login: U.nowIso() };
    var r = Db.byId('Users', email);
    if (r && !r.name && name) patch.name = name;
    if (r) Db.update('Users', email, patch);
    U.cDel('USR_' + email);
  }

  function list() {
    return Db.all('Users').map(fromRow_).sort(function (a, b) {
      if (a.role !== b.role) return a.role === 'admin' ? -1 : 1;
      return a.name.localeCompare(b.name, 'th');
    });
  }

  function activeAdminsExcept_(email) {
    return Db.all('Users').filter(function (r) {
      return r.email !== email && r.role === 'admin' && U.bool(r.active);
    }).length;
  }

  function cleanSystems_(arr) {
    var out = [];
    (Array.isArray(arr) ? arr : String(arr || '').split(',')).forEach(function (s) {
      s = String(s).trim();
      if (APP.SYSTEMS.indexOf(s) >= 0 && out.indexOf(s) < 0) out.push(s);
    });
    return out;
  }

  /** เพิ่ม/แก้ผู้ใช้ (admin เท่านั้น — ตรวจสิทธิ์ที่ Router) */
  function upsert(actor, a) {
    var email = U.normEmail(a.email);
    if (!U.isEmail(email)) throw U.E('E_EMAIL');
    var domain = String(Config.get('DOMAIN') || '').toLowerCase();
    if (!domain || email.slice(-(domain.length + 1)) !== '@' + domain) throw U.E('E_EMAIL_DOMAIN');
    var name = U.clip(U.req(a.name, 'ชื่อที่แสดง'), 120);
    var existing = Db.byId('Users', email);
    // ฟิลด์ที่ไม่ส่งมา = คงค่าเดิมของผู้ใช้ที่มีอยู่ (กันเรียก API แบบย่อแล้วเผลอเปิดบัญชีที่ถูกปิด/ลดสิทธิ์ admin/ล้างระบบ)
    var role = (a.role === undefined || a.role === '') ? (existing ? existing.role : 'teacher') : String(a.role);
    if (APP.ROLES.indexOf(role) < 0) throw U.E('E_ROLE');
    var systems = a.systems === undefined ? cleanSystems_(existing ? existing.systems : '') : cleanSystems_(a.systems);
    var active = (a.active === undefined) ? (existing ? U.bool(existing.active) : true) : U.bool(a.active);

    if (existing && existing.role === 'admin' && U.bool(existing.active) && (role !== 'admin' || !active)) {
      if (activeAdminsExcept_(email) < 1) throw U.E('E_LAST_ADMIN');
    }
    if (existing) {
      Db.update('Users', email, { name: name, role: role, systems: systems.join(','), active: U.bstr(active) });
      Audit.log(actor, 'user.update', email, { role: role, systems: systems, active: active });
    } else {
      Db.insert('Users', {
        email: email, name: name, role: role, systems: systems.join(','), active: U.bstr(active),
        added_at: U.nowIso(), added_by: actor, last_login: ''
      });
      Audit.log(actor, 'user.add', email, { role: role, systems: systems });
    }
    U.cDel('USR_' + email);
    return get(email);
  }

  function setActive(actor, emailRaw, active) {
    var email = U.normEmail(emailRaw);
    var r = Db.byId('Users', email);
    if (!r) throw U.E('E_NOT_FOUND');
    active = U.bool(active);
    if (r.role === 'admin' && U.bool(r.active) && !active && activeAdminsExcept_(email) < 1) throw U.E('E_LAST_ADMIN');
    Db.update('Users', email, { active: U.bstr(active) });
    U.cDel('USR_' + email);
    Audit.log(actor, active ? 'user.enable' : 'user.disable', email, '');
    return get(email);
  }

  return { get: get, list: list, upsert: upsert, setActive: setActive, touchLogin: touchLogin };
})();
