"""e2e ขั้น 3: เช็คชื่อ — เปิดคาบ (GPS) · QR · นักศึกษาสแกน · PIN · เครื่องชน/อนุมัติ · พัก/ปิด · รายงาน · นำเข้า · ลบ"""
import re
from e2e_lib import *

T1 = 't1@rmutr.ac.th'
T2 = 't2@rmutr.ac.th'
T3 = 't3@rmutr.ac.th'
LAT, LNG = 13.7563, 100.5018
NEAR = {'latitude': LAT + 0.0004, 'longitude': LNG}
FAR = {'latitude': LAT + 0.02, 'longitude': LNG}


def world(n=4):
    seed(ADMIN, 'term.create', {'name': '1/2569'})
    seed(ADMIN, 'user.upsert', {'email': T1, 'name': 'อ.หนึ่ง', 'systems': ['att', 'exam', 'asg']})
    seed(ADMIN, 'user.upsert', {'email': T2, 'name': 'อ.สอง', 'systems': ['att']})
    seed(ADMIN, 'user.upsert', {'email': T3, 'name': 'อ.สาม', 'systems': ['exam']})
    cid = seed(T1, 'course.create', {'code': 'BIO101', 'name': 'ชีววิทยา', 'section': '1'})['courseId']
    rows = [{'stdId': str(660000 + i), 'name': 'นักศึกษา %d' % i} for i in range(1, n + 1)]
    seed(T1, 'student.importCsv', {'courseId': cid, 'rows': rows})
    return cid


def rows_of(sheet):
    return get('/__rows?sheet=' + sheet)


def teacher(geo=True, viewport=(1100, 800)):
    c = Ctx(viewport=viewport)
    if geo:
        c.ctx.grant_permissions(['geolocation'])
        c.ctx.set_geolocation({'latitude': LAT, 'longitude': LNG})
    return c


def student(pos=NEAR, viewport=(390, 800)):
    c = Ctx(viewport=viewport)
    c.ctx.grant_permissions(['geolocation'])
    c.ctx.set_geolocation(pos)
    return c


def open_session(cid, **kw):
    a = {'courseId': cid, 'lat': LAT, 'lng': LNG}
    a.update(kw)
    return seed(T1, 'att.open', a)['sessionId']


def scan_open(c, sid, std_id=None, name=None):
    p = c.page
    p.goto(BASE + '/s/scan.html?s=' + sid)
    p.wait_for_selector('#selS option[value="660001"]', state='attached')
    if std_id:
        p.select_option('#selS', std_id)


def pin_fill(p, ids, val='1234'):
    for i in ids:
        p.fill('#' + i, val)


# ---------------------------------------------------------------------------------------------
print('\nอาจารย์: เปิดคาบ')


@case('เปิดคาบจากเบราว์เซอร์: ต้องกดระบุตำแหน่งก่อน → เปิด → หน้าสด มี QR + ลิงก์สแกน + ปุ่มพัก/ปิด')
def _():
    cid = world()
    c = teacher()
    c.login_as(T1, 'อ.หนึ่ง', to='/t/att.html?id=' + cid)
    p = c.page
    p.wait_for_selector('#openBtn')
    p.click('#openBtn')
    assert 'ยังไม่ได้ระบุตำแหน่ง' in p.inner_text('#openErr')
    assert rows_of('AttSessions') == []
    p.click('#getLoc')
    p.wait_for_function("document.getElementById('locState').textContent.indexOf('ได้ตำแหน่งแล้ว')>=0")
    p.fill('#radius', '300')
    p.click('#openBtn')
    p.wait_for_url('**/t/att-live.html?s=*')
    p.wait_for_selector('#qrBox svg')
    url = p.inner_text('#scanUrl')
    assert '/s/scan.html?s=' in url, url
    assert p.locator('#pauseBtn').count() == 1 and p.locator('#closeBtn').count() == 1
    s = rows_of('AttSessions')
    assert len(s) == 1 and s[0][9] == '300', s            # radius_m
    assert 'ปกติ' in p.inner_text('#phase')
    p.click('#bigBtn')
    p.wait_for_selector('#bigQr svg')
    no_errors(c)
    c.close()


@case('เปิดซ้ำขณะมีคาบเปิดอยู่: หน้าประวัติแสดงการ์ด “มีคาบที่เปิดอยู่” แทนฟอร์มเปิด')
def _():
    cid = world()
    open_session(cid)
    c = teacher()
    c.login_as(T1, 'อ.หนึ่ง', to='/t/att.html?id=' + cid)
    c.page.wait_for_selector('#liveCard')
    assert c.page.locator('#openCard').count() == 0
    c.page.click('#goLive')
    c.page.wait_for_url('**/att-live.html?s=*')
    c.close()


print('\nนักศึกษา: สแกน')


@case('สแกน: เลือกชื่อ → ตั้ง PIN ครั้งแรกพร้อมเช็ค → สำเร็จ · อาจารย์เห็นในหน้าสดเอง (poll) · เช็คซ้ำ = เช็คไว้แล้ว')
def _():
    cid = world()
    sid = open_session(cid)
    t = teacher()
    t.login_as(T1, 'อ.หนึ่ง', to='/t/att-live.html?s=' + sid)
    t.page.wait_for_selector('#stTbl')
    assert t.page.inner_text('#counts [data-k=normal]') == '0'
    s = student()
    p = s.page
    scan_open(s, sid)
    assert 'เปิดรับเช็คชื่อ' in p.inner_text('#stBanner')
    p.fill('#fq', '660001')                       # ค้นหาแล้วเลือกให้อัตโนมัติ
    assert p.input_value('#selS') == '660001'
    p.click('#go')
    p.wait_for_selector('#npin')
    assert 'ตั้ง PIN ครั้งแรก' in p.inner_text('#pinBox')
    pin_fill(p, ['npin', 'npin2'], '1234')
    p.click('#go')
    p.wait_for_selector('#okTitle')
    assert 'เช็คชื่อสำเร็จ' in p.inner_text('#okTitle') and p.inner_text('#okStatus') == 'ปกติ'
    assert 'ตั้ง PIN แล้ว' in p.inner_text('#done')
    assert len(rows_of('AttRecords')) == 1
    t.page.wait_for_function("document.querySelector('#counts [data-k=normal]').textContent==='1'", timeout=20000)
    assert 'is-new' in (t.page.get_attribute('#stTbl tr[data-std="660001"]', 'class') or '')
    # เปิดอีกครั้ง (เครื่องเดิม จำชื่อไว้) → เช็คซ้ำ
    scan_open(s, sid)
    p.wait_for_function("document.getElementById('selS').value==='660001'")
    p.click('#go')
    p.wait_for_selector('#okTitle')
    assert 'ไว้แล้ว' in p.inner_text('#okTitle')
    assert len(rows_of('AttRecords')) == 1
    no_errors(s); no_errors(t)
    s.close(); t.close()


@case('นอกรัศมี → บอกระยะ · ปฏิเสธสิทธิ์ตำแหน่ง → บอกวิธีเปิด · ไม่มีการเขียนแถวหรือตั้ง PIN')
def _():
    cid = world()
    sid = open_session(cid, radiusM=200)
    s = student(pos=FAR)
    p = s.page
    scan_open(s, sid, '660001')
    p.click('#go')
    p.wait_for_function("document.getElementById('err').textContent.indexOf('นอกพื้นที่')>=0")
    assert 'ไม่เกิน 200' in p.inner_text('#err')
    assert rows_of('AttRecords') == [] and rows_of('StudentPIN') == []
    s.close()
    # ปฏิเสธตำแหน่ง
    s2 = Ctx(viewport=(390, 800))
    p2 = s2.page
    scan_open(s2, sid, '660001')
    p2.click('#go')
    p2.wait_for_function("document.getElementById('err').textContent.length>0")
    assert 'ตำแหน่ง' in p2.inner_text('#err')
    assert rows_of('AttRecords') == []
    s2.close()


@case('เครื่องชน: คนที่ 2 ใช้มือถือเครื่องเดียวกัน → ขออนุมัติ → อาจารย์กดอนุมัติในหน้าสด → เช็คสำเร็จ')
def _():
    cid = world()
    sid = open_session(cid)
    t = teacher()
    t.login_as(T1, 'อ.หนึ่ง', to='/t/att-live.html?s=' + sid)
    t.page.wait_for_selector('#stTbl')
    s = student()
    p = s.page
    scan_open(s, sid, '660001')
    p.click('#go'); p.wait_for_selector('#npin'); pin_fill(p, ['npin', 'npin2']); p.click('#go'); p.wait_for_selector('#okTitle')
    # คนที่ 2 บนเครื่องเดิม
    scan_open(s, sid)
    p.select_option('#selS', '660002')
    p.click('#go')
    p.wait_for_selector('#askBtn')
    assert 'นักศึกษา 1' in p.inner_text('#conflict')
    assert len(rows_of('AttRecords')) == 1
    p.click('#askBtn')
    p.wait_for_selector('#waitTxt')
    t.page.wait_for_selector('.appr', timeout=20000)
    assert 'นักศึกษา 2' in t.page.inner_text('#apprBox')
    t.page.click('[data-yes]')
    t.page.wait_for_selector('#apprBox', state='hidden')
    # นักศึกษาส่งซ้ำเอง → ต้องตั้ง PIN (ยังไม่มี) → ตั้ง → สำเร็จ
    p.wait_for_selector('#npin', timeout=15000)
    pin_fill(p, ['npin', 'npin2'], '4321')
    p.click('#go')
    p.wait_for_selector('#okTitle')
    recs = rows_of('AttRecords')
    assert len(recs) == 2 and any('อนุมัติ' in r[9] for r in recs), recs
    no_errors(s); no_errors(t)
    s.close(); t.close()


@case('เครื่องชน → อาจารย์ปฏิเสธ → นักศึกษาเห็น “ไม่อนุมัติ” และไม่ได้เช็ค')
def _():
    cid = world()
    sid = open_session(cid)
    seed(T1, 'att.checkIn', {'sessionId': sid, 'stdId': '660001', 'deviceId': 'device-same-0001', 'newPin': '1234', 'lat': LAT, 'lng': LNG})
    t = teacher()
    t.login_as(T1, 'อ.หนึ่ง', to='/t/att-live.html?s=' + sid)
    s = student()
    s.page.goto(BASE + '/s/scan.html?s=' + sid)
    s.page.evaluate("localStorage.setItem('hbt.device','device-same-0001')")
    scan_open(s, sid, '660002')
    s.page.click('#go'); s.page.wait_for_selector('#askBtn'); s.page.click('#askBtn')
    t.page.wait_for_selector('[data-no]', timeout=20000)
    t.page.click('[data-no]')
    s.page.wait_for_function("document.getElementById('conflict').textContent.indexOf('ไม่อนุมัติ')>=0", timeout=15000)
    assert len(rows_of('AttRecords')) == 1
    s.close(); t.close()


@case('เครื่องใหม่ของคนที่มี PIN: ต้องใส่ PIN (ผิดแจ้งผิด ถูกผ่าน) · เครื่องเดิมไม่ต้อง')
def _():
    cid = world()
    sid0 = open_session(cid)
    seed(T1, 'att.checkIn', {'sessionId': sid0, 'stdId': '660001', 'deviceId': 'device-old-00001', 'newPin': '1234', 'lat': LAT, 'lng': LNG})
    seed(T1, 'att.close', {'sessionId': sid0})
    sid = open_session(cid)
    s = student()
    p = s.page
    scan_open(s, sid, '660001')
    p.click('#go')
    p.wait_for_selector('#pin')
    assert 'ยังไม่เคยยืนยันตัวตน' in p.inner_text('#pinBox')
    p.fill('#pin', '0000'); p.click('#go')
    p.wait_for_function("document.getElementById('err').textContent.indexOf('PIN')>=0")
    p.fill('#pin', '1234'); p.click('#go')
    p.wait_for_selector('#okTitle')
    assert len(rows_of('AttRecords')) == 2
    s.close()


print('\nควบคุมคาบ')


@case('พัก → นักศึกษาเห็นพัก/กดไม่ได้ → ต่อ → ปิดคาบ (ยืนยัน) → นักศึกษาเห็นปิดแล้ว · คะแนนเช็คชื่อถูกสร้าง')
def _():
    cid = world()
    sid = open_session(cid)
    seed(T1, 'att.checkIn', {'sessionId': sid, 'stdId': '660001', 'deviceId': 'device-aaaa-0001', 'newPin': '1234', 'lat': LAT, 'lng': LNG})
    t = teacher()
    t.login_as(T1, 'อ.หนึ่ง', to='/t/att-live.html?s=' + sid)
    p = t.page
    p.wait_for_selector('#pauseBtn')
    p.click('#pauseBtn')
    p.wait_for_selector('#resumeBtn')
    assert 'พักอยู่' in p.inner_text('#phase')
    s = student()
    scan_open(s, sid, '660002')
    assert 'พักการเช็คชื่อ' in s.page.inner_text('#stBanner') and s.page.is_disabled('#go')
    p.click('#resumeBtn')
    p.wait_for_selector('#pauseBtn')
    s.page.click('#recheck')
    s.page.wait_for_function("document.getElementById('go').disabled===false")
    p.click('#closeBtn')
    p.click('#cOk')
    p.wait_for_function("document.getElementById('phase').textContent.indexOf('ปิดแล้ว')>=0")
    assert p.locator('#shareCard').is_hidden()
    assert p.inner_text('#counts [data-k=absent]') == '3'
    s.page.reload()
    s.page.wait_for_selector('#stBanner')
    assert 'ปิดรับเช็คชื่อแล้ว' in s.page.inner_text('#stBanner') and s.page.is_disabled('#go')
    types = rows_of('ScoreTypes')
    assert len(types) == 1 and 'ATT' in types[0], types
    no_errors(t)
    s.close(); t.close()


@case('เลยเวลาปกติ → ป้ายเปลี่ยนเป็นสาย · นักศึกษาที่เช็คตอนนั้นได้ “สาย” · เลยเวลาปิด → ปิดเอง')
def _():
    cid = world()
    sid = open_session(cid)
    post('/__advance', {'min': 12})
    s = student()
    scan_open(s, sid, '660001')
    assert 'สาย' in s.page.inner_text('#stBanner')
    s.page.click('#go'); s.page.wait_for_selector('#npin'); pin_fill(s.page, ['npin', 'npin2']); s.page.click('#go')
    s.page.wait_for_selector('#okTitle')
    assert s.page.inner_text('#okStatus') == 'สาย'
    post('/__advance', {'min': 15})
    t = teacher()
    t.login_as(T1, 'อ.หนึ่ง', to='/t/att-live.html?s=' + sid)
    t.page.wait_for_selector('#counts')
    assert 'ปิดแล้ว' in t.page.inner_text('#phase')
    s.close(); t.close()


print('\nแก้ไข · รายงาน · นำเข้า · ลบ')


@case('หน้าสด: แก้สถานะรายคน (ลา/ขาด/สาย) · รายงานแสดงตาราง · กดชื่อดูรายคาบ · ส่งออก CSV')
def _():
    cid = world()
    sid = open_session(cid)
    seed(T1, 'att.checkIn', {'sessionId': sid, 'stdId': '660001', 'deviceId': 'device-aaaa-0001', 'newPin': '1234', 'lat': LAT, 'lng': LNG})
    seed(T1, 'att.close', {'sessionId': sid})
    t = teacher()
    t.login_as(T1, 'อ.หนึ่ง', to='/t/att-live.html?s=' + sid)
    p = t.page
    p.wait_for_selector('#stTbl')
    p.select_option('tr[data-std="660002"] .st-sel', 'leave')
    p.wait_for_function("document.querySelector('#counts [data-k=absent]').textContent==='2'")
    p.select_option('tr[data-std="660001"] .st-sel', 'late')
    p.wait_for_function("document.querySelector('#counts [data-k=late]').textContent==='1'")
    recs = {r[3]: r[5] for r in rows_of('AttRecords')}
    assert recs == {'660001': 'late', '660002': 'leave'}, recs
    p.fill('#fq', 'นักศึกษา 3')
    assert p.locator('#stTbl tbody tr').count() == 1
    p.goto(BASE + '/t/att-report.html?id=' + cid)
    p.wait_for_selector('#repTbl')
    assert p.locator('#repTbl tbody tr').count() == 4
    row1 = p.inner_text('#repTbl tr[data-std="660001"]')
    assert '50' in row1 and 'ส' in row1, row1
    assert 'ยังไม่ได้กำหนดน้ำหนัก' in p.inner_text('#wBox')
    assert p.locator('#wBox a[href*="scores.html"]').count() == 1
    p.click('[data-det="660002"]')
    p.wait_for_selector('#dBody table')
    assert 'ลา' in p.inner_text('#dBody')
    p.keyboard.press('Escape')
    with p.expect_download() as dl:
        p.click('#csvBtn')
    d = dl.value
    assert d.suggested_filename == 'BIO101-1-attendance.csv', d.suggested_filename
    txt = open(d.path(), encoding='utf-8').read()
    assert 'นักศึกษา 2' in txt and 'ลา' in txt
    no_errors(t)
    t.close()


@case('นำเข้าย้อนหลัง: ตรวจก่อน (ข้ามแถวเสีย) → นำเข้า → ขึ้นในประวัติ · ลบคาบ (ยืนยัน) · ลบคาบที่ไม่มีคนเช็ค')
def _():
    cid = world()
    t = teacher(geo=False)
    t.login_as(T1, 'อ.หนึ่ง', to='/t/att.html?id=' + cid)
    p = t.page
    p.wait_for_selector('#noSess')
    p.click('#impBtn')
    p.fill('#iDate', '2026-08-10')
    p.click('#iCheck')
    assert 'ยังไม่มีข้อมูล' in p.inner_text('#iErr')
    p.fill('#iText', 'รหัส\tสถานะ\n660001\t1\n660002\tสาย\n660003\tลา\n999999\t1\n660004\tมั่ว')
    p.click('#iCheck')
    p.wait_for_selector('#iPrev .callout.good')
    assert 'พร้อมนำเข้า 3 คน' in p.inner_text('#iPrev') and 'ข้าม 2 แถว' in p.inner_text('#iPrev')
    assert rows_of('AttSessions') == []
    p.click('#iGo')
    p.wait_for_selector('#histTbl')
    assert 'นำเข้า' in p.inner_text('#histTbl') and len(rows_of('AttRecords')) == 3
    assert p.locator('#liveCard').count() == 0 and p.locator('#openCard').count() == 1
    p.click('[data-del]')
    assert 'ลบถาวร' in p.inner_text('#cOk')
    p.click('#cOk')
    p.wait_for_selector('#noSess')
    assert rows_of('AttSessions') == [] and rows_of('AttRecords') == []
    # คาบว่าง
    sid = open_session(cid)
    seed(T1, 'att.close', {'sessionId': sid})
    p.reload()
    p.wait_for_selector('#histTbl')
    p.click('#emptyBtn'); p.click('#cOk')
    p.wait_for_selector('#noSess')
    no_errors(t)
    t.close()


print('\nสิทธิ์ · ความปลอดภัย · มือถือ')


@case('สิทธิ์: ไม่มีสิทธิ์ระบบ att / ไม่ใช่เจ้าของวิชา → ไม่เห็นข้อมูล · ลิงก์สแกนเสีย → แจ้งไม่พบ')
def _():
    cid = world()
    sid = open_session(cid)
    c = Ctx()
    c.login_as(T3, 'อ.สาม', to='/t/att.html?id=' + cid)
    c.page.wait_for_selector('.callout.bad')
    assert 'ไม่มีสิทธิ์' in c.page.inner_text('#content')
    c.close()
    c = Ctx()
    c.login_as(T2, 'อ.สอง', to='/t/att-live.html?s=' + sid)
    c.page.wait_for_selector('.callout.bad')
    assert 'ไม่มีสิทธิ์' in c.page.inner_text('#box')
    c.page.goto(BASE + '/t/att-report.html?id=' + cid)
    c.page.wait_for_selector('.callout.bad')
    c.close()
    s = Ctx()
    s.page.goto(BASE + '/s/scan.html?s=nope')
    s.page.wait_for_selector('#infoErr')
    assert 'ไม่พบคาบ' in s.page.inner_text('#infoErr')
    s.page.goto(BASE + '/s/scan.html')
    s.page.wait_for_selector('#noSid')
    s.close()


@case('ชื่อนักศึกษามี HTML → ถูก escape ทั้งหน้าสแกนและหน้าสด (ไม่รันสคริปต์)')
def _():
    seed(ADMIN, 'term.create', {'name': '1/2569'})
    seed(ADMIN, 'user.upsert', {'email': T1, 'name': 'อ.หนึ่ง', 'systems': ['att']})
    cid = seed(T1, 'course.create', {'code': 'XSS1', 'name': 'x<script>window.__x=1</script>', 'section': '1'})['courseId']
    seed(T1, 'student.importCsv', {'courseId': cid, 'rows': [{'stdId': '660001', 'name': '<img src=x onerror=window.__x=1>'}]})
    sid = open_session(cid)
    s = student()
    s.page.goto(BASE + '/s/scan.html?s=' + sid)
    s.page.wait_for_selector('#selS option[value="660001"]', state='attached')
    assert '<img' in s.page.inner_text('#selS')
    assert s.page.evaluate('window.__x') is None
    t = teacher()
    t.login_as(T1, 'อ.หนึ่ง', to='/t/att-live.html?s=' + sid)
    t.page.wait_for_selector('#stTbl')
    assert '<img' in t.page.inner_text('#stTbl') and t.page.evaluate('window.__x') is None
    no_errors(s); no_errors(t)
    s.close(); t.close()


@case('มือถือ 360px: สแกน · เปิดคาบ · หน้าสด · รายงาน ไม่ล้นจอ')
def _():
    cid = world(n=30)
    sid0 = open_session(cid)
    seed(T1, 'att.checkIn', {'sessionId': sid0, 'stdId': '660001', 'deviceId': 'device-aaaa-0001', 'newPin': '1234', 'lat': LAT, 'lng': LNG})
    seed(T1, 'att.close', {'sessionId': sid0})
    sid = open_session(cid)
    t = teacher(viewport=(360, 740))
    t.login_as(T1, 'อ.หนึ่ง', to='/t/att-live.html?s=' + sid)
    t.page.wait_for_selector('#stTbl')
    assert t.overflow() <= 0, ('live', t.overflow())
    t.shot('att-live-m')
    t.page.goto(BASE + '/t/att-report.html?id=' + cid)
    t.page.wait_for_selector('#repTbl')
    assert t.overflow() <= 0, ('report', t.overflow())
    t.shot('att-report-m')
    seed(T1, 'att.close', {'sessionId': sid})
    t.page.goto(BASE + '/t/att.html?id=' + cid)
    t.page.wait_for_selector('#openCard')
    assert t.overflow() <= 0, ('att', t.overflow())
    t.shot('att-open')
    s = student(viewport=(360, 740))
    sid2 = open_session(cid)
    scan_open(s, sid2, '660002')
    s.page.click('#go'); s.page.wait_for_selector('#npin')
    assert s.overflow() <= 0, ('scan', s.overflow())
    s.shot('scan-pin')
    no_errors(t); no_errors(s)
    s.close(); t.close()


finish()
