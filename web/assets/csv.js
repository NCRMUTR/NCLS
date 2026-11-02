/* HBT Core — csv.js : อ่าน CSV/ข้อมูลที่วางจาก Excel และดาวน์โหลดไฟล์ */
(function () {
  'use strict';
  var HBT = window.HBT = window.HBT || {};

  /** แยกข้อความเป็นตาราง · เดาตัวคั่น (แท็บ ← จาก Excel / , / ;) · รองรับเครื่องหมายคำพูดและ BOM */
  function parse(text) {
    text = String(text == null ? '' : text).replace(/^﻿/, '');
    var first = text.split(/\r\n|\n|\r/)[0] || '';
    var delim = first.indexOf('\t') >= 0 ? '\t' : (first.split(';').length > first.split(',').length ? ';' : ',');
    var rows = [], row = [], cell = '', q = false, i = 0, n = text.length, c;
    function endCell() { row.push(cell); cell = ''; }
    function endRow() { endCell(); rows.push(row); row = []; }
    for (; i < n; i++) {
      c = text.charAt(i);
      if (q) {
        if (c === '"') { if (text.charAt(i + 1) === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"' && cell === '') q = true;
      else if (c === delim) endCell();
      else if (c === '\r') { if (text.charAt(i + 1) === '\n') i++; endRow(); }
      else if (c === '\n') endRow();
      else cell += c;
    }
    if (cell !== '' || row.length) endRow();
    return rows.filter(function (r) { return r.some(function (v) { return String(v).trim() !== ''; }); })
      .map(function (r) { return r.map(function (v) { return String(v).trim(); }); });
  }

  var ID_RE = /^[A-Za-z0-9\-]{4,20}$/;
  function looksId(v) { return ID_RE.test(String(v).replace(/[\s​]/g, '')); }

  /** รายชื่อ: คอลัมน์แรก = รหัส · ที่เหลือต่อกันเป็นชื่อ (รองรับ รหัส | ชื่อ | นามสกุล) · ข้ามแถวหัวตาราง */
  function parseRoster(text) {
    var t = parse(text), header = false;
    if (t.length && !looksId(t[0][0])) { header = true; t = t.slice(1); }
    return {
      header: header,
      rows: t.map(function (r) { return { stdId: r[0] || '', name: r.slice(1).filter(function (x) { return x; }).join(' ') }; })
    };
  }

  /** คะแนน: คอลัมน์แรก = รหัส · คอลัมน์สอง = คะแนน (ว่าง = ล้าง) */
  function parseScores(text) {
    var t = parse(text), header = false;
    if (t.length && !looksId(t[0][0])) { header = true; t = t.slice(1); }
    return { header: header, rows: t.map(function (r) { return { stdId: r[0] || '', score: r.length > 1 ? r[1] : '' }; }) };
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/csv') + ';charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename; a.style.display = 'none';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); if (a.parentNode) a.parentNode.removeChild(a); }, 1500);
  }

  /** สร้างข้อความ CSV ฝั่งเบราว์เซอร์ (ใช้กับรหัสชั่วคราว) · กัน CSV injection */
  function build(rows) {
    function cell(v) {
      v = String(v == null ? '' : v);
      if (/^[=+\-@\t\r]/.test(v)) v = "'" + v;
      return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    }
    return '﻿' + rows.map(function (r) { return r.map(cell).join(','); }).join('\r\n');
  }

  HBT.csv = { parse: parse, parseRoster: parseRoster, parseScores: parseScores, download: download, build: build };
  HBT.qs = function (k) {
    try { return new URLSearchParams(location.search).get(k) || ''; } catch (e) { return ''; }
  };
})();
