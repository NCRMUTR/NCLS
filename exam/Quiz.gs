/**************************************************************
 * File: Quiz.gs  (HBT Exam API v0.5.0)
 * คลังข้อสอบ แบ่งเป็น "แบบทดสอบ" (หนึ่งวิชามีได้หลายชุด) + แคชชุดข้อสอบต่อแบบทดสอบ
 * (ยกจาก EEOS v2.1.0 — ตรรกะเดิม เปลี่ยนที่เก็บ/สิทธิ์เป็นของ HBT)
 *
 * ตัวเลือกลำดับที่ 1 (c_idx = 1) คือคำตอบที่ถูกเสมอ · ระบบสลับลำดับให้นักศึกษาตอนแสดงผล
 * (หน้าเว็บให้ติ๊กข้อที่ถูก แล้ว server ย้ายขึ้นเป็นลำดับ 1 ให้ — ดู normalizeChoices)
 **************************************************************/

var Img = {
  folder: function () {
    var id = Config.get('IMG_FOLDER_ID');
    if (id) { try { return DriveApp.getFolderById(id); } catch (e) {} }
    var it = DriveApp.getFoldersByName(APP.IMG_FOLDER);
    var f = it.hasNext() ? it.next() : DriveApp.createFolder(APP.IMG_FOLDER);
    Config.set('IMG_FOLDER_ID', f.getId());
    return f;
  },

  /** ตรวจชนิดรูปจาก "ไบต์หัวไฟล์" (ไม่เชื่อนามสกุล/ชนิดที่หน้าเว็บบอก) → { mime, ext } หรือ null */
  sniff: function (b) {
    function u(i) { return (b[i] === undefined ? 0 : b[i]) & 255; }
    if (u(0) === 0xFF && u(1) === 0xD8 && u(2) === 0xFF) return { mime: 'image/jpeg', ext: 'jpg' };
    if (u(0) === 0x89 && u(1) === 0x50 && u(2) === 0x4E && u(3) === 0x47) return { mime: 'image/png', ext: 'png' };
    if (u(0) === 0x47 && u(1) === 0x49 && u(2) === 0x46 && u(3) === 0x38) return { mime: 'image/gif', ext: 'gif' };
    if (u(0) === 0x52 && u(1) === 0x49 && u(2) === 0x46 && u(3) === 0x46 && u(8) === 0x57 && u(9) === 0x45 && u(10) === 0x42 && u(11) === 0x50) return { mime: 'image/webp', ext: 'webp' };
    return null;
  },

  /** รับ { base64, name } → ตรวจแล้วขึ้น Drive (แชร์แบบมีลิงก์ดูได้ เพราะนักศึกษาไม่มีบัญชี) → คืน fileId */
  save: function (img) {
    var b64 = String(img && img.base64 || '').replace(/^data:[^;]+;base64,/, '').replace(/\s+/g, '');
    if (!b64 || b64.length > Math.ceil(APP.IMG_MAX_BYTES * 1.4) + 8 || !/^[A-Za-z0-9+\/]+={0,2}$/.test(b64)) throw U.E('E_IMG');
    var bytes;
    try { bytes = Utilities.base64Decode(b64); } catch (e) { throw U.E('E_IMG'); }
    if (!bytes.length || bytes.length > APP.IMG_MAX_BYTES) throw U.E('E_IMG');
    var kind = Img.sniff(bytes);
    if (!kind) throw U.E('E_IMG');
    var name = String(img.name || 'img').replace(/[^A-Za-z0-9._\-]+/g, '_').substring(0, 60).replace(/\.[A-Za-z0-9]+$/, '') + '.' + kind.ext;
    try {
      var file = Img.folder().createFile(Utilities.newBlob(bytes, kind.mime, name));
      try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
      return file.getId();
    } catch (e) {
      throw U.E('E_DRIVE');
    }
  },

  url: function (id) { return id ? ('https://drive.google.com/thumbnail?id=' + id + '&sz=w1600') : ''; },

  remove: function (id) {
    if (!id) return;
    try { DriveApp.getFileById(id).setTrashed(true); } catch (e) {}
  },

  /** ลบถาวร (ข้ามถังขยะ) ด้วย Drive advanced service · ใช้ไม่ได้/ล้มเหลว = ทิ้งลงถังขยะ · คืน 'deleted' | 'trashed' */
  purge: function (id) {
    if (!id) return 'deleted';
    try { Drive.Files.remove(id); return 'deleted'; }
    catch (e) {
      if (/not found|File not found|No item/i.test(String(e && e.message || e))) return 'deleted';      // ไม่มีแล้ว = ถือว่าลบแล้ว
      try { DriveApp.getFileById(id).setTrashed(true); return 'trashed'; } catch (e2) { return 'deleted'; }
    }
  }
};

/** ชุดข้อสอบของ "แบบทดสอบ" หนึ่งชุด พร้อมแคช (หน้าสอบเรียกทุกข้อ ถ้าไม่แคชจะต้องอ่านทั้งตารางซ้ำ ๆ) */
var Paper = {

  key: function (quizId) { return 'PAPER_' + quizId; },

  build: function (quizId) {
    var quiz = Db.byId('Quizzes', quizId);
    if (!quiz) return [];
    var qs = Db.findRows('Questions', 'quiz_id', quizId).filter(function (q) { return q.status !== 'DELETED'; })
      .sort(function (a, b) { return U.num(a.q_no) - U.num(b.q_no); });
    var ids = {};
    qs.forEach(function (q) { ids[q.question_id] = true; });
    var byQ = {};
    Db.findRows('Choices', 'course_id', quiz.course_id).forEach(function (c) {
      if (ids[c.question_id]) (byQ[c.question_id] = byQ[c.question_id] || []).push(c);
    });
    return qs.map(function (q) {
      var list = (byQ[q.question_id] || []).sort(function (a, b) { return U.num(a.c_idx) - U.num(b.c_idx); });
      return {
        question_id: q.question_id, q_no: U.num(q.q_no), q_type: q.q_type,
        q_text: q.q_text, q_image_url: Img.url(q.q_image_id),
        score: U.num(q.score, 1),
        explain_text: q.explain_text, explain_image_url: Img.url(q.explain_image_id),
        choices: list.map(function (c) {
          return { c_idx: U.num(c.c_idx), c_type: c.c_type, c_text: c.c_text, c_image_url: Img.url(c.c_image_id) };
        })
      };
    });
  },

  get: function (quizId) {
    if (!quizId) return [];
    var hit = U.cGet(Paper.key(quizId));
    if (hit) {
      var parsed = U.parse(hit, null);
      if (parsed) return parsed;
    }
    var built = Paper.build(quizId);
    U.cPut(Paper.key(quizId), U.json(built), 21600);
    return built;
  },

  map: function (quizId) {
    var m = {};
    Paper.get(quizId).forEach(function (q) { m[q.question_id] = q; });
    return m;
  },

  invalidate: function (quizId) { if (quizId) U.cDel(Paper.key(quizId)); },

  nextNo: function (quizId) {
    var max = 0;
    Db.findRows('Questions', 'quiz_id', quizId).forEach(function (q) {
      if (q.status !== 'DELETED') max = Math.max(max, U.num(q.q_no));
    });
    return max + 1;
  }
};

var Quiz = {

  live: function (courseId) {
    return Db.findRows('Quizzes', 'course_id', courseId).filter(function (z) { return z.status !== 'DELETED'; });
  },

  recount: function (quizId) {
    var n = Db.findRows('Questions', 'quiz_id', quizId).filter(function (q) { return q.status !== 'DELETED'; }).length;
    if (Db.byId('Quizzes', quizId)) Db.update('Quizzes', quizId, { question_count: n, updated_at: U.nowIso() });
    return n;
  },

  toClient: function (z) {
    return {
      quizId: z.quiz_id, courseId: z.course_id, title: z.title, note: z.note,
      questionCount: U.num(z.question_count), createdAt: z.created_at, updatedAt: z.updated_at
    };
  },

  list: function (actor, a) {
    var c = Gate.course(actor, a.courseId);
    var usedBy = {};
    Db.findRows('Rounds', 'course_id', a.courseId).forEach(function (s) {
      if (s.status !== 'DELETED') usedBy[s.quiz_id] = (usedBy[s.quiz_id] || 0) + 1;
    });
    return {
      course: c.course,
      quizzes: Quiz.live(a.courseId).sort(function (x, y) { return x.created_at < y.created_at ? -1 : 1; })
        .map(function (z) { var o = Quiz.toClient(z); o.rounds = usedBy[z.quiz_id] || 0; return o; })
    };
  },

  /** สร้าง/แก้ชื่อแบบทดสอบ (quizId ว่าง = สร้างใหม่) */
  save: function (actor, a) {
    Gate.course(actor, a.courseId);
    var title = String(a.title || '').replace(/\s+/g, ' ').trim();
    if (!title) throw U.E('E_QUIZ_TITLE');
    title = U.clip(title, 200);
    var dup = Quiz.live(a.courseId).filter(function (z) {
      return z.quiz_id !== a.quizId && z.title.trim().toLowerCase() === title.toLowerCase();
    });
    if (dup.length) throw U.E('E_DUP_QUIZ');
    if (a.quizId) {
      var z = Gate.quiz(actor, a.quizId);
      if (z.course_id !== a.courseId) throw U.E('E_QUIZ_REQUIRED');
      Db.update('Quizzes', z.quiz_id, { title: title, note: U.clip(a.note || '', 500), updated_at: U.nowIso() });
      Audit.log(actor.email, 'quiz.update', z.quiz_id, title);
      return Quiz.toClient(Db.byId('Quizzes', z.quiz_id));
    }
    var rec = {
      quiz_id: U.uid('QZ'), course_id: a.courseId, title: title, note: U.clip(a.note || '', 500), status: 'ACTIVE',
      created_at: U.nowIso(), updated_at: U.nowIso(), question_count: 0
    };
    Db.insert('Quizzes', rec);
    Audit.log(actor.email, 'quiz.create', rec.quiz_id, title);
    return Quiz.toClient(rec);
  },

  /** ลบแบบทดสอบทั้งชุดพร้อมข้อสอบ — ปฏิเสธถ้ามีรอบที่ยังไม่ถูกลบใช้อยู่ */
  remove: function (actor, a) {
    var z = Gate.quiz(actor, a.quizId);
    var used = Db.findRows('Rounds', 'quiz_id', z.quiz_id).filter(function (s) { return s.status !== 'DELETED'; });
    if (used.length) throw U.E('E_QUIZ_IN_USE', { count: used.length });
    var n = Questions.deleteMany(z.quiz_id, null);
    Db.update('Quizzes', z.quiz_id, { status: 'DELETED', question_count: 0, updated_at: U.nowIso() });
    Paper.invalidate(z.quiz_id);
    Audit.log(actor.email, 'quiz.delete', z.quiz_id, { questions: n });
    return { removed: n };
  }
};

var Questions = {

  /**
   * ลบข้อสอบหลายข้อ (ids = อาร์เรย์ question_id) หรือทั้งชุด (ids = null) · เรียงเลขข้อ 1..n ใหม่
   * รูปที่ผูกไว้ย้ายไปถังขยะ Drive หลังเขียนชีตแล้ว · ต้องเรียกภายใน lock
   */
  deleteMany: function (quizId, ids) {
    Db.flush();
    var pick = null;
    if (ids) { pick = {}; ids.forEach(function (i) { pick[i] = true; }); }
    var live = Db.findRows('Questions', 'quiz_id', quizId).filter(function (q) { return q.status !== 'DELETED'; });
    var gone = live.filter(function (q) { return !pick || pick[q.question_id]; });
    if (!gone.length) return 0;

    var goneIds = {};
    gone.forEach(function (q) { goneIds[q.question_id] = true; });
    var now = U.nowIso(), patch = {};
    gone.forEach(function (q) { patch[q._row] = { status: 'DELETED', updated_at: now }; });
    live.filter(function (q) { return !goneIds[q.question_id]; })
      .sort(function (a, b) { return U.num(a.q_no) - U.num(b.q_no); })
      .forEach(function (q, i) { if (U.num(q.q_no) !== i + 1) patch[q._row] = { q_no: i + 1 }; });
    Db.bulkPatch('Questions', patch);

    var imgs = [];
    gone.forEach(function (q) { if (q.q_image_id) imgs.push(q.q_image_id); if (q.explain_image_id) imgs.push(q.explain_image_id); });
    var z = Db.byId('Quizzes', quizId);
    if (z) {
      Db.findRows('Choices', 'course_id', z.course_id).forEach(function (c) {
        if (goneIds[c.question_id] && c.c_image_id) imgs.push(c.c_image_id);
      });
    }
    var t0 = Date.now();
    for (var i = 0; i < imgs.length; i++) {
      if (Date.now() - t0 > 150000) break;
      Img.remove(imgs[i]);
    }
    Db.flush();
    Quiz.recount(quizId);
    Paper.invalidate(quizId);
    return gone.length;
  },

  list: function (actor, a) {
    var z = Gate.quiz(actor, a.quizId);
    return { quiz: Quiz.toClient(z), questions: Paper.get(z.quiz_id) };
  },

  /** รับ choices + correct (ดัชนี 0..n-1 ของข้อที่ถูก; ไม่ระบุ = ข้อแรก) → เรียงให้ข้อที่ถูกอยู่ลำดับ 1 */
  normalizeChoices: function (choices, correct) {
    var list = (choices || []).slice();
    if (list.length < 2) throw U.E('E_CHOICES_MIN');
    var k = U.num(correct, 0);
    if (k < 0 || k >= list.length || Math.floor(k) !== k) throw U.E('E_BAD_REQUEST', { why: 'correct' });
    var right = list.splice(k, 1)[0];
    list.unshift(right);
    return list;
  },

  /** บันทึกข้อสอบ 1 ข้อ (questionId ว่าง = ข้อใหม่) · รูปขึ้น Drive ก่อนเข้า lock แล้วเขียนแถวใน lock · ล้มเหลวทิ้งรูปใหม่ลงถังขยะ */
  save: function (actor, a) {
    var quiz = Gate.quiz(actor, a.quizId);
    var qType = a.q_type === 'image' ? 'image' : 'text';
    var choices = Questions.normalizeChoices(Array.isArray(a.choices) ? a.choices : [], a.correct);
    if (choices.length < 2) throw U.E('E_CHOICES_MIN');
    if (choices.length > 5) throw U.E('E_CHOICES_MAX');
    var hasQImg = !!(a.q_image || a.q_image_id);
    if (qType === 'text' && !String(a.q_text || '').trim() && !hasQImg) throw U.E('E_EMPTY_Q');
    if (qType === 'image' && !hasQImg) throw U.E('E_EMPTY_Q');
    choices.forEach(function (c, i) {
      var t = c && c.c_type === 'image' ? 'image' : 'text';
      if (t === 'text' && !String(c && c.c_text || '').trim()) throw U.E('E_EMPTY_CHOICE', { index: i + 1 });
      if (t === 'image' && !(c && (c.c_image || c.c_image_id))) throw U.E('E_EMPTY_CHOICE', { index: i + 1 });
    });
    var score = U.num(a.score, 1);
    if (!(score > 0) || score > 1000) throw U.E('E_BAD_REQUEST', { why: 'score' });

    // ข้อเดิม: อ่านรูปที่ใช้อยู่ เพื่อรับเฉพาะ id รูปที่เป็นของข้อนี้จริง (กันหน้าเว็บส่ง id ไฟล์อื่นมาให้เราไปลบ/ผูก)
    var old = null, ownImg = {};
    if (a.questionId) {
      old = Db.byId('Questions', String(a.questionId));
      if (!old || old.status === 'DELETED' || old.quiz_id !== quiz.quiz_id) throw U.E('E_NOT_FOUND');
      if (old.q_image_id) ownImg[old.q_image_id] = true;
      if (old.explain_image_id) ownImg[old.explain_image_id] = true;
      Db.findRows('Choices', 'question_id', old.question_id).forEach(function (c) { if (c.c_image_id) ownImg[c.c_image_id] = true; });
    }
    function keep(id) { return (id && ownImg[id]) ? id : ''; }

    var fresh = [];                 // รูปที่เพิ่งอัปโหลดรอบนี้ (ไว้ทิ้งถ้าล้มเหลว)
    function up(img) { var id = Img.save(img); fresh.push(id); return id; }
    var qImage, eImage, cImages;
    try {
      qImage = a.q_image ? up(a.q_image) : keep(a.q_image_id);
      eImage = a.explain_image ? up(a.explain_image) : keep(a.explain_image_id);
      cImages = choices.map(function (c) {
        if (c.c_type !== 'image') return '';
        return c.c_image ? up(c.c_image) : keep(c.c_image_id);
      });
      choices.forEach(function (c, i) { if (c.c_type === 'image' && !cImages[i]) throw U.E('E_EMPTY_CHOICE', { index: i + 1 }); });
      if (qType === 'image' && !qImage) throw U.E('E_EMPTY_Q');

      return U.lock(function () {
        Db.flush();
        var isNew = !old, qid = old ? old.question_id : U.uid('QST'), now = U.nowIso();
        var rec = {
          question_id: qid, course_id: quiz.course_id, quiz_id: quiz.quiz_id,
          q_no: 0, q_type: qType, q_text: U.clip(a.q_text || ''), q_image_id: qImage,
          score: score, explain_text: U.clip(a.explain_text || ''), explain_image_id: eImage,
          status: 'ACTIVE', created_at: now, updated_at: now
        };
        var newChoices = choices.map(function (c, i) {
          var isImg = c.c_type === 'image';
          return {
            choice_id: U.uid('CHC'), question_id: qid, course_id: quiz.course_id, c_idx: i + 1,
            c_type: isImg ? 'image' : 'text', c_text: isImg ? U.clip(c.c_text || '') : U.clip(c.c_text),
            c_image_id: isImg ? cImages[i] : '', is_correct: U.bstr(i === 0)
          };
        });
        var orphan = [];
        if (isNew) {
          rec.q_no = Paper.nextNo(quiz.quiz_id);
          Db.insert('Questions', rec);
        } else {
          var cur = Db.byId('Questions', qid);
          if (!cur || cur.status === 'DELETED') throw U.E('E_NOT_FOUND');
          rec.q_no = U.num(cur.q_no);
          rec.created_at = cur.created_at;
          // รูปเดิมที่ไม่ได้ใช้ต่อ → ถังขยะ (หลังเขียนแถวสำเร็จ)
          var used = {};
          [rec.q_image_id, rec.explain_image_id].concat(cImages).forEach(function (id) { if (id) used[id] = true; });
          Object.keys(ownImg).forEach(function (id) { if (!used[id]) orphan.push(id); });
          Db.update('Questions', qid, rec);
          Db.removeWhere('Choices', function (c) { return c.question_id === qid; });
        }
        Db.insertMany('Choices', newChoices);
        Db.flush();
        Quiz.recount(quiz.quiz_id);
        Paper.invalidate(quiz.quiz_id);
        orphan.forEach(Img.remove);
        Audit.log(actor.email, isNew ? 'question.create' : 'question.update', qid, quiz.quiz_id);
        return { questionId: qid, qNo: rec.q_no };
      }, 60000);
    } catch (e) {
      fresh.forEach(Img.remove);
      throw e;
    }
  },

  remove: function (actor, a) {
    var q = a.questionId ? Db.byId('Questions', String(a.questionId)) : null;
    if (!q || q.status === 'DELETED') throw U.E('E_NOT_FOUND');
    Gate.quiz(actor, q.quiz_id);
    var n = Questions.deleteMany(q.quiz_id, [q.question_id]);
    Audit.log(actor.email, 'question.delete', q.question_id, '');
    return { removed: n };
  },

  /** ids = อาร์เรย์ question_id ที่เลือก หรือ 'ALL' = ทุกข้อในแบบทดสอบนี้ */
  removeMany: function (actor, a) {
    var z = Gate.quiz(actor, a.quizId);
    var all = (a.ids === 'ALL');
    if (!all && (!Array.isArray(a.ids) || !a.ids.length)) throw U.E('E_NOTHING_SELECTED');
    var n = Questions.deleteMany(z.quiz_id, all ? null : a.ids.map(String));
    Audit.log(actor.email, all ? 'question.deleteAll' : 'question.deleteMany', z.quiz_id, { n: n });
    return { removed: n };
  },

  move: function (actor, a) {
    var q = a.questionId ? Db.byId('Questions', String(a.questionId)) : null;
    if (!q || q.status === 'DELETED') throw U.E('E_NOT_FOUND');
    Gate.quiz(actor, q.quiz_id);
    var list = Db.findRows('Questions', 'quiz_id', q.quiz_id).filter(function (x) { return x.status !== 'DELETED'; })
      .sort(function (x, y) { return U.num(x.q_no) - U.num(y.q_no); });
    var i = -1;
    list.forEach(function (x, k) { if (x.question_id === q.question_id) i = k; });
    var j = a.dir === 'up' ? i - 1 : i + 1;
    if (i < 0 || j < 0 || j >= list.length) return { moved: false };
    var x = list[i], y = list[j], patch = {};
    patch[x._row] = { q_no: U.num(y.q_no) };
    patch[y._row] = { q_no: U.num(x.q_no) };
    Db.bulkPatch('Questions', patch);
    Paper.invalidate(q.quiz_id);
    return { moved: true };
  },

  renumber: function (actor, a) {
    var z = Gate.quiz(actor, a.quizId);
    var list = Db.findRows('Questions', 'quiz_id', z.quiz_id).filter(function (x) { return x.status !== 'DELETED'; })
      .sort(function (x, y) { return U.num(x.q_no) - U.num(y.q_no); });
    var patch = {};
    list.forEach(function (q, i) { if (U.num(q.q_no) !== i + 1) patch[q._row] = { q_no: i + 1 }; });
    Db.bulkPatch('Questions', patch);
    Db.flush();
    Paper.invalidate(z.quiz_id);
    return { count: list.length };
  },

  /**
   * นำเข้า CSV เข้าแบบทดสอบ: A = คำถาม · B = ตัวเลือกที่ 1 (คำตอบที่ถูก) · C–F = ตัวเลือกที่ 2–5 · G = คะแนน (ว่าง = 1) · H = คำอธิบาย
   */
  importCsv: function (actor, a) {
    var quiz = Gate.quiz(actor, a.quizId);
    if (typeof a.csv !== 'string') throw U.E('E_CSV_EMPTY');
    var rows = U.parseCsv(a.csv);
    if (!rows.length) throw U.E('E_CSV_EMPTY');
    if (U.bool(a.skipFirstRow)) rows = rows.slice(1);
    if (rows.length > 1000) throw U.E('E_BAD_REQUEST', { why: 'too_many', max: 1000 });
    var no = Paper.nextNo(quiz.quiz_id);
    var qRows = [], cRows = [], skipped = [], now = U.nowIso();
    rows.forEach(function (r, i) {
      var cell = function (k) { return String(r[k] === undefined ? '' : r[k]).trim(); };
      var qText = cell(0);
      if (!qText) return;
      var opts = [];
      for (var k = 1; k <= 5; k++) { var v = cell(k); if (v) opts.push(v); }
      if (opts.length < 2) { skipped.push('แถว ' + (i + 1) + ': ตัวเลือกน้อยกว่า 2'); return; }
      var sc = U.num(cell(6), 1);
      if (!(sc > 0) || sc > 1000) sc = 1;
      var qid = U.uid('QST');
      qRows.push({
        question_id: qid, course_id: quiz.course_id, quiz_id: quiz.quiz_id, q_no: no++,
        q_type: 'text', q_text: U.clip(qText), q_image_id: '', score: sc, explain_text: U.clip(cell(7)),
        explain_image_id: '', status: 'ACTIVE', created_at: now, updated_at: now
      });
      opts.forEach(function (o, oi) {
        cRows.push({
          choice_id: U.uid('CHC'), question_id: qid, course_id: quiz.course_id, c_idx: oi + 1,
          c_type: 'text', c_text: U.clip(o), c_image_id: '', is_correct: U.bstr(oi === 0)
        });
      });
    });
    Db.insertMany('Questions', qRows);
    Db.insertMany('Choices', cRows);
    Db.flush();
    Quiz.recount(quiz.quiz_id);
    Paper.invalidate(quiz.quiz_id);
    Audit.log(actor.email, 'question.import', quiz.quiz_id, { added: qRows.length, skipped: skipped.length });
    return { added: qRows.length, skipped: skipped.length, messages: skipped.slice(0, 30), totalRows: rows.length };
  },

  exportCsv: function (actor, a) {
    var quiz = Gate.quiz(actor, a.quizId);
    var out = [['question', 'answer(correct)', 'choice2', 'choice3', 'choice4', 'choice5', 'score', 'explanation']];
    Paper.get(quiz.quiz_id).forEach(function (q) {
      var row = [q.q_text || '[IMAGE]'];
      for (var i = 0; i < 5; i++) { var c = q.choices[i]; row.push(c ? (c.c_text || '[IMAGE]') : ''); }
      row.push(q.score);
      row.push(q.explain_text || '');
      out.push(row);
    });
    var safe = String(quiz.title).replace(/[^A-Za-z0-9ก-๙._-]+/g, '_').substring(0, 60) || 'quiz';
    return { filename: safe + '-questions.csv', csv: U.toCsv(out, true) };
  }
};
