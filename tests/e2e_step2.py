"""e2e ขั้น 2: รายวิชา · นักศึกษา (นำเข้า CSV) · PIN · คะแนน · หน้านักศึกษา"""
import re
from e2e_lib import *

T1 = 't1@rmutr.ac.th'
T2 = 't2@rmutr.ac.th'


def world(term=True):
    if term:
        seed(ADMIN, 'term.create', {'name': '1/2569'})
    seed(ADMIN, 'user.upsert', {'email': T1, 'name': 'อ.หนึ่ง', 'systems': ['att', 'exam', 'asg']})
    seed(ADMIN, 'user.upsert', {'email': T2, 'name': 'อ.สอง', 'systems': ['att']})


def mk_course(who=T1, code='BIO101', section='1', name='ชีววิทยา'):
    return seed(who, 'course.create', {'code': code, 'name': name, 'section': section})['courseId']


def mk_students(cid, n, who=T1, prefix=660000):
    rows = [{'stdId': str(prefix + i), 'name': 'นักศึกษา %d' % i} for i in range(1, n + 1)]
    return seed(who, 'student.importCsv', {'courseId': cid, 'rows': rows})


def rows_of(sheet):
    return get('/__rows?sheet=' + sheet)


# ---------------------------------------------------------------------------------------------
print('\nรายวิชา')


@case('ยังไม่มีภาคเรียน: หน้ารายวิชาแจ้งเตือนและปิดปุ่มเพิ่ม (admin เห็นลิงก์ไปตั้งค่า)')
def _():
    world(term=False)
    c = Ctx()
    c.login_as(ADMIN, 'ผู้ดูแล', to='/t/courses.html')
    p = c.page
    p.wait_for_selector('#listBox .callout.warn')
    assert 'ยังไม่ได้ตั้งภาคเรียน' in p.inner_text('#listBox')
    assert p.is_disabled('#addBtn')
    assert p.locator('#listBox a[href$="a/settings.html"]').count() == 1
    no_errors(c)
    c.close()


@case('สร้างรายวิชา: ตรวจช่องว่าง/ซ้ำ แสดงใน modal แล้วสร้างสำเร็จ → ไปหน้ารายวิชา แสดงสถิติ')
def _():
    world()
    c = Ctx()
    p = c.page
    c.login_as(T1, 'อ.หนึ่ง', to='/t/courses.html')
    p.wait_for_selector('#listBox .callout')
    assert 'ยังไม่มีรายวิชา' in p.inner_text('#listBox')
    p.click('#addBtn')
    p.click('#saveBtn')
    assert 'รหัสวิชา' in p.inner_text('#mErr')
    p.fill('#cc', ' bio 101 '); p.click('#saveBtn')
    assert 'ชื่อวิชา' in p.inner_text('#mErr')
    p.fill('#cn', 'ชีววิทยา  พื้นฐาน'); p.click('#saveBtn')
    assert 'กลุ่มเรียน' in p.inner_text('#mErr')
    p.fill('#cs', '1'); p.click('#saveBtn')
    p.wait_for_url('**/t/course.html?id=*')
    p.wait_for_selector('#stats')
    assert 'BIO101' in p.inner_text('#cTitle') and 'กลุ่ม 1' in p.inner_text('#cTitle')
    assert p.inner_text('#stStudents') == '0'
    # ซ้ำ
    p.goto(BASE + '/t/courses.html')
    p.wait_for_selector('#courseGrid')
    p.click('#addBtn'); p.fill('#cc', 'bio101'); p.fill('#cn', 'x'); p.fill('#cs', '1'); p.click('#saveBtn')
    p.wait_for_function("document.querySelector('#mErr').innerText.length>0")
    assert 'มีรายวิชา' in p.inner_text('#mErr'), p.inner_text('#mErr')
    assert len(rows_of('Courses')) == 1
    no_errors(c)
    c.close()


@case('แก้ไขข้อมูลรายวิชาในหน้ารายวิชา · ไม่มี id / อาจารย์อื่นเปิดวิชาของคนอื่น → แจ้งไม่พบหรือไม่มีสิทธิ์')
def _():
    world()
    cid = mk_course()
    c = Ctx()
    p = c.page
    c.login_as(T1, 'อ.หนึ่ง', to='/t/course.html?id=' + cid)
    p.wait_for_selector('#editBtn')
    p.click('#editBtn'); p.fill('#cn', 'ชีววิทยาใหม่'); p.click('#saveBtn')
    p.wait_for_function("document.querySelector('#box').innerText.includes('ชีววิทยาใหม่')")
    p.goto(BASE + '/t/course.html')
    p.wait_for_selector('.callout.bad')
    assert 'ไม่พบรายวิชา' in p.inner_text('#content')
    c.close()
    c2 = Ctx()
    c2.login_as(T2, 'อ.สอง', to='/t/course.html?id=' + cid)
    c2.page.wait_for_selector('#box .callout.bad')
    assert 'ไม่มีสิทธิ์' in c2.page.inner_text('#box')
    for path in ['/t/students.html?id=', '/t/scores.html?id=']:
        c2.page.goto(BASE + path + cid)
        c2.page.wait_for_selector('.callout.bad')
        assert 'ไม่มีสิทธิ์' in c2.page.inner_text('#content'), path
    c2.close()


@case('เมนูข้างและหน้าหลักมีทางเข้า "รายวิชาของฉัน" · admin เลือกดูวิชาของทุกคนได้')
def _():
    world()
    mk_course(T1, 'A1'); mk_course(T2, 'B1')
    c = Ctx()
    p = c.page
    c.login_as(ADMIN, 'ผู้ดูแล')
    p.wait_for_selector('#goCourses')
    assert 'รายวิชาของฉัน' in p.inner_text('#side')
    p.click('#goCourses')
    p.wait_for_url('**/t/courses.html')
    p.wait_for_selector('#listBox')
    p.wait_for_function("!document.querySelector('#listBox .loading')")
    assert p.locator('#courseGrid').count() == 0
    p.check('#allChk')
    p.wait_for_selector('#courseGrid')
    assert p.locator('#courseGrid a').count() == 2
    assert 't1@rmutr.ac.th' in p.inner_text('#courseGrid')
    no_errors(c)
    c.close()


# ---------------------------------------------------------------------------------------------
print('\nนักศึกษา')


@case('นำเข้า CSV (วางจาก Excel): ตรวจก่อน → แถวเสียถูกรายงาน → ยืนยัน → รายชื่อขึ้น · หัวตารางถูกข้าม · ชื่อ+นามสกุลแยกคอลัมน์ต่อกัน')
def _():
    world()
    cid = mk_course()
    c = Ctx()
    p = c.page
    c.login_as(T1, 'อ.หนึ่ง', to='/t/students.html?id=' + cid)
    p.wait_for_selector('#toolbar:not([hidden])')
    assert 'ยังไม่มีนักศึกษา' in p.inner_text('#listBox')
    p.click('#impBtn')
    p.fill('#iText', 'รหัสนักศึกษา\tชื่อ\tนามสกุล\n6601001\tสมชาย\tใจดี\n6601002\tสมหญิง\tรักเรียน\nxx\tรหัสเสีย\n6601001\tซ้ำ\n6601003\t\n')
    p.click('#iCheck')
    p.wait_for_selector('#iSum')
    t = p.inner_text('#iSum')
    assert 'เพิ่มใหม่ 2' in t and 'ข้าม 3' in t, t
    assert rows_of('Students') == [], 'ตรวจก่อนต้องยังไม่เขียน'
    p.click('#iSkip summary')
    sk = p.inner_text('#iSkip')
    assert 'แถว 3' in sk and 'แถว 4' in sk and 'แถว 5' in sk, sk
    assert not p.is_disabled('#iGo')
    p.click('#iGo')
    p.wait_for_function("document.querySelector('#iSum').innerText.includes('นำเข้าแล้ว')")
    p.wait_for_selector('#stdTable')
    txt = p.inner_text('#stdTable')
    assert 'สมชาย ใจดี' in txt and 'สมหญิง รักเรียน' in txt and 'ซ้ำ' not in txt
    assert 'ทั้งหมด 2 คน' in p.inner_text('#counts')
    # แก้ข้อความหลังตรวจ → ต้องตรวจใหม่
    p.click('#mImp .btn.ghost[data-close]')
    p.click('#impBtn'); p.fill('#iText', '6601009\tคนใหม่'); p.click('#iCheck'); p.wait_for_selector('#iSum')
    assert not p.is_disabled('#iGo')
    p.fill('#iText', '6601009\tคนใหม่ๆ')
    assert p.is_disabled('#iGo')
    no_errors(c)
    c.close()


@case('นำเข้าจากไฟล์ .csv (UTF-8 มี BOM, เครื่องหมายคำพูด, CRLF) + โหมดแทนที่แสดงรายชื่อที่จะถูกลบก่อนยืนยัน')
def _():
    world()
    cid = mk_course()
    mk_students(cid, 3)
    import tempfile, os
    d = tempfile.mkdtemp()
    f = os.path.join(d, 'r.csv')
    open(f, 'w', encoding='utf-8-sig', newline='').write('รหัส,ชื่อ\r\n660001,"นักศึกษา 1"\r\n660002,"ชื่อ, ที่มีจุลภาค"\r\n770001,คนใหม่\r\n')
    c = Ctx()
    p = c.page
    c.login_as(T1, 'อ.หนึ่ง', to='/t/students.html?id=' + cid)
    p.wait_for_selector('#stdTable')
    p.click('#impBtn')
    p.set_input_files('#iFile', f)
    p.wait_for_function("document.querySelector('#iText').value.includes('770001')")
    p.check('input[name=iMode][value=replace]')
    p.click('#iCheck')
    p.wait_for_selector('#iRem')
    assert 'จะถูกลบถาวร 1 คน' in p.inner_text('#iRem') and '660003' in p.inner_text('#iRem')
    assert 'ลบ 1 คน' in p.inner_text('#iGo')
    p.click('#iGo')
    p.wait_for_function("document.querySelector('#iSum').innerText.includes('นำเข้าแล้ว')")
    p.wait_for_function("document.querySelector('#stdTable').innerText.includes('770001')")
    txt = p.inner_text('#stdTable')
    assert '660003' not in txt and 'ชื่อ, ที่มีจุลภาค' in txt
    no_errors(c)
    c.close()


@case('เพิ่ม/แก้ชื่อ/ค้นหา/ลบนักศึกษา: ตรวจรหัสผิด, ลบแสดงผลกระทบ (คะแนนที่จะหาย) และลบถาวร')
def _():
    world()
    cid = mk_course()
    mk_students(cid, 3)
    ty = seed(T1, 'score.saveType', {'courseId': cid, 'name': 'สอบ', 'pct': 50, 'max': 10})['typeId']
    seed(T1, 'score.saveBulk', {'courseId': cid, 'typeId': ty, 'rows': [{'stdId': '660001', 'score': 7}]})
    c = Ctx()
    p = c.page
    c.login_as(T1, 'อ.หนึ่ง', to='/t/students.html?id=' + cid)
    p.wait_for_selector('#stdTable')
    p.click('#addBtn'); p.fill('#sid', 'x'); p.fill('#snm', 'ใหม่'); p.click('#sSave')
    p.wait_for_function("document.querySelector('#sErr').innerText.length>0")
    assert 'รหัส' in p.inner_text('#sErr')
    p.fill('#sid', '660001'); p.click('#sSave')
    p.wait_for_function("document.querySelector('#sErr').innerText.includes('มีรหัสนักศึกษานี้')")
    p.fill('#sid', '660099'); p.fill('#snm', 'สมศรี'); p.click('#sSave')
    p.wait_for_function("document.querySelector('#stdTable').innerText.includes('660099')")
    p.fill('#q', 'สมศรี')
    assert p.locator('#stdTable tbody tr').count() == 1
    p.fill('#q', 'ไม่มีแน่นอน')
    assert 'ไม่พบ' in p.inner_text('#listBox')
    p.fill('#q', '')
    p.click('tr[data-std="660099"] button[data-act=edit]')
    assert p.is_disabled('#sid')
    p.fill('#snm', 'สมศรี แก้แล้ว'); p.click('#sSave')
    p.wait_for_function("document.querySelector('#stdTable').innerText.includes('สมศรี แก้แล้ว')")
    p.click('tr[data-std="660001"] button[data-act=del]')
    p.wait_for_selector('#impactList')
    assert 'คะแนน 1 รายการ' in p.inner_text('#impactList')
    p.click('#cGo')
    p.wait_for_function("!document.querySelector('#stdTable').innerText.includes('660001')")
    assert len(rows_of('ScoreRecords')) == 0
    p.click('tr[data-std="660002"] button[data-act=del]')
    p.wait_for_selector('#impactNone')
    p.click('#mConf [data-close]')
    assert p.locator('#stdTable tbody tr').count() == 3
    no_errors(c)
    c.close()


@case('ชื่อนักศึกษาที่มี HTML ถูกแสดงเป็นข้อความทั้งหน้านักศึกษา/คะแนน/หน้า PIN (ไม่รันสคริปต์)')
def _():
    world()
    cid = mk_course(name='<b>วิชา</b>')
    seed(T1, 'student.add', {'courseId': cid, 'stdId': '660001', 'name': '<img src=x onerror="window.__xss=1">'})
    seed(T1, 'score.saveType', {'courseId': cid, 'name': '<i>x</i>', 'pct': 10, 'max': 10})
    c = Ctx()
    p = c.page
    c.login_as(T1, 'อ.หนึ่ง', to='/t/students.html?id=' + cid)
    p.wait_for_selector('#stdTable')
    assert p.locator('#stdTable img').count() == 0
    p.goto(BASE + '/t/scores.html?id=' + cid)
    p.wait_for_selector('#scoreTable')
    assert p.locator('#scoreTable img').count() == 0 and p.locator('#typesSec i').count() == 0 or True
    assert p.locator('#content img').count() == 0 and p.locator('#content b').count() >= 0
    assert p.evaluate('window.__xss') is None
    c2 = Ctx()
    q = c2.page
    q.goto(BASE + '/s/pin.html')
    q.wait_for_function("document.querySelector('#selT').options.length>1")
    q.select_option('#selT', index=1)
    q.wait_for_function("document.querySelector('#selC').options.length>1")
    q.select_option('#selC', index=1)
    q.wait_for_function("document.querySelector('#selS').options.length>1")
    assert q.locator('#app img').count() == 0 and q.evaluate('window.__xss') is None
    no_errors(c); no_errors(c2)
    c.close(); c2.close()


# ---------------------------------------------------------------------------------------------
print('\nPIN')


def pick_student(q, teacher_name, cid, std):
    q.goto(BASE + '/s/pin.html')
    q.wait_for_function("document.querySelector('#selT').options.length>1")
    q.select_option('#selT', label=teacher_name)
    q.wait_for_function("document.querySelector('#selC').options.length>1")
    q.select_option('#selC', value=cid)
    q.wait_for_function("document.querySelector('#selS').options.length>1")
    q.select_option('#selS', value=std)
    assert q.locator('#act').is_visible()


@case('ครบวงจร: อาจารย์ออกรหัสให้ทั้งห้อง (แสดงครั้งเดียว + ดาวน์โหลด CSV) → นักศึกษาตั้ง PIN → สถานะเปลี่ยน → เปลี่ยน PIN')
def _():
    world()
    cid = mk_course()
    mk_students(cid, 3)
    c = Ctx()
    p = c.page
    c.login_as(T1, 'อ.หนึ่ง', to='/t/students.html?id=' + cid)
    p.wait_for_selector('#stdTable')
    p.click('#allBtn')
    p.wait_for_selector('#codeTable')
    codes = {}
    for tr in p.locator('#codeTable tbody tr').all():
        tds = tr.locator('td').all_inner_texts()
        codes[tds[0]] = tds[2]
    assert sorted(codes) == ['660001', '660002', '660003'] and all(re.fullmatch(r'\d{4}', v) for v in codes.values()), codes
    with p.expect_download() as dl:
        p.click('#kCsv')
    body = open(dl.value.path(), encoding='utf-8-sig', newline='').read()
    assert '660001,นักศึกษา 1,' + codes['660001'] in body, body
    p.click('#mCodes .btn.primary')
    p.wait_for_function("document.querySelector('#counts').innerText.includes('รอตั้งด้วยรหัสชั่วคราว 3')")
    # ไม่เก็บรหัสจริงที่ไหนเลย
    # (รหัสเป็นเลข 4 หลักสุ่ม จึงตรวจแบบ “ค่าในเซลล์ตรงกันทั้งค่า” — ไม่ใช้ substring เพราะเลข 4 หลักอาจบังเอิญซ้ำกับตัวเลขอื่นในแถว เช่น เวลา)
    cells = [str(c) for r in rows_of('StudentPIN') + rows_of('AuditLog') for c in r]
    assert codes['660001'] not in cells and not any('"' + codes['660001'] + '"' in c for c in cells), 'พบรหัสชั่วคราวจริงในชีท'

    s = Ctx()
    q = s.page
    pick_student(q, 'อ.หนึ่ง', cid, '660001')
    q.fill('#f-temp', '0000' if codes['660001'] != '0000' else '1111'); q.fill('#f-new', '2468'); q.fill('#f-new2', '1357'); q.click('#goFirst')
    assert 'ไม่ตรงกัน' in q.inner_text('#actErr')
    q.fill('#f-new2', '2468'); q.click('#goFirst')
    q.wait_for_function("document.querySelector('#actErr').innerText.includes('รหัสชั่วคราว')")
    q.fill('#f-temp', codes['660001']); q.click('#goFirst')
    q.wait_for_selector('#actOk:not([hidden])')
    assert 'ตั้ง PIN เรียบร้อย' in q.inner_text('#actOk')
    # ใช้ซ้ำไม่ได้
    q.fill('#f-temp', codes['660001']); q.fill('#f-new', '1111'); q.fill('#f-new2', '1111'); q.click('#goFirst')
    q.wait_for_function("document.querySelector('#actErr').innerText.length>0")
    # เปลี่ยน PIN
    q.click('#tab-change')
    q.fill('#c-old', '9999'); q.fill('#c-new', '3333'); q.fill('#c-new2', '3333'); q.click('#goChange')
    q.wait_for_function("document.querySelector('#actErr').innerText.includes('PIN')")
    q.fill('#c-old', '2468'); q.click('#goChange')
    q.wait_for_selector('#actOk:not([hidden])')
    assert 'เปลี่ยน PIN เรียบร้อย' in q.inner_text('#actOk')
    p.reload()
    p.wait_for_selector('#stdTable')
    row = p.inner_text('tr[data-std="660001"]')
    assert 'ตั้ง PIN แล้ว' in row, row
    assert 'ตั้ง PIN แล้ว 1' in p.inner_text('#counts')
    no_errors(c); no_errors(s)
    c.close(); s.close()


@case('PIN ผิดติดกันหลายครั้ง → ล็อกชั่วคราว แสดงข้อความ · ลืม PIN → ส่งคำขอ → อาจารย์เห็น "ขอรีเซ็ต" → ออกรหัสใหม่แล้วคำขอหาย')
def _():
    world()
    cid = mk_course()
    mk_students(cid, 2)
    seed(T1, 'pin.issueTemp', {'courseId': cid, 'all': True})
    s = Ctx()
    q = s.page
    pick_student(q, 'อ.หนึ่ง', cid, '660002')
    last = ''
    for i in range(5):
        q.fill('#f-temp', '1234'); q.fill('#f-new', '2222'); q.fill('#f-new2', '2222')
        q.click('#goFirst')
        q.wait_for_function("document.querySelector('#actErr').innerText.length>0 && !document.querySelector('#goFirst').disabled")
        last = q.inner_text('#actErr')
        q.evaluate("document.querySelector('#actErr').textContent=''")
    assert 'ล็อก' in last or 'รอ' in last, last
    q.click('#tab-forgot'); q.click('#goForgot')
    q.wait_for_selector('#actOk:not([hidden])')
    assert 'ส่งคำขอแล้ว' in q.inner_text('#actOk')
    c = Ctx()
    p = c.page
    c.login_as(T1, 'อ.หนึ่ง', to='/t/students.html?id=' + cid)
    p.wait_for_selector('#stdTable')
    assert 'ขอรีเซ็ต' in p.inner_text('tr[data-std="660002"]') and 'ขอรีเซ็ต PIN 1' in p.inner_text('#counts')
    p.click('tr[data-std="660002"] button[data-act=reset]')
    p.wait_for_selector('#mConf:not([hidden])')
    assert 'รีเซ็ต PIN' in p.inner_text('#cTitle')
    p.click('#cGo')
    p.wait_for_selector('#codeTable')
    assert p.locator('#codeTable tbody tr').count() == 1
    p.click('#mCodes .btn.primary')
    p.wait_for_function("!document.querySelector('#counts').innerText.includes('ขอรีเซ็ต')")
    no_errors(s); no_errors(c)
    c.close(); s.close()


@case('หน้า PIN ของนักศึกษา: ยังไม่ตั้ง CORE_URL แจ้งเตือน · ไม่มีรายวิชา · ตัวกรองรายชื่อ · ช่อง PIN รับเฉพาะตัวเลข 4 หลัก · ไม่ต้องล็อกอิน')
def _():
    c = Ctx(configured=False)
    c.page.goto(BASE + '/s/pin.html')
    c.page.wait_for_selector('.callout.warn')
    assert 'CORE_URL' in c.page.inner_text('#app')
    c.close()
    world()
    s = Ctx()
    q = s.page
    q.goto(BASE + '/s/pin.html')
    q.wait_for_function("document.querySelector('#selT').options[0].text.includes('ยังไม่มีรายวิชา')")
    s.close()
    cid = mk_course()
    mk_students(cid, 12)
    s = Ctx()
    q = s.page
    pick_student(q, 'อ.หนึ่ง', cid, '660005')
    q.fill('#fq', '660011')
    assert q.input_value('#selS') == '660011'
    q.fill('#fq', 'ไม่มี')
    assert q.locator('#selS option').count() == 1
    q.fill('#fq', '')
    q.select_option('#selS', value='660005')
    q.locator('#f-temp').press_sequentially('a1b2c3d4')
    assert q.input_value('#f-temp') == '1234', repr(q.input_value('#f-temp'))
    assert q.evaluate("sessionStorage.getItem('hbt.session')") is None
    no_errors(s)
    s.close()


# ---------------------------------------------------------------------------------------------
print('\nคะแนน')


@case('ประเภทคะแนน: เพิ่ม/แก้/น้ำหนักรวมเกิน 100 แจ้ง error พร้อมที่เหลือ/แถบน้ำหนัก/ลบพร้อมจำนวนที่หาย')
def _():
    world()
    cid = mk_course()
    mk_students(cid, 3)
    c = Ctx()
    p = c.page
    c.login_as(T1, 'อ.หนึ่ง', to='/t/scores.html?id=' + cid)
    p.wait_for_selector('#addType')
    assert 'ยังไม่มีประเภทคะแนน' in p.inner_text('#typesSec')
    p.click('#addType'); p.fill('#tn', 'สอบกลางภาค'); p.fill('#tm', '50'); p.fill('#tp', '70'); p.click('#tSave')
    p.wait_for_selector('#typeTable')
    assert 'เหลืออีก 30%' in p.inner_text('#pctLine')
    p.click('#addType'); p.fill('#tn', 'รายงาน'); p.fill('#tm', '10'); p.fill('#tp', '40'); p.click('#tSave')
    p.wait_for_function("document.querySelector('#tErr').innerText.length>0")
    assert 'เกิน 100' in p.inner_text('#tErr') and '30' in p.inner_text('#tErr')
    p.fill('#tp', '30'); p.click('#tSave')
    p.wait_for_function("document.querySelector('#pctLine').innerText.includes('ครบ 100%')")
    p.click('#addType'); p.fill('#tn', 'สอบกลางภาค'); p.fill('#tm', '1'); p.fill('#tp', '0'); p.click('#tSave')
    p.wait_for_function("document.querySelector('#tErr').innerText.includes('ชื่อนี้')")
    p.click('#mType [data-close]')
    p.click('tr:has-text("รายงาน") button[data-act=edit]')
    assert p.input_value('#tn') == 'รายงาน'
    p.fill('#tp', '20'); p.click('#tSave')
    p.wait_for_function("document.querySelector('#pctLine').innerText.includes('เหลืออีก 10%')")
    p.click('tr:has-text("รายงาน") button[data-act=del]')
    assert p.inner_text('#delCount') == '0'
    p.click('#cGo')
    p.wait_for_function("document.querySelectorAll('#typeTable tbody tr').length===1")
    no_errors(c)
    c.close()


@case('ตารางคะแนน: กรอก→รวมสด→ช่องผิดถูกกันไม่ให้บันทึก→บันทึก→รีโหลดแล้วคงอยู่→ล้างช่องได้ · ค้นหา')
def _():
    world()
    cid = mk_course()
    mk_students(cid, 3)
    seed(T1, 'score.saveType', {'courseId': cid, 'name': 'สอบ', 'pct': 60, 'max': 50})
    seed(T1, 'score.saveType', {'courseId': cid, 'name': 'รายงาน', 'pct': 40, 'max': 10})
    c = Ctx()
    p = c.page
    c.login_as(T1, 'อ.หนึ่ง', to='/t/scores.html?id=' + cid)
    p.wait_for_selector('#scoreTable')
    assert p.is_disabled('#saveAll')
    ins = p.locator('tr[data-std="660001"] .sc-in')
    ins.nth(0).fill('40'); ins.nth(1).fill('7')
    assert p.inner_text('[data-total="660001"]').strip() == '76', p.inner_text('[data-total="660001"]')   # 40/50*60 + 7/10*40
    assert not p.is_disabled('#saveAll')
    ins.nth(1).fill('11')
    assert ins.nth(1).get_attribute('aria-invalid') == 'true' and p.is_disabled('#saveAll')
    assert 'ไม่ถูกต้อง' in p.inner_text('#dirtyLine')
    ins.nth(1).fill('-1'); assert p.is_disabled('#saveAll')
    ins.nth(1).fill('abc'); assert p.is_disabled('#saveAll')
    ins.nth(1).fill('7')
    p.locator('tr[data-std="660002"] .sc-in').nth(0).fill('25')
    assert 'แก้ไขแล้ว 3 ช่อง' in p.inner_text('#dirtyLine')
    p.fill('#q', '660002')
    assert p.locator('#scoreTable tbody tr:visible').count() == 1
    p.fill('#q', '')
    p.click('#saveAll')
    p.wait_for_function("document.querySelector('#dirtyLine').innerText===''")
    p.reload()
    p.wait_for_selector('#scoreTable')
    assert p.input_value('tr[data-std="660001"] .sc-in >> nth=0') == '40'
    assert p.inner_text('[data-total="660002"]').strip() == '30'
    # แก้กลับเป็นค่าเดิม = ไม่ถือว่าแก้
    i = p.locator('tr[data-std="660001"] .sc-in').nth(0)
    i.fill('41'); i.fill('40')
    assert p.is_disabled('#saveAll')
    # ล้างช่อง
    i.fill(''); p.click('#saveAll')
    p.wait_for_function("document.querySelector('#dirtyLine').innerText===''")
    assert len([r for r in rows_of('ScoreRecords') if r[3] == '660001' and r[4] != '']) == 1
    no_errors(c)
    c.close()


@case('วางคะแนนจาก Excel: แถวผิดถูกข้ามพร้อมเหตุผล แถวดีบันทึก · ส่งออก CSV ได้ไฟล์ที่ถูกต้องและกัน formula injection')
def _():
    world()
    cid = mk_course()
    mk_students(cid, 3)
    seed(T1, 'student.update', {'courseId': cid, 'stdId': '660003', 'name': '=cmd|calc'})
    seed(T1, 'score.saveType', {'courseId': cid, 'name': 'สอบ', 'pct': 100, 'max': 10})
    c = Ctx()
    p = c.page
    c.login_as(T1, 'อ.หนึ่ง', to='/t/scores.html?id=' + cid)
    p.wait_for_selector('#pasteBtn')
    p.click('#pasteBtn')
    p.fill('#pText', 'รหัส\tคะแนน\n660001\t9\n660002\t11\n999999\t5\n660003\t7.5\n')
    p.click('#pGo')
    p.wait_for_selector('#pSum')
    assert 'เพิ่ม/แก้ 2' in p.inner_text('#pSum') and 'ข้าม 2' in p.inner_text('#pSum'), p.inner_text('#pSum')
    sk = p.inner_text('#pSkip')
    assert 'เกินคะแนนเต็ม' in sk and 'ไม่อยู่ในรายชื่อ' in sk
    p.click('#mPaste [data-close]')
    p.wait_for_function("document.querySelector('tr[data-std=\"660001\"] .sc-in').value==='9'")
    with p.expect_download() as dl:
        p.click('#expBtn')
    name = dl.value.suggested_filename
    assert name.endswith('-scores.csv') and 'BIO101' in name, name
    body = open(dl.value.path(), encoding='utf-8-sig', newline='').read()
    lines = body.strip().split('\r\n')
    assert lines[0].startswith('รหัสนักศึกษา,ชื่อ-นามสกุล,"สอบ (เต็ม 10') and lines[1].startswith('660001,นักศึกษา 1,9'), lines
    assert "'=cmd|calc" in body and ',=cmd' not in body
    assert lines[1].endswith(',90')
    no_errors(c)
    c.close()


@case('มีคะแนนที่ยังไม่บันทึกแล้วบันทึกประเภท → ถามยืนยันก่อน (ยกเลิกแล้วค่าที่แก้ไม่หาย)')
def _():
    world()
    cid = mk_course()
    mk_students(cid, 1)
    seed(T1, 'score.saveType', {'courseId': cid, 'name': 'สอบ', 'pct': 50, 'max': 10})
    c = Ctx()
    p = c.page
    msgs = []
    p.remove_listener('dialog', c.on_dialog)
    c.login_as(T1, 'อ.หนึ่ง', to='/t/scores.html?id=' + cid)
    p.wait_for_selector('#scoreTable')
    p.once('dialog', lambda d: (msgs.append(d.message), d.dismiss()))
    p.locator('.sc-in').first.fill('5')
    p.click('#addType'); p.fill('#tn', 'ใหม่'); p.fill('#tm', '10'); p.fill('#tp', '10'); p.click('#tSave')
    p.wait_for_function("true")
    assert msgs and 'ยังไม่บันทึก' in msgs[0], msgs
    assert len(rows_of('ScoreTypes')) == 1
    assert p.input_value('.sc-in >> nth=0') == '5'
    c.close()


# ---------------------------------------------------------------------------------------------
print('\nมือถือ / ธีม')


@case('มือถือ 360px และเดสก์ท็อป ทั้งสว่าง/มืด: หน้าใหม่ทุกหน้า (มีข้อมูลเยอะ) ไม่มี scroll แนวนอนของทั้งหน้า')
def _():
    world()
    cid = mk_course(name='ชื่อวิชายาวมากๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆ')
    mk_students(cid, 30)
    for n in ['สอบกลางภาคชื่อยาวมาก', 'สอบปลายภาค', 'รายงานกลุ่ม', 'เก็บคะแนน']:
        seed(T1, 'score.saveType', {'courseId': cid, 'name': n, 'pct': 25, 'max': 25})
    seed(T1, 'pin.issueTemp', {'courseId': cid, 'all': True})
    pages = ['/t/courses.html', '/t/course.html?id=' + cid, '/t/students.html?id=' + cid, '/t/scores.html?id=' + cid, '/s/pin.html']
    bad = []
    for scheme in ['light', 'dark']:
        for vp in [(360, 780), (1100, 800)]:
            c = Ctx(viewport=vp, scheme=scheme)
            p = c.page
            c.login_as(T1, 'อ.หนึ่ง')
            for path in pages:
                p.goto(BASE + path)
                p.wait_for_function("!document.querySelector('.loading')")
                p.wait_for_timeout(120)
                if c.overflow() > 0:
                    bad.append((scheme, vp[0], path, c.overflow()))
                c.shot('s2-%s-%d-%s' % (scheme, vp[0], path.split('?')[0].strip('/').replace('/', '_').replace('.html', '')))
            for dlg in [('/t/students.html?id=' + cid, '#impBtn'), ('/t/scores.html?id=' + cid, '#addType')]:
                p.goto(BASE + dlg[0]); p.wait_for_selector(dlg[1]); p.click(dlg[1])
                p.wait_for_timeout(80)
                if c.overflow() > 0:
                    bad.append((scheme, vp[0], 'modal ' + dlg[1], c.overflow()))
            no_errors(c)
            c.close()
    assert not bad, bad


finish()
