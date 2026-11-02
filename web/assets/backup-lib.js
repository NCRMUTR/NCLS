/* HBT Core — backup-lib.js : ประกอบไฟล์ Zip สำรองข้อมูลวิชา "ที่เบราว์เซอร์" (JSZip) จากข้อมูลที่ API เดิมให้
 *   summary  → สรุปวิชา: รายชื่อ · คะแนน · เช็คชื่อ · คะแนนงาน · (ถ้าใช้ระบบสอบ) ข้อสอบ+ผลสอบ เป็น CSV
 *   assignment → ไฟล์งานที่นักศึกษาส่ง แยกไฟล์ Zip ต่องาน (ใหญ่เกิน PART_BYTES แบ่งเป็นหลายส่วน) + submissions.csv
 * ไฟล์ทั้งหมดไม่ผ่านเซิร์ฟเวอร์อื่น — ดึงผ่าน API ของระบบเอง (สิทธิ์เดียวกับหน้าจอ) แล้วประกอบในเครื่อง */
(function () {
  'use strict';
  var HBT = window.HBT = window.HBT || {};
  var DEFAULT_PART = 80 * 1024 * 1024;          // ขนาดต่อส่วน (ไฟล์ดิบ) — จำกัดเพื่อไม่ให้หน่วยความจำเบราว์เซอร์/มือถือเต็ม

  function partBytes() { return Number(window.HBT_BACKUP_PART_BYTES) > 0 ? Number(window.HBT_BACKUP_PART_BYTES) : DEFAULT_PART; }

  function safe(s, max) {
    s = String(s == null ? '' : s).replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
    s = s.replace(/ /g, '_');
    if (max && s.length > max) s = s.substring(0, max);
    return s || '_';
  }
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }
  function fmtSize(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(n >= 10485760 ? 0 : 1) + ' MB';
    if (n >= 1024) return Math.round(n / 1024) + ' KB';
    return n + ' B';
  }

  function zipLib() {
    if (!window.JSZip) throw new Error('โหลดไลบรารี Zip ไม่สำเร็จ — รีเฟรชหน้าแล้วลองใหม่');
    return new window.JSZip();
  }
  function api(action, args, opt) { return HBT.api.call(action, args || {}, opt || {}); }

  /** ดึงข้อมูลที่ "ไม่มีสิทธิ์/ไม่ได้ตั้งค่า" ให้ข้ามพร้อมบันทึกเหตุผล (ไม่ทำให้ทั้ง Zip ล้ม) · ข้อผิดพลาดอื่น = ล้มจริง */
  function soft(notes, label, fn) {
    return Promise.resolve().then(fn).catch(function (e) {
      if (e && (e.code === 'E_FORBIDDEN' || e.code === 'E_NOT_SETUP')) { notes.skipped.push(label + ': ' + HBT.errMsg(e)); return null; }
      throw e;
    });
  }

  function readme(lines) { return '﻿' + lines.join('\r\n') + '\r\n'; }

  /* ---------- สรุปวิชา ---------- */
  function buildSummary(course, opt, onProgress) {
    var zip = zipLib(), notes = { skipped: [], files: [] }, id = course.courseId;
    var folder = safe(course.code + '-' + course.section + '_สรุปวิชา');
    var z = zip.folder(folder);
    function put(name, text) { z.file(name, text); notes.files.push(name); }
    function step(t) { if (onProgress) onProgress(t); }

    step('รายชื่อนักศึกษา');
    return api('student.list', { courseId: id }).then(function (r) {
      put('students.csv', HBT.csv.build([['รหัสนักศึกษา', 'ชื่อ-นามสกุล']].concat(r.students.map(function (s) { return [s.stdId, s.name]; }))));
      step('คะแนน');
      return api('score.exportCsv', { courseId: id });
    }).then(function (r) {
      put('scores.csv', r.csv);
      step('เช็คชื่อ');
      return soft(notes, 'เช็คชื่อ', function () { return api('att.exportCsv', { courseId: id }); });
    }).then(function (r) {
      if (r) put('attendance.csv', r.csv);
      step('คะแนนงาน');
      return assignmentGrades(id, opt.assignments, notes);
    }).then(function (csv) {
      if (csv) put('assignments-grades.csv', csv);
      step('ข้อสอบ');
      return examParts(id, z, notes, put);
    }).then(function () {
      var L = ['HBT Teaching System — สำรองข้อมูลวิชา', '',
        'วิชา: ' + course.code + ' ' + course.name + ' กลุ่ม ' + course.section, 'ภาคเรียน: ' + (course.termName || '-'),
        'สร้างเมื่อ: ' + new Date().toLocaleString('th-TH'), '', 'ไฟล์ในชุดนี้:'];
      notes.files.forEach(function (f) { L.push('  - ' + f); });
      if (notes.skipped.length) { L.push('', 'ส่วนที่ไม่ได้รวม:'); notes.skipped.forEach(function (s) { L.push('  - ' + s); }); }
      L.push('', 'หมายเหตุ: ไฟล์งานของนักศึกษาอยู่ใน Zip แยกต่องาน · รูปประกอบข้อสอบไม่รวมในชุดนี้ (ไฟล์ข้อสอบ CSV ใช้ [IMAGE] แทนรูป)',
        'ข้อมูลนี้มีรายชื่อและคะแนนนักศึกษา — เก็บในที่ปลอดภัย');
      z.file('README.txt', readme(L));
      return zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    }).then(function (blob) {
      return { blob: blob, name: safe(course.code + '-' + course.section) + '_สรุปวิชา_' + stamp() + '.zip', skipped: notes.skipped, files: notes.files.length };
    });
  }

  /** ตารางคะแนนงาน: นักศึกษา × งาน (ได้จาก asg.submissions ทีละงาน — ไม่ดึงไฟล์) */
  function assignmentGrades(courseId, asgs, notes) {
    if (!asgs || !asgs.length) return Promise.resolve(null);
    var heads = ['รหัสนักศึกษา', 'ชื่อ-นามสกุล'], by = {}, order = [];
    var p = Promise.resolve();
    asgs.forEach(function (a) {
      p = p.then(function () {
        return soft(notes, 'คะแนนงาน ' + a.title, function () { return api('asg.submissions', { asgId: a.asgId }); }).then(function (r) {
          if (!r) return;
          heads.push(a.title + ' (เต็ม ' + r.assignment.maxScore + ')');
          var col = heads.length - 3;
          r.units.forEach(function (u) {
            u.members.forEach(function (m) {
              if (!by[m.stdId]) { by[m.stdId] = { name: m.name, v: [] }; order.push(m.stdId); }
              by[m.stdId].v[col] = m.score === null ? '' : m.score;
            });
          });
        });
      });
    });
    return p.then(function () {
      if (heads.length <= 2) return null;
      order.sort();
      return HBT.csv.build([heads].concat(order.map(function (sid) {
        var row = [sid, by[sid].name];
        for (var i = 0; i < heads.length - 2; i++) row.push(by[sid].v[i] === undefined ? '' : by[sid].v[i]);
        return row;
      })));
    });
  }

  /** ข้อสอบ (แบบทดสอบ CSV นำกลับเข้าได้) + ผลสอบรายรอบ — ข้ามถ้าไม่ได้ตั้งค่า/ไม่มีสิทธิ์ */
  function examParts(courseId, z, notes, put) {
    if (!HBT.api.configuredExam || !HBT.api.configuredExam()) { notes.skipped.push('สอบออนไลน์: ยังไม่ได้ตั้งค่า EXAM_URL'); return Promise.resolve(); }
    var X = { api: 'exam' };
    return soft(notes, 'สอบออนไลน์', function () {
      return Promise.all([api('exam.quiz.list', { courseId: courseId }, X), api('exam.round.list', { courseId: courseId }, X)]);
    }).then(function (r) {
      if (!r) return;
      var p = Promise.resolve(), used = {};
      function uniq(n) { var k = n, i = 2; while (used[k]) k = n.replace(/(\.csv)$/, '_' + (i++) + '$1'); used[k] = true; return k; }
      r[0].quizzes.forEach(function (q) {
        p = p.then(function () { return api('exam.q.export', { quizId: q.quizId }, X); }).then(function (x) {
          put(uniq('exam/quiz_' + safe(q.title, 50) + '.csv'), x.csv);
        });
      });
      r[1].rounds.forEach(function (s) {
        p = p.then(function () { return api('exam.round.export', { sessionId: s.sessionId, detail: true }, X); }).then(function (x) {
          put(uniq('exam/results_' + safe(s.title, 40) + '_' + (s.mode === 'TEST' ? 'สอบ' : 'ฝึกทำ') + '.csv'), x.csv);
        });
      });
      return p;
    });
  }

  /* ---------- ไฟล์งาน (ต่องาน แบ่งส่วนตามขนาด) ---------- */
  function planParts(files, limit) {
    var parts = [[]], cur = 0;
    files.forEach(function (f) {
      if (cur > 0 && cur + f.size > limit) { parts.push([]); cur = 0; }
      parts[parts.length - 1].push(f); cur += f.size;
    });
    return parts;
  }

  function getFile(fileId) {
    var tries = 0;
    function go() {
      return api('asg.fileGet', { fileId: fileId }).catch(function (e) {
        if (++tries < 3 && e && e.code !== 'E_NOT_FOUND' && e.code !== 'E_FORBIDDEN') return new Promise(function (r) { setTimeout(r, 800 * tries); }).then(go);
        throw e;
      });
    }
    return go();
  }

  /** คืนรายการส่วน (แต่ละส่วนสร้างทีละอัน: build(i) → { blob, name }) · ผู้เรียกดาวน์โหลดแล้วค่อยสร้างส่วนถัดไป */
  function planAssignment(course, asg) {
    return api('asg.submissions', { asgId: asg.asgId }).then(function (r) {
      var files = [], used = {};
      r.units.forEach(function (u) {
        var owner = r.assignment.kind === 'group'
          ? 'กลุ่ม_' + safe(u.name, 40) + '_(' + (u.rep ? u.rep.stdId : '') + ')'
          : safe(u.members[0] ? u.members[0].stdId + '_' + u.members[0].name : u.name, 70);
        u.files.forEach(function (f) {
          var dir = 'files/' + owner, n = safe(f.name, 120), k = dir + '/' + n, i = 2;
          while (used[k]) k = dir + '/' + (i++) + '_' + n;
          used[k] = true;
          files.push({ fileId: f.fileId, size: f.size, path: k });
        });
        u.filePaths = u.files.map(function (f, j) { return ''; });
      });
      var parts = planParts(files, partBytes());
      var rows = [['รหัสนักศึกษา', 'ชื่อ', 'กลุ่ม', 'สถานะ', 'ส่งล่าสุด', 'ส่งช้า', 'จำนวนไฟล์', 'ข้อความ', 'ลิงก์', 'คะแนน', 'ความเห็น', 'โฟลเดอร์ไฟล์']];
      r.units.forEach(function (u) {
        var dir = '';
        if (u.files.length) { var f0 = files.filter(function (x) { return x.fileId === u.files[0].fileId; })[0]; dir = f0 ? f0.path.replace(/\/[^\/]*$/, '') : ''; }
        u.members.forEach(function (m) {
          rows.push([m.stdId, m.name, r.assignment.kind === 'group' ? u.name : '', u.submitted ? 'ส่งแล้ว' : 'ยังไม่ส่ง', u.updatedAt || '', u.late ? 'ช้า' : '', u.files.length, u.note || '', u.link || '', m.score === null ? '' : m.score, m.feedback || '', dir]);
        });
      });
      (r.ungrouped || []).forEach(function (x) { rows.push([x.stdId, x.name, '(ยังไม่มีกลุ่ม)', 'ยังไม่ส่ง', '', '', 0, '', '', '', '', '']); });
      var base = safe(course.code + '-' + course.section) + '_งาน_' + safe(asg.title, 50) + '_' + stamp();
      var total = parts.length, csv = HBT.csv.build(rows);
      return {
        count: total, files: files.length, bytes: files.reduce(function (s, f) { return s + f.size; }, 0),
        build: function (i, onFile) {
          var zip = zipLib(), root = zip.folder(safe(asg.title, 50) + '_' + asg.code), errs = [], list = parts[i];
          root.file('submissions.csv', csv);
          var p = Promise.resolve(), n = 0;
          list.forEach(function (f) {
            p = p.then(function () { return getFile(f.fileId); }).then(function (x) {
              root.file(f.path, x.b64, { base64: true });
              if (onFile) onFile(++n, list.length, f);
            }, function (e) { errs.push(f.path + ' — ' + HBT.errMsg(e)); n++; });
          });
          return p.then(function () {
            var L = ['HBT Teaching System — ไฟล์งานที่นักศึกษาส่ง', '', 'งาน: ' + asg.title + ' (รหัส ' + asg.code + ')', 'วิชา: ' + course.code + '-' + course.section,
              'ส่วนที่ ' + (i + 1) + ' จาก ' + total + ' (' + list.length + ' ไฟล์)', 'submissions.csv = รายการส่ง/คะแนน/ความเห็น (ทุกส่วนมีไฟล์นี้ไฟล์เดียวกัน)'];
            if (errs.length) { L.push('', 'ดึงไฟล์ไม่สำเร็จ ' + errs.length + ' ไฟล์:'); errs.forEach(function (e) { L.push('  - ' + e); }); }
            root.file('README.txt', readme(L));
            return zip.generateAsync({ type: 'blob', compression: 'STORE' });
          }).then(function (blob) {
            return { blob: blob, name: base + (total > 1 ? '_ส่วน' + (i + 1) + 'จาก' + total : '') + '.zip', errors: errs };
          });
        }
      };
    });
  }

  function save(blob, name) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 4000);
  }

  HBT.backup = { safe: safe, fmtSize: fmtSize, planParts: planParts, partBytes: partBytes, buildSummary: buildSummary, planAssignment: planAssignment, save: save };
})();
