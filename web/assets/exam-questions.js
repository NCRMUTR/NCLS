/* HBT Core — ข้อสอบของแบบทดสอบ (อาจารย์): เพิ่ม/แก้/ลบ/เลื่อนลำดับ · รูปประกอบ · นำเข้า-ส่งออก CSV
 * ติ๊กตัวเลือกที่ถูก (server ย้ายเป็นตัวเลือกที่ 1 เอง) · นักศึกษาเห็นตำแหน่งตัวเลือกที่สลับแล้ว ไม่เห็นเฉลย */
HBT.page({ active: 'exam', need: 'exam', crumbs: [['รายวิชาของฉัน', 't/courses.html'], ['สอบออนไลน์'], ['ข้อสอบ']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$, root = HBT.api.root();
  var zid = HBT.qs('z'), cid = HBT.qs('id');
  var X = { api: 'exam' };
  var data = null, editing = null, sel = {}, slots = null;
  var IMG_MAX = 800 * 1024;                      // server รับรูปไม่เกิน 1 MB — ย่อให้เหลือต่ำกว่านี้เผื่อ base64

  if (!zid) { ctx.content.insertAdjacentHTML('beforeend', '<div class="callout bad"><b>ไม่พบแบบทดสอบ</b></div><div><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>'); return; }
  if (!HBT.api.configuredExam()) { ctx.content.insertAdjacentHTML('beforeend', '<div class="callout warn"><b>ยังไม่ได้ตั้งค่าระบบสอบออนไลน์</b><br>ไฟล์ assets/config.js ยังไม่มี EXAM_URL</div>'); return; }
  var back = root + 't/exam.html?tab=quizzes&id=' + encodeURIComponent(cid);

  ctx.content.insertAdjacentHTML('beforeend', '<div id="box" class="stack"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +
    '<div class="modal" id="mQ" hidden role="dialog" aria-modal="true" aria-labelledby="qTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="qTitle">เพิ่มข้อสอบ</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="field"><label for="qText">คำถาม</label><textarea id="qText" rows="3" maxlength="4000"></textarea></div>' +
    '<div class="stack-s" id="qImgBox"></div>' +
    '<div class="lbl">ตัวเลือก (ติ๊กวงกลมหน้าข้อที่ถูก)</div><div id="chBox"></div>' +
    '<div class="row"><button class="btn sm" type="button" id="addCh">+ เพิ่มตัวเลือก</button><span class="small muted">2–5 ตัวเลือก</span></div>' +
    '<div class="grid g2"><div class="field"><label for="qScore">คะแนนข้อนี้</label><input id="qScore" type="number" inputmode="decimal" min="0.01" max="1000" step="any" value="1"></div></div>' +
    '<div class="field"><label for="qExp">คำอธิบายเฉลย (แสดงในโหมดฝึกทำ)</label><textarea id="qExp" rows="2" maxlength="4000"></textarea></div>' +
    '<div class="stack-s" id="eImgBox"></div>' +
    '<div class="err" id="qErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="qSave">บันทึก</button></div></div></div>' +
    '<div class="modal" id="mImp" hidden role="dialog" aria-modal="true" aria-labelledby="iTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="iTitle">นำเข้าข้อสอบจาก CSV</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<p class="small muted">คอลัมน์: A = คำถาม · B = <b>ตัวเลือกที่ถูก</b> · C–F = ตัวเลือกอื่น (อย่างน้อย 1) · G = คะแนน (ว่าง = 1) · H = คำอธิบาย — วางจาก Excel หรือเลือกไฟล์ .csv · นำเข้าได้เฉพาะข้อความ (ใส่รูปทีหลังในหน้านี้)</p>' +
    '<div class="field"><label for="iFile">เลือกไฟล์ CSV</label><input id="iFile" type="file" accept=".csv,.txt,text/csv"></div>' +
    '<div class="field"><label for="iText">หรือวางข้อความ</label><textarea id="iText" rows="6" placeholder="2+2 เท่ากับเท่าไร&#9;4&#9;3&#9;5&#9;6"></textarea></div>' +
    '<label class="check"><input type="checkbox" id="iSkip"><span>แถวแรกเป็นหัวตาราง (ข้าม)</span></label>' +
    '<div class="err" id="iErr" role="alert"></div><div id="iRes"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ปิด</button><button class="btn primary" type="button" id="iGo">นำเข้า</button></div></div></div>');

  function idOf(url) { var m = String(url || '').match(/[?&]id=([^&]+)/); return m ? decodeURIComponent(m[1]) : ''; }

  function render() {
    var z = data.quiz, qs = data.questions;
    document.title = z.title + ' — HBT Teaching';
    var h = '<div class="page-h"><div class="stack-s"><h1>' + esc(z.title) + '</h1><p class="muted">' + qs.length + ' ข้อ · คะแนนรวม ' + qs.reduce(function (a, x) { return a + x.score; }, 0) + '</p></div>' +
      '<div class="row"><a class="btn" href="' + back + '">‹ แบบทดสอบ</a><button class="btn primary" type="button" id="addQ">เพิ่มข้อสอบ</button></div></div>';
    h += '<div class="row"><button class="btn sm" type="button" id="impBtn">นำเข้า CSV</button><button class="btn sm" type="button" id="expBtn"' + (qs.length ? '' : ' disabled') + '>ส่งออก CSV</button>' +
      '<button class="btn sm ghost" type="button" id="delSel" disabled>ลบที่เลือก</button><button class="btn sm ghost" type="button" id="delAll"' + (qs.length ? '' : ' disabled') + '>ลบทั้งหมด</button></div>';
    if (!qs.length) h += '<div class="card stack-s" id="empty"><h3>ยังไม่มีข้อสอบ</h3><p class="small muted">กด “เพิ่มข้อสอบ” หรือ “นำเข้า CSV” (วางจาก Excel ได้)</p></div>';
    else h += '<div class="stack" id="qlist">' + qs.map(function (x, i) {
      return '<div class="ex-qrow" data-q="' + esc(x.question_id) + '"><label class="check" style="padding:0"><input type="checkbox" data-pick="' + esc(x.question_id) + '" aria-label="เลือกข้อ ' + x.q_no + '"' + (sel[x.question_id] ? ' checked' : '') + '></label>' +
        '<div class="no">' + x.q_no + '</div><div class="body"><div class="txt">' + esc(x.q_text || (x.q_image_url ? '' : '(ไม่มีข้อความ)')) + '</div>' +
        (x.q_image_url ? '<div><img class="ex-thumb" src="' + esc(x.q_image_url) + '" alt="รูปคำถาม ข้อ ' + x.q_no + '"></div>' : '') +
        x.choices.map(function (c, k) {
          return '<div class="ex-ch' + (k === 0 ? ' right' : '') + '"><span>' + (k === 0 ? '✓' : '○') + '</span><span>' + (c.c_image_url ? '<img class="ex-thumb" src="' + esc(c.c_image_url) + '" alt=""> ' : '') + esc(c.c_text) + '</span></div>';
        }).join('') +
        '<div class="small muted" style="margin-top:6px">' + x.score + ' คะแนน' + (x.explain_text || x.explain_image_url ? ' · มีคำอธิบายเฉลย' : '') + '</div>' +
        '<div class="row" style="margin-top:8px"><button class="btn sm" type="button" data-edit="' + esc(x.question_id) + '">แก้ไข</button>' +
        '<button class="btn sm ghost" type="button" data-up="' + esc(x.question_id) + '"' + (i === 0 ? ' disabled' : '') + ' aria-label="เลื่อนขึ้น">↑</button>' +
        '<button class="btn sm ghost" type="button" data-down="' + esc(x.question_id) + '"' + (i === qs.length - 1 ? ' disabled' : '') + ' aria-label="เลื่อนลง">↓</button>' +
        '<button class="btn sm ghost" type="button" data-del="' + esc(x.question_id) + '">ลบ</button></div></div></div>';
    }).join('') + '</div>';
    $('#box').innerHTML = h;
    $('#addQ').addEventListener('click', function () { openEdit(null); });
    $('#impBtn').addEventListener('click', function () { $('#iErr').textContent = ''; $('#iRes').innerHTML = ''; $('#iText').value = ''; $('#iFile').value = ''; HBT.modal.open('mImp'); });
    $('#expBtn').addEventListener('click', exportCsv);
    HBT.$$('[data-edit]').forEach(function (b) { b.addEventListener('click', function () { openEdit(b.getAttribute('data-edit')); }); });
    HBT.$$('[data-del]').forEach(function (b) { b.addEventListener('click', function () { delOne(b); }); });
    HBT.$$('[data-up]').forEach(function (b) { b.addEventListener('click', function () { move(b, 'up', b.getAttribute('data-up')); }); });
    HBT.$$('[data-down]').forEach(function (b) { b.addEventListener('click', function () { move(b, 'down', b.getAttribute('data-down')); }); });
    HBT.$$('[data-pick]').forEach(function (c) {
      c.addEventListener('change', function () { if (c.checked) sel[c.getAttribute('data-pick')] = 1; else delete sel[c.getAttribute('data-pick')]; paintSel(); });
    });
    $('#delSel').addEventListener('click', function () { delMany(false); });
    $('#delAll').addEventListener('click', function () { delMany(true); });
    paintSel();
  }
  function paintSel() { var n = Object.keys(sel).length, b = $('#delSel'); if (b) { b.disabled = !n; b.textContent = n ? 'ลบที่เลือก (' + n + ')' : 'ลบที่เลือก'; } }

  function reload() { return HBT.api.call('exam.q.list', { quizId: zid }, X).then(function (r) { data = r; sel = {}; render(); }); }
  function fail(e) { HBT.toast(HBT.errMsg(e), 'bad'); }

  function move(btn, dir, qid) {
    HBT.busy(btn, function () { return HBT.api.call('exam.q.move', { questionId: qid, dir: dir }, X).then(reload); }).catch(fail);
  }
  function delOne(btn) {
    if (!window.confirm('ลบข้อนี้? ลบแล้วกู้คืนไม่ได้ (เลขข้อถัดไปจะเลื่อนขึ้น)')) return;
    HBT.busy(btn, function () { return HBT.api.call('exam.q.delete', { questionId: btn.getAttribute('data-del') }, { api: 'exam', write: true }).then(function () { HBT.toast('ลบแล้ว', 'good'); return reload(); }); }).catch(fail);
  }
  function delMany(all) {
    var ids = Object.keys(sel);
    if (!all && !ids.length) return;
    if (!window.confirm(all ? 'ลบข้อสอบ “ทั้งหมด” ในแบบทดสอบนี้? ลบแล้วกู้คืนไม่ได้' : 'ลบข้อสอบที่เลือก ' + ids.length + ' ข้อ? ลบแล้วกู้คืนไม่ได้')) return;
    HBT.busy(all ? $('#delAll') : $('#delSel'), function () {
      return HBT.api.call('exam.q.deleteMany', { quizId: zid, ids: all ? 'ALL' : ids }, { api: 'exam', write: true }).then(function (r) { HBT.toast('ลบแล้ว ' + r.removed + ' ข้อ', 'good'); return reload(); });
    }).catch(fail);
  }
  function exportCsv() {
    HBT.busy($('#expBtn'), function () {
      return HBT.api.call('exam.q.export', { quizId: zid }, X).then(function (r) { HBT.csv.download(r.filename, r.csv); });
    }).catch(fail);
  }

  /* ---------- นำเข้า CSV ---------- */
  $('#iFile').addEventListener('change', function () {
    var f = this.files && this.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { $('#iText').value = String(rd.result || ''); };
    rd.onerror = function () { $('#iErr').textContent = 'อ่านไฟล์ไม่ได้'; };
    rd.readAsText(f, 'utf-8');
  });
  $('#iGo').addEventListener('click', function () {
    var txt = $('#iText').value;
    $('#iErr').textContent = ''; $('#iRes').innerHTML = '';
    if (!txt.trim()) { $('#iErr').textContent = 'ยังไม่มีข้อมูลให้นำเข้า'; return; }
    HBT.busy(this, function () {
      return HBT.api.call('exam.q.import', { quizId: zid, csv: txt, skipFirstRow: $('#iSkip').checked }, { api: 'exam', write: true }).then(function (r) {
        $('#iRes').innerHTML = '<div class="callout ' + (r.added ? 'good' : 'warn') + '" id="iOut">นำเข้า <b>' + r.added + '</b> ข้อ' + (r.skipped ? ' · ข้าม ' + r.skipped + ' แถว' : '') +
          (r.messages && r.messages.length ? '<br>' + r.messages.map(esc).join('<br>') : '') + '</div>';
        return reload();
      });
    }).catch(function (e) { $('#iErr').textContent = HBT.errMsg(e); });
  });

  /* ---------- ฟอร์มข้อสอบ ---------- */
  /** slot ของรูป = { id (รูปเดิมใน Drive), url (แสดงตัวอย่าง), b64, name } */
  function slotOf(url) { return { id: idOf(url), url: url || '', b64: '', name: '' }; }
  function imgPicker(box, slot, label, onChange) {
    function paint() {
      box.innerHTML = '<div class="row">' + (slot.url ? '<img class="ex-thumb" src="' + esc(slot.url) + '" alt="ตัวอย่างรูป">' : '') +
        '<label class="btn sm">' + (slot.url ? 'เปลี่ยนรูป' : esc(label)) + '<input type="file" accept="image/jpeg,image/png,image/gif,image/webp" hidden></label>' +
        (slot.url ? '<button class="btn sm ghost" type="button" data-rm>เอารูปออก</button>' : '') + '<span class="err small" data-e></span></div>';
      var inp = box.querySelector('input[type=file]'), rm = box.querySelector('[data-rm]'), er = box.querySelector('[data-e]');
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0]; if (!f) return;
        er.textContent = '';
        HBT.stu.shrinkImage(f, IMG_MAX).then(function (g) {
          if (g.size > IMG_MAX) throw new Error('รูปใหญ่เกินไป (ไม่เกิน 800 KB)');
          return HBT.stu.readB64(g).then(function (b64) {
            slot.b64 = b64; slot.name = g.name; slot.id = ''; slot.url = 'data:' + (g.type || 'image/jpeg') + ';base64,' + b64; paint(); if (onChange) onChange();
          });
        }).catch(function (e) { er.textContent = e.message || 'ใช้รูปนี้ไม่ได้'; });
      });
      if (rm) rm.addEventListener('click', function () { slot.id = ''; slot.url = ''; slot.b64 = ''; slot.name = ''; paint(); if (onChange) onChange(); });
    }
    paint();
  }

  function chRow(i, c) {
    return '<div class="ex-edch' + (c.right ? ' right' : '') + '" data-ch="' + i + '"><input type="radio" name="right" value="' + i + '" aria-label="ตัวเลือกที่ ' + (i + 1) + ' เป็นข้อที่ถูก"' + (c.right ? ' checked' : '') + '>' +
      '<div class="stack-s"><input type="text" maxlength="500" data-ct placeholder="ตัวเลือกที่ ' + (i + 1) + '" value="' + esc(c.text) + '" aria-label="ข้อความตัวเลือกที่ ' + (i + 1) + '"><div data-cimg></div></div>' +
      '<button class="btn sm ghost" type="button" data-cdel aria-label="ลบตัวเลือกที่ ' + (i + 1) + '">ลบ</button></div>';
  }
  function paintChoices() {
    var box = $('#chBox');
    box.innerHTML = slots.ch.map(function (c, i) { return chRow(i, c); }).join('');
    HBT.$$('[data-ch]', box).forEach(function (row) {
      var i = Number(row.getAttribute('data-ch')), c = slots.ch[i];
      row.querySelector('input[type=radio]').addEventListener('change', function () { slots.ch.forEach(function (x, k) { x.right = k === i; }); paintChoices(); });
      row.querySelector('[data-ct]').addEventListener('input', function () { c.text = this.value; });
      row.querySelector('[data-cdel]').addEventListener('click', function () {
        if (slots.ch.length <= 2) { $('#qErr').textContent = 'ต้องมีอย่างน้อย 2 ตัวเลือก'; return; }
        var wasRight = c.right; slots.ch.splice(i, 1); if (wasRight) slots.ch[0].right = true; paintChoices();
      });
      imgPicker(row.querySelector('[data-cimg]'), c.img, 'ใส่รูปในตัวเลือก');
    });
    $('#addCh').disabled = slots.ch.length >= 5;
  }
  $('#addCh').addEventListener('click', function () {
    if (slots.ch.length >= 5) return;
    slots.ch.push({ text: '', right: false, img: slotOf('') }); paintChoices();
  });

  function openEdit(qid) {
    editing = qid ? data.questions.filter(function (x) { return x.question_id === qid; })[0] : null;
    var x = editing;
    $('#qTitle').textContent = x ? 'แก้ไขข้อ ' + x.q_no : 'เพิ่มข้อสอบ';
    $('#qText').value = x ? x.q_text : ''; $('#qScore').value = x ? x.score : 1; $('#qExp').value = x ? x.explain_text : ''; $('#qErr').textContent = '';
    slots = {
      q: slotOf(x ? x.q_image_url : ''), e: slotOf(x ? x.explain_image_url : ''),
      ch: x ? x.choices.map(function (c, k) { return { text: c.c_text, right: k === 0, img: slotOf(c.c_image_url) }; })
            : [0, 1, 2, 3].map(function (k) { return { text: '', right: k === 0, img: slotOf('') }; })
    };
    imgPicker($('#qImgBox'), slots.q, 'ใส่รูปประกอบคำถาม');
    imgPicker($('#eImgBox'), slots.e, 'ใส่รูปประกอบคำอธิบาย');
    paintChoices();
    HBT.modal.open('mQ');
  }
  function imgFields(slot, key, out) {
    if (slot.b64) out[key] = { base64: slot.b64, name: slot.name || 'img.jpg' };
    else if (slot.id) out[key + '_id'] = slot.id;
  }
  $('#qSave').addEventListener('click', function () {
    var b = this, err = $('#qErr'); err.textContent = '';
    var text = $('#qText').value;
    if (!text.trim() && !slots.q.url) { err.textContent = 'กรุณาใส่คำถาม (ข้อความหรือรูป)'; return; }
    var ri = -1; slots.ch.forEach(function (c, i) { if (c.right) ri = i; });
    for (var i = 0; i < slots.ch.length; i++) {
      var c = slots.ch[i];
      if (!c.text.trim() && !c.img.url) { err.textContent = 'ตัวเลือกที่ ' + (i + 1) + ' ยังว่าง'; return; }
    }
    if (ri < 0) { err.textContent = 'กรุณาติ๊กตัวเลือกที่ถูก'; return; }
    var p = { quizId: zid, q_type: (!text.trim() && slots.q.url) ? 'image' : 'text', q_text: text, score: $('#qScore').value, explain_text: $('#qExp').value, correct: ri };
    if (editing) p.questionId = editing.question_id;
    imgFields(slots.q, 'q_image', p); imgFields(slots.e, 'explain_image', p);
    p.choices = slots.ch.map(function (c) {
      var o = { c_type: (c.img.url && !c.text.trim()) ? 'image' : (c.img.url ? 'image' : 'text'), c_text: c.text };
      imgFields(c.img, 'c_image', o);
      return o;
    });
    HBT.busy(b, function () {
      return HBT.api.call('exam.q.save', p, { api: 'exam', write: true }).then(function () {
        HBT.modal.close('mQ'); HBT.toast('บันทึกแล้ว', 'good'); return reload();
      });
    }).catch(function (e) { err.textContent = HBT.errMsg(e); });
  });

  reload().catch(function (e) {
    var nf = e.code === 'E_NOT_FOUND' || e.code === 'E_FORBIDDEN' || e.code === 'E_QUIZ_REQUIRED';
    $('#box').innerHTML = '<div class="callout bad"><b>' + (nf ? 'ไม่พบแบบทดสอบนี้ หรือไม่มีสิทธิ์เข้าถึง' : 'โหลดไม่สำเร็จ') + '</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
      '<div class="row" style="margin-top:10px"><a class="btn" href="' + root + 't/courses.html">รายวิชาของฉัน</a></div>';
  });
});
