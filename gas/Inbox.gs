/**************************************************************
 * File: Inbox.gs  (HBT Core v0.9.0)
 * กล่องข้อความจากนักศึกษาถึงอาจารย์เจ้าของวิชา (แจ้งเรื่องงาน/เพื่อนร่วมกลุ่มที่ไม่ช่วยงาน ฯลฯ)
 *  - นักศึกษา (token ชนิด s) ส่งได้ · ดูได้เฉพาะข้อความของตัวเอง + สถานะ (new/read/done) · ไม่มีการตอบกลับในระบบ
 *  - อาจารย์เจ้าของวิชา/admin ดูทั้งหมดของวิชานั้น · มีสถานะ ใหม่/อ่านแล้ว/จัดการแล้ว · ลบได้
 *  - เพื่อนที่ถูกกล่าวถึง (about_std) มองไม่เห็นข้อความนี้ · จำกัด 10 ข้อความ/คน/วัน · ข้อความยาวไม่เกิน 500 ตัวอักษร
 **************************************************************/

var Inbox = (function () {

  var MAX_MSG = 500, PER_DAY = 10, DUP_SEC = 60, STATUSES = ['new', 'read', 'done'];

  function cleanMsg_(v) { return String(v === undefined || v === null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim().substring(0, MAX_MSG); }
  function out_(r) {
    return {
      msgId: r.msg_id, asgId: r.asg_id, fromStd: r.from_std, aboutStd: r.about_std, kind: r.kind, message: r.message,
      createdAt: r.created_at, status: r.status || 'new', handledBy: r.handled_by, handledAt: r.handled_at
    };
  }

  /** นักศึกษาส่งข้อความ: a = { message, asgId?, aboutStd? } */
  function send(s, a) {
    var msg = cleanMsg_(a.message);
    if (!msg) throw U.E('E_INBOX_FIELD', { field: 'message' }, 'กรุณาพิมพ์ข้อความ');
    var asgId = '';
    if (a.asgId) {
      var asg = Db.byId('Assignments', String(a.asgId));
      if (!asg || asg.course_id !== s.courseId) throw U.E('E_NOT_FOUND');
      asgId = asg.asg_id;
    }
    var about = '';
    if (a.aboutStd) {
      about = Students.cleanId(a.aboutStd);
      if (about === s.stdId) throw U.E('E_INBOX_FIELD', { field: 'aboutStd' }, 'เลือกชื่อเพื่อนที่ต้องการแจ้ง ไม่ใช่ตัวเอง');
      if (!Students.find(s.courseId, about)) throw U.E('E_NOT_FOUND');
    }
    var now = U.nowIso(), today = now.substring(0, 10), mine = Db.findRows('Inbox', 'from_std', s.stdId).filter(function (r) { return r.course_id === s.courseId; });
    var dup = mine.filter(function (r) { return r.message === msg && r.about_std === about && r.asg_id === asgId && (Date.now() - (U.toDate(r.created_at) || new Date(0)).getTime()) < DUP_SEC * 1000; })[0];
    if (dup) return { msgId: dup.msg_id, duplicate: true };
    if (mine.filter(function (r) { return String(r.created_at).substring(0, 10) === today; }).length >= PER_DAY) throw U.E('E_INBOX_LIMIT', { max: PER_DAY });
    var id = U.uid('MSG');
    Db.insert('Inbox', {
      msg_id: id, course_id: s.courseId, asg_id: asgId, from_std: s.stdId, about_std: about, kind: about ? 'member' : 'general',
      message: msg, created_at: now, status: 'new', handled_by: '', handled_at: ''
    });
    Audit.log(s.stdId + '@' + s.courseId, 'inbox.send', id, { asg: asgId, about: about });
    return { msgId: id, sent: true };
  }

  /** ข้อความที่ตัวเองส่ง (ล่าสุด 30) + สถานะ */
  function mine(s) {
    var titles = {};
    Db.findRows('Assignments', 'course_id', s.courseId).forEach(function (r) { titles[r.asg_id] = r.title; });
    var rows = Db.findRows('Inbox', 'from_std', s.stdId).filter(function (r) { return r.course_id === s.courseId; })
      .sort(function (x, y) { return x.created_at < y.created_at ? 1 : -1; }).slice(0, 30);
    return {
      messages: rows.map(function (r) {
        var o = out_(r), ab = r.about_std ? Students.find(s.courseId, r.about_std) : null;
        return { msgId: o.msgId, message: o.message, createdAt: o.createdAt, status: o.status, asgTitle: titles[o.asgId] || '', aboutName: ab ? ab.name : (o.aboutStd || '') };
      }),
      perDay: PER_DAY
    };
  }

  /** อาจารย์: ข้อความทั้งหมดของวิชา */
  function list(user, a) {
    var c = Courses.require(user, a.courseId), names = {}, titles = {};
    Students.roster(c.course_id).forEach(function (s) { names[s.std_id] = s.name; });
    Db.findRows('Assignments', 'course_id', c.course_id).forEach(function (r) { titles[r.asg_id] = r.title; });
    var counts = { new: 0, read: 0, done: 0, total: 0 };
    var msgs = Db.findRows('Inbox', 'course_id', c.course_id).sort(function (x, y) { return x.created_at < y.created_at ? 1 : -1; }).map(function (r) {
      var o = out_(r); counts.total++; counts[o.status] = (counts[o.status] || 0) + 1;
      o.fromName = names[o.fromStd] || o.fromStd; o.aboutName = o.aboutStd ? (names[o.aboutStd] || o.aboutStd) : ''; o.asgTitle = titles[o.asgId] || '';
      return o;
    });
    return { course: { courseId: c.course_id, code: c.code, name: c.name, section: c.section }, messages: msgs, counts: counts };
  }

  function pickIds_(ids) {
    if (!Array.isArray(ids) || !ids.length) throw U.E('E_BAD_REQUEST', null, 'ยังไม่ได้เลือกข้อความ');
    if (ids.length > 500) throw U.E('E_BAD_REQUEST', { max: 500 }, 'เลือกได้ครั้งละไม่เกิน 500 ข้อความ');
    var set = {}; ids.forEach(function (i) { set[String(i)] = true; });
    return set;
  }

  /** a = { courseId, msgIds[], status: new|read|done } */
  function mark(user, a) {
    var c = Courses.require(user, a.courseId), set = pickIds_(a.msgIds), st = String(a.status);
    if (STATUSES.indexOf(st) < 0) throw U.E('E_BAD_REQUEST', { why: 'status' });
    var patch = {}, n = 0, now = U.nowIso();
    Db.findRows('Inbox', 'course_id', c.course_id).forEach(function (r) {
      if (!set[r.msg_id] || (r.status || 'new') === st) return;
      patch[r._row] = { status: st, handled_by: st === 'new' ? '' : user.email, handled_at: st === 'new' ? '' : now }; n++;
    });
    if (n) Db.bulkPatch('Inbox', patch);
    return { changed: n };
  }

  function remove(user, a) {
    var c = Courses.require(user, a.courseId), set = pickIds_(a.msgIds);
    var n = Db.removeWhere('Inbox', function (o) { return o.course_id === c.course_id && set[o.msg_id] === true; });
    Audit.log(user.email, 'inbox.delete', c.course_id, { count: n });
    return { removed: n };
  }

  /** จำนวนข้อความใหม่ต่อวิชา (แสดงเป็นป้ายในหน้ารายวิชา) */
  function newCounts() {
    var m = {};
    Db.all('Inbox').forEach(function (r) { if ((r.status || 'new') === 'new') m[r.course_id] = (m[r.course_id] || 0) + 1; });
    return m;
  }
  /** ข้อความที่ผูกกับงานนี้ (ใช้แสดงตอนอาจารย์ตรวจ) */
  function forAsg(asgId, courseId) {
    return Db.findRows('Inbox', 'asg_id', asgId).filter(function (r) { return r.course_id === courseId; }).map(out_);
  }
  function dropAsg(asgId) { return Db.removeWhere('Inbox', function (o) { return o.asg_id === asgId; }); }
  /** ลบนักศึกษา → ข้อความที่เขาส่งหายไปด้วย */
  function dropStudents(courseId, stdIds) {
    var set = {}; stdIds.forEach(function (i) { set[i] = true; });
    return Db.removeWhere('Inbox', function (o) { return o.course_id === courseId && set[o.from_std] === true; });
  }

  return { send: send, mine: mine, list: list, mark: mark, remove: remove, newCounts: newCounts, forAsg: forAsg, dropAsg: dropAsg, dropStudents: dropStudents };
})();
