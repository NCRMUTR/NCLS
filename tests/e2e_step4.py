"""e2e ขั้น 4: ส่งงาน — อาจารย์สั่งงาน · ลิงก์ถาวร + รหัสงาน · นักศึกษาเข้าด้วยชื่อ+PIN · อัปโหลดไฟล์ · กลุ่ม · ตรวจ/ให้คะแนน · ดาวน์โหลด · ลบ"""
import json, os, struct, urllib.request, zlib
from e2e_lib import *

T1 = 't1@rmutr.ac.th'
T2 = 't2@rmutr.ac.th'
PIN = '1234'


def api(action, args=None, token=''):
    req = urllib.request.Request(BASE + '/api', data=json.dumps({'action': action, 'token': token, 'args': args or {}}).encode(), method='POST')
    return json.loads(urllib.request.urlopen(req).read())


def world(n=4):
    seed(ADMIN, 'term.create', {'name': '1/2569'})
    seed(ADMIN, 'user.upsert', {'email': T1, 'name': 'อ.หนึ่ง', 'systems': ['att', 'exam', 'asg']})
    seed(ADMIN, 'user.upsert', {'email': T2, 'name': 'อ.สอง', 'systems': ['att']})
    cid = seed(T1, 'course.create', {'code': 'BIO101', 'name': 'ชีววิทยา', 'section': '1'})['courseId']
    seed(T1, 'student.importCsv', {'courseId': cid, 'rows': [{'stdId': str(660000 + i), 'name': 'นักศึกษา %d' % i} for i in range(1, n + 1)]})
    for c in seed(T1, 'pin.issueTemp', {'courseId': cid, 'all': True})['codes']:
        r = api('pin.setWithTemp', {'courseId': cid, 'stdId': c['stdId'], 'tempPin': c['pin'], 'newPin': PIN})
        assert r['ok'], r
    return cid


def mk_asg(cid, **kw):
    a = {'courseId': cid, 'title': 'รายงานแล็บ 1', 'kind': 'single', 'maxScore': 10, 'description': 'ส่งเป็น PDF\nบรรทัดสอง'}
    a.update(kw)
    return seed(T1, 'asg.save', a)


def rows_of(sheet):
    return get('/__rows?sheet=' + sheet)


def drive():
    return get('/__drive')


def live_files():
    return [f for f in drive()['files'] if not f['trashed']]


def pdf(n=2000, tag=b''):
    b = bytearray(b'%PDF-1.4\n' + tag)
    b += b'x' * (n - len(b))
    return bytes(b)


def png_noise(w, h):
    """PNG แบบไม่บีบอัด (zlib level 0) เนื้อสุ่ม → ใหญ่แน่นอน และเบราว์เซอร์ถอดรหัสได้จริง"""
    raw = b''.join(b'\x00' + os.urandom(w * 3) for _ in range(h))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 0)) + chunk(b'IEND', b'')


def student(viewport=(390, 800)):
    return Ctx(viewport=viewport)


def teacher(viewport=(1100, 800)):
    return Ctx(viewport=viewport)


def link(a):
    return '/s/submit.html?t=%s&c=%s' % (a['tid'], a['code'])


def stu_login(c, std='660001', pin=PIN):
    p = c.page
    p.wait_for_selector('#lq')
    p.fill('#lq', std)
    p.wait_for_function("document.getElementById('lsel').value==='%s'" % std)
    p.fill('#lpin', pin)
    p.click('#lgo')


def upload(p, name, data, mime='application/pdf'):
    p.set_input_files('#pick', {'name': name, 'mimeType': mime, 'buffer': data})


# ---------------------------------------------------------------------------------------------
print('\nอาจารย์: สั่งงาน')


@case('สั่งงานจากหน้าวิชา: การ์ดส่งงานเปิดใช้ → สั่งงานใหม่ → ได้รหัสงาน + ข้อความแจ้งนักศึกษา (ลิงก์ที่ใส่รหัสให้แล้ว)')
def _():
    cid = world()
    c = teacher()
    c.login_as(T1, 'อ.หนึ่ง', to='/t/course.html?id=' + cid)
    p = c.page
    p.wait_for_selector('#goAsg')
    p.click('#goAsg')
    p.wait_for_url('**/t/asg.html?id=*')
    p.wait_for_selector('#empty')
    p.click('#newBtn')
    p.fill('#fT', 'รายงานแล็บ 1')
    p.fill('#fD', 'ส่งเป็น PDF')
    p.fill('#fM', '20')
    p.fill('#fDue', '2030-01-10T17:00')
    p.check('#fLate')
    p.click('#eSave')
    p.wait_for_selector('#mMsg:not([hidden])')
    txt = p.input_value('#msgTxt')
    a = rows_of('Assignments')
    assert len(a) == 1 and a[0][2] in txt, (a, txt)
    assert '/s/submit.html?t=' in txt and 'c=' + a[0][2] in txt and 'รหัสงาน' in txt, txt
    assert a[0][3] == 'รายงานแล็บ 1' and str(a[0][6]) == '20' and a[0][7] == '2030-01-10 17:00:00' and a[0][8] == 'TRUE', a
    p.click('#mMsg [data-close]')
    p.wait_for_selector('#list [data-asg]')
    assert 'ส่งแล้ว 0 / 4' in p.inner_text('#list') and a[0][2] in p.inner_text('#list')
    assert len(live_files()) == 0 and any(f['name'].startswith('BIO101-1_') for f in drive()['folders'])
    # ปุ่มแจ้งนักศึกษาเปิดข้อความเดิมได้อีก
    p.click('[data-msg]'); p.wait_for_selector('#mMsg:not([hidden])')
    assert a[0][2] in p.input_value('#msgTxt')
    no_errors(c)
    c.close()


@case('แก้ไขงาน: เปลี่ยนชื่อ/คะแนนเต็ม · งานที่มีคนส่งแล้วเปลี่ยนเดี่ยว↔กลุ่มไม่ได้ (ปุ่มถูกล็อก) · ค่าผิด (ชื่อว่าง) แจ้งในฟอร์ม')
def _():
    cid = world()
    a = mk_asg(cid)
    s = student()
    s.page.goto(BASE + link(a)); stu_login(s)
    s.page.wait_for_selector('#pick')
    upload(s.page, 'a.pdf', pdf())
    s.page.wait_for_selector('#files [data-fid]')
    s.close()
    c = teacher()
    c.login_as(T1, 'อ.หนึ่ง', to='/t/asg.html?id=' + cid)
    p = c.page
    p.wait_for_selector('[data-edit]')
    p.click('[data-edit]')
    p.wait_for_function("document.getElementById('kNote') && document.getElementById('kNote').innerText.indexOf('เปลี่ยนประเภทงานไม่ได้')>=0")
    assert p.is_disabled('input[name=fK][value=group]') and 'เปลี่ยนประเภทงานไม่ได้' in p.inner_text('#kNote')
    p.fill('#fT', '')
    p.click('#eSave')
    p.wait_for_function("document.getElementById('eErr').innerText.trim()!==''")
    assert 'กรุณากรอกชื่องาน' in p.inner_text('#eErr'), p.inner_text('#eErr')
    p.fill('#fT', 'ชื่อใหม่'); p.fill('#fM', '30')
    p.click('#eSave')
    p.wait_for_function("document.querySelector('#list').innerText.indexOf('ชื่อใหม่')>=0")
    assert rows_of('Assignments')[0][3] == 'ชื่อใหม่' and str(rows_of('Assignments')[0][6]) == '30'
    t = seed(T1, 'score.types', {'courseId': cid})['types']
    assert [x['name'] for x in t if x['source'] == 'ASSIGN'] == ['ชื่อใหม่']
    c.close()


# ---------------------------------------------------------------------------------------------
print('\nนักศึกษา: เข้าลิงก์ · PIN · ส่งไฟล์')


@case('ลิงก์ถาวรพร้อมรหัส: เข้า → เห็นงาน → เลือกชื่อ + PIN → หน้างาน (รายละเอียด/กำหนดส่ง) → อัปโหลด pdf → ขึ้นรายการ + ขึ้น Drive + ครูเห็นว่าส่งแล้ว')
def _():
    cid = world()
    a = mk_asg(cid, dueAt='2030-01-10 17:00', lateOk=True, linkUrl='https://example.com/spec')
    s = student()
    p = s.page
    p.goto(BASE + link(a))
    p.wait_for_selector('#loginCard')
    assert 'รายงานแล็บ 1' in p.inner_text('#hTitle') and 'BIO101' in p.inner_text('#taskHint')
    stu_login(s)
    p.wait_for_selector('#taskCard')
    assert 'รายงานแล็บ 1' in p.inner_text('#hTitle') and 'บรรทัดสอง' in p.inner_text('#desc')
    assert '2573' in p.inner_text('#dueLine') and '10 ม.ค.' in p.inner_text('#dueLine')      # พ.ศ.
    assert p.get_attribute('#taskCard a[href^="https://example.com"]', 'rel') == 'noopener noreferrer'
    assert 'ยังไม่ได้ส่ง' in p.inner_text('#stBanner')
    upload(p, 'รายงาน.pdf', pdf(3000))
    p.wait_for_selector('#files [data-fid]')
    assert 'รายงาน.pdf' in p.inner_text('#files') and 'ไฟล์ 1 / 5' in p.inner_text('#cnt')
    assert 'ส่งแล้ว' in p.inner_text('#stBanner')
    lf = live_files()
    assert len(lf) == 1 and lf[0]['size'] == 3000 and lf[0]['head'] == '25504446' and lf[0]['name'].endswith('รายงาน.pdf'), lf
    t = teacher()
    t.login_as(T1, 'อ.หนึ่ง', to='/t/asg-detail.html?a=' + a['asgId'])
    t.page.wait_for_selector('#subTbl')
    assert t.page.inner_text('#cSub') == '1' and t.page.inner_text('#cTo') == '1'
    assert 'ส่งแล้ว' in t.page.inner_text('tr[data-u$="660001"]') or 'ส่งแล้ว' in t.page.inner_text('#subTbl')
    no_errors(s); no_errors(t)
    s.close(); t.close()


@case('เข้าด้วยมือ: หน้าส่งงานเปล่า → เลือกอาจารย์ + พิมพ์รหัสตัวพิมพ์เล็กไม่มีขีด → พบงาน · รหัสผิด/อาจารย์ผิด = ข้อความไม่พบ')
def _():
    cid = world()
    a = mk_asg(cid)
    s = student()
    p = s.page
    p.goto(BASE + '/s/submit.html')
    p.wait_for_selector('#selT option[value="%s"]' % a['tid'], state='attached')
    p.select_option('#selT', a['tid'])
    p.fill('#code', 'zzz-zzz')
    p.click('#fgo')
    p.wait_for_function("document.getElementById('ferr').textContent.indexOf('ไม่พบงานนี้')>=0")
    p.fill('#code', a['code'].lower().replace('-', ''))
    assert p.input_value('#code') == a['code'].replace('-', '')
    p.click('#fgo')
    p.wait_for_selector('#loginCard')
    assert 'รายงานแล็บ 1' in p.inner_text('#hTitle')
    p.click('#other')
    p.wait_for_selector('#findCard')
    p.goto(BASE + '/s/submit.html?t=wrongtid&c=' + a['code'])
    p.wait_for_function("document.getElementById('ferr') && document.getElementById('ferr').textContent.indexOf('ไม่พบงานนี้')>=0")
    s.close()


@case('PIN: ผิด → แจ้ง ไม่เข้า · ผิดครบกำหนด → ล็อก · ยังไม่ตั้ง PIN → ข้อความพร้อมลิงก์ไปหน้าตั้ง PIN · ไม่เลือกชื่อ/PIN ไม่ครบ → เตือนฝั่งหน้าเว็บ')
def _():
    cid = world()
    seed(T1, 'student.add', {'courseId': cid, 'stdId': '660099', 'name': 'ไม่มี PIN'})
    a = mk_asg(cid)
    s = student()
    p = s.page
    p.goto(BASE + link(a)); p.wait_for_selector('#lgo')
    p.click('#lgo'); assert 'เลือกชื่อ' in p.inner_text('#lerr')
    p.fill('#lq', '660001'); p.wait_for_function("document.getElementById('lsel').value==='660001'")
    p.click('#lgo'); assert 'ตัวเลข 4 หลัก' in p.inner_text('#lerr')
    for i in range(2):
        p.fill('#lpin', '9999'); p.click('#lgo')
        p.wait_for_function("document.getElementById('lerr').textContent.indexOf('PIN ไม่ถูกต้อง')>=0")
    assert p.input_value('#lpin') == '' and p.locator('#taskCard').count() == 0
    p.fill('#lq', '660099'); p.wait_for_function("document.getElementById('lsel').value==='660099'")
    p.fill('#lpin', '1234'); p.click('#lgo')
    p.wait_for_function("document.getElementById('lerr').textContent.indexOf('ยังไม่ได้ตั้ง PIN')>=0")
    assert p.locator('#lerr a[href$="s/pin.html"]').count() == 1
    p.fill('#lq', '660002'); p.wait_for_function("document.getElementById('lsel').value==='660002'")
    for i in range(5):
        p.fill('#lpin', '0000'); p.click('#lgo'); p.wait_for_function("document.getElementById('lpin').value===''")
    p.wait_for_function("document.getElementById('lerr').textContent.indexOf('ล็อก')>=0")
    p.fill('#lpin', PIN); p.click('#lgo')
    p.wait_for_function("document.getElementById('lerr').textContent.indexOf('ล็อก')>=0")
    assert p.locator('#taskCard').count() == 0
    s.close()


@case('ตรวจไฟล์ก่อนส่ง: ชนิดต้องห้าม/เนื้อไม่ตรงชนิด/เกินจำนวน → แจ้งรายไฟล์ ไม่ขึ้น Drive · ลบไฟล์ได้ · ข้อความ+ลิงก์บันทึกได้ ลิงก์ผิดรูปแบบถูกปฏิเสธ')
def _():
    cid = world()
    seed(ADMIN, 'settings.set', {'changes': {'file_max_count': 2}})
    a = mk_asg(cid)
    s = student()
    p = s.page
    p.goto(BASE + link(a)); stu_login(s); p.wait_for_selector('#pick')
    p.set_input_files('#pick', [
        {'name': 'virus.exe', 'mimeType': 'application/octet-stream', 'buffer': b'MZ' + b'0' * 50},
        {'name': 'fake.pdf', 'mimeType': 'application/pdf', 'buffer': b'\x89PNG\r\n\x1a\n' + b'0' * 50},
        {'name': 'a.pdf', 'mimeType': 'application/pdf', 'buffer': pdf(500, b'A')},
        {'name': 'b.pdf', 'mimeType': 'application/pdf', 'buffer': pdf(600, b'B')},
        {'name': 'c.pdf', 'mimeType': 'application/pdf', 'buffer': pdf(700, b'C')},
    ])
    p.wait_for_function("document.querySelectorAll('#files [data-fid]').length===2")
    log = p.inner_text('#log')
    assert 'virus.exe' in log and 'ชนิดไฟล์ไม่รับ' in log and 'fake.pdf' in log and 'ไม่ตรงชนิด' in log and 'c.pdf' in log and 'ครบ 2 ไฟล์' in log, log
    assert len(live_files()) == 2 and len(rows_of('AsgFiles')) == 2
    assert p.is_disabled('#pick') and 'ครบจำนวนแล้ว' in p.inner_text('#subCard')
    p.click('[data-rm]')
    p.wait_for_function("document.querySelectorAll('#files [data-fid]').length===1")
    assert len(live_files()) == 1 and len([f for f in drive()['files'] if f['trashed']]) == 1
    p.fill('#note', 'ส่งแล้วครับ'); p.fill('#link', 'ftp://bad'); p.click('#nsave')
    assert 'http' in p.inner_text('#nerr')
    p.fill('#link', 'https://drive.google.com/file/x'); p.click('#nsave')
    p.wait_for_function("document.querySelector('#nsave') && !document.querySelector('#nsave').disabled")
    sub = rows_of('AsgSubs')
    assert len(sub) == 1 and sub[0][5] == 'ส่งแล้วครับ' and sub[0][6] == 'https://drive.google.com/file/x', sub
    p.reload()       # เปิดหน้าใหม่ → เซสชันยังอยู่ (sessionStorage) → เข้าหน้างานเลยไม่ต้องใส่ PIN
    p.wait_for_selector('#taskCard')
    assert p.input_value('#note') == 'ส่งแล้วครับ' and 'drive.google.com' in p.input_value('#link')
    no_errors(s)
    s.close()


@case('รูปถ่ายใหญ่ (PNG ~9 MB เกินขีดจำกัด 5 MB): เบราว์เซอร์ย่อเป็น JPEG ให้อัตโนมัติ แล้วอัปโหลดผ่าน')
def _():
    cid = world()
    a = mk_asg(cid)
    s = student()
    p = s.page
    p.goto(BASE + link(a)); stu_login(s); p.wait_for_selector('#pick')
    big = png_noise(1800, 1800)
    assert len(big) > 5 * 1024 * 1024
    upload(p, 'photo.png', big, 'image/png')
    p.wait_for_selector('#files [data-fid]', timeout=60000)
    lf = live_files()
    assert len(lf) == 1 and lf[0]['head'].startswith('ffd8ff') and lf[0]['size'] <= 5 * 1024 * 1024 and lf[0]['name'].endswith('photo.jpg'), lf
    assert 'photo.jpg' in p.inner_text('#files')
    no_errors(s)
    s.close()


@case('ปิดรับ/ส่งช้า/ตรวจแล้ว: เลยกำหนด (รับช้า) → เตือน+ส่งได้+ติดป้ายช้า · เลยวันปิด → ส่งไม่ได้ · ให้คะแนนแล้ว → แก้ไม่ได้ เห็นคะแนน+ความเห็น')
def _():
    cid = world()
    import datetime
    now = datetime.datetime.now()
    due = (now + datetime.timedelta(minutes=10)).strftime('%Y-%m-%d %H:%M')
    close = (now + datetime.timedelta(minutes=40)).strftime('%Y-%m-%d %H:%M')
    a = mk_asg(cid, dueAt=due, closeAt=close, lateOk=True)
    s = student()
    p = s.page
    p.goto(BASE + link(a)); stu_login(s); p.wait_for_selector('#pick')
    assert 'เปิดรับ' in p.inner_text('#taskCard')
    post('/__advance', {'min': 15})
    p.goto(BASE + link(a)); p.wait_for_selector('#pick')            # เซสชันยังอยู่ (ไม่ถึง 2 ชม.)
    assert 'เลยกำหนดส่งแล้ว' in p.inner_text('#stBanner') and 'ส่งช้า' in p.inner_text('#stBanner')
    upload(p, 'late.pdf', pdf(900))
    p.wait_for_selector('#files [data-fid]')
    assert 'ส่งช้า' in p.inner_text('#stBanner')
    assert [u for u in seed(T1, 'asg.submissions', {'asgId': a['asgId']})['units'] if u['submitted']][0]['late'] is True
    post('/__advance', {'min': 30})
    p.reload(); p.wait_for_selector('#whyNot')
    assert 'ปิดรับ' in p.inner_text('#stBanner') and 'ปิดรับแล้ว' in p.inner_text('#whyNot') and p.locator('#pick').count() == 0
    assert 'late.pdf' in p.inner_text('#files') and p.locator('[data-rm]').count() == 0
    seed(T1, 'asg.setStatus', {'asgId': a['asgId'], 'closed': False})
    seed(T1, 'asg.save', {'asgId': a['asgId'], 'closeAt': '2031-01-01 10:00'})
    seed(T1, 'asg.grade', {'asgId': a['asgId'], 'grades': [{'stdId': '660001', 'score': 8.5, 'feedback': 'ดีมาก แก้ตรงสรุป'}]})
    p.reload(); p.wait_for_selector('#whyNot')
    assert 'ตรวจแล้ว' in p.inner_text('#stBanner') and '8.5' in p.inner_text('#stBanner') and 'ดีมาก' in p.inner_text('#stBanner')
    assert 'ตรวจและให้คะแนนแล้ว' in p.inner_text('#whyNot') and p.locator('#pick').count() == 0
    s.close()


@case('หมดเวลา 2 ชม. กลางทาง: ทำรายการต่อ → กลับไปหน้าใส่ PIN พร้อมข้อความ (ไม่ย้ายไปหน้าอาจารย์) · ใส่ PIN แล้วกลับมาที่งานเดิม')
def _():
    cid = world()
    a = mk_asg(cid)
    s = student()
    p = s.page
    p.goto(BASE + link(a)); stu_login(s); p.wait_for_selector('#pick')
    post('/__advance', {'min': 125})
    p.fill('#note', 'หลังหมดเวลา'); p.click('#nsave')
    p.wait_for_selector('#lmsg')
    assert 'หมดเวลา' in p.inner_text('#lmsg') and '/t/login' not in p.url
    stu_login(s)
    p.wait_for_selector('#taskCard')
    assert 'รายงานแล็บ 1' in p.inner_text('#hTitle')
    s.close()


# ---------------------------------------------------------------------------------------------
print('\nอาจารย์: ตรวจงาน · ดาวน์โหลด · ให้คะแนน')


@case('ตรวจงานเดี่ยว: ตารางรายการ + ตัวกรอง → เปิดดูไฟล์/ข้อความ → ดาวน์โหลดไบต์ตรง → ให้คะแนน+ความเห็น → ขึ้นตารางคะแนน · ล้างคะแนนได้')
def _():
    cid = world()
    a = mk_asg(cid, maxScore=10)
    data = pdf(1500, b'HELLO')
    s = student()
    s.page.goto(BASE + link(a)); stu_login(s, '660002'); s.page.wait_for_selector('#pick')
    upload(s.page, 'ผลแล็บ.pdf', data); s.page.wait_for_selector('#files [data-fid]')
    s.page.fill('#note', 'ดูไฟล์แนบ'); s.page.click('#nsave')
    s.page.wait_for_function("document.querySelector('#nsave') && !document.querySelector('#nsave').disabled")
    s.close()
    c = teacher()
    c.login_as(T1, 'อ.หนึ่ง', to='/t/asg-detail.html?a=' + a['asgId'])
    p = c.page
    p.wait_for_selector('#subTbl')
    assert p.inner_text('#cTotal') == '4' and p.inner_text('#cSub') == '1'
    p.click('[data-f=none]'); assert p.locator('#subTbl tbody tr').count() == 3
    p.click('[data-f=toGrade]'); assert p.locator('#subTbl tbody tr').count() == 1
    p.click('[data-f=all]')
    p.fill('#sq', 'นักศึกษา 2'); assert p.locator('#subTbl tbody tr').count() == 1
    p.click('[data-open="%s|660002"]' % a['asgId'])
    p.wait_for_selector('#mUnit:not([hidden]) #uFiles')
    assert 'ดูไฟล์แนบ' in p.inner_text('#uNote') and 'ผลแล็บ.pdf' in p.inner_text('#uFiles')
    with p.expect_download() as d:
        p.click('[data-dl]')
    path = d.value.path()
    assert open(path, 'rb').read() == data and d.value.suggested_filename == 'ผลแล็บ.pdf'
    p.fill('#gScore', '11'); p.click('#gSave')
    assert 'ตัวเลข 0–10' in p.inner_text('#gErr')
    p.fill('#gScore', '9.5'); p.fill('#gFb', 'ดีมาก'); p.click('#gSave')
    p.wait_for_function("document.getElementById('mUnit').hidden")
    p.wait_for_function("document.getElementById('cGr').textContent==='1'")
    g = rows_of('AsgGrades')
    assert len(g) == 1 and str(g[0][4]) == '9.5' and g[0][5] == 'ดีมาก', g
    tb = seed(T1, 'score.table', {'courseId': cid})
    ty = [t for t in tb['types'] if t['source'] == 'ASSIGN'][0]
    assert [s_ for s_ in tb['students'] if s_['stdId'] == '660002'][0]['scores'][ty['typeId']] == 9.5
    # ล้างคะแนน
    p.fill('#sq', '660002'); p.click('[data-open]')
    p.wait_for_selector('#mUnit:not([hidden]) #gClear')
    p.click('#gClear')
    p.wait_for_function("document.getElementById('cGr').textContent==='0'")
    assert rows_of('AsgGrades') == []
    # CSV
    with p.expect_download() as d:
        p.click('#csvBtn')
    txt = open(d.value.path(), encoding='utf-8-sig').read()
    assert '660002' in txt and 'ส่งแล้ว' in txt and 'ดูไฟล์แนบ' in txt, txt
    no_errors(c)
    c.close()


@case('งานกลุ่ม: ตัวแทนสร้างกลุ่ม+เลือกเพื่อน → เพื่อนเห็นกลุ่ม ส่งไม่ได้ → ตัวแทนส่ง → อาจารย์ให้คะแนนทั้งกลุ่ม / แยกรายคน → ทุกคนเห็นคะแนน · ล็อกการแก้')
def _():
    cid = world(5)
    a = mk_asg(cid, kind='group', maxGroup=3, title='โครงงานกลุ่ม')
    r = student()
    p = r.page
    p.goto(BASE + link(a)); stu_login(r, '660001'); p.wait_for_selector('#groupCard')
    assert 'ยังไม่มีกลุ่ม' in p.inner_text('#whyNot') or 'ต้องมีกลุ่ม' in p.inner_text('#whyNot')
    p.fill('#gname', 'ทีมเอ')
    p.fill('#gq', '660002')
    assert p.locator('#gList label:visible').count() == 1
    p.check('#gList input[value="660002"]'); p.fill('#gq', ''); p.check('#gList input[value="660003"]')
    assert 'รวมคุณเป็น 3 / 3' in p.inner_text('#gCount')
    p.check('#gList input[value="660004"]')
    p.click('#gmk')
    assert 'ไม่เกิน 3 คน' in p.inner_text('#gerr')
    p.uncheck('#gList input[value="660004"]')
    p.click('#gmk')
    p.wait_for_selector('#gMembers')
    assert 'ทีมเอ' in p.inner_text('#gName') and 'คุณเป็นตัวแทน' in p.inner_text('#groupCard') and p.locator('#gMembers li').count() == 3
    assert len(rows_of('AsgMembers')) == 3
    # เพื่อน (สมาชิก) เห็นกลุ่ม แต่ส่งไม่ได้
    m = student()
    m.page.goto(BASE + link(a)); stu_login(m, '660002'); m.page.wait_for_selector('#gMembers')
    assert 'สมาชิก' in m.page.inner_text('#groupCard') and 'ตัวแทนกลุ่ม' in m.page.inner_text('#groupCard')
    assert 'เฉพาะตัวแทน' in m.page.inner_text('#whyNot') and m.page.locator('#pick').count() == 0 and m.page.locator('#gedit').count() == 0
    # คนที่ 4 ไม่เห็นเพื่อนที่มีกลุ่มแล้วในรายชื่อเลือก
    o = student()
    o.page.goto(BASE + link(a)); stu_login(o, '660004'); o.page.wait_for_selector('#gmk')
    vals = o.page.eval_on_selector_all('#gList input', 'els => els.map(e => e.value)')
    assert sorted(vals) == ['660005'], vals
    o.close()
    # ตัวแทนส่งงาน
    p.wait_for_selector('#pick'); upload(p, 'proj.pdf', pdf(1200)); p.wait_for_selector('#files [data-fid]')
    m.page.reload(); m.page.wait_for_selector('#files [data-fid]')
    assert 'proj.pdf' in m.page.inner_text('#files') and 'ส่งแล้ว' in m.page.inner_text('#stBanner')
    # อาจารย์
    t = teacher()
    t.login_as(T1, 'อ.หนึ่ง', to='/t/asg-detail.html?a=' + a['asgId'])
    tp = t.page
    tp.wait_for_selector('#subTbl')
    assert tp.inner_text('#cTotal') == '1' and 'ยังไม่มีกลุ่ม 2 คน' in tp.inner_text('#ungrp')
    tp.click('[data-open]')
    tp.wait_for_selector('#gMem', state='attached')
    assert tp.locator('#gMem [data-m]').count() == 3 and tp.is_hidden('#gMem')
    tp.fill('#gScore', '8'); tp.fill('#gFb', 'ทำได้ดี'); tp.click('#gSave')
    tp.wait_for_function("document.getElementById('cGr').textContent==='1'")
    assert sorted(str(g[4]) for g in rows_of('AsgGrades')) == ['8', '8', '8'], rows_of('AsgGrades')
    # รายคน: คนที่ 3 ต่างจากเพื่อน
    tp.click('[data-open]'); tp.wait_for_selector('#mUnit:not([hidden]) #gEach')
    assert not tp.is_checked('#gEach')
    tp.check('#gEach'); tp.fill('#gMem [data-m="660003"] input', '5'); tp.click('#gSave')
    tp.wait_for_function("document.getElementById('mUnit').hidden")
    tp.wait_for_function("document.querySelector('#subTbl').innerText.indexOf('ต่างกัน')>=0")
    scores = {str(g[3]): str(g[4]) for g in rows_of('AsgGrades')}
    assert scores == {'660001': '8', '660002': '8', '660003': '5'}, scores
    # นักศึกษาเห็นคะแนนของตัวเอง + แก้ไม่ได้
    m.page.reload(); m.page.wait_for_selector('#whyNot')
    assert 'คะแนน' in m.page.inner_text('#stBanner') and '8' in m.page.inner_text('#stBanner')
    p.reload(); p.wait_for_selector('#whyNot')
    assert 'ตรวจและให้คะแนนแล้ว' in p.inner_text('#whyNot') and p.locator('#gedit').count() == 0
    no_errors(t); no_errors(m); no_errors(r)
    r.close(); m.close(); t.close()


@case('งานของฉัน: เลือกอาจารย์→วิชา→ชื่อ+PIN → รายการงานพร้อมสถานะ (ยังไม่ส่ง/ส่งแล้ว/ตรวจแล้ว+คะแนน/ปิดรับ/ยังไม่มีกลุ่ม) → กดเข้าหน้าส่งงานได้เลยไม่ต้องใส่ PIN ซ้ำ')
def _():
    cid = world()
    a1 = mk_asg(cid, title='งานเดี่ยว 1')
    a2 = mk_asg(cid, title='งานเดี่ยว 2')
    a3 = mk_asg(cid, title='งานกลุ่ม', kind='group')
    a4 = mk_asg(cid, title='งานปิดแล้ว')
    seed(T1, 'asg.setStatus', {'asgId': a4['asgId'], 'closed': True})
    seed(T1, 'asg.grade', {'asgId': a2['asgId'], 'grades': [{'stdId': '660001', 'score': 7}]})
    s = student()
    p = s.page
    p.goto(BASE + link(a1)); stu_login(s); p.wait_for_selector('#pick')
    upload(p, 'a.pdf', pdf()); p.wait_for_selector('#files [data-fid]')
    s.close()
    s = student()
    p = s.page
    p.goto(BASE + '/s/tasks.html')
    p.wait_for_selector('#selT option[value="%s"]' % a1['tid'], state='attached')
    p.select_option('#selT', a1['tid'])
    p.wait_for_function("document.getElementById('selC').options.length>1")
    p.select_option('#selC', cid)
    stu_login(s)
    p.wait_for_selector('#tlist')
    cards = {c.get_attribute('data-code'): c.inner_text() for c in p.locator('#tlist [data-code]').all()}
    assert 'ส่งแล้ว' in cards[a1['code']] and 'ตรวจแล้ว' in cards[a2['code']] and '7/10' in cards[a2['code']], cards
    assert 'ยังไม่มีกลุ่ม' in cards[a3['code']] and 'ปิดรับ' in cards[a4['code']], cards
    assert 'ยังไม่ได้ส่ง' in p.inner_text('#todo')
    p.click('#tlist [data-code="%s"]' % a3['code'])
    p.wait_for_selector('#taskCard')               # เข้าหน้างานเลย (มีเซสชันแล้ว)
    assert 'งานกลุ่ม' in p.inner_text('#hTitle') and p.locator('#loginCard').count() == 0
    no_errors(s)
    s.close()


@case('งานของฉัน: งานค้างขึ้นก่อนเรียงตามกำหนดส่ง · มีปุ่ม "ส่งงาน" บนงานค้าง · กล่องเตือนกดไปงานที่ใกล้กำหนดที่สุดได้ทันที · งานที่ส่งแล้วไม่มีปุ่ม')
def _():
    import datetime
    cid = world()
    f = lambda d: (datetime.datetime.now() + datetime.timedelta(days=d)).strftime('%Y-%m-%d %H:%M')
    far = mk_asg(cid, title='ไกล', dueAt=f(9))
    near = mk_asg(cid, title='ใกล้', dueAt=f(2))
    done = mk_asg(cid, title='ส่งแล้ว', dueAt=f(1))
    late = mk_asg(cid, title='เลยกำหนด', dueAt=f(-1), lateOk=True)
    s = student(); p = s.page
    p.goto(BASE + link(done)); stu_login(s); p.wait_for_selector('#pick')
    upload(p, 'a.pdf', pdf()); p.wait_for_selector('#files [data-fid]')
    p.goto(BASE + '/s/tasks.html'); p.wait_for_selector('#tlist')
    codes = [c.get_attribute('data-code') for c in p.locator('#tlist [data-code]').all()]
    assert codes == [late['code'], near['code'], far['code'], done['code']], codes          # เลยกำหนดก่อน → ใกล้ → ไกล → ส่งแล้ว
    assert p.locator('#tlist [data-code="%s"] [data-go]' % near['code']).inner_text().startswith('ส่งงาน')
    assert 'รับช้า' in p.locator('#tlist [data-code="%s"] [data-go]' % late['code']).inner_text()
    assert p.locator('#tlist [data-code="%s"] [data-go]' % done['code']).count() == 0
    assert 'ยังไม่ได้ส่ง 3 งาน' in p.inner_text('#todo') and 'เลยกำหนด' in p.inner_text('#todo')
    p.click('#todo')
    p.wait_for_selector('#taskCard')
    assert 'เลยกำหนด' in p.inner_text('#hTitle')
    p.go_back(); p.wait_for_selector('#tlist')
    p.click('#tlist [data-code="%s"] [data-go]' % near['code'])
    p.wait_for_selector('#taskCard'); assert 'ใกล้' in p.inner_text('#hTitle')
    no_errors(s); s.close()


@case('ปิด/เปิดรับ และลบงาน (ต้องพิมพ์ชื่อยืนยัน): ปิดแล้วนักศึกษาส่งไม่ได้ · ลบแล้วไฟล์ลงถังขยะ Drive แถวหาย คะแนนหายจากตาราง')
def _():
    cid = world()
    a = mk_asg(cid)
    keep = mk_asg(cid, title='งานอื่น')
    s = student()
    s.page.goto(BASE + link(a)); stu_login(s); s.page.wait_for_selector('#pick')
    upload(s.page, 'a.pdf', pdf()); s.page.wait_for_selector('#files [data-fid]')
    s.close()
    seed(T1, 'asg.grade', {'asgId': a['asgId'], 'grades': [{'stdId': '660001', 'score': 5}]})
    c = teacher()
    c.login_as(T1, 'อ.หนึ่ง', to='/t/asg-detail.html?a=' + a['asgId'])
    p = c.page
    p.wait_for_selector('#togBtn')
    p.click('#togBtn')
    p.wait_for_function("document.getElementById('phase').textContent.indexOf('ปิดรับ')>=0")
    assert rows_of('Assignments')[0][10] == 'closed'
    p.click('#togBtn')
    p.wait_for_function("document.getElementById('phase').textContent==='เปิดรับ'")
    p.click('#delBtn'); p.wait_for_selector('#mDel:not([hidden])')
    assert 'ไฟล์ 1 ไฟล์' in p.inner_text('#dWarn')
    p.fill('#dConfirm', 'ผิด'); p.click('#dGo')
    assert 'ไม่ตรง' in p.inner_text('#dErr')
    p.fill('#dConfirm', 'รายงานแล็บ 1'); p.click('#dGo')
    p.wait_for_url('**/t/asg.html?id=*')
    p.wait_for_selector('#list [data-asg]')
    assert len(rows_of('Assignments')) == 1 and rows_of('Assignments')[0][0] == keep['asgId']
    assert rows_of('AsgFiles') == [] and rows_of('AsgGrades') == [] and rows_of('AsgSubs') == []
    assert len(live_files()) == 0 and len([f for f in drive()['files'] if f['trashed']]) == 1
    tb = seed(T1, 'score.table', {'courseId': cid})
    assert [t['name'] for t in tb['types'] if t['source'] == 'ASSIGN'] == ['งานอื่น']
    c.close()


@case('สิทธิ์ในหน้าเว็บ: อาจารย์ที่ไม่มีสิทธิ์ระบบส่งงาน/เปิดงานของวิชาคนอื่น → ข้อความไม่มีสิทธิ์/ไม่พบ · เมนู “ส่งงาน” เปิดใช้ตามสิทธิ์')
def _():
    cid = world()
    a = mk_asg(cid)
    c = teacher()
    c.login_as(T2, 'อ.สอง', to='/t/home.html')
    c.page.wait_for_selector('#sysCards')
    assert c.page.locator('#sysCards [data-sys=asg].sys-off').count() == 1
    c.page.goto(BASE + '/t/asg.html?id=' + cid)
    c.page.wait_for_selector('.callout.bad')
    assert 'ไม่มีสิทธิ์' in c.page.inner_text('.callout.bad')
    c.close()
    seed(ADMIN, 'user.upsert', {'email': T2, 'name': 'อ.สอง', 'systems': ['att', 'asg']})
    c = teacher()
    c.login_as(T2, 'อ.สอง', to='/t/asg-detail.html?a=' + a['asgId'])
    c.page.wait_for_selector('.callout.bad')
    assert 'ไม่พบงานนี้' in c.page.inner_text('.callout.bad')
    c.page.goto(BASE + '/t/asg.html?id=' + cid)
    c.page.wait_for_selector('.callout.bad')
    assert 'ไม่พบรายวิชานี้' in c.page.inner_text('.callout.bad')
    c.close()
    c = teacher()
    c.login_as(T1, 'อ.หนึ่ง', to='/t/home.html')
    c.page.wait_for_selector('#sysCards')
    assert c.page.locator('#sysCards a[data-sys=asg]').count() == 1 and c.page.locator('#side a', has_text='ส่งงาน').count() == 1
    c.close()


@case('XSS: ชื่องาน/คำสั่ง/ชื่อกลุ่ม/ข้อความ/ชื่อไฟล์ ที่มี HTML ถูก escape ทุกหน้า (ไม่มี script ทำงาน)')
def _():
    cid = world()
    evil = '<img src=x onerror="window.__x=1">'
    a = mk_asg(cid, title='T' + evil, description='D' + evil, kind='group')
    s = student()
    p = s.page
    p.goto(BASE + link(a)); stu_login(s); p.wait_for_selector('#groupCard')
    p.fill('#gname', 'G' + evil); p.click('#gmk'); p.wait_for_selector('#gMembers')
    p.wait_for_selector('#pick')
    upload(p, 'f' + evil.replace('"', '').replace('<', '(').replace('>', ')') + '.pdf', pdf())
    p.wait_for_selector('#files [data-fid]')
    p.fill('#note', 'N' + evil); p.click('#nsave')
    p.wait_for_function("document.querySelector('#nsave') && !document.querySelector('#nsave').disabled")
    p.reload(); p.wait_for_selector('#taskCard')
    assert p.evaluate('window.__x') is None and p.locator('#taskCard img').count() == 0 and p.locator('#groupCard img').count() == 0
    t = teacher()
    t.login_as(T1, 'อ.หนึ่ง', to='/t/asg-detail.html?a=' + a['asgId'])
    t.page.wait_for_selector('#subTbl')
    t.page.click('[data-open]'); t.page.wait_for_selector('#uNote')
    assert t.page.evaluate('window.__x') is None and t.page.locator('#box img, #uBody img').count() == 0
    t.page.goto(BASE + '/t/asg.html?id=' + cid); t.page.wait_for_selector('#list')
    assert t.page.evaluate('window.__x') is None and t.page.locator('#list img').count() == 0
    no_errors(s); no_errors(t)
    s.close(); t.close()


@case('มือถือ 360px: หน้าส่งงาน(หน้างาน/กลุ่ม) · งานของฉัน · รายการงาน · ตรวจงาน ไม่มีเลื่อนแนวนอนทั้งหน้า')
def _():
    cid = world()
    a = mk_asg(cid, kind='group', title='ชื่องานยาวมากๆ ' * 4)
    g = mk_asg(cid, title='เดี่ยว')
    s = student(viewport=(360, 740))
    p = s.page
    p.goto(BASE + '/s/submit.html'); p.wait_for_selector('#findCard')
    assert s.overflow() <= 0, ('find', s.overflow())
    p.goto(BASE + link(a)); p.wait_for_selector('#loginCard')
    assert s.overflow() <= 0, ('login', s.overflow())
    stu_login(s); p.wait_for_selector('#groupCard')
    assert s.overflow() <= 0, ('task', s.overflow())
    s.shot('asg-student-task')
    p.goto(BASE + '/s/tasks.html'); p.wait_for_selector('#tlist')
    assert s.overflow() <= 0, ('tasks', s.overflow())
    s.close()
    t = teacher(viewport=(360, 740))
    t.login_as(T1, 'อ.หนึ่ง', to='/t/asg.html?id=' + cid)
    t.page.wait_for_selector('#list')
    assert t.overflow() <= 0, ('asg', t.overflow())
    t.shot('asg-list-m')
    t.page.goto(BASE + '/t/asg-detail.html?a=' + g['asgId']); t.page.wait_for_selector('#subTbl')
    assert t.overflow() <= 0, ('detail', t.overflow())
    t.shot('asg-detail-m')
    t.page.click('[data-open]'); t.page.wait_for_selector('#gSave')
    t.shot('asg-grade-m')
    no_errors(t)
    t.close()

@case('งานของฉัน → กดส่งงาน เปิดหน้าส่งงานได้แม้เซสชันไม่มีรหัสอาจารย์ (เช่น ล็อกอินมาจากลิงก์ข้อสอบ)')
def _():
    cid = world()
    a = mk_asg(cid, title='งานจากลิงก์ข้อสอบ')
    s = student(); p = s.page
    p.goto(BASE + '/s/tasks.html')
    p.wait_for_selector('#selT option[value="%s"]' % a['tid'], state='attached')
    p.select_option('#selT', a['tid'])
    p.wait_for_function("document.getElementById('selC').options.length>1")
    p.select_option('#selC', cid)
    stu_login(s)
    p.wait_for_selector('#tlist [data-code]')
    # จำลองเซสชันที่ไม่มีรหัสอาจารย์ (หน้าสอบสร้างเซสชันแบบนี้) แล้วเข้าหน้างานของฉันใหม่
    p.evaluate("()=>{var k='hbt.stu',v=JSON.parse(sessionStorage.getItem(k));v.tid='';sessionStorage.setItem(k,JSON.stringify(v));}")
    try: p.evaluate("()=>localStorage.removeItem('hbt.asg.tid')")
    except Exception: pass
    p.goto(BASE + '/s/tasks.html'); p.wait_for_selector('#tlist [data-code]')
    href = p.get_attribute('#tlist [data-code="%s"]' % a['code'], 'href')
    assert '?a=' in href, href
    p.click('#tlist [data-code="%s"] [data-go]' % a['code'])
    p.wait_for_selector('#taskCard')                       # เข้าหน้างานจริง ไม่ใช่ฟอร์มเลือกอาจารย์
    assert p.locator('#selT').count() == 0 and p.locator('#pick').count() == 1
    assert 'งานจากลิงก์ข้อสอบ' in p.inner_text('#hTitle')
    no_errors(s)
    s.close()


finish()
