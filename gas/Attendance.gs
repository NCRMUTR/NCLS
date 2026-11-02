/**************************************************************
 * File: Attendance.gs  (HBT Core v0.3.0)
 * เช็คชื่อ (ย้ายตรรกะจากระบบเช็คชื่อ v6.3.1 มาอยู่บนชั้น Db กลาง)
 *
 * ที่เก็บ  : AttSessions (1 แถว = 1 คาบ) · AttRecords (ขาด = ไม่มีแถว) · AttDevices (1 เครื่อง : 1 คน ต่อคาบ)
 *            StudentDevices (เครื่องที่เคยยืนยัน PIN แล้ว) · AttApprovals (นักศึกษาขออนุมัติใช้เครื่องร่วม)
 * เวลา    : เก็บเป็น 'yyyy-MM-dd HH:mm:ss' เขตเวลา Asia/Bangkok ค่าเดียว (ค.ศ.) — แสดง พ.ศ. ที่หน้าจอเท่านั้น
 * สถานะ   : normal (1) · late (0.5) · leave ลา (1) · absent ขาด (ไม่มีแถว)
 * ที่ต่างจากระบบเดิม
 *   - ตัวตนอาจารย์มาจาก token (ไม่เชื่อ username ที่หน้าเว็บส่ง) · ไม่มีรหัสผ่านอาจารย์/แอดมินในโค้ด
 *   - เครื่องซ้ำ: นักศึกษา "ขออนุมัติ" → อาจารย์กดอนุมัติในหน้าสด (แทนรหัสผ่านอาจารย์)
 *   - ตรวจ PIN เมื่อเช็คชื่อด้วย "เครื่องใหม่" ของนักศึกษา · ตั้ง PIN ครั้งแรกได้ตอนเช็คชื่อ
 *   - เขียนทุกอย่างใน lock · กันซ้ำด้วยคีย์ (คาบ|รหัสนักศึกษา) · ไม่ deleteRow ทีละแถว
 *   - คาบที่พักอยู่ "ไม่ปิดเอง" และเวลาไม่เดินระหว่างพัก (ระบบเดิมปิดคาบที่พักได้เอง)
 **************************************************************/

var Attendance = (function () {

  var SCORE = { normal: 1, late: 0.5, leave: 1 };
  var STATUSES = ['normal', 'late', 'leave'];
  var APPROVE_WAIT_MIN = 2;        // คำขออนุมัติรอได้กี่นาที
  var APPROVE_VALID_MIN = 5;       // อนุมัติแล้วใช้ได้กี่นาที
  var MAX_TRUSTED = 3;             // เครื่องที่จำไว้ต่อนักศึกษา (ใหม่สุด 3 เครื่อง)
  var MAX_IMPORT = 1000;

  function r2_(n) { return Math.round(n * 100) / 100; }
  function ms_(v) { var d = U.toDate(v); return d ? d.getTime() : NaN; }
  function fmtMs_(ms) { return U.fmt(new Date(ms)); }
  function newSid_() { return 'S' + Date.now().toString(36).toUpperCase() + U.randomHex(3).toUpperCase(); }
  function rk_(sid, std) { return sid + '|' + std; }
  function validYmd_(s) { return Terms.validYmd(String(s || '')); }
  function validDevice_(d) {
    if (typeof d !== 'string' || !/^[A-Za-z0-9\-]{8,64}$/.test(d)) throw U.E('E_ATT_DEVICE');
    return d;
  }
  function normStd_(v) { try { return Students.cleanId(v); } catch (e) { throw U.E('E_NOT_FOUND'); } }

  /* ---------- สถานะเวลาของคาบ (คำนวณที่ server เท่านั้น) ---------- */
  function phase_(s, nowMs) {
    var start = ms_(s.start_at), normal = Number(s.normal_min), close = Number(s.close_min);
    if (isNaN(start) || isNaN(normal) || isNaN(close) || s.kind === 'manual') return { hasConfig: false, phase: 'normal', remainingSeconds: null };
    var off = Number(s.pause_offset_min) || 0;
    var ref = (s.status === 'paused' && s.paused_at && !isNaN(ms_(s.paused_at))) ? ms_(s.paused_at) : nowMs;   // พักอยู่ = เวลาหยุดเดิน
    var elapsed = (ref - start) / 60000;
    var normalAbs = normal + off, closeAbs = close + off, ph;
    if (elapsed <= normalAbs) ph = 'normal';          // รวมมาก่อนเวลาเริ่ม (elapsed < 0) = ปกติ
    else if (elapsed <= closeAbs) ph = 'late';
    else ph = 'closed';
    return {
      hasConfig: true, phase: ph, elapsedMin: r2_(elapsed), normalAbs: normalAbs, closeAbs: closeAbs,
      remainingSeconds: Math.max(0, Math.round((closeAbs - elapsed) * 60)),
      normalRemainingSeconds: Math.max(0, Math.round((normalAbs - elapsed) * 60))
    };
  }

  function sessionOut_(s, full) {
    var ph = phase_(s, Date.now());
    var o = {
      sessionId: s.session_id, courseId: s.course_id, date: s.date, kind: s.kind, status: s.status,
      openedAt: s.opened_at, closedAt: s.closed_at, hasLocation: s.lat !== '' && s.lng !== '',
      startAt: s.start_at, normalMin: s.normal_min === '' ? null : Number(s.normal_min), closeMin: s.close_min === '' ? null : Number(s.close_min),
      pauseOffsetMin: Number(s.pause_offset_min) || 0,
      phase: ph.phase, hasTimeConfig: ph.hasConfig, remainingSeconds: ph.remainingSeconds, normalRemainingSeconds: ph.normalRemainingSeconds === undefined ? null : ph.normalRemainingSeconds
    };
    if (full) { o.lat = s.lat === '' ? null : Number(s.lat); o.lng = s.lng === '' ? null : Number(s.lng); o.radiusM = s.radius_m === '' ? null : Number(s.radius_m); }
    return o;
  }

  function sessionsOf_(courseId) { return Db.findRows('AttSessions', 'course_id', courseId); }

  /** คาบ + ตรวจสิทธิ์ (เจ้าของวิชาหรือ admin) */
  function sessionFor_(user, sessionId) {
    var s = Db.byId('AttSessions', U.req(sessionId, 'sessionId'));
    if (!s) throw U.E('E_NOT_FOUND');
    Courses.require(user, s.course_id);
    return s;
  }

  function haversine_(lat1, lon1, lat2, lon2) {
    var R = 6371000, rad = function (d) { return d * Math.PI / 180; };
    var dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* ---------- คะแนนเช็คชื่อ → ประเภทคะแนนอัตโนมัติ ATT ---------- */
  function tally_(courseId) {
    var closed = sessionsOf_(courseId).filter(function (s) { return s.status === 'closed'; })
      .sort(function (a, b) { return (a.start_at || a.opened_at) < (b.start_at || b.opened_at) ? -1 : 1; });
    var ids = {}; closed.forEach(function (s) { ids[s.session_id] = true; });
    var lookup = {};
    Db.findRows('AttRecords', 'course_id', courseId).forEach(function (r) { if (ids[r.session_id]) lookup[rk_(r.session_id, r.std_id)] = r; });
    return { sessions: closed, lookup: lookup };
  }
  function statusIn_(lookup, sid, std) { var r = lookup[rk_(sid, std)]; return r ? r.status : 'absent'; }

  /** คำนวณคะแนนเช็คชื่อ (0–100 = % การเข้าเรียน) ของทุกคนในวิชา แล้วเขียนลงประเภท ATT (น้ำหนักอาจารย์ตั้งเองที่หน้าคะแนน) */
  function syncScores_(courseId) {
    var t = tally_(courseId);
    if (!t.sessions.length) {
      var ex = Db.findRows('ScoreTypes', 'course_id', courseId).filter(function (x) { return x.source === 'ATT'; })[0];
      if (!ex) return;      // ยังไม่เคยมีคาบที่ปิด และยังไม่มีประเภท → ไม่ต้องสร้าง
    }
    var type = Scores.ensureType(courseId, 'ATT', 'ATT', { name: 'เช็คชื่อ', max: 100 });
    var rows = Students.roster(courseId).map(function (st) {
      if (!t.sessions.length) return { stdId: st.std_id, score: '' };
      var raw = 0;
      t.sessions.forEach(function (s) { raw += SCORE[statusIn_(t.lookup, s.session_id, st.std_id)] || 0; });
      return { stdId: st.std_id, score: r2_(raw / t.sessions.length * 100) };
    });
    if (rows.length) Scores.setRecords(courseId, type.type_id, rows, 'attendance');
  }

  /* ---------- เปิด/พัก/ต่อ/ปิดคาบ ---------- */
  function closeRow_(s) {
    Db.update('AttSessions', s.session_id, { status: 'closed', closed_at: U.nowIso(), paused_at: '' });
    syncScores_(s.course_id);
  }

  /** ปิดคาบที่เลยเวลาแล้ว (lazy auto-close) ใน lock · คืนแถวล่าสุด */
  function lazyClose_(s) {
    if (s.status !== 'open' || phase_(s, Date.now()).phase !== 'closed') return s;
    return U.lock(function () {
      Db.flush();
      var cur = Db.byId('AttSessions', s.session_id);
      if (cur && cur.status === 'open' && phase_(cur, Date.now()).phase === 'closed') {
        closeRow_(cur);
        cur = Db.byId('AttSessions', s.session_id);
      }
      return cur || s;
    });
  }

  function num_(v) { var n = (typeof v === 'string' && v.trim() === '') ? NaN : Number(v); return n; }

  function open(user, a) {
    var c = Courses.require(user, a.courseId);
    sessionsOf_(c.course_id).forEach(function (s) {
      if (s.status === 'open') lazyClose_(s);
    });
    var live = sessionsOf_(c.course_id).filter(function (s) { return s.status === 'open' || s.status === 'paused'; });
    if (live.length) throw U.E('E_ATT_OPEN_EXISTS', { sessionId: live[0].session_id });

    var hasLat = !(a.lat === undefined || a.lat === null || a.lat === ''), hasLng = !(a.lng === undefined || a.lng === null || a.lng === '');
    var lat = '', lng = '', radius = '';
    if (hasLat !== hasLng) throw U.E('E_ATT_LOC');
    if (hasLat) {
      lat = num_(a.lat); lng = num_(a.lng);
      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) throw U.E('E_ATT_LOC');
      radius = (a.radiusM === undefined || a.radiusM === null || a.radiusM === '') ? Number(Settings.get('att_radius_m')) : num_(a.radiusM);
      if (isNaN(radius) || radius < 10 || radius > 5000 || Math.floor(radius) !== radius) throw U.E('E_ATT_LOC', { field: 'radius' }, 'รัศมีต้องเป็นจำนวนเต็ม 10–5,000 เมตร');
    }
    var normal = (a.normalMin === undefined || a.normalMin === null || a.normalMin === '') ? Number(Settings.get('att_normal_min')) : num_(a.normalMin);
    var close = (a.closeMin === undefined || a.closeMin === null || a.closeMin === '') ? Number(Settings.get('att_close_min')) : num_(a.closeMin);
    if (isNaN(normal) || isNaN(close) || normal < 0 || close <= normal || close > 600) throw U.E('E_ATT_TIME');

    var nowMs = Date.now(), startMs = nowMs;
    if (a.startAt !== undefined && a.startAt !== null && a.startAt !== '') {
      var m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})$/.exec(String(a.startAt).trim());
      if (!m || !validYmd_(m[1]) || Number(m[2]) > 23 || Number(m[3]) > 59) throw U.E('E_ATT_TIME', { field: 'startAt' });
      startMs = ms_(m[1] + ' ' + m[2] + ':' + m[3] + ':00');
      if (isNaN(startMs) || Math.abs(startMs - nowMs) > 12 * 3600000) throw U.E('E_ATT_TIME', { field: 'startAt' }, 'เวลาเริ่มต้องอยู่ภายใน 12 ชั่วโมงจากตอนนี้');
    }
    var startAt = fmtMs_(startMs), id = newSid_();
    Db.insert('AttSessions', {
      session_id: id, course_id: c.course_id, date: startAt.substring(0, 10), kind: 'live', status: 'open',
      opened_at: U.nowIso(), closed_at: '', lat: lat, lng: lng, radius_m: radius, start_at: startAt,
      normal_min: normal, close_min: close, paused_at: '', pause_offset_min: 0, created_by: user.email
    });
    Courses.touch(c.course_id);
    Audit.log(user.email, 'att.open', id, { course: c.course_id, loc: hasLat, normal: normal, close: close });
    return sessionOut_(Db.byId('AttSessions', id), true);
  }

  function pause(user, a) {
    var s = sessionFor_(user, a.sessionId);
    if (s.status !== 'open') throw U.E('E_ATT_STATE');
    Db.update('AttSessions', s.session_id, { status: 'paused', paused_at: U.nowIso() });
    Audit.log(user.email, 'att.pause', s.session_id, '');
    return sessionOut_(Db.byId('AttSessions', s.session_id), true);
  }

  function resume(user, a) {
    var s = sessionFor_(user, a.sessionId);
    if (s.status !== 'paused') throw U.E('E_ATT_STATE');
    var off = Number(s.pause_offset_min) || 0, pm = ms_(s.paused_at);
    if (!isNaN(pm)) off += Math.min(1440, Math.max(0, (Date.now() - pm) / 60000));     // เวลาที่พักไป = เลื่อนเส้นตายออกไป
    Db.update('AttSessions', s.session_id, { status: 'open', paused_at: '', pause_offset_min: r2_(off) });
    Audit.log(user.email, 'att.resume', s.session_id, { offset: r2_(off) });
    return sessionOut_(Db.byId('AttSessions', s.session_id), true);
  }

  function close(user, a) {
    var s = sessionFor_(user, a.sessionId);
    if (s.status === 'closed') return sessionOut_(s, true);          // ปิดซ้ำ = ไม่ทำอะไร
    closeRow_(s);
    Audit.log(user.email, 'att.close', s.session_id, '');
    return sessionOut_(Db.byId('AttSessions', s.session_id), true);
  }

  /** คาบที่เปิด/พักอยู่ของวิชา (ใช้เปิดหน้าสดต่อหลังรีเฟรช) */
  function current(user, a) {
    var c = Courses.require(user, a.courseId);
    var live = sessionsOf_(c.course_id).filter(function (s) { return s.status === 'open' || s.status === 'paused'; });
    if (!live.length) return { session: null };
    var s = lazyClose_(live[0]);
    return { session: s.status === 'closed' ? null : sessionOut_(s, true) };
  }

  /* ---------- หน้าสด ---------- */
  function live(user, a) {
    var s = lazyClose_(sessionFor_(user, a.sessionId));
    var roster = Students.roster(s.course_id);
    var recs = {};
    Db.findRows('AttRecords', 'session_id', s.session_id).forEach(function (r) { recs[r.std_id] = r; });
    var closed = s.status === 'closed';
    var latest = '';
    Object.keys(recs).forEach(function (k) { if (recs[k].at > latest) latest = recs[k].at; });
    var counts = { total: roster.length, normal: 0, late: 0, leave: 0, absent: 0, waiting: 0 };
    var students = roster.map(function (st) {
      var r = recs[st.std_id], status;
      if (r) status = r.status; else status = closed ? 'absent' : 'waiting';
      counts[status]++;
      return { stdId: st.std_id, name: st.name, status: status, at: r ? r.at : '', source: r ? r.source : '', note: r ? r.note : '', isNew: !!r && r.at === latest };
    });
    var names = {}; roster.forEach(function (st) { names[st.std_id] = st.name; });
    var now = Date.now(), approvals = [];
    if (!closed) {
      Db.findRows('AttApprovals', 'session_id', s.session_id).forEach(function (q) {
        if (q.status !== 'open') return;
        if (now - ms_(q.at) > APPROVE_WAIT_MIN * 60000) return;
        var dev = Db.byId('AttDevices', s.session_id + '|' + q.device_id);
        approvals.push({
          requestId: q.req_id, stdId: q.std_id, name: names[q.std_id] || q.std_id, at: q.at,
          usedByStdId: dev ? dev.std_id : '', usedByName: dev ? (names[dev.std_id] || dev.std_id) : '',
          secondsLeft: Math.max(0, Math.round((APPROVE_WAIT_MIN * 60000 - (now - ms_(q.at))) / 1000))
        });
      });
    }
    return { session: sessionOut_(s, true), students: students, counts: counts, approvals: approvals, serverTime: U.nowIso() };
  }

  /** อาจารย์อนุมัติ/ปฏิเสธการใช้เครื่องร่วมกัน */
  function decide(user, a) {
    var q = Db.byId('AttApprovals', U.req(a.requestId, 'requestId'));
    if (!q) throw U.E('E_NOT_FOUND');
    var s = Db.byId('AttSessions', q.session_id);
    if (!s) throw U.E('E_NOT_FOUND');
    Courses.require(user, s.course_id);
    if (q.status !== 'open' || Date.now() - ms_(q.at) > APPROVE_WAIT_MIN * 60000) throw U.E('E_ATT_REQ');
    var yes = U.bool(a.approve);
    Db.update('AttApprovals', q.req_id, { status: yes ? 'approved' : 'denied', decided_by: user.email, decided_at: U.nowIso() });
    Audit.log(user.email, yes ? 'att.approve' : 'att.deny', q.session_id, { std: q.std_id });
    return { requestId: q.req_id, status: yes ? 'approved' : 'denied' };
  }

  /* ---------- นักศึกษา (ไม่ล็อกอิน) ---------- */
  /** ข้อมูลคาบสำหรับหน้าสแกน (ไม่เปิดเผยพิกัดห้อง) */
  function info(a) {
    var s = Db.byId('AttSessions', String(a.sessionId || ''));
    if (!s || s.kind !== 'live') throw U.E('E_NOT_FOUND');
    var c = Db.byId('Courses', s.course_id);
    if (!c) throw U.E('E_NOT_FOUND');
    s = lazyClose_(s);
    var o = sessionOut_(s, false);
    return {
      sessionId: o.sessionId, status: o.status, phase: o.phase, hasLocation: o.hasLocation, remainingSeconds: o.remainingSeconds,
      course: { courseId: c.course_id, code: c.code, name: c.name, section: c.section }
    };
  }

  function nameOf_(courseId, std) { var r = Students.find(courseId, std); return r ? r.name : std; }

  function trustedDevices_(std) { return Db.findRows('StudentDevices', 'std_id', std); }

  /**
   * เช็คชื่อ  a = { sessionId, stdId, deviceId, lat?, lng?, pin?, newPin?, tempPin? }
   * ผ่าน = { status:'normal'|'late'|'leave', name, already, pinJustSet }
   * ไม่ผ่านโยน error: E_ATT_CLOSED · E_ATT_PAUSED · E_ATT_GPS_REQUIRED · E_ATT_OUT_OF_RANGE{distance,radius}
   *   E_ATT_DEVICE_CONFLICT{usedByName} · E_ATT_PIN_REQUIRED{mode:'enter'|'set'|'temp'} · E_PIN_BAD/LOCKED · E_NOT_FOUND
   */
  function checkIn(a) {
    var sid = String(a.sessionId || '');
    var s = Db.byId('AttSessions', sid);
    if (!s || s.kind !== 'live') throw U.E('E_NOT_FOUND');
    var std = normStd_(a.stdId);
    var dev = validDevice_(a.deviceId);

    s = lazyClose_(s);
    if (s.status === 'paused') throw U.E('E_ATT_PAUSED');
    if (s.status !== 'open') throw U.E('E_ATT_CLOSED');
    var student = Students.find(s.course_id, std);
    if (!student) throw U.E('E_NOT_FOUND');

    // พิกัด
    if (s.lat !== '' && s.lng !== '') {
      var la = num_(a.lat), ln = num_(a.lng);
      if (isNaN(la) || isNaN(ln) || la < -90 || la > 90 || ln < -180 || ln > 180) throw U.E('E_ATT_GPS_REQUIRED');
      var dist = Math.round(haversine_(Number(s.lat), Number(s.lng), la, ln)), radius = Number(s.radius_m) || 500;
      if (dist > radius) throw U.E('E_ATT_OUT_OF_RANGE', { distance: dist, radius: radius }, 'อยู่ห่างจากห้องเรียน ' + dist + ' ม. (ต้องไม่เกิน ' + radius + ' ม.)');
    }

    // เช็คแล้ว = สำเร็จ (กดซ้ำได้ ไม่เกิดแถวซ้ำ)
    var done = Db.byId('AttRecords', rk_(sid, std));
    if (done) return { status: done.status, name: student.name, already: true, pinJustSet: false };

    // เครื่องซ้ำ (ตรวจก่อน PIN: ไม่ให้เดา PIN ผ่านเครื่องที่ถูกใช้ไปแล้ว)
    var owner = Db.byId('AttDevices', sid + '|' + dev);
    var needOverride = !!owner && owner.std_id !== std;
    if (needOverride && !approvedFor_(sid, std, dev)) {
      throw U.E('E_ATT_DEVICE_CONFLICT', { usedByName: nameOf_(s.course_id, owner.std_id) }, 'เครื่องนี้ถูกใช้เช็คชื่อให้ ' + nameOf_(s.course_id, owner.std_id) + ' แล้ว');
    }

    // PIN: เครื่องใหม่ของนักศึกษาคนนี้ต้องยืนยัน PIN (ตั้ง PIN ครั้งแรกได้ที่นี่)
    var trusted = trustedDevices_(std).some(function (t) { return t.device_id === dev; });
    var pst = Pin.status(std), mode = '';
    if (pst === 'set') { if (!trusted) mode = 'enter'; }
    else mode = (pst === 'temp') ? 'temp' : 'set';
    if (mode === 'enter') {
      if (a.pin === undefined || a.pin === null || a.pin === '') throw U.E('E_ATT_PIN_REQUIRED', { mode: 'enter' });
      U.lock(function () { Db.flush(); Pin.verify(std, a.pin); }, 30000);   // นับครั้งที่ผิดใน lock (ยิงขนานก็นับครบ) · ผิด/ล็อก → โยน E_PIN_BAD / E_PIN_LOCKED
    } else if (mode === 'set') {
      if (a.newPin === undefined || a.newPin === null || a.newPin === '') throw U.E('E_ATT_PIN_REQUIRED', { mode: 'set' });
    } else if (mode === 'temp') {
      if (!a.tempPin || !a.newPin) throw U.E('E_ATT_PIN_REQUIRED', { mode: 'temp' });
    }

    // เขียน (ใน lock · อ่านข้อมูลสดอีกครั้ง)
    return U.lock(function () {
      Db.flush();
      var cur = Db.byId('AttSessions', sid);
      if (!cur) throw U.E('E_NOT_FOUND');
      if (cur.status === 'paused') throw U.E('E_ATT_PAUSED');
      if (cur.status !== 'open') throw U.E('E_ATT_CLOSED');
      if (phase_(cur, Date.now()).phase === 'closed') { closeRow_(cur); throw U.E('E_ATT_CLOSED'); }
      var again = Db.byId('AttRecords', rk_(sid, std));
      if (again) return { status: again.status, name: student.name, already: true, pinJustSet: false };
      var own = Db.byId('AttDevices', sid + '|' + dev), approval = null;
      if (own && own.std_id !== std) {
        approval = approvedFor_(sid, std, dev);
        if (!approval) throw U.E('E_ATT_DEVICE_CONFLICT', { usedByName: nameOf_(cur.course_id, own.std_id) });
      }
      var pinJustSet = false;
      if (mode === 'set') { Pin.setInitial(std, a.newPin); pinJustSet = true; }
      else if (mode === 'temp') { Pin.setWithTemp({ courseId: cur.course_id, stdId: std, tempPin: a.tempPin, newPin: a.newPin }); pinJustSet = true; }

      var ph = phase_(cur, Date.now()), status = (ph.hasConfig && ph.phase === 'late') ? 'late' : 'normal';
      var lat = (a.lat === undefined || a.lat === null || a.lat === '') ? '' : String(a.lat).substring(0, 20);
      var lng = (a.lng === undefined || a.lng === null || a.lng === '') ? '' : String(a.lng).substring(0, 20);
      var now = U.nowIso();
      Db.insert('AttRecords', {
        rec_key: rk_(sid, std), session_id: sid, course_id: cur.course_id, std_id: std, at: now, status: status,
        lat: lat, lng: lng, device_id: dev, note: approval ? 'ใช้เครื่องร่วม (อาจารย์อนุมัติ)' : '', source: 'SCAN'
      });
      if (!own) Db.insert('AttDevices', { dev_key: sid + '|' + dev, session_id: sid, course_id: cur.course_id, device_id: dev, std_id: std, at: now });
      if (approval) Db.update('AttApprovals', approval.req_id, { status: 'used' });
      rememberDevice_(std, dev, now);
      return { status: status, name: student.name, already: false, pinJustSet: pinJustSet };
    }, 30000);
  }

  function approvedFor_(sid, std, dev) {
    var now = Date.now(), hit = null;
    Db.findRows('AttApprovals', 'session_id', sid).forEach(function (q) {
      if (q.std_id === std && q.device_id === dev && q.status === 'approved' && now - ms_(q.decided_at) <= APPROVE_VALID_MIN * 60000) hit = q;
    });
    return hit;
  }

  function rememberDevice_(std, dev, now) {
    var key = std + '|' + dev, ex = Db.byId('StudentDevices', key);
    if (ex) { Db.update('StudentDevices', key, { last_at: now }); return; }
    var list = trustedDevices_(std).sort(function (x, y) { return x.last_at < y.last_at ? -1 : 1; });
    while (list.length >= MAX_TRUSTED) { Db.remove('StudentDevices', list.shift().dev_key); }
    Db.insert('StudentDevices', { dev_key: key, std_id: std, device_id: dev, first_at: now, last_at: now });
  }

  /** ลืมเครื่องที่เคยยืนยัน PIN (เรียกเมื่ออาจารย์รีเซ็ต PIN) */
  function forgetDevices(stdIds) {
    var set = {}; stdIds.forEach(function (i) { set[i] = true; });
    return Db.removeWhere('StudentDevices', function (o) { return set[o.std_id] === true; });
  }

  /** นักศึกษาที่ชนเครื่อง กดขออนุมัติจากอาจารย์ */
  function requestOverride(a) {
    var sid = String(a.sessionId || '');
    var s = Db.byId('AttSessions', sid);
    if (!s || s.kind !== 'live') throw U.E('E_NOT_FOUND');
    var std = normStd_(a.stdId), dev = validDevice_(a.deviceId);
    if (!Students.find(s.course_id, std)) throw U.E('E_NOT_FOUND');
    return U.lock(function () {
      Db.flush();
      s = Db.byId('AttSessions', sid);
      if (!s || s.status !== 'open') throw U.E(s && s.status === 'paused' ? 'E_ATT_PAUSED' : 'E_ATT_CLOSED');
      var own = Db.byId('AttDevices', sid + '|' + dev);
      if (!own || own.std_id === std) throw U.E('E_ATT_REQ');             // ไม่ได้ชนเครื่องจริง
      var now = Date.now(), found = null;
      Db.findRows('AttApprovals', 'session_id', sid).forEach(function (q) {
        if (q.std_id === std && q.device_id === dev && (q.status === 'open' || q.status === 'approved') && now - ms_(q.at) <= APPROVE_VALID_MIN * 60000) found = q;
      });
      if (found) return { requestId: found.req_id, status: found.status };
      var id = U.uid('APR');
      Db.insert('AttApprovals', { req_id: id, session_id: sid, course_id: s.course_id, std_id: std, device_id: dev, at: U.nowIso(), status: 'open', decided_by: '', decided_at: '' });
      return { requestId: id, status: 'open' };
    });
  }

  function approvalStatus(a) {
    var q = Db.byId('AttApprovals', String(a.requestId || ''));
    if (!q) throw U.E('E_NOT_FOUND');
    var st = q.status;
    if (st === 'open' && Date.now() - ms_(q.at) > APPROVE_WAIT_MIN * 60000) st = 'expired';
    if (st === 'approved' && Date.now() - ms_(q.decided_at) > APPROVE_VALID_MIN * 60000) st = 'expired';
    return { status: st };
  }

  /* ---------- ประวัติ / รายงาน ---------- */
  function sessionsList(user, a) {
    var c = Courses.require(user, a.courseId);
    var counts = {};
    Db.findRows('AttRecords', 'course_id', c.course_id).forEach(function (r) { counts[r.session_id] = (counts[r.session_id] || 0) + 1; });
    var list = sessionsOf_(c.course_id).map(function (s) {
      var o = sessionOut_(s, false); o.checkIns = counts[s.session_id] || 0; return o;
    }).sort(function (x, y) { return (y.startAt || y.openedAt) < (x.startAt || x.openedAt) ? -1 : 1; });
    return { sessions: list };
  }

  function report(user, a) {
    var c = Courses.require(user, a.courseId);
    var t = tally_(c.course_id), total = t.sessions.length;
    var students = Students.roster(c.course_id).map(function (st) {
      var cnt = { normal: 0, late: 0, leave: 0, absent: 0 }, raw = 0;
      var recs = t.sessions.map(function (s) {
        var x = statusIn_(t.lookup, s.session_id, st.std_id);
        cnt[x]++; raw += SCORE[x] || 0; return x;
      });
      return { stdId: st.std_id, name: st.name, records: recs, counts: cnt, percent: total ? r2_(raw / total * 100) : null };
    });
    var type = Db.findRows('ScoreTypes', 'course_id', c.course_id).filter(function (x) { return x.source === 'ATT'; })[0];
    return {
      course: { courseId: c.course_id, code: c.code, name: c.name, section: c.section },
      sessions: t.sessions.map(function (s) { return { sessionId: s.session_id, date: s.date, kind: s.kind }; }),
      students: students, totalSessions: total, weightPct: type ? Number(type.pct) : null
    };
  }

  function studentDetail(user, a) {
    var c = Courses.require(user, a.courseId);
    var std = normStd_(a.stdId);
    var st = Students.find(c.course_id, std);
    if (!st) throw U.E('E_NOT_FOUND');
    var all = sessionsOf_(c.course_id).sort(function (x, y) { return (x.start_at || x.opened_at) < (y.start_at || y.opened_at) ? -1 : 1; });
    var recs = {};
    Db.findRows('AttRecords', 'std_id', std).forEach(function (r) { if (r.course_id === c.course_id) recs[r.session_id] = r; });
    return {
      stdId: std, name: st.name,
      sessions: all.filter(function (s) { return s.status === 'closed' || s.status === 'open' || s.status === 'paused'; }).map(function (s) {
        var r = recs[s.session_id];
        return { sessionId: s.session_id, date: s.date, sessionStatus: s.status, status: r ? r.status : 'absent', note: r ? r.note : '', at: r ? r.at : '' };
      })
    };
  }

  function exportCsv(user, a) {
    var c = Courses.require(user, a.courseId);
    var rep = report(user, { courseId: c.course_id });
    var MAP = { normal: 'ปกติ', late: 'สาย', leave: 'ลา', absent: 'ขาด' };
    var head = ['รหัสนักศึกษา', 'ชื่อ-นามสกุล'].concat(rep.sessions.map(function (s) { return s.date; })).concat(['ปกติ', 'สาย', 'ลา', 'ขาด', 'เข้าเรียน (%)']);
    var rows = [head];
    rep.students.forEach(function (s) {
      rows.push([s.stdId, s.name].concat(s.records.map(function (x) { return MAP[x]; })).concat([s.counts.normal, s.counts.late, s.counts.leave, s.counts.absent, s.percent === null ? '' : s.percent]));
    });
    var safe = (c.code + '-' + c.section).replace(/[^A-Za-z0-9ก-๙._-]+/g, '_');
    Audit.log(user.email, 'att.exportCsv', c.course_id, { rows: rep.students.length });
    return { filename: safe + '-attendance.csv', csv: U.toCsv(rows) };
  }

  /* ---------- แก้ย้อนหลัง / นำเข้า / ลบ ---------- */
  function setStatus(user, a) {
    var s = sessionFor_(user, a.sessionId);
    var std = normStd_(a.stdId), status = String(a.status || '');
    if (status !== 'absent' && STATUSES.indexOf(status) < 0) throw U.E('E_ATT_STATUS');
    if (!Students.find(s.course_id, std)) throw U.E('E_NOT_FOUND');
    var key = rk_(s.session_id, std), ex = Db.byId('AttRecords', key);
    if (status === 'absent') {
      if (ex) Db.remove('AttRecords', key);
    } else if (ex) {
      Db.update('AttRecords', key, { status: status, note: status === 'leave' ? 'ลา' : (ex.note === 'ลา' ? '' : ex.note) });     // แก้เฉพาะสถานะ เก็บหลักฐานสแกนเดิม (เวลา/พิกัด/เครื่อง)
    } else {
      Db.insert('AttRecords', { rec_key: key, session_id: s.session_id, course_id: s.course_id, std_id: std, at: U.nowIso(), status: status, lat: '', lng: '', device_id: '', note: status === 'leave' ? 'ลา' : '', source: 'MANUAL' });
    }
    if (s.status === 'closed') syncScores_(s.course_id);
    Courses.touch(s.course_id);
    Audit.log(user.email, 'att.setStatus', s.session_id, { std: std, status: status });
    return { stdId: std, status: status };
  }

  /** นำเข้าการเข้าเรียนย้อนหลัง a = { courseId, date:'yyyy-MM-dd', rows:[{stdId, status|score}], dryRun? } → คาบ manual ที่ปิดแล้ว */
  function importRows(user, a) {
    var c = Courses.require(user, a.courseId);
    var date = String(a.date || '').trim();
    if (!validYmd_(date)) throw U.E('E_IMPORT', { field: 'date' }, 'วันที่ไม่ถูกต้อง');
    var rows = a.rows;
    if (!Array.isArray(rows) || !rows.length) throw U.E('E_IMPORT', null, 'ไม่พบข้อมูลที่จะนำเข้า');
    if (rows.length > MAX_IMPORT) throw U.E('E_IMPORT', { max: MAX_IMPORT }, 'นำเข้าได้ครั้งละไม่เกิน ' + MAX_IMPORT + ' รายการ');
    var roster = {}; Students.roster(c.course_id).forEach(function (s) { roster[s.std_id] = s; });
    var seen = {}, good = [], skipped = [];
    rows.forEach(function (r, i) {
      var no = i + 1, id = '', st;
      try { id = Students.cleanId(r && r.stdId); } catch (e) { skipped.push({ row: no, stdId: String(r && r.stdId || '').substring(0, 30), why: 'รหัสนักศึกษาไม่ถูกต้อง' }); return; }
      if (!roster[id]) { skipped.push({ row: no, stdId: id, why: 'ไม่อยู่ในรายชื่อวิชานี้' }); return; }
      if (seen[id]) { skipped.push({ row: no, stdId: id, why: 'รหัสซ้ำ (ใช้แถวแรก)' }); return; }
      seen[id] = true;
      var raw = (r.status !== undefined && r.status !== '') ? r.status : r.score;
      if (raw === 'absent' || raw === 'ขาด' || String(raw).trim() === '0') st = 'absent';
      else if (raw === 'normal' || raw === 'ปกติ' || String(raw).trim() === '1') st = 'normal';
      else if (raw === 'late' || raw === 'สาย' || String(raw).trim() === '0.5') st = 'late';
      else if (raw === 'leave' || raw === 'ลา') st = 'leave';
      else { skipped.push({ row: no, stdId: id, why: 'สถานะ/คะแนนไม่ถูกต้อง (ใช้ 1 = ปกติ, 0.5 = สาย, 0 = ขาด, ลา)' }); return; }
      good.push({ stdId: id, status: st });
    });
    var plan = {
      date: date, imported: good.length, normal: 0, late: 0, leave: 0, absent: 0,
      skipped: skipped.slice(0, 200), skippedCount: skipped.length, dryRun: U.bool(a.dryRun)
    };
    good.forEach(function (g) { plan[g.status]++; });
    if (!good.length) throw U.E('E_IMPORT', null, 'ไม่มีแถวที่ใช้ได้เลย');
    if (plan.dryRun) return plan;
    var sid = newSid_(), now = U.nowIso();
    Db.insert('AttSessions', {
      session_id: sid, course_id: c.course_id, date: date, kind: 'manual', status: 'closed', opened_at: now, closed_at: now,
      lat: '', lng: '', radius_m: '', start_at: '', normal_min: '', close_min: '', paused_at: '', pause_offset_min: 0, created_by: user.email
    });
    Db.insertMany('AttRecords', good.filter(function (g) { return g.status !== 'absent'; }).map(function (g) {
      return { rec_key: rk_(sid, g.stdId), session_id: sid, course_id: c.course_id, std_id: g.stdId, at: now, status: g.status, lat: '', lng: '', device_id: '', note: g.status === 'leave' ? 'ลา' : '', source: 'IMPORT' };
    }));
    syncScores_(c.course_id);
    Courses.touch(c.course_id);
    Audit.log(user.email, 'att.import', sid, { date: date, imported: plan.imported, skipped: plan.skippedCount });
    plan.sessionId = sid;
    return plan;
  }

  function removeSession_(s) {
    var n = Db.removeWhere('AttRecords', function (o) { return o.session_id === s.session_id; });
    Db.removeWhere('AttDevices', function (o) { return o.session_id === s.session_id; });
    Db.removeWhere('AttApprovals', function (o) { return o.session_id === s.session_id; });
    Db.remove('AttSessions', s.session_id);
    return n;
  }

  function deleteSession(user, a) {
    var s = sessionFor_(user, a.sessionId);
    if (s.status === 'open' || s.status === 'paused') throw U.E('E_ATT_STILL_OPEN');
    var n = removeSession_(s);
    syncScores_(s.course_id);
    Courses.touch(s.course_id);
    Audit.log(user.email, 'att.deleteSession', s.session_id, { records: n });
    return { deletedRecords: n };
  }

  function deleteEmpty(user, a) {
    var c = Courses.require(user, a.courseId);
    var counts = {};
    Db.findRows('AttRecords', 'course_id', c.course_id).forEach(function (r) { counts[r.session_id] = true; });
    var targets = sessionsOf_(c.course_id).filter(function (s) { return s.status === 'closed' && !counts[s.session_id]; });
    targets.forEach(removeSession_);
    if (targets.length) { syncScores_(c.course_id); Courses.touch(c.course_id); }
    Audit.log(user.email, 'att.deleteEmpty', c.course_id, { deleted: targets.length });
    return { deleted: targets.length };
  }

  /* ---------- ผูกกับการลบนักศึกษา (STUDENT_CASCADE) ---------- */
  function countForStudent(courseId, stdId) {
    return Db.findRows('AttRecords', 'std_id', stdId).filter(function (r) { return r.course_id === courseId; }).length;
  }
  function removeForStudents(courseId, stdIds) {
    var set = {}; stdIds.forEach(function (i) { set[i] = true; });
    Db.removeWhere('AttDevices', function (o) { return o.course_id === courseId && set[o.std_id] === true; });
    Db.removeWhere('AttApprovals', function (o) { return o.course_id === courseId && set[o.std_id] === true; });
    return Db.removeWhere('AttRecords', function (o) { return o.course_id === courseId && set[o.std_id] === true; });
  }

  return {
    open: open, pause: pause, resume: resume, close: close, current: current, live: live, decide: decide,
    info: info, checkIn: checkIn, requestOverride: requestOverride, approvalStatus: approvalStatus,
    sessionsList: sessionsList, report: report, studentDetail: studentDetail, exportCsv: exportCsv,
    setStatus: setStatus, importRows: importRows, deleteSession: deleteSession, deleteEmpty: deleteEmpty,
    forgetDevices: forgetDevices, countForStudent: countForStudent, removeForStudents: removeForStudents,
    syncScores: syncScores_, phase: phase_
  };
})();
