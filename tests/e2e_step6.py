"""e2e ขั้น 6: สำรองข้อมูลวิชา (Zip ในเบราว์เซอร์) + ผู้ดูแลลบข้อมูลสิ้นภาคเรียนถาวร (Core + Exam + Drive)"""
import io, json, urllib.request, zipfile
from e2e_lib import *

T1 = 't1@rmutr.ac.th'
T2 = 't2@rmutr.ac.th'
PIN = '1234'
STD = lambda i: str(660000 + i)


def api(action, args=None, token=''):
    req = urllib.request.Request(BASE + '/api', data=json.dumps({'action': action, 'token': token, 'args': args or {}}).encode(), method='POST')
    return json.loads(urllib.request.urlopen(req).read())


def exapi(as_, action, args=None):
    r = post('/__exseed', {'as': as_, 'action': action, 'args': args or {}})
    assert r.get('ok'), r
    return r['data']


def pdf(n=200, tag=b''):
    b = bytearray(b'%PDF-1.4\n' + tag)
    b += b'x' * (n - len(b))
    return bytes(b)


def mk_course(code, owner, name, n=3, term=None):
    cid = seed(owner, 'course.create', {'code': code, 'name': name, 'section': '1'})['courseId']
    seed(owner, 'student.importCsv', {'courseId': cid, 'rows': [{'stdId': STD(i), 'name': 'นักศึกษา %d' % i} for i in range(1, n + 1)]})
    return cid


def set_pins(cid):
    for c in seed(ADMIN, 'pin.issueTemp', {'courseId': cid, 'all': True})['codes']:
        r = api('pin.setWithTemp', {'courseId': cid, 'stdId': c['stdId'], 'tempPin': c['pin'], 'newPin': PIN})
        assert r['ok'], r


def upload(cid, i, asg, name, data):
    tok = api('stu.login', {'courseId': cid, 'stdId': STD(i), 'pin': PIN})['data']['token']
    r = api('stu.upload', {'asgId': asg, 'name': name, 'b64': __import__('base64').b64encode(data).decode()}, tok)
    assert r['ok'], r
    return r


def world():
    seed(ADMIN, 'term.create', {'name': '1/2569'})
    seed(ADMIN, 'user.upsert', {'email': T1, 'name': 'อ.หนึ่ง', 'systems': ['att', 'exam', 'asg']})
    seed(ADMIN, 'user.upsert', {'email': T2, 'name': 'อ.สอง', 'systems': ['att', 'exam', 'asg']})
    cid = mk_course('BIO101', T1, 'ชีววิทยา')
    cid2 = mk_course('CHM201', T2, 'เคมี', 2)
    set_pins(cid)
    seed(T1, 'att.import', {'courseId': cid, 'date': '2026-08-10', 'rows': [{'stdId': STD(1), 'status': 'normal'}]})
    a1 = seed(T1, 'asg.save', {'courseId': cid, 'title': 'รายงาน 1', 'kind': 'single', 'maxScore': 10})['asgId']
    a2 = seed(T1, 'asg.save', {'courseId': cid, 'title': 'รายงาน 2', 'kind': 'single', 'maxScore': 10})['asgId']
    b1 = seed(T2, 'asg.save', {'courseId': cid2, 'title': 'งานเคมี', 'kind': 'single', 'maxScore': 10})['asgId']
    upload(cid, 1, a1, 'a.pdf', pdf(200, b'A')); upload(cid, 2, a1, 'b.pdf', pdf(200, b'B')); upload(cid, 1, a2, 'c.pdf', pdf(200, b'C'))
    upload(cid2, 1, b1, 'k.pdf', pdf(200, b'K'))
    return dict(cid=cid, cid2=cid2, a1=a1, a2=a2, b1=b1)


def with_exam(w):
    """ข้อสอบมีรูปในวิชา 1 และ 2"""
    import base64
    png = base64.b64encode(b'\x89PNG\r\n\x1a\n' + b'0' * 200).decode()
    z = exapi(T1, 'exam.quiz.save', {'courseId': w['cid'], 'title': 'ชุดที่ 1'})['quizId']
    exapi(T1, 'exam.q.save', {'quizId': z, 'q_type': 'image', 'q_text': 'ข้อ 1', 'q_image': {'base64': png, 'name': 'q.png'}, 'correct': 0, 'score': 1,
                              'choices': [{'c_type': 'text', 'c_text': t} for t in ['ถูก', 'ผิด']]})
    z2 = exapi(T2, 'exam.quiz.save', {'courseId': w['cid2'], 'title': 'ชุดเคมี'})['quizId']
    exapi(T2, 'exam.q.save', {'quizId': z2, 'q_type': 'image', 'q_text': 'ข้อ 1', 'q_image': {'base64': png, 'name': 'k.png'}, 'correct': 0, 'score': 1,
                              'choices': [{'c_type': 'text', 'c_text': t} for t in ['ถูก', 'ผิด']]})


def rows_of(sheet):
    return get('/__rows?sheet=' + sheet)


def exrows_(sheet):
    return get('/__exrows?sheet=' + sheet)


def live(files):
    return [f for f in files if not f['trashed']]


def zip_of(dl):
    path = dl.path()
    return zipfile.ZipFile(path)


def collect(page, trigger, n, timeout=30000):
    """กดปุ่มแล้วรอดาวน์โหลด n ไฟล์ → คืน [(ชื่อ, ZipFile)]"""
    got = []
    page.on('download', lambda d: got.append(d))
    trigger()
    page.wait_for_function('1', timeout=1000)
    import time
    t = time.time()
    while len(got) < n and time.time() - t < timeout / 1000:
        page.wait_for_timeout(150)
    assert len(got) == n, 'ดาวน์โหลด %d ไฟล์ (คาด %d): %s' % (len(got), n, [d.suggested_filename for d in got])
    return [(d.suggested_filename, zip_of(d)) for d in got]


# ============================================================
print('\nอาจารย์: สำรองข้อมูล')


@case('หน้าสำรอง: ยังไม่เคยสำรอง → ดาวน์โหลดทั้งหมด = สรุปวิชา + Zip ต่องาน · เนื้อหาถูกต้อง · เสร็จครบแล้วบันทึก "สำรองครบ"')
def _():
    w = world(); with_exam(w)
    c = Ctx()
    c.login_as(T1, 'อ.หนึ่ง', to='/t/course.html?id=' + w['cid'])
    p = c.page
    p.wait_for_selector('#goBackup')
    assert 'ยังไม่เคยสำรอง' in p.inner_text('#bkPill')
    p.click('#goBackup')
    p.wait_for_selector('#bkState')
    assert p.get_attribute('#bkState', 'data-state') == 'none'
    items = p.locator('[data-item]')
    assert items.count() == 3, items.count()
    assert 'ไฟล์' in p.inner_text('[data-item="asg:%s"]' % w['a1'])
    c.shot('s6_backup_before')
    dls = collect(p, lambda: p.click('#backupAll'), 3)
    p.wait_for_function("document.getElementById('bkState').getAttribute('data-state')==='ok'")
    names = [n for n, _ in dls]
    summ = [z for n, z in dls if 'สรุปวิชา' in n]
    assert len(summ) == 1, names
    sn = summ[0].namelist()
    assert any(x.endswith('students.csv') for x in sn) and any(x.endswith('scores.csv') for x in sn) and any(x.endswith('attendance.csv') for x in sn), sn
    assert any(x.endswith('assignments-grades.csv') for x in sn) and any('exam/quiz_' in x for x in sn) and any(x.endswith('README.txt') for x in sn), sn
    stu = [x for x in sn if x.endswith('students.csv')][0]
    txt = summ[0].read(stu).decode('utf-8')
    assert STD(1) in txt and 'นักศึกษา 3' in txt, txt
    asgz = [z for n, z in dls if 'รายงาน_1' in n]
    assert len(asgz) == 1, names
    fl = [x for x in asgz[0].namelist() if x.endswith('.pdf')]
    assert len(fl) == 2 and all('/files/' in x and (STD(1) in x or STD(2) in x) for x in fl), asgz[0].namelist()
    body = asgz[0].read(fl[0])
    assert body.startswith(b'%PDF') and len(body) == 200, len(body)
    assert any(x.endswith('submissions.csv') for x in asgz[0].namelist())
    # ฝั่งเซิร์ฟเวอร์บันทึกแล้ว + หน้าวิชาแสดงสำรองแล้ว
    p.goto(BASE + '/t/course.html?id=' + w['cid'])
    p.wait_for_selector('#bkPill')
    assert 'สำรองแล้ว' in p.inner_text('#bkPill'), p.inner_text('#bkPill')
    assert len([r for r in rows_of('AuditLog') if 'backup.mark' in r]) == 1
    no_errors(c)


@case('ไฟล์ใหญ่แบ่งหลายส่วน: งานที่มี 2 ไฟล์ แบ่งส่วนละไฟล์ → Zip 2 ส่วน ชื่อบอก "ส่วน 1 จาก 2" · ทุกส่วนมี submissions.csv')
def _():
    w = world()
    c = Ctx()
    c.page.add_init_script('window.HBT_BACKUP_PART_BYTES = 250;')
    c.login_as(T1, 'อ.หนึ่ง', to='/t/backup.html?id=' + w['cid'])
    p = c.page
    p.wait_for_selector('[data-item="asg:%s"]' % w['a1'])
    dls = collect(p, lambda: p.click('[data-dl="asg:%s"]' % w['a1']), 2)
    ns = sorted(n for n, _ in dls)
    assert 'ส่วน1จาก2' in ns[0] and 'ส่วน2จาก2' in ns[1], ns
    for n, z in dls:
        assert any(x.endswith('submissions.csv') for x in z.namelist())
        assert len([x for x in z.namelist() if x.endswith('.pdf')]) == 1
    p.wait_for_function("document.querySelector('[data-item=\"asg:%s\"]').getAttribute('data-status')==='done'" % w['a1'])
    assert p.get_attribute('#bkState', 'data-state') == 'none'              # ทำรายการเดียว ยังไม่ครบ → ยังไม่บันทึกว่าสำรองครบ
    no_errors(c)


@case('ดึงไฟล์ไม่สำเร็จ → รายการ "ไม่ครบ" ไม่บันทึกสำรองครบ + README บอกไฟล์ที่พลาด · ลองใหม่สำเร็จ → บันทึกครบ')
def _():
    w = world()
    bad = [r[0] for r in rows_of('AsgFiles') if r[2] == w['a1']][0]
    c = Ctx()
    c.login_as(T1, 'อ.หนึ่ง', to='/t/backup.html?id=' + w['cid'])
    p = c.page
    state = {'block': True}

    def handler(route):
        pd = route.request.post_data or ''
        if state['block'] and '"asg.fileGet"' in pd and bad in pd:
            return route.fulfill(content_type='application/json', body=json.dumps({'ok': False, 'error': {'code': 'E_NOT_FOUND', 'msg': 'ไม่พบไฟล์'}}))
        route.continue_()
    p.route('**/api', handler)
    p.wait_for_selector('#backupAll')
    dls = collect(p, lambda: p.click('#backupAll'), 3)
    p.wait_for_function("document.querySelector('[data-item=\"asg:%s\"]').getAttribute('data-status')==='partial'" % w['a1'])
    assert p.get_attribute('#bkState', 'data-state') == 'none'
    z = [z for n, z in dls if 'รายงาน_1' in n][0]
    rd = z.read([x for x in z.namelist() if x.endswith('README.txt')][0]).decode('utf-8')
    assert 'ดึงไฟล์ไม่สำเร็จ 1 ไฟล์' in rd, rd
    # ลองใหม่เฉพาะที่ค้าง
    state['block'] = False
    got = collect(p, lambda: p.click('[data-dl="asg:%s"]' % w['a1']), 1)
    p.wait_for_function("document.getElementById('bkState').getAttribute('data-state')==='ok'")
    no_errors(c)


@case('สถานะ: แก้ข้อมูลหลังสำรอง → "มีแก้ไขหลังสำรอง" · วิชาว่างไม่มีอะไรให้สำรอง (ปุ่มปิด)')
def _():
    w = world()
    c = Ctx()
    c.login_as(T1, 'อ.หนึ่ง', to='/t/backup.html?id=' + w['cid'])
    p = c.page
    p.wait_for_selector('#backupAll')
    collect(p, lambda: p.click('#backupAll'), 3)
    p.wait_for_function("document.getElementById('bkState').getAttribute('data-state')==='ok'")
    post('/__advance', {'min': 2})
    seed(T1, 'att.import', {'courseId': w['cid'], 'date': '2026-08-11', 'rows': [{'stdId': STD(2), 'status': 'normal'}]})
    p.goto(BASE + '/t/backup.html?id=' + w['cid'])
    p.wait_for_selector('#bkState')
    assert p.get_attribute('#bkState', 'data-state') == 'stale'
    # วิชาว่าง
    e = seed(T1, 'course.create', {'code': 'EMP100', 'name': 'ว่าง', 'section': '1'})['courseId']
    p.goto(BASE + '/t/backup.html?id=' + e)
    p.wait_for_selector('#bkState')
    assert p.get_attribute('#bkState', 'data-state') == 'empty'
    assert p.locator('#backupAll[disabled]').count() == 1


@case('สิทธิ์: อาจารย์อื่นเปิดหน้าสำรองของวิชาที่ไม่ใช่ของตัวเองไม่ได้ · admin เปิดได้ · มือถือไม่ล้นจอ')
def _():
    w = world()
    c = Ctx(viewport=(390, 800))
    c.login_as(T2, 'อ.สอง', to='/t/backup.html?id=' + w['cid'])
    p = c.page
    p.wait_for_selector('.callout.bad')
    assert 'ไม่พบรายวิชานี้' in p.inner_text('#box')
    assert p.locator('#backupAll').count() == 0
    c2 = Ctx(viewport=(390, 800))
    c2.login_as(ADMIN, 'ผู้ดูแล', to='/t/backup.html?id=' + w['cid'])
    c2.page.wait_for_selector('#backupAll')
    assert c2.overflow() <= 1, c2.overflow()
    c2.shot('s6_backup_mobile')


# ============================================================
print('\nผู้ดูแล: ลบข้อมูลสิ้นภาคเรียน')


def pick(p, cid):
    p.check('[data-pick="%s"]' % cid)


@case('หน้าลบ: เฉพาะ admin · แสดงจำนวนต่อวิชา+สถานะสำรอง · เลือกวิชาที่ยังไม่สำรอง = คำเตือนรายชื่อ (ยังกดลบต่อได้)')
def _():
    w = world(); with_exam(w)
    seed(T2, 'backup.mark', {'courseId': w['cid2']})
    t = Ctx()
    t.login_as(T1, 'อ.หนึ่ง', to='/a/reset.html')
    t.page.wait_for_selector('.callout.bad, #rsTerm', state='attached')
    assert t.page.locator('#rsTerm').count() == 0
    c = Ctx()
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/reset.html')
    p = c.page
    p.wait_for_selector('#rsTbl')
    assert p.locator('#rsTbl tbody tr').count() == 2
    r1 = p.inner_text('[data-course="%s"]' % w['cid'])
    assert '3 นศ.' in r1 and '2 งาน' in r1 and '3 ไฟล์' in r1 and 'ยังไม่สำรอง' in r1 and '1 ชุด' in r1 and '1 รูป' in r1, r1
    assert 'สำรองครบ' in p.inner_text('[data-course="%s"]' % w['cid2'])
    assert p.locator('#rsDelete[disabled]').count() == 1
    pick(p, w['cid2'])
    assert p.locator('#rsUnsafe').count() == 0
    pick(p, w['cid'])
    assert 'BIO101-1' in p.inner_text('#rsUnsafe') and 'CHM201' not in p.inner_text('#rsUnsafe')
    assert p.locator('#rsDelete[disabled]').count() == 0
    c.shot('s6_reset_warn')
    p.click('#pickOk')                                                  # เลือกเฉพาะที่สำรองครบ
    assert p.locator('#rsUnsafe').count() == 0 and p.locator('[data-pick]:checked').count() == 1
    no_errors(c)


@case('ลบ 1 วิชา: ต้องพิมพ์รหัสวิชา-กลุ่มให้ตรงก่อน → ลบถาวรทุกระบบ (Core+Drive+Exam+รูป) · วิชาอื่นครบเหมือนเดิม')
def _():
    w = world(); with_exam(w)
    d0 = live(get('/__drive')['files']); x0 = live(get('/__exdrive')['files'])
    assert len(d0) == 4 and len(x0) == 2, (len(d0), len(x0))
    c = Ctx()
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/reset.html')
    p = c.page
    p.wait_for_selector('#rsTbl')
    pick(p, w['cid'])
    p.click('#rsDelete')
    assert p.is_visible('#mDel')
    p.fill('#rsConfirm', 'BIO101')
    assert p.locator('#rsGo[disabled]').count() == 1
    p.fill('#rsConfirm', ' bio101 - 1 ')
    assert p.locator('#rsGo[disabled]').count() == 0
    c.shot('s6_reset_confirm')
    p.click('#rsGo')
    p.wait_for_selector('#rsDoneBox')
    assert p.get_attribute('[data-rs="%s"]' % w['cid'], 'data-rs-status') == 'done'
    assert 'ถังขยะ' not in p.inner_text('#rsDoneBox')
    c.shot('s6_reset_done')
    ids = [r[0] for r in rows_of('Courses')]
    assert w['cid'] not in ids and w['cid2'] in ids, ids
    assert len(rows_of('Students')) == 2                           # เหลือเฉพาะวิชาเคมี
    assert len(rows_of('AsgFiles')) == 1 and len(rows_of('Assignments')) == 1
    d1 = get('/__drive')['files']; x1 = get('/__exdrive')['files']
    assert len(live(d1)) == 1 and len(d1) == 1, d1                      # ลบถาวร ไม่ใช่ถังขยะ
    assert len(live(x1)) == 1 and len(x1) == 1, x1
    assert len(exrows_('Quizzes')) == 1
    # รายการรีเฟรช → เหลือวิชาเดียว
    p.click('#rsRefresh')
    p.wait_for_function("document.querySelectorAll('#rsTbl tbody tr').length===1")
    no_errors(c)


@case('ลบหลายวิชา: ต้องพิมพ์ชื่อภาคเรียน → ทั้งสองวิชาหาย · ภาคเรียนปัจจุบันลบชื่อไม่ได้')
def _():
    w = world(); with_exam(w)
    c = Ctx()
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/reset.html')
    p = c.page
    p.wait_for_selector('#rsTbl')
    assert p.locator('#rsCurNote').count() == 1
    p.click('#pickAll'); p.click('#rsDelete')
    p.fill('#rsConfirm', 'BIO101-1')
    assert p.locator('#rsGo[disabled]').count() == 1
    p.fill('#rsConfirm', '1/2569')
    p.click('#rsGo')
    p.wait_for_selector('#rsDoneBox')
    assert 'ลบเสร็จ 2 วิชา' in p.inner_text('#rsDoneBox')
    assert len(rows_of('Courses')) == 0 and len(rows_of('Students')) == 0 and len(exrows_('Quizzes')) == 0
    assert get('/__drive')['files'] == [] and get('/__exdrive')['files'] == []
    p.click('#rsRefresh')
    p.wait_for_selector('#rsEmpty')
    assert p.locator('#rtOpen').count() == 0                            # ภาคเรียนปัจจุบัน → ไม่มีปุ่มลบภาคเรียน
    no_errors(c)


@case('Exam ล่ม: ลบไม่เริ่ม (ไม่ลบอะไรเลย) แสดง error · Exam กลับมา → "ทำต่อ" สำเร็จ ')
def _():
    w = world(); with_exam(w)
    c = Ctx()
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/reset.html')
    p = c.page
    p.wait_for_selector('#rsTbl')
    post('/__mode', {'exam': 'down'})
    pick(p, w['cid']); p.click('#rsDelete'); p.fill('#rsConfirm', 'BIO101-1'); p.click('#rsGo')
    p.wait_for_selector('#rsRetry')
    assert p.get_attribute('[data-rs="%s"]' % w['cid'], 'data-rs-status') == 'err'
    assert 'ยังไม่ได้ลบอะไร' in p.inner_text('[data-rs="%s"]' % w['cid'])
    assert len(rows_of('Students')) == 5 and len(rows_of('Courses')) == 2
    post('/__mode', {'exam': 'ok'})
    p.click('#rsRetry')
    p.wait_for_selector('#rsDoneBox')
    assert len(rows_of('Courses')) == 1
    no_errors(c)


@case('ลบภาคเรียนที่ว่าง: เลือกภาคเรียนเก่า → การ์ดลบภาคเรียน → พิมพ์ชื่อผิดถูกปฏิเสธ → พิมพ์ถูกลบได้ · ภาคเรียนที่ยังมีวิชาไม่มีการ์ด')
def _():
    w = world()
    seed(ADMIN, 'term.create', {'name': '2/2569'})                      # ภาคเรียนใหม่ (ตั้งเป็นปัจจุบัน → 1/2569 กลายเป็นเก่า)
    terms = seed(ADMIN, 'term.list')['terms']
    t2 = [t for t in terms if t['name'] == '2/2569'][0]['termId']
    t1 = [t for t in terms if t['name'] == '1/2569'][0]['termId']
    seed(ADMIN, 'term.setCurrent', {'termId': t2})
    c = Ctx()
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/reset.html')
    p = c.page
    p.wait_for_selector('#rsEmpty')                                     # ภาคเรียนปัจจุบัน 2/2569 ว่าง แต่เป็นปัจจุบัน
    assert p.locator('#rtOpen').count() == 0
    p.select_option('#rsTerm', t1)
    p.wait_for_selector('#rsTbl')
    assert p.locator('#rtOpen').count() == 0                            # ยังมีวิชา
    p.click('#pickAll'); p.click('#rsDelete'); p.fill('#rsConfirm', '1/2569'); p.click('#rsGo')
    p.wait_for_selector('#rsDoneBox')
    p.click('#rsRefresh')
    p.wait_for_selector('#rtOpen')
    p.click('#rtOpen')
    p.fill('#rtConfirm', 'ผิด'); p.click('#rtGo')
    p.wait_for_function("document.getElementById('mTermErr').textContent.length>0")
    p.fill('#rtConfirm', '1/2569'); p.click('#rtGo')
    p.wait_for_function("![...document.querySelectorAll('#rsTerm option')].some(o=>o.textContent.includes('1/2569'))")
    assert [t['name'] for t in seed(ADMIN, 'term.list')['terms']] == ['2/2569']
    no_errors(c)


@case('PIN ที่ไม่มีวิชา: ตรวจจำนวนก่อน → ลบ · ไม่แตะ PIN ของคนที่ยังอยู่วิชาอื่น')
def _():
    w = world()
    c = Ctx()
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/reset.html')
    p = c.page
    p.wait_for_selector('#pinDry')
    p.click('#pinDry')
    p.wait_for_function("document.getElementById('pinOut').textContent.length>0")
    assert 'ไม่มี PIN ที่ต้องลบ' in p.inner_text('#pinOut') and p.is_hidden('#pinDel')
    # ลบวิชา 1 (นศ. 660001-3) → 660003 ไม่เหลือวิชาใด (วิชา 2 มี 660001-2)
    p.wait_for_selector('#rsTbl')
    pick(p, w['cid']); p.click('#rsDelete'); p.fill('#rsConfirm', 'BIO101-1'); p.click('#rsGo'); p.wait_for_selector('#rsDoneBox')
    n0 = len(get('/__rows?sheet=StudentPIN'))
    p.click('#pinDry')
    p.wait_for_selector('#pinDel:not([hidden])')
    assert 'พบ PIN' in p.inner_text('#pinOut')
    p.click('#pinDel')
    p.wait_for_function("document.getElementById('pinOut').textContent.includes('ลบ PIN')")
    assert len(get('/__rows?sheet=StudentPIN')) == n0 - 1
    no_errors(c)


@case('มือถือ: หน้าลบข้อมูลไม่ล้นจอ (ตารางเลื่อนในกรอบ) · ปุ่มเมนูผู้ดูแลมีลิงก์หน้าลบ')
def _():
    w = world()
    c = Ctx(viewport=(390, 800))
    c.login_as(ADMIN, 'ผู้ดูแล', to='/a/reset.html')
    p = c.page
    p.wait_for_selector('#rsTbl')
    assert c.overflow() <= 1, c.overflow()
    c.shot('s6_reset_mobile')
    assert p.locator('#side a[href$="a/reset.html"]').count() == 1
    p.goto(BASE + '/t/home.html'); p.wait_for_selector('#goReset')


finish()
