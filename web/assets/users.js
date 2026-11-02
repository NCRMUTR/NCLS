/* HBT Core — ผู้ใช้และสิทธิ์ (admin) */
HBT.page({ active: 'users', need: 'admin', crumbs: [['ผู้ดูแล', 't/home.html'], ['ผู้ใช้และสิทธิ์']] }, function (ctx) {
  var esc = HBT.esc, $ = HBT.$;
  var me = ctx.user.email;
  var SYS = ['att', 'exam', 'asg'];
  var users = [];
  var editing = null;       // email ที่กำลังแก้ (null = เพิ่มใหม่)

  ctx.content.insertAdjacentHTML('beforeend',
    '<div class="page-h"><div class="stack-s"><h1>ผู้ใช้และสิทธิ์</h1><p class="muted">เพิ่มอีเมลอาจารย์และกำหนดว่าใช้ระบบไหนได้</p></div>' +
    '<div class="row"><button class="btn primary" type="button" id="addBtn">เพิ่มผู้ใช้</button></div></div>' +
    '<div id="listBox"><div class="loading"><span class="spin"></span> กำลังโหลด…</div></div>' +
    '<section class="stack" id="sumBox"></section>' +
    '<div class="modal" id="mUser" hidden role="dialog" aria-modal="true" aria-labelledby="mTitle"><div class="mbox stack">' +
    '<div class="row sp"><h2 id="mTitle">เพิ่มผู้ใช้</h2><button class="btn sm ghost" data-close type="button">ปิด</button></div>' +
    '<div class="field"><label for="ue">อีเมลมหาวิทยาลัย</label><input id="ue" type="email" autocomplete="off" placeholder="name@rmutr.ac.th"><span class="help">ต้องลงท้ายด้วยโดเมนของมหาวิทยาลัย · แก้อีเมลภายหลังไม่ได้</span></div>' +
    '<div class="field"><label for="un">ชื่อที่แสดง</label><input id="un" type="text" autocomplete="off" placeholder="อ.สมชาย ใจดี"></div>' +
    '<div class="field"><label for="ur">บทบาท</label><select id="ur"><option value="teacher">teacher — อาจารย์</option><option value="admin">admin — ผู้ดูแลระบบ</option></select></div>' +
    '<div class="stack-s"><span class="lbl">ระบบที่ใช้ได้</span><div id="sysBox"></div><span class="help" id="sysHelp"></span></div>' +
    '<div class="err" id="mErr" role="alert"></div>' +
    '<div class="row" style="justify-content:flex-end"><button class="btn ghost" data-close type="button">ยกเลิก</button><button class="btn primary" type="button" id="saveBtn">บันทึก</button></div>' +
    '</div></div>');

  $('#sysBox').innerHTML = SYS.map(function (s) {
    return '<label class="check"><input type="checkbox" name="sys" value="' + s + '"><span><b>' + esc(HBT.SYSTEM_NAMES[s]) + ' (' + s + ')</b><br><span class="small muted">' + esc(HBT.SYSTEM_DESC[s]) + '</span></span></label>';
  }).join('');

  function pills(u) {
    if (u.role === 'admin') return '<span class="pill acc">ทุกระบบ</span>';
    if (!u.systems.length) return '<span class="muted small">— ยังไม่มีสิทธิ์ —</span>';
    return u.systems.map(function (s) { return '<span class="pill acc">' + esc(HBT.SYSTEM_NAMES[s] || s) + '</span>'; }).join('');
  }

  function render() {
    var rows = users.map(function (u) {
      return '<tr data-email="' + esc(u.email) + '"><td><b>' + esc(u.name) + '</b>' + (u.email === me ? ' <span class="pill info">คุณ</span>' : '') +
        '<br><span class="small muted">' + esc(u.email) + '</span></td>' +
        '<td><span class="pill ' + (u.role === 'admin' ? 'adm' : '') + '">' + esc(u.role) + '</span></td>' +
        '<td><div class="row" style="gap:4px">' + pills(u) + '</div></td>' +
        '<td><span class="pill ' + (u.active ? 'good' : 'bad') + '">' + (u.active ? 'ใช้งาน' : 'ปิดใช้งาน') + '</span>' +
        (u.lastLogin ? '<br><span class="xs muted">เข้าล่าสุด ' + esc(HBT.fmtBE(u.lastLogin, true)) + '</span>' : '<br><span class="xs muted">ยังไม่เคยเข้า</span>') + '</td>' +
        '<td><div class="tbl-actions"><button class="btn sm" type="button" data-act="edit">แก้ไข</button>' +
        '<button class="btn sm ' + (u.active ? '' : 'primary') + '" type="button" data-act="toggle">' + (u.active ? 'ปิดใช้งาน' : 'เปิดใช้งาน') + '</button></div></td></tr>';
    }).join('');
    $('#listBox').innerHTML = users.length
      ? '<div class="scroll"><table><thead><tr><th>ผู้ใช้</th><th>บทบาท</th><th>ระบบที่ใช้ได้</th><th>สถานะ</th><th></th></tr></thead><tbody>' + rows + '</tbody></table></div>'
      : '<div class="callout">ยังไม่มีผู้ใช้</div>';

    var sum = SYS.map(function (s) {
      var names = users.filter(function (u) { return u.active && (u.role === 'admin' || u.systems.indexOf(s) >= 0); })
        .map(function (u) { return esc(u.name) + (u.role === 'admin' ? ' (admin)' : ''); });
      return '<tr><td>' + esc(HBT.SYSTEM_NAMES[s]) + ' (' + s + ')</td><td>' + (names.join(' · ') || '<span class="muted">—</span>') + '</td></tr>';
    }).join('');
    $('#sumBox').innerHTML = '<h3>สรุปสิทธิ์ตามระบบ</h3><div class="scroll"><table><thead><tr><th>ระบบ</th><th>ใครใช้ได้ (เฉพาะบัญชีที่เปิดใช้งาน)</th></tr></thead><tbody>' + sum + '</tbody></table></div>' +
      '<p class="help">สิทธิ์ที่แก้มีผลกับผู้ที่ล็อกอินอยู่ทันที (ในการเรียกระบบครั้งถัดไป)</p>';
  }

  function load() {
    return HBT.api.call('user.list').then(function (r) { users = r.users; render(); }, function (e) {
      $('#listBox').innerHTML = '<div class="callout bad"><b>โหลดรายชื่อไม่สำเร็จ</b><br>' + esc(HBT.errMsg(e)) + '</div>' +
        '<div class="row" style="margin-top:10px"><button class="btn" type="button" id="reload">ลองใหม่</button></div>';
      $('#reload').addEventListener('click', load);
    });
  }

  function syncRole() {
    var adm = $('#ur').value === 'admin';
    HBT.$$('input[name=sys]').forEach(function (c) { if (adm) c.checked = true; c.disabled = adm; });
    $('#sysHelp').textContent = adm ? 'ผู้ดูแลระบบใช้ได้ทุกระบบโดยอัตโนมัติ' : '';
  }

  function openForm(u) {
    editing = u ? u.email : null;
    $('#mTitle').textContent = u ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้';
    $('#ue').value = u ? u.email : ''; $('#ue').disabled = !!u;
    $('#un').value = u ? u.name : '';
    $('#ur').value = u ? u.role : 'teacher';
    HBT.$$('input[name=sys]').forEach(function (c) { c.checked = !!u && u.systems.indexOf(c.value) >= 0; c.disabled = false; });
    syncRole();
    $('#mErr').textContent = '';
    HBT.modal.open('mUser');
  }

  $('#addBtn').addEventListener('click', function () { openForm(null); });
  $('#ur').addEventListener('change', syncRole);
  $('#listBox').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-act]');
    if (!b) return;
    var tr = b.closest('tr'), email = tr.getAttribute('data-email');
    var u = users.filter(function (x) { return x.email === email; })[0];
    if (!u) return;
    if (b.getAttribute('data-act') === 'edit') { openForm(u); return; }
    if (u.active && email === me && !window.confirm('ปิดใช้งานบัญชีของคุณเอง? คุณจะออกจากระบบทันที')) return;
    HBT.busy(b, function () {
      return HBT.api.call('user.setActive', { email: email, active: !u.active }, { write: true }).then(function () {
        HBT.toast(u.active ? 'ปิดใช้งานแล้ว' : 'เปิดใช้งานแล้ว', 'good');
        if (email === me && u.active) { HBT.api.goLogin('disabled'); return; }
        return load();
      });
    }).catch(function (er) { HBT.toast(HBT.errMsg(er), 'bad'); });
  });

  $('#saveBtn').addEventListener('click', function () {
    var b = this;
    var sys = HBT.$$('input[name=sys]').filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
    var payload = {
      email: $('#ue').value.trim(), name: $('#un').value.trim(), role: $('#ur').value, systems: sys
    };
    if (editing) { var cur = users.filter(function (x) { return x.email === editing; })[0]; payload.active = cur ? cur.active : true; }
    $('#mErr').textContent = '';
    if (!payload.email) { $('#mErr').textContent = 'กรุณากรอกอีเมล'; return; }
    if (!payload.name) { $('#mErr').textContent = 'กรุณากรอกชื่อที่แสดง'; return; }
    HBT.busy(b, function () {
      return HBT.api.call('user.upsert', payload, { write: true }).then(function () {
        HBT.modal.close('mUser');
        HBT.toast(editing ? 'บันทึกแล้ว' : 'เพิ่มผู้ใช้แล้ว', 'good');
        if (payload.email === me) { location.reload(); return; }     // แก้สิทธิ์ตัวเอง: โหลดใหม่ให้เมนูตรงสิทธิ์
        return load();
      });
    }).catch(function (er) { $('#mErr').textContent = HBT.errMsg(er); });
  });

  load();
});
