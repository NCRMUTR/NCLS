"""e2e ขั้น 1: ล็อกอิน / ผู้ใช้ / ภาคเรียน / ตั้งค่า"""
from e2e_lib import *

# ---------------------------------------------------------------------------------------------
print('\nเปิดหน้า / ตั้งค่า')


@case('ยังไม่ตั้ง config.js: ทุกหน้าบอกให้ตั้งค่า ไม่พังเงียบ')
def _():
    c = Ctx(configured=False)
    p = c.page
    p.goto(BASE + '/t/login.html')
    p.wait_for_selector('#msg .callout')
    assert 'ยังไม่ได้ตั้งค่าเว็บ' in p.inner_text('#msg')
    assert p.locator('#fakeG').count() == 0
    p.goto(BASE + '/t/home.html')
    p.wait_for_selector('.callout')
    assert 'ยังไม่ได้ตั้งค่าเว็บ' in p.inner_text('#app')
    no_errors(c)
    c.close()


@case('หน้าแรก: มีลิงก์เข้าสู่ระบบอาจารย์ และเปลี่ยนเป็น "ไปหน้าหลัก" เมื่อมีเซสชัน')
def _():
    c = Ctx()
    p = c.page
    p.goto(BASE + '/index.html')
    assert 'เข้าสู่ระบบ' in p.inner_text('#goTeacherLbl')
    c.login_as(ADMIN, 'ผู้ดูแล', to='/index.html')
    assert 'ไปหน้าหลัก' in p.inner_text('#goTeacherLbl')
    assert p.get_attribute('#goTeacher', 'href') == 't/home.html'
    no_errors(c)
    c.close()

# ---------------------------------------------------------------------------------------------
print('\nล็อกอิน')


@case('admin ล็อกอินสำเร็จ → หน้าหลัก เห็นเมนูผู้ดูแล + เตือนยังไม่มีภาคเรียน')
def _():
    c = Ctx()
    p = c.page
    c.login_as(ADMIN, 'ผู้ดูแลระบบ')
    p.wait_for_selector('#sysCards')
    assert 'สวัสดี' in p.inner_text('h1')
    assert p.locator('#admCard').is_visible()
    assert p.locator('#noTerm').is_visible()
    side = p.inner_text('#side')
    assert 'ผู้ใช้และสิทธิ์' in side and 'ตั้งค่าระบบ' in side
    assert p.inner_text('#whoEmail') == ADMIN
    s = p.evaluate("JSON.parse(sessionStorage.getItem('hbt.session'))")
    assert s['token'] and s['user']['role'] == 'admin'
    c.shot('home-admin')
    no_errors(c)
    c.close()


@case('ล็อกอินไม่ผ่าน: นอกโดเมน / ไม่อยู่ในรายชื่อ / ถูกปิด / token ไม่ถูกต้อง แสดงข้อความถูกต้อง และลองใหม่ได้ในหน้าเดิม')
def _():
    seed(ADMIN, 'user.upsert', {'email': 'off@rmutr.ac.th', 'name': 'Off', 'systems': ['att']})
    seed(ADMIN, 'user.setActive', {'email': 'off@rmutr.ac.th', 'active': False})
    c = Ctx()
    p = c.page
    p.goto(BASE + '/t/login.html')
    c.sign_in('somchai@gmail.com', hd=None)
    p.wait_for_selector('#msg .callout.bad')
    t = p.inner_text('#msg')
    assert 'ใช้ได้เฉพาะบัญชีมหาวิทยาลัย' in t and 'somchai@gmail.com' in t, t
    c.sign_in('stranger@rmutr.ac.th')
    p.wait_for_function("document.querySelector('#msg').innerText.includes('ยังไม่ได้รับสิทธิ์')")
    assert 'stranger@rmutr.ac.th' in p.inner_text('#msg')
    c.sign_in('off@rmutr.ac.th')
    p.wait_for_function("document.querySelector('#msg').innerText.includes('ถูกปิดใช้งาน')")
    c.sign_in(ADMIN, aud='someone-elses-app')
    p.wait_for_function("document.querySelector('#msg').innerText.includes('ยืนยันตัวตนกับ Google ไม่สำเร็จ')")
    assert p.url.endswith('/t/login.html'), p.url
    assert p.evaluate("sessionStorage.getItem('hbt.session')") is None
    c.sign_in(ADMIN)          # ลองใหม่ในหน้าเดิม ต้องผ่าน
    p.wait_for_url('**/t/home.html')
    no_errors(c)
    c.close()


@case('เข้าหน้าที่ต้องล็อกอินก่อน → กลับมาหน้าเดิมหลังล็อกอิน; next ภายนอกถูกปฏิเสธ')
def _():
    c = Ctx()
    p = c.page
    p.goto(BASE + '/a/users.html')
    p.wait_for_url('**/t/login.html?why=need&next=a%2Fusers.html')
    c.sign_in(ADMIN)
    p.wait_for_url('**/a/users.html')
    p.wait_for_selector('h1:has-text("ผู้ใช้และสิทธิ์")')
    p.evaluate("sessionStorage.clear()")
    for bad in ['//evil.com/x.html', 'https://evil.com/x.html', '..%2F..%2Fx.html', 'javascript:alert(1)', '%2Fetc%2Fpasswd.html']:
        p.goto(BASE + '/t/login.html?next=' + bad)
        c.sign_in(ADMIN)
        p.wait_for_url('**/t/home.html')
        assert p.url.startswith(BASE + '/'), p.url
        p.evaluate("sessionStorage.clear()")
    no_errors(c)
    c.close()


@case('มีเซสชันอยู่แล้วเปิดหน้าล็อกอิน → ข้ามไปหน้าหลักเลย')
def _():
    c = Ctx()
    c.login_as(ADMIN)
    c.page.goto(BASE + '/t/login.html')
    c.page.wait_for_url('**/t/home.html')
    c.close()


@case('ออกจากระบบ: ล้างเซสชัน + กลับหน้าล็อกอิน + เข้าหน้าอื่นต้องล็อกอินใหม่')
def _():
    c = Ctx()
    p = c.page
    c.login_as(ADMIN)
    p.wait_for_selector('#logoutBtn')
    p.click('#logoutBtn')
    p.wait_for_url('**/t/login.html?why=bye')
    assert 'ออกจากระบบแล้ว' in p.inner_text('#msg')
    assert p.evaluate("sessionStorage.getItem('hbt.session')") is None
    p.goto(BASE + '/t/home.html')
    p.wait_for_url('**/t/login.html?why=need&next=t%2Fhome.html')
    no_errors(c)
    c.close()


@case('เซสชันถูกปลอม/หมดอายุ → เด้งไปล็อกอิน (expired) และล้างเซสชัน')
def _():
    c = Ctx()
    p = c.page
    c.login_as(ADMIN)
    p.evaluate("""() => { const s = JSON.parse(sessionStorage.getItem('hbt.session'));
        s.token = s.token.slice(0, -2) + 'AA'; sessionStorage.setItem('hbt.session', JSON.stringify(s)); }""")
    p.goto(BASE + '/a/users.html')
    p.wait_for_url('**/t/login.html?why=expired&next=a%2Fusers.html')
    assert 'เซสชันหมดอายุ' in p.inner_text('#msg')
    assert p.evaluate("sessionStorage.getItem('hbt.session')") is None
    no_errors(c)
    c.close()


@case('เซสชันที่หมดอายุตามเวลาในเครื่อง (expiresAt) ถูกทิ้งก่อนเรียก server')
def _():
    c = Ctx()
    p = c.page
    c.login_as(ADMIN)
    p.evaluate("""() => { const s = JSON.parse(sessionStorage.getItem('hbt.session')); s.expiresAt = Date.now() - 1000;
        sessionStorage.setItem('hbt.session', JSON.stringify(s)); }""")
    n0 = get('/__count')['apiCount']
    p.goto(BASE + '/t/home.html')
    p.wait_for_url('**/t/login.html?why=need**')
    assert get('/__count')['apiCount'] == n0
    c.close()


@case('บัญชีถูกปิดระหว่างใช้งาน → โหลดหน้าถัดไปแล้วเด้งออก (disabled)')
def _():
    seed(ADMIN, 'user.upsert', {'email': 't1@rmutr.ac.th', 'name': 'T1', 'systems': ['att']})
    c = Ctx()
    c.login_as('t1@rmutr.ac.th', 'T1')
    seed(ADMIN, 'user.setActive', {'email': 't1@rmutr.ac.th', 'active': False})
    c.page.goto(BASE + '/t/home.html')
    c.page.wait_for_url('**/t/login.html?why=disabled**')
    assert 'ถูกปิดใช้งาน' in c.page.inner_text('#msg')
    c.close()

# ---------------------------------------------------------------------------------------------
print('\nสิทธิ์ตามบทบาท')


@case('อาจารย์ทั่วไป: เห็นเฉพาะระบบที่มีสิทธิ์ ไม่เห็นเมนูผู้ดูแล และเข้า /a/* ไม่ได้')
def _():
    seed(ADMIN, 'user.upsert', {'email': 't1@rmutr.ac.th', 'name': 'อ.ทดสอบ หนึ่ง', 'systems': ['att']})
    c = Ctx()
    p = c.page
    c.login_as('t1@rmutr.ac.th', 'อ.ทดสอบ หนึ่ง')
    p.wait_for_selector('#sysCards')
    assert not p.locator('#admCard').count()
    side = p.inner_text('#side')
    assert 'ผู้ใช้และสิทธิ์' not in side and 'เช็คชื่อ' in side and 'สอบออนไลน์' not in side, side
    cards = {el.get_attribute('data-sys'): el.inner_text() for el in p.locator('#sysCards [data-sys]').all()}
    assert 'มีสิทธิ์' in cards['att'] and 'ไม่มีสิทธิ์' in cards['exam'] and 'ไม่มีสิทธิ์' in cards['asg'], cards
    assert 'ทดสอบ หนึ่ง' in p.inner_text('h1')
    for path in ['/a/users.html', '/a/settings.html']:
        p.goto(BASE + path)
        p.wait_for_selector('.callout.bad')
        assert 'ไม่มีสิทธิ์ใช้งานส่วนนี้' in p.inner_text('#content')
    # ต้องไม่ยิง API ของ admin เลยเมื่อไม่มีสิทธิ์ (หน้าไม่เรียก user.list)
    no_errors(c)
    c.close()


@case('อาจารย์ที่ยังไม่มีสิทธิ์ระบบใด: เห็นข้อความแจ้งให้ติดต่อผู้ดูแล')
def _():
    seed(ADMIN, 'user.upsert', {'email': 't2@rmutr.ac.th', 'name': 'T2', 'systems': []})
    c = Ctx()
    c.login_as('t2@rmutr.ac.th', 'T2')
    c.page.wait_for_selector('#noSys')
    c.close()


@case('ชื่อผู้ใช้ที่มี HTML ถูกแสดงเป็นข้อความ (ไม่รันสคริปต์) ทั้งหน้าหลัก/แถบบน/รายชื่อผู้ใช้')
def _():
    evil = '<img src=x onerror="window.__xss=1">'
    seed(ADMIN, 'user.upsert', {'email': 'x@rmutr.ac.th', 'name': evil, 'systems': ['att']})
    c = Ctx()
    p = c.page
    c.login_as('x@rmutr.ac.th', evil)
    p.wait_for_selector('#sysCards')
    assert p.evaluate('window.__xss') is None
    assert evil in p.inner_text('h1')
    assert p.locator('h1 img').count() == 0
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/users.html')
    p.wait_for_selector('#listBox table')
    assert p.evaluate('window.__xss') is None and p.locator('#listBox img').count() == 0
    assert evil in p.inner_text('#listBox')
    no_errors(c)
    c.close()

# ---------------------------------------------------------------------------------------------
print('\nจัดการผู้ใช้ (admin)')


@case('เพิ่ม/แก้ไข/ปิด-เปิดใช้งานผู้ใช้ และสรุปสิทธิ์อัปเดต')
def _():
    c = Ctx()
    p = c.page
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/users.html')
    p.wait_for_selector('#listBox table')
    p.click('#addBtn')
    assert p.locator('#mUser').is_visible()
    p.fill('#ue', 'Somchai@RMUTR.ac.th')
    p.fill('#un', 'อ.สมชาย ใจดี')
    p.check('input[name=sys][value=att]')
    p.check('input[name=sys][value=exam]')
    p.click('#saveBtn')
    p.wait_for_selector('tr[data-email="somchai@rmutr.ac.th"]')
    assert not p.locator('#mUser').is_visible()
    row = p.inner_text('tr[data-email="somchai@rmutr.ac.th"]')
    assert 'อ.สมชาย ใจดี' in row and 'เช็คชื่อ' in row and 'สอบออนไลน์' in row and 'ส่งงาน' not in row, row
    assert 'ยังไม่เคยเข้า' in row
    assert 'อ.สมชาย ใจดี' in p.inner_text('#sumBox')
    # แก้ไข
    p.click('tr[data-email="somchai@rmutr.ac.th"] button[data-act=edit]')
    assert p.is_disabled('#ue') and p.input_value('#ue') == 'somchai@rmutr.ac.th'
    assert p.is_checked('input[name=sys][value=att]') and not p.is_checked('input[name=sys][value=asg]')
    p.fill('#un', 'อ.สมชาย (แก้)')
    p.uncheck('input[name=sys][value=exam]')
    p.check('input[name=sys][value=asg]')
    p.click('#saveBtn')
    p.wait_for_function("document.querySelector('tr[data-email=\"somchai@rmutr.ac.th\"]').innerText.includes('(แก้)')")
    row = p.inner_text('tr[data-email="somchai@rmutr.ac.th"]')
    assert 'ส่งงาน' in row and 'สอบออนไลน์' not in row, row
    # ปิด-เปิด
    p.click('tr[data-email="somchai@rmutr.ac.th"] button[data-act=toggle]')
    p.wait_for_function("document.querySelector('tr[data-email=\"somchai@rmutr.ac.th\"]').innerText.includes('ปิดใช้งาน')")
    assert 'somchai' not in p.inner_text('#sumBox') and '(แก้)' not in p.inner_text('#sumBox')
    p.click('tr[data-email="somchai@rmutr.ac.th"] button[data-act=toggle]')
    p.wait_for_function("document.querySelector('tr[data-email=\"somchai@rmutr.ac.th\"] .pill.good') !== null")
    users = get('/__rows?sheet=Users')
    assert len(users) == 2, users
    c.shot('users-admin')
    no_errors(c)
    c.close()


@case('ฟอร์มผู้ใช้: ตรวจข้อมูลผิด (ชื่อว่าง/ต่างโดเมน/รูปแบบ) แสดงข้อความและไม่ปิดฟอร์ม; role admin ติ๊กทุกระบบอัตโนมัติ')
def _():
    c = Ctx()
    p = c.page
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/users.html')
    p.wait_for_selector('#listBox table')
    p.click('#addBtn')
    p.click('#saveBtn')
    assert 'กรุณากรอกอีเมล' in p.inner_text('#mErr')
    p.fill('#ue', 'a@rmutr.ac.th')
    p.click('#saveBtn')
    assert 'กรุณากรอกชื่อ' in p.inner_text('#mErr')
    p.fill('#un', 'A')
    p.fill('#ue', 'a@gmail.com')
    p.click('#saveBtn')
    p.wait_for_function("document.querySelector('#mErr').innerText.includes('โดเมน')")
    assert p.locator('#mUser').is_visible()
    p.fill('#ue', 'not-an-email')
    p.click('#saveBtn')
    p.wait_for_function("document.querySelector('#mErr').innerText.includes('รูปแบบอีเมล')")
    assert p.is_enabled('#saveBtn')                   # ปุ่มกลับมากดได้หลัง error
    p.select_option('#ur', 'admin')
    assert all(p.is_checked('input[name=sys][value=%s]' % s) and p.is_disabled('input[name=sys][value=%s]' % s) for s in ['att', 'exam', 'asg'])
    p.select_option('#ur', 'teacher')
    assert all(p.is_enabled('input[name=sys][value=%s]' % s) for s in ['att', 'exam', 'asg'])
    p.keyboard.press('Escape')
    assert not p.locator('#mUser').is_visible()
    assert len(get('/__rows?sheet=Users')) == 1
    no_errors(c)
    c.close()


@case('admin คนสุดท้าย: ปิดตัวเอง/ลดสิทธิ์ตัวเองไม่ได้ (แสดงข้อความ) และยังล็อกอินอยู่')
def _():
    c = Ctx()
    p = c.page
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/users.html')
    p.wait_for_selector('#listBox table')
    p.click('tr[data-email="%s"] button[data-act=toggle]' % ADMIN)       # dialog ถูก accept อัตโนมัติ
    p.wait_for_selector('.toast.bad')
    assert 'ผู้ดูแลระบบที่ใช้งานอยู่อย่างน้อย 1 คน' in p.inner_text('.toast.bad')
    assert p.url.endswith('/a/users.html')
    p.click('tr[data-email="%s"] button[data-act=edit]' % ADMIN)
    p.select_option('#ur', 'teacher')
    p.click('#saveBtn')
    p.wait_for_function("document.querySelector('#mErr').innerText.includes('อย่างน้อย 1 คน')")
    assert get('/__rows?sheet=Users')[0][2] == 'admin'
    no_errors(c)
    c.close()


@case('admin ปิดตัวเอง (มี admin อื่นอยู่) → ถูกเด้งออกทันที')
def _():
    seed(ADMIN, 'user.upsert', {'email': 'b@rmutr.ac.th', 'name': 'B', 'role': 'admin'})
    c = Ctx()
    p = c.page
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/users.html')
    p.wait_for_selector('#listBox table')
    p.click('tr[data-email="%s"] button[data-act=toggle]' % ADMIN)
    p.wait_for_url('**/t/login.html?why=disabled**')
    c.close()


@case('กดบันทึกซ้ำรัว ๆ ไม่สร้างซ้ำ (ปุ่มถูกล็อกระหว่างส่ง) และ error ของ lock/เครือข่ายส่งซ้ำด้วย opId เดิมแล้วทำครั้งเดียว')
def _():
    c = Ctx()
    p = c.page
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/users.html')
    p.wait_for_selector('#listBox table')
    state = {'n': 0}

    def handler(route):
        data = route.request.post_data or ''
        if '"user.upsert"' in data:
            state['n'] += 1
            if state['n'] == 1:
                route.fetch()                 # server ทำงานจริงแล้ว
                route.abort('failed')         # แต่ฝั่งเว็บไม่ได้รับคำตอบ (เน็ตหลุด)
                return
        route.continue_()
    p.route('**/api', handler)
    p.click('#addBtn')
    p.fill('#ue', 'retry@rmutr.ac.th')
    p.fill('#un', 'Retry')
    p.dblclick('#saveBtn')
    p.wait_for_selector('tr[data-email="retry@rmutr.ac.th"]', timeout=10000)
    assert state['n'] == 2, state                         # ส่งครั้งแรก (หลุด) + ส่งซ้ำ opId เดิม
    rows = [r for r in get('/__rows?sheet=Users') if r[0] == 'retry@rmutr.ac.th']
    audit = [r for r in get('/__rows?sheet=AuditLog') if r[3] == 'user.add' and r[4] == 'retry@rmutr.ac.th']
    assert len(rows) == 1 and len(audit) == 1, (rows, audit)
    no_errors(c)
    c.close()

# ---------------------------------------------------------------------------------------------
print('\nตั้งค่าระบบ (admin)')


@case('ภาคเรียน: เพิ่ม → อันแรกเป็นปัจจุบัน → เพิ่มอันสอง → สลับ → หน้าหลักแสดงภาคเรียนใหม่; ชื่อซ้ำแจ้ง error')
def _():
    c = Ctx()
    p = c.page
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/settings.html')
    p.wait_for_selector('#tnAdd')
    p.click('#tnAdd')
    assert 'กรุณาระบุชื่อภาคเรียน' in p.inner_text('#tnErr')
    p.fill('#tnName', '1/2569'); p.fill('#tnStart', '2026-08-11'); p.fill('#tnEnd', '2026-12-12')
    p.click('#tnAdd')
    p.wait_for_selector('#tcur')
    assert '1/2569 (ปัจจุบัน)' in p.inner_text('#tcur')
    assert '11 ส.ค. 2569 – 12 ธ.ค. 2569' in p.inner_text('#tRange'), p.inner_text('#tRange')
    p.fill('#tnName', '2/2569')
    p.click('#tnAdd')
    p.wait_for_function("document.querySelector('#tcur').options.length === 2")
    p.fill('#tnName', '2/2569')
    p.click('#tnAdd')
    p.wait_for_function("document.querySelector('#tnErr').innerText.includes('มีภาคเรียนชื่อนี้แล้ว')")
    p.fill('#tnName', 'X'); p.fill('#tnStart', '2026-12-12'); p.fill('#tnEnd', '2026-01-01')
    p.click('#tnAdd')
    assert 'วันสิ้นสุด' in p.inner_text('#tnErr')
    assert p.is_disabled('#tSet')
    p.select_option('#tcur', label='2/2569')
    assert p.is_enabled('#tSet')
    p.click('#tSet')
    p.wait_for_function("document.querySelector('#tcur').selectedOptions[0].innerText.includes('ปัจจุบัน')")
    assert '2/2569 (ปัจจุบัน)' in p.inner_text('#tcur')
    p.goto(BASE + '/t/home.html')
    p.wait_for_selector('#termLine')
    assert 'ภาคเรียน 2/2569' in p.inner_text('#termLine')
    assert p.locator('#noTerm').count() == 0
    no_errors(c)
    c.close()


@case('ค่าตั้งค่า: ปุ่มบันทึกเปิดเมื่อมีการแก้, ค่านอกช่วง/ว่าง/ไม่เลือกชนิดไฟล์ถูกกันที่หน้าเว็บ, บันทึกแล้วคงอยู่หลังรีโหลด')
def _():
    c = Ctx()
    p = c.page
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/settings.html')
    p.wait_for_selector('#st_file_max_mb')
    assert p.is_disabled('#setSave')
    assert p.input_value('#st_file_max_mb') == '5' and p.input_value('#st_att_radius_m') == '500'
    p.fill('#st_file_max_mb', '99')
    assert p.is_enabled('#setSave')
    n0 = get('/__count')['apiCount']
    p.click('#setSave')
    assert 'ต้องเป็นจำนวนเต็มระหว่าง 1 ถึง 6' in p.inner_text('#setErr')
    p.fill('#st_file_max_mb', '')
    p.click('#setSave')
    assert 'จำนวนเต็ม' in p.inner_text('#setErr')
    p.fill('#st_file_max_mb', '2.5')
    p.click('#setSave')
    assert 'จำนวนเต็ม' in p.inner_text('#setErr')
    assert get('/__count')['apiCount'] == n0, 'ค่าผิดต้องไม่ถูกส่งไป server'
    p.fill('#st_file_max_mb', '4')
    p.uncheck('[data-key=file_types] input[value=xlsx]')
    p.fill('#st_att_close_min', '25')
    assert '3 รายการ' in p.inner_text('#setHint')
    p.click('#setSave')
    p.wait_for_selector('.toast.good')
    assert p.is_disabled('#setSave') and 'ยังไม่มีการเปลี่ยนแปลง' in p.inner_text('#setHint')
    p.reload()
    p.wait_for_selector('#st_file_max_mb')
    assert p.input_value('#st_file_max_mb') == '4' and p.input_value('#st_att_close_min') == '25'
    assert not p.is_checked('[data-key=file_types] input[value=xlsx]') and p.is_checked('[data-key=file_types] input[value=pdf]')
    for t in ['pdf', 'jpg', 'png', 'docx', 'pptx']:
        p.uncheck('[data-key=file_types] input[value=%s]' % t)
    p.click('#setSave')
    assert 'อย่างน้อย 1 รายการ' in p.inner_text('#setErr')
    c.shot('settings-admin')
    no_errors(c)
    c.close()

# ---------------------------------------------------------------------------------------------
print('\nเครือข่าย / ข้อผิดพลาด')


@case('API ล่ม ตอนเปิดหน้า: แสดงการ์ด "โหลดไม่สำเร็จ" + ปุ่มลองใหม่ ใช้งานได้เมื่อกลับมา')
def _():
    c = Ctx()
    p = c.page
    c.login_as(ADMIN, 'ผู้ดูแล')
    p.route('**/api', lambda r: r.abort('failed'))
    p.goto(BASE + '/a/users.html')
    p.wait_for_selector('#retryBtn', timeout=15000)
    assert 'โหลดหน้านี้ไม่สำเร็จ' in p.inner_text('#app') and 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้' in p.inner_text('#app')
    p.unroute('**/api')
    p.click('#retryBtn')
    p.wait_for_selector('#listBox table')
    c.close()


@case('เซิร์ฟเวอร์ตอบมาไม่ใช่ JSON (เช่น หน้า error ของ Google) → แจ้งข้อความที่เข้าใจได้ ไม่ค้าง')
def _():
    c = Ctx()
    p = c.page
    c.login_as(ADMIN, 'ผู้ดูแล')
    p.route('**/api', lambda r: r.fulfill(status=200, content_type='text/html', body='<html>Error 500</html>'))
    p.goto(BASE + '/t/home.html')
    p.wait_for_selector('#retryBtn', timeout=15000)
    assert 'ตอบกลับไม่ถูกต้อง' in p.inner_text('#app')
    c.close()

# ---------------------------------------------------------------------------------------------
print('\nมือถือ / ธีม')

PAGES = ['/t/login.html', '/t/home.html', '/a/users.html', '/a/settings.html']


@case('มือถือ 360px และเดสก์ท็อป: ไม่มี scroll แนวนอนทุกหน้า (ทั้งสว่าง/มืด)')
def _():
    seed(ADMIN, 'user.upsert', {'email': 'long.long.long.long.name@rmutr.ac.th', 'name': 'อาจารย์ที่มีชื่อยาวมากๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆๆ', 'systems': ['att', 'exam', 'asg']})
    bad = []
    for scheme in ['light', 'dark']:
        for vp in [(360, 740), (1100, 800)]:
            c = Ctx(viewport=vp, scheme=scheme)
            p = c.page
            p.goto(BASE + '/t/login.html')
            c.sign_in(ADMIN, 'ผู้ดูแล')
            p.wait_for_url('**/t/home.html')
            for path in PAGES[1:] + PAGES[:1]:
                if path == '/t/login.html':
                    p.evaluate("sessionStorage.clear()")
                p.goto(BASE + path)
                p.wait_for_selector('#sysCards, #listBox table, #st_file_max_mb, #gbtn')
                p.wait_for_timeout(150)
                o = c.overflow()
                if o > 0:
                    bad.append((scheme, vp, path, o))
                if path == '/t/login.html':
                    pass
                c.shot('%s-%d-%s' % (scheme, vp[0], path.strip('/').replace('/', '_').replace('.html', '')))
            no_errors(c)
            c.close()
    assert not bad, bad


@case('มือถือ: ปุ่มเมนูเปิด-ปิดเมนูข้างได้')
def _():
    c = Ctx(viewport=(390, 800))
    p = c.page
    c.login_as(ADMIN, 'ผู้ดูแล')
    p.wait_for_selector('#menuBtn')
    assert not p.locator('#side').is_visible()
    p.click('#menuBtn')
    assert p.locator('#side').is_visible() and p.get_attribute('#menuBtn', 'aria-expanded') == 'true'
    p.click('#menuBtn')
    assert not p.locator('#side').is_visible()
    c.close()


finish()
