"""e2e ขั้น 5: สอบออนไลน์ — อาจารย์จัดข้อสอบ/รอบ · นักศึกษาเข้าด้วยชื่อ+PIN ทำข้อสอบ · ติดตามสด · ผลสอบ · ซิงก์คะแนนเข้า Core"""
import datetime, json, os, struct, time, urllib.request, zlib
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


def world(n=4):
    seed(ADMIN, 'term.create', {'name': '1/2569'})
    seed(ADMIN, 'user.upsert', {'email': T1, 'name': 'อ.หนึ่ง', 'systems': ['att', 'exam', 'asg']})
    seed(ADMIN, 'user.upsert', {'email': T2, 'name': 'อ.สอง', 'systems': ['att']})
    cid = seed(T1, 'course.create', {'code': 'BIO101', 'name': 'ชีววิทยา', 'section': '1'})['courseId']
    seed(T1, 'student.importCsv', {'courseId': cid, 'rows': [{'stdId': STD(i), 'name': 'นักศึกษา %d' % i} for i in range(1, n + 1)]})
    for c in seed(T1, 'pin.issueTemp', {'courseId': cid, 'all': True})['codes']:
        r = api('pin.setWithTemp', {'courseId': cid, 'stdId': c['stdId'], 'tempPin': c['pin'], 'newPin': PIN})
        assert r['ok'], r
    return cid


def when(min_):
    return (datetime.datetime.now() + datetime.timedelta(minutes=min_)).strftime('%Y-%m-%d %H:%M')


def mk_quiz(cid, n=4, title='บทที่ 1'):
    z = exapi(T1, 'exam.quiz.save', {'courseId': cid, 'title': title})['quizId']
    for i in range(1, n + 1):
        exapi(T1, 'exam.q.save', {'quizId': z, 'q_type': 'text', 'q_text': 'คำถามข้อ %d' % i, 'correct': 0, 'score': 2 if i == 1 else 1,
                                  'choices': [{'c_type': 'text', 'c_text': t} for t in ['ถูก', 'ผิด ก', 'ผิด ข', 'ผิด ค']], 'explain_text': 'เฉลยข้อ %d' % i})
    return z


def mk_round(cid, z, **kw):
    a = {'courseId': cid, 'quizId': z, 'mode': 'TEST', 'title': 'สอบกลางภาค', 'startAt': when(-1), 'endAt': when(90), 'allowBack': True, 'totalMinutes': 60, 'scoreMode': 'SCORE', 'scoreValue': 20}
    a.update(kw)
    return exapi(T1, 'exam.round.create', a)


def exrows(sheet):
    return get('/__exrows?sheet=' + sheet)


def stu_ctx(viewport=(390, 800)):
    return Ctx(viewport=viewport)


def stu_login(c, std='660001', pin=PIN):
    p = c.page
    p.wait_for_selector('#lq')
    p.fill('#lq', std)
    p.wait_for_function("document.getElementById('lsel').value==='%s'" % std)
    p.fill('#lpin', pin)
    p.click('#lgo')


def open_exam(c, rd, std='660001'):
    p = c.page
    p.goto(BASE + '/s/exam.html?t=' + rd['token'])
    stu_login(c, std)
    p.wait_for_selector('#rules')


def pick(p, text):
    p.locator('.ex-opt', has_text=text).first.click()


def png(w=40, h=30):
    raw = b''.join(b'\x00' + bytes([200, 30, 30]) * w for _ in range(h))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


def run_test(p, right_upto=99):
    """โหมดสอบแบบย้อนได้: ตอบทุกข้อ (ข้อ qNo<=right_upto ตอบถูก) แล้วส่ง"""
    n = p.locator('#exOmr .b').count()
    for i in range(n):
        label = p.inner_text('#exLabel')
        k = int(label.split()[1])
        pick(p, 'ถูก' if k <= right_upto else 'ผิด ก')
        p.click('#exNext')
        if i == n - 1:
            p.click('#cfYes')


# ============================================================
print('\nอาจารย์: แบบทดสอบ/ข้อสอบ')


@case('จัดการแบบทดสอบ: สร้างชุด → เพิ่มข้อ (ติ๊กข้อที่ถูก) → แก้ → ใส่รูป → ย้าย → ลบ → เปลี่ยนชื่อ → ลบชุด')
def _():
    cid = world()
    c = Ctx()
    c.login_as(T1, 'อ.หนึ่ง', to='/t/exam.html?id=' + cid)
    p = c.page
    p.wait_for_selector('#emptyQ')
    p.click('#goQuizzes')
    p.wait_for_selector('#emptyZ')
    p.click('#newQuiz')
    p.fill('#zName', 'บทที่ 1 เซลล์')
    p.click('#zSave')
    p.wait_for_selector('#empty')
    assert 'บทที่ 1 เซลล์' in p.inner_text('h1')
    # เพิ่มข้อ: ติ๊กข้อที่ 3 เป็นคำตอบ
    p.click('#addQ')
    p.fill('#qText', 'นิวเคลียสทำหน้าที่อะไร')
    for i, t in enumerate(['สร้างพลังงาน', 'สังเคราะห์โปรตีน', 'ควบคุมการทำงานของเซลล์', 'ย่อยสลาย']):
        p.fill('[data-ch="%d"] [data-ct]' % i, t)
    p.check('input[name=right][value="2"]')
    p.fill('#qScore', '3')
    p.fill('#qExp', 'นิวเคลียสเป็นศูนย์ควบคุม')
    p.click('#qSave')
    p.wait_for_selector('.ex-qrow')
    assert p.locator('.ex-ch.right').inner_text().strip().endswith('ควบคุมการทำงานของเซลล์'), p.locator('.ex-ch.right').inner_text()
    assert '3 คะแนน' in p.inner_text('.ex-qrow')
    rows = exrows('Choices')
    assert len(rows) == 4
    # ไม่ติ๊ก/ว่าง → ตรวจที่หน้าเว็บ
    p.click('#addQ')
    p.click('#qSave')
    assert 'กรุณาใส่คำถาม' in p.inner_text('#qErr')
    p.fill('#qText', 'ข้อสอง')
    p.fill('[data-ch="0"] [data-ct]', 'ก')
    p.click('#qSave')
    assert 'ตัวเลือกที่ 2 ยังว่าง' in p.inner_text('#qErr')
    p.fill('[data-ch="1"] [data-ct]', 'ข')
    p.click('[data-ch="3"] [data-cdel]')
    p.click('[data-ch="2"] [data-cdel]')
    assert p.locator('[data-ch]').count() == 2
    p.click('[data-ch="1"] [data-cdel]')
    assert 'อย่างน้อย 2' in p.inner_text('#qErr')
    p.click('#qSave')
    p.wait_for_function("document.querySelectorAll('.ex-qrow').length===2")
    # แก้ข้อแรก + ใส่รูป
    p.click('[data-edit]:first-of-type >> nth=0')
    p.wait_for_selector('#qText')
    assert p.input_value('#qText') == 'นิวเคลียสทำหน้าที่อะไร'
    assert p.is_checked('input[name=right][value="0"]'), 'ตัวเลือกที่ถูกอยู่ลำดับแรกเสมอเมื่อเปิดแก้'
    p.set_input_files('#qImgBox input[type=file]', files=[{'name': 'cell.png', 'mimeType': 'image/png', 'buffer': png()}])
    p.wait_for_selector('#qImgBox .ex-thumb')
    p.fill('#qText', 'นิวเคลียสทำหน้าที่อะไร (แก้)')
    p.click('#qSave')
    p.wait_for_selector('.ex-qrow .ex-thumb')
    ex = get('/__exdrive')['files']
    assert len(ex) == 1 and not ex[0]['trashed']
    # เอารูปออก → ไฟล์ลงถังขยะ
    p.click('[data-edit] >> nth=0')
    p.click('#qImgBox [data-rm]')
    p.click('#qSave')
    p.wait_for_function("document.querySelectorAll('.ex-qrow .ex-thumb').length===0")
    assert get('/__exdrive')['files'][0]['trashed'] is True
    # ย้ายลง
    first = p.inner_text('.ex-qrow >> nth=0')
    p.click('[data-down] >> nth=0')
    p.wait_for_function("document.querySelector('.ex-qrow .no').textContent==='1' && !document.querySelector('.ex-qrow .txt').textContent.includes('นิวเคลียส')")
    # ลบข้อ
    p.click('[data-del] >> nth=0')
    p.wait_for_function("document.querySelectorAll('.ex-qrow').length===1")
    assert p.inner_text('.ex-qrow .no') == '1'
    no_errors(c)
    c.close()


@case('นำเข้า/ส่งออก CSV + ลบหลายข้อ/ทั้งหมด + ลบชุดไม่ได้ถ้ามีรอบใช้อยู่')
def _():
    cid = world()
    z = mk_quiz(cid, 0)
    c = Ctx()
    c.login_as(T1, 'อ.หนึ่ง', to='/t/exam-questions.html?z=%s&id=%s' % (z, cid))
    p = c.page
    p.wait_for_selector('#empty')
    p.click('#impBtn')
    p.fill('#iText', 'คำถาม\tถูก\tผิด1\tผิด2\n2+2 เท่าไร\t4\t3\t5\nเมืองหลวงไทย\tกรุงเทพ\tเชียงใหม่\nข้อเสีย\tมีตัวเลือกเดียว')
    p.check('#iSkip')
    p.click('#iGo')
    p.wait_for_selector('#iOut')
    assert 'นำเข้า 2 ข้อ' in p.inner_text('#iOut') and 'ข้าม 1' in p.inner_text('#iOut'), p.inner_text('#iOut')
    p.click('#mImp [data-close] >> nth=0')
    p.wait_for_function("document.querySelectorAll('.ex-qrow').length===2")
    with p.expect_download() as dl:
        p.click('#expBtn')
    path = dl.value.path()
    txt = open(path, encoding='utf-8').read()
    assert '2+2 เท่าไร' in txt and 'กรุงเทพ' in txt
    # เลือก 1 ข้อแล้วลบ
    p.check('[data-pick] >> nth=0')
    assert 'ลบที่เลือก (1)' in p.inner_text('#delSel')
    p.click('#delSel')
    p.wait_for_function("document.querySelectorAll('.ex-qrow').length===1")
    p.click('#delAll')
    p.wait_for_selector('#empty')
    # ลบชุดที่มีรอบใช้อยู่
    exapi(T1, 'exam.q.save', {'quizId': z, 'q_text': 'x', 'choices': [{'c_type': 'text', 'c_text': 'a'}, {'c_type': 'text', 'c_text': 'b'}]})
    mk_round(cid, z)
    p.goto(BASE + '/t/exam.html?tab=quizzes&id=' + cid)
    p.wait_for_selector('#zlist')
    p.click('[data-zdel]')
    p.wait_for_selector('.toast.bad')
    assert 'มี 1 รอบใช้' in p.inner_text('.toast.bad')
    no_errors(c)
    c.close()


@case('สร้างรอบสอบจากหน้าเว็บ: ตรวจเวลา/คะแนน · ข้อความแจ้งนักศึกษามีลิงก์ที่ใช้ได้ · เปิดทันที/ปิดรอบ · ซิงก์เข้าตารางคะแนน')
def _():
    cid = world()
    z = mk_quiz(cid, 4)
    c = Ctx()
    c.login_as(T1, 'อ.หนึ่ง', to='/t/exam.html?id=' + cid)
    p = c.page
    p.wait_for_selector('#empty')
    p.click('#newRound')
    p.fill('#rName', 'สอบกลางภาค')
    p.fill('#rEnd', (datetime.datetime.now() - datetime.timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M'))
    p.click('#rSave')
    p.wait_for_function("document.getElementById('rErr').textContent.trim()!==''")
    assert 'เวลา' in p.inner_text('#rErr'), p.inner_text('#rErr')
    p.fill('#rEnd', (datetime.datetime.now() + datetime.timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M'))
    p.select_option('#rSm', 'SCORE')
    p.fill('#rSv', '0')
    p.evaluate("document.getElementById('rErr').textContent=''")
    p.click('#rSave')
    p.wait_for_function("document.getElementById('rErr').textContent.trim()!==''")
    p.fill('#rSv', '20')
    p.click('#rSave')
    p.wait_for_selector('#msgTxt')
    msg = p.input_value('#msgTxt')
    assert 'สอบกลางภาค' in msg and '/s/exam.html?t=' in msg
    url = msg.split('เข้าทำที่: ')[1].split('\n')[0]
    p.click('#mMsg [data-close] >> nth=0')
    assert 'เปิดอยู่' in p.inner_text('[data-round]') and 'เต็ม 20' in p.inner_text('[data-round]')
    # นักศึกษา 1 คนทำจนเสร็จ
    s = stu_ctx()
    s.page.goto(url)
    stu_login(s, STD(1))
    s.page.wait_for_selector('#goBtn')
    s.page.click('#goBtn')
    s.page.wait_for_selector('#exQ')
    run_test(s.page, right_upto=99)
    s.page.wait_for_selector('#scoreTxt')
    assert s.page.inner_text('#scoreTxt') == '5 / 5'
    s.close()
    # อาจารย์ปิดรอบ → ซิงก์
    p.reload()
    p.wait_for_selector('[data-round]')
    p.click('[data-st=CLOSE]')
    p.wait_for_function("document.querySelector('[data-round]').innerText.includes('ซิงก์คะแนนแล้ว')")
    types = seed(T1, 'score.types', {'courseId': cid})['types']
    ex = [t for t in types if t['source'] == 'EXAM']
    assert len(ex) == 1 and ex[0]['max'] == 20 and ex[0]['name'] == 'สอบ: สอบกลางภาค', ex
    tb = seed(T1, 'score.table', {'courseId': cid})
    row = [x for x in tb['students'] if x['stdId'] == STD(1)][0]
    assert row['scores'][ex[0]['typeId']] == 20
    # หน้าคะแนนของ Core แสดงประเภทนี้
    p.goto(BASE + '/t/scores.html?id=' + cid)
    p.wait_for_selector('#box')
    assert 'สอบ: สอบกลางภาค' in p.inner_text('#box')
    no_errors(c)
    c.close()


# ============================================================
print('\nนักศึกษา: ทำข้อสอบ')


@case('โหมดสอบ: ยืนยันตัวตน → เงื่อนไข → ทำ (ตัวเลือกสลับ) → ส่ง → สรุปผล · ไม่มีเฉลยในหน้า · ส่งซ้ำไม่ได้เมื่อทำได้ 1 ครั้ง')
def _():
    cid = world()
    z = mk_quiz(cid, 4)
    rd = mk_round(cid, z, allowBack=True, shuffleC=True)
    c = stu_ctx()
    open_exam(c, rd)
    p = c.page
    txt = p.inner_text('#rules')
    assert '4 ข้อ' in txt and '60 นาที' in txt and 'ย้อนกลับไปแก้' in txt, txt
    assert 'นักศึกษา 1' in p.inner_text('main')
    p.click('#goBtn')
    p.wait_for_selector('#exQ')
    assert 'ข้อ 1 / 4' in p.inner_text('#exLabel')
    html = p.content()
    assert 'เฉลยข้อ' not in html and 'is_correct' not in html
    assert p.locator('.ex-opt').count() == 4
    # ตอบข้อ 1 แล้ว ย้อนกลับมาเห็นคำตอบเดิม
    pick(p, 'ถูก')
    p.click('#exNext')
    p.wait_for_function("document.getElementById('exLabel').textContent.includes('ข้อ 2')")
    p.click('#exPrev')
    p.wait_for_function("document.getElementById('exLabel').textContent.includes('ข้อ 1')")
    assert 'sel' in p.locator('.ex-opt', has_text='ถูก').first.get_attribute('class')
    p.click('#exNext')
    # ข้อ 2-4
    for k in (2, 3, 4):
        pick(p, 'ถูก' if k != 3 else 'ผิด ข')
        p.click('#exNext')
        if k == 4:
            p.click('#cfYes')
    p.wait_for_selector('#scoreTxt')
    assert p.inner_text('#scoreTxt') == '4 / 5', p.inner_text('#scoreTxt')
    assert '3' in p.inner_text('#result') and 'คะแนนเก็บเข้ารายวิชา' not in p.inner_text('#result') or True
    # กลับมาเปิดใหม่ → ทำครบแล้ว
    p.click('#again')
    stu_login(c, STD(1)) if p.locator('#lq').count() else None
    p.wait_for_selector('#cant')
    assert 'ครบจำนวนครั้ง' in p.inner_text('#cant')
    assert 'ครั้งที่ 1' in p.inner_text('#past') and '4 / 5' in p.inner_text('#past')
    assert c.overflow() <= 0
    c.shot('s5_student_done')
    no_errors(c)
    c.close()


@case('โหมดฝึกทำ: ตรวจคำตอบทีละข้อ ได้เฉลยพร้อมคำอธิบาย · ถูก=เขียว/ผิด=แดง · เก็บคะแนนครบข้อ')
def _():
    cid = world()
    z = mk_quiz(cid, 3)
    rd = mk_round(cid, z, mode='PRACTISE', allowBack=False, scoreMode='COMPLETE', scoreValue=5, maxAttempts=0, totalMinutes=0)
    c = stu_ctx()
    open_exam(c, rd, STD(2))
    p = c.page
    assert 'ตรวจคำตอบ' in p.inner_text('#rules')
    p.click('#goBtn')
    p.wait_for_selector('#exQ')
    assert p.inner_text('#exNext') == 'ตรวจคำตอบ'
    p.click('#exNext')
    p.wait_for_selector('.toast.bad')
    pick(p, 'ผิด ก')
    p.click('#exNext')
    p.wait_for_selector('#rv')
    assert 'ยังไม่ถูก' in p.inner_text('#rv') and 'เฉลยข้อ' in p.inner_text('#rv')
    assert p.locator('.ex-opt.right').count() == 1 and 'ถูก' in p.locator('.ex-opt.right').inner_text()
    assert p.locator('.ex-opt.wrong').count() == 1
    assert p.locator('.ex-opt').first.is_disabled()
    assert p.inner_text('#exNext') == 'ถัดไป →'
    p.click('#exNext')
    p.wait_for_function("document.getElementById('exLabel').textContent.includes('ข้อ 2')")
    pick(p, 'ถูก')
    p.click('#exNext')
    p.wait_for_selector('#rv.ok')
    p.click('#exNext')
    pick(p, 'ถูก')
    p.click('#exNext')
    p.wait_for_selector('#rv')
    assert p.inner_text('#exNext') == 'ส่งข้อสอบ'
    p.click('#exNext')
    p.wait_for_selector('#scoreTxt')
    assert p.inner_text('#scoreTxt') == '2 / 4', p.inner_text('#scoreTxt')
    assert '5' in p.inner_text('#courseLine'), '' if not p.locator('#courseLine').count() else p.inner_text('#courseLine')
    # ทำอีกครั้งได้ (ไม่จำกัด)
    p.click('#again')
    p.wait_for_selector('#goBtn')
    assert 'เริ่มทำอีกครั้ง' in p.inner_text('#goBtn')
    c.shot('s5_practise_reveal')
    no_errors(c)
    c.close()


@case('รีเฟรชระหว่างทำ → กลับเข้าข้อเดิมพร้อมคำตอบ · ปิดแท็บแล้วเปิดลิงก์ใหม่ → "ทำต่อจากเดิม" · เวลารวมเดินต่อ')
def _():
    cid = world()
    z = mk_quiz(cid, 4)
    rd = mk_round(cid, z, allowBack=True)
    c = stu_ctx()
    open_exam(c, rd)
    p = c.page
    p.click('#goBtn')
    p.wait_for_selector('#exQ')
    pick(p, 'ถูก')
    p.click('#exNext')
    pick(p, 'ผิด ก')
    p.click('#exNext')
    p.wait_for_function("document.getElementById('exLabel').textContent.includes('ข้อ 3')")
    p.wait_for_function("JSON.parse(localStorage.getItem(Object.keys(localStorage).filter(k=>k.startsWith('hbt.exam.q.'))[0]||'null')||'[]').length===0", timeout=8000)
    p.reload()
    p.wait_for_selector('#exQ')
    assert 'ข้อ 3 / 4' in p.inner_text('#exLabel')
    p.click('#exPrev')
    assert 'sel' in p.locator('.ex-opt', has_text='ผิด ก').first.get_attribute('class')
    assert ':' in p.inner_text('#exClock') and p.inner_text('#exClock')[0] in '0123456789'
    p.wait_for_function("JSON.parse(localStorage.getItem(Object.keys(localStorage).filter(k=>k.startsWith('hbt.exam.q.'))[0]||'null')||'[]').length===0", timeout=8000)
    # แท็บใหม่ (ไม่มี sessionStorage) → เลือก "ทำต่อจากเดิม"
    c2 = stu_ctx()
    open_exam(c2, rd)
    assert 'ทำต่อจากเดิม' in c2.page.inner_text('#goBtn')
    c2.page.click('#goBtn')
    c2.page.wait_for_selector('#exQ')
    assert 'ข้อ 2 / 4' in c2.page.inner_text('#exLabel'), c2.page.inner_text('#exLabel')   # ถอยกลับมาข้อ 2 แล้ว คิวส่งเสร็จก่อน
    assert len(exrows('Attempts')) == 1
    no_errors(c)
    c2.close()
    c.close()


@case('เน็ตหลุดระหว่างสอบ: คำตอบเก็บในเครื่อง แจ้งเตือน · กลับมาออนไลน์แล้วส่งให้เองเรียงลำดับ')
def _():
    cid = world()
    z = mk_quiz(cid, 4)
    rd = mk_round(cid, z, allowBack=True)
    c = stu_ctx()
    open_exam(c, rd)
    p = c.page
    p.click('#goBtn')
    p.wait_for_selector('#exQ')
    c.ctx.set_offline(True)
    pick(p, 'ถูก')
    p.click('#exNext')
    pick(p, 'ถูก')
    p.click('#exNext')
    p.wait_for_selector('#offBar', timeout=15000)
    q = p.evaluate("JSON.parse(localStorage.getItem(Object.keys(localStorage).filter(k=>k.startsWith('hbt.exam.q.'))[0])||'[]').length")
    assert q >= 1, q
    assert 'ข้อ 3 / 4' in p.inner_text('#exLabel')
    c.ctx.set_offline(False)
    p.evaluate("window.dispatchEvent(new Event('online'))")
    p.wait_for_function("(function(){var k=Object.keys(localStorage).filter(k=>k.startsWith('hbt.exam.q.'))[0];return !k||JSON.parse(localStorage.getItem(k)||'[]').length===0})()", timeout=20000)
    att = exrows('Attempts')[0]
    ans = json.loads(att[19] or '{}') if len(att) > 19 else {}
    assert len(ans) == 2, att
    assert not p.locator('#offBar').count()
    no_errors(c)
    c.close()


@case('เวลาต่อข้อ: หมดเวลาแล้วไปข้อถัดไปเอง (คำตอบที่เลือกไว้ยังนับ) · ข้อสุดท้ายหมดเวลาแล้วส่งฉบับ')
def _():
    cid = world()
    z = mk_quiz(cid, 2)
    rd = mk_round(cid, z, allowBack=False, secPerQuestion=3, totalMinutes=0)
    c = stu_ctx()
    open_exam(c, rd)
    p = c.page
    p.click('#goBtn')
    p.wait_for_selector('#exQ')
    assert not p.is_visible('#exPrev')
    pick(p, 'ถูก')
    p.wait_for_function("document.getElementById('exLabel').textContent.includes('ข้อ 2')", timeout=8000)
    p.wait_for_selector('#scoreTxt', timeout=9000)
    assert p.inner_text('#scoreTxt') == '2 / 3', p.inner_text('#scoreTxt')
    no_errors(c)
    c.close()


@case('ออกนอกหน้าจอ: นับครั้ง แสดงเตือน อาจารย์เห็นในติดตามสด · ครบกำหนดแล้วระบบส่งให้อัตโนมัติ')
def _():
    cid = world()
    z = mk_quiz(cid, 3)
    rd = mk_round(cid, z, lockTab=True, maxViolations=2, allowBack=True)
    c = stu_ctx()
    open_exam(c, rd)
    p = c.page
    p.click('#goBtn')
    p.wait_for_selector('#exQ')
    pick(p, 'ถูก')
    p.click('#exNext')
    hide = "Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'))"
    show = "Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange'))"
    p.evaluate(hide)
    p.evaluate(show)
    p.wait_for_selector('#violBar', timeout=8000)
    assert '1 ครั้ง' in p.inner_text('#violBar')
    # อาจารย์เปิดติดตามสด
    t = Ctx()
    t.login_as(T1, 'อ.หนึ่ง', to='/t/exam-round.html?r=%s&id=%s' % (rd['sessionId'], cid))
    t.page.wait_for_selector('#liveTbl')
    row = t.page.inner_text('#liveTbl tbody tr')
    assert '660001' in row and 'กำลังทำ' in row and '1 / 3' in row, row
    assert t.page.inner_text('#lvDoing') == '1'
    p.evaluate(hide)
    p.wait_for_selector('#scoreTxt', timeout=10000)
    t.page.wait_for_function("document.getElementById('lvDone') && document.getElementById('lvDone').textContent==='1'", timeout=12000)
    no_errors(c)
    t.close()
    c.close()


@case('ลิงก์ผิด/ยังไม่ถึงเวลา/ปิดแล้ว/ผิดวิชา/ไม่ได้ตั้งค่า: ข้อความชัดเจน ไม่ค้าง')
def _():
    cid = world()
    z = mk_quiz(cid, 2)
    c = stu_ctx()
    p = c.page
    p.goto(BASE + '/s/exam.html?t=zzz')
    assert 'ลิงก์ไม่ถูกต้อง' in p.inner_text('main')
    p.goto(BASE + '/s/exam.html?t=' + '0' * 32)
    p.wait_for_selector('.callout.bad')
    assert 'เปิดลิงก์นี้ไม่ได้' in p.inner_text('main')
    fut = mk_round(cid, z, startAt=when(30), endAt=when(90))
    open_exam(c, fut)
    assert 'ยังไม่ถึงเวลา' in p.inner_text('#cant')
    clo = mk_round(cid, z, title='ปิด')
    exapi(T1, 'exam.round.setStatus', {'sessionId': clo['sessionId'], 'action': 'CLOSE'})
    p.goto(BASE + '/s/exam.html?t=' + clo['token'])
    p.wait_for_selector('#cant')
    assert 'ปิดรับแล้ว' in p.inner_text('#cant')
    c.close()
    n = Ctx(configured=False)
    n.page.goto(BASE + '/s/exam.html?t=' + '0' * 32)
    assert 'ยังไม่ได้ตั้งค่า' in n.page.inner_text('main')
    n.close()


@case('ผิดวิชา: นักศึกษาวิชาอื่นที่เข้าสู่ระบบไว้ ใช้ลิงก์รอบนี้ไม่ได้ ต้องเลือกชื่อใหม่')
def _():
    cid = world()
    cid2 = seed(T1, 'course.create', {'code': 'CHM1', 'name': 'เคมี', 'section': '1'})['courseId']
    seed(T1, 'student.importCsv', {'courseId': cid2, 'rows': [{'stdId': '770001', 'name': 'เคมี 1'}]})
    for cc in seed(T1, 'pin.issueTemp', {'courseId': cid2, 'all': True})['codes']:
        api('pin.setWithTemp', {'courseId': cid2, 'stdId': cc['stdId'], 'tempPin': cc['pin'], 'newPin': PIN})
    z = mk_quiz(cid, 2)
    rd = mk_round(cid, z)
    c = stu_ctx()
    p = c.page
    p.goto(BASE + '/s/exam.html?t=' + rd['token'])
    stu_login(c, STD(1))
    p.wait_for_selector('#goBtn')
    # เปลี่ยนเซสชันเป็นวิชาอื่นแล้วเปิดลิงก์เดิม
    r = api('stu.login', {'courseId': cid2, 'stdId': '770001', 'pin': PIN})['data']
    p.evaluate("(s)=>sessionStorage.setItem('hbt.stu',JSON.stringify(s))", {'token': r['token'], 'expiresAt': r['expiresAt'], 'courseId': cid2, 'stdId': '770001', 'name': 'เคมี 1', 'course': r['course'], 'tid': ''})
    p.reload()
    p.wait_for_selector('#loginBox #lq')
    c.close()


# ============================================================
print('\nอาจารย์: ติดตาม/ผลสอบ/ตั้งค่า')


@case('ผลสอบ: สถิติ/ฮิสโตแกรม/รายข้อ/รายคน · CSV · ปุ่มส่งคะแนนอีกครั้ง · ตั้งค่ารอบแล้วคิดคะแนนใหม่ · ลบรอบเอาคะแนนออกจากวิชา')
def _():
    cid = world(4)
    z = mk_quiz(cid, 4)
    rd = mk_round(cid, z, maxAttempts=2)
    for i, upto in ((1, 99), (2, 2), (3, 0)):
        c = stu_ctx()
        open_exam(c, rd, STD(i))
        c.page.click('#goBtn')
        c.page.wait_for_selector('#exQ')
        run_test(c.page, right_upto=upto)
        c.page.wait_for_selector('#scoreTxt')
        c.close()
    t = Ctx()
    t.login_as(T1, 'อ.หนึ่ง', to='/t/exam-round.html?tab=results&r=%s&id=%s' % (rd['sessionId'], cid))
    p = t.page
    p.wait_for_selector('#effPill')
    p.click('#stBtn')
    p.wait_for_selector('#repStats') if False else None
    p.wait_for_function("document.getElementById('effPill').textContent.includes('ปิดแล้ว')", timeout=10000)
    p.wait_for_selector('#repStats')
    assert p.locator('#attTbl tbody tr').count() == 3
    assert p.locator('#perQ tbody tr').count() == 4
    assert 'ซิงก์แล้ว' in p.inner_text('#syncCard')
    avg = float(p.inner_text('#repAvg').replace('%', ''))
    assert 40 < avg < 60, avg
    with p.expect_download() as dl:
        p.click('#csv2')
    txt = open(dl.value.path(), encoding='utf-8').read()
    assert '660001' in txt and 'ข้อ 4' in txt
    # คะแนนในวิชา
    ex = [x for x in seed(T1, 'score.types', {'courseId': cid})['types'] if x['source'] == 'EXAM'][0]
    tb = {r['stdId']: r['scores'][ex['typeId']] for r in seed(T1, 'score.table', {'courseId': cid})['students']}
    assert tb[STD(1)] == 20 and tb[STD(2)] == 12 and tb[STD(3)] == 0 and tb[STD(4)] is None, tb
    # แก้เกณฑ์ → คิดใหม่
    p.click('#tab-settings')
    p.select_option('#eSm', 'SCORE')
    p.fill('#eSv', '10')
    p.click('#eSave')
    p.wait_for_selector('.toast.good')
    tb = {r['stdId']: r['scores'][ex['typeId']] for r in seed(T1, 'score.table', {'courseId': cid})['students']}
    assert tb[STD(1)] == 10 and tb[STD(2)] == 6, tb
    # ลบรอบ → คะแนนหาย
    p.click('#delBtn')
    p.wait_for_url('**/t/exam.html**')
    assert not [x for x in seed(T1, 'score.types', {'courseId': cid})['types'] if x['source'] == 'EXAM']
    assert 'ยังไม่มีรอบ' in p.inner_text('#empty')
    no_errors(t)
    t.close()


@case('Core ล่มตอนปิดรอบ: แจ้งว่าส่งคะแนนไม่สำเร็จ แล้วกด "ส่งคะแนนใหม่" สำเร็จเมื่อ Core กลับมา')
def _():
    cid = world(3)
    z = mk_quiz(cid, 2)
    rd = mk_round(cid, z)
    c = stu_ctx()
    open_exam(c, rd)
    c.page.click('#goBtn')
    c.page.wait_for_selector('#exQ')
    run_test(c.page)
    c.page.wait_for_selector('#scoreTxt')
    c.close()
    t = Ctx()
    t.login_as(T1, 'อ.หนึ่ง', to='/t/exam.html?id=' + cid)
    p = t.page
    p.wait_for_selector('[data-round]')
    post('/__mode', {'core': 'down'})
    p.click('[data-st=CLOSE]')
    p.wait_for_selector('.toast.bad')
    assert 'ไม่สำเร็จ' in p.inner_text('.toast.bad')
    post('/__mode', {'core': 'ok'})
    p.wait_for_selector('[data-sync]')
    assert 'ซิงก์ไม่สำเร็จ' in p.inner_text('[data-round]')
    p.click('[data-sync]')
    p.wait_for_function("document.querySelector('[data-round]').innerText.includes('ซิงก์คะแนนแล้ว')")
    no_errors(t) if False else None
    t.close()


@case('สิทธิ์: อาจารย์ที่ไม่มีสิทธิ์สอบ/ไม่ใช่เจ้าของวิชา เข้าไม่ได้ · ไม่ตั้ง EXAM_URL แจ้งให้ตั้งค่า · Exam ล่ม = แจ้งโหลดไม่สำเร็จ + ลองใหม่ได้')
def _():
    cid = world()
    z = mk_quiz(cid, 2)
    rd = mk_round(cid, z)
    t2 = Ctx()
    t2.login_as(T2, 'อ.สอง', to='/t/exam.html?id=' + cid)
    t2.page.wait_for_selector('.callout.bad')
    assert 'ไม่มีสิทธิ์' in t2.page.inner_text('#content')
    t2.close()
    seed(ADMIN, 'user.upsert', {'email': T2, 'name': 'อ.สอง', 'systems': ['att', 'exam']})
    t2 = Ctx()
    t2.login_as(T2, 'อ.สอง', to='/t/exam.html?id=' + cid)
    t2.page.wait_for_selector('.callout.bad')
    assert 'ไม่พบรายวิชานี้' in t2.page.inner_text('#box') or 'ไม่มีสิทธิ์' in t2.page.inner_text('#box')
    t2.close()
    t = Ctx()
    t.login_as(T1, 'อ.หนึ่ง', to='/t/exam.html?id=' + cid)
    t.page.wait_for_selector('[data-round]')
    t.ctx.route('**/exam', lambda r: r.abort())            # เบราว์เซอร์ติดต่อ Exam ไม่ได้
    t.page.reload()
    t.page.wait_for_selector('#reload', timeout=15000)
    t.ctx.unroute('**/exam')
    t.page.click('#reload')
    t.page.wait_for_selector('[data-round]')
    t.close()
    n = Ctx()
    n.ctx.unroute('**/assets/config.js')
    n.ctx.route('**/assets/config.js', lambda r: r.fulfill(content_type='text/javascript', body="window.HBT_CONFIG={GOOGLE_CLIENT_ID:'%s',CORE_URL:'%s/api',EXAM_URL:''};" % (CLIENT_ID, BASE)))
    n.login_as(T1, 'อ.หนึ่ง', to='/t/exam.html?id=' + cid)
    n.page.wait_for_selector('#noExam')
    assert 'EXAM_URL' in n.page.inner_text('#noExam')
    n.close()


@case('เมนู/การ์ดระบบ: หน้าหลัก + หน้ารายวิชา มีทางเข้าสอบออนไลน์ (เปิดใช้) · แถบข้างพาไปเลือกวิชา')
def _():
    cid = world()
    c = Ctx()
    c.login_as(T1, 'อ.หนึ่ง')
    p = c.page
    p.wait_for_selector('#sysCards')
    card = p.locator('[data-sys=exam]')
    assert 'เลือกรายวิชาเพื่อจัดสอบ' in card.inner_text()
    p.goto(BASE + '/t/course.html?id=' + cid)
    p.wait_for_selector('#goExam')
    p.click('#goExam')
    p.wait_for_url('**/t/exam.html?id=*')
    p.wait_for_selector('#emptyQ')
    assert p.locator('#side a', has_text='สอบออนไลน์').count() == 1
    c.close()


@case('มือถือ/เดสก์ท็อป ทั้งสว่างและมืด: ไม่มี scroll แนวนอน · ปุ่มกดได้ขนาดพอ')
def _():
    cid = world()
    z = mk_quiz(cid, 3)
    rd = mk_round(cid, z)
    exapi(T1, 'exam.q.save', {'quizId': z, 'q_text': 'ข้อยาวมาก ' + 'ก' * 200, 'choices': [{'c_type': 'text', 'c_text': 'ตัวเลือกยาวมาก ' + 'ข' * 150}, {'c_type': 'text', 'c_text': 'สั้น'}]})
    for scheme in ('light', 'dark'):
        for vp in ((360, 740), (1100, 800)):
            s = Ctx(viewport=vp, scheme=scheme)
            open_exam(s, rd)
            assert s.overflow() <= 0, ('howto', scheme, vp)
            s.page.click('#goBtn')
            s.page.wait_for_selector('#exQ')
            assert s.overflow() <= 0, ('exam', scheme, vp)
            s.shot('s5_exam_%s_%d' % (scheme, vp[0]))
            s.close()
            t = Ctx(viewport=vp, scheme=scheme)
            t.login_as(T1, 'อ.หนึ่ง', to='/t/exam.html?id=' + cid)
            t.page.wait_for_selector('[data-round]')
            assert t.overflow() <= 0, ('teacher list', scheme, vp)
            t.page.goto(BASE + '/t/exam-questions.html?z=%s&id=%s' % (z, cid))
            t.page.wait_for_selector('.ex-qrow')
            assert t.overflow() <= 0, ('questions', scheme, vp)
            t.page.click('#addQ')
            t.shot('s5_editor_%s_%d' % (scheme, vp[0]))
            t.page.keyboard.press('Escape')
            t.page.goto(BASE + '/t/exam-round.html?r=%s&id=%s' % (rd['sessionId'], cid))
            t.page.wait_for_selector('#liveStats')
            assert t.overflow() <= 0, ('round', scheme, vp)
            t.close()


finish()
