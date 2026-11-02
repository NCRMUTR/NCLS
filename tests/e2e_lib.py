"""ไลบรารีร่วมของ e2e (Core):  Playwright (Chromium) + เซิร์ฟเวอร์จำลอง GAS (e2e_server.js)
Google Sign-In จำลองด้วยสคริปต์ปลอมที่เสียบแทน https://accounts.google.com/gsi/client"""
import base64, json, os, subprocess, sys, time, traceback, urllib.request, uuid
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(os.path.abspath(__file__))
SHOTS = os.environ.get('SHOTS')           # โฟลเดอร์เก็บภาพหน้าจอ (ไม่ตั้ง = ไม่เก็บ)
CLIENT_ID = '1234-test.apps.googleusercontent.com'

FAKE_GIS = """
window.google={accounts:{id:{
 initialize:function(c){window.__gis=c;},
 renderButton:function(el){el.innerHTML='<button id="fakeG" type="button">Sign in with Google</button>';
   el.firstChild.onclick=function(){window.__gis.callback({credential:window.__CRED});};},
 disableAutoSelect:function(){window.__disabled=true;}
}}};
"""

srv = subprocess.Popen(['node', os.path.join(HERE, 'e2e_server.js')], stdout=subprocess.PIPE, text=True)
line = srv.stdout.readline().strip()
assert line.startswith('READY '), line
BASE = 'http://127.0.0.1:' + line.split()[1]


def post(path, obj=None):
    req = urllib.request.Request(BASE + path, data=json.dumps(obj or {}).encode(), method='POST')
    return json.loads(urllib.request.urlopen(req).read())


def get(path):
    return json.loads(urllib.request.urlopen(BASE + path).read())


def b64u(s):
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip('=')


def cred(email, name='Test User', **claims):
    key = 'h.%s.%s' % (b64u(json.dumps({'aud': CLIENT_ID, 'exp': int(time.time()) + 3000, 'email': email, 'name': name})), uuid.uuid4().hex)
    c = {'email': email, 'name': name}
    c.update(claims)
    post('/__google', {'key': key, 'claims': c})
    return key


def seed(as_, action, args=None):
    r = post('/__seed', {'as': as_, 'action': action, 'args': args or {}})
    assert r.get('ok'), r
    return r['data']


ADMIN = 'admin@rmutr.ac.th'
results = []
pw = sync_playwright().start()
browser = pw.chromium.launch()


ALLCTX = []


class Ctx:
    def __init__(self, configured=True, viewport=(1100, 800), scheme='light'):
        ALLCTX.append(self)
        self.errors = []
        self.ctx = browser.new_context(viewport={'width': viewport[0], 'height': viewport[1]}, color_scheme=scheme, locale='th-TH')
        if configured:
            self.ctx.route('**/assets/config.js', lambda r: r.fulfill(
                content_type='text/javascript',
                body="window.HBT_CONFIG={GOOGLE_CLIENT_ID:'%s',CORE_URL:'%s/api',EXAM_URL:'%s/exam'};" % (CLIENT_ID, BASE, BASE)))
        else:
            self.ctx.route('**/assets/config.js', lambda r: r.fulfill(
                content_type='text/javascript', body="window.HBT_CONFIG={GOOGLE_CLIENT_ID:'',CORE_URL:'',EXAM_URL:''};"))
        self.ctx.route('https://accounts.google.com/gsi/client', lambda r: r.fulfill(content_type='text/javascript', body=FAKE_GIS))
        self.ctx.route('https://fonts.googleapis.com/**', lambda r: r.abort())
        self.ctx.route('https://fonts.gstatic.com/**', lambda r: r.abort())
        self.page = self.ctx.new_page()
        self.page.on('console', lambda m: self.errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text else None)
        self.page.on('pageerror', lambda e: self.errors.append('pageerror: ' + str(e)))
        self.on_dialog = lambda d: d.accept()
        self.page.on('dialog', self.on_dialog)

    def close(self):
        self.ctx.close()

    def sign_in(self, email, name='Test User', **claims):
        p = self.page
        p.wait_for_selector('#fakeG')
        p.evaluate('c => { window.__CRED = c }', cred(email, name, **claims))
        p.click('#fakeG')

    def login_as(self, email, name='Test User', to='/t/home.html'):
        p = self.page
        p.goto(BASE + '/index.html')
        p.evaluate("sessionStorage.clear()")          # login_as เริ่มจากไม่มีเซสชันเสมอ
        p.goto(BASE + '/t/login.html')
        self.sign_in(email, name)
        p.wait_for_url('**/t/home.html')
        if to != '/t/home.html':
            p.goto(BASE + to)

    def overflow(self):
        return self.page.evaluate('document.documentElement.scrollWidth - document.documentElement.clientWidth')

    def shot(self, name):
        if SHOTS:
            os.makedirs(SHOTS, exist_ok=True)
            self.page.screenshot(path=os.path.join(SHOTS, name + '.png'), full_page=True)


ONLY = os.environ.get('ONLY')


def case(name):
    def deco(fn):
        if ONLY and ONLY not in name:
            return fn
        post('/__reset')
        c = None
        try:
            fn()
            results.append((name, True, ''))
            print('  ✔ ' + name)
        except Exception as e:
            tb = traceback.format_exc().strip().splitlines()
            for i, cx in enumerate(ALLCTX[-3:]):
                try:
                    cx.page.screenshot(path='/tmp/fail_%d.png' % i)
                except Exception:
                    pass
            del ALLCTX[:]
            results.append((name, False, '%s: %s' % (type(e).__name__, str(e).splitlines()[0] if str(e) else '')))
            print('  ✘ ' + name + '\n      ' + '\n      '.join(tb[-14:]))
        return fn
    return deco


def no_errors(c):
    assert not c.errors, 'console/page errors: %r' % c.errors



def finish():
    browser.close()
    pw.stop()
    srv.terminate()
    ok = sum(1 for r in results if r[1])
    print('\n%s (%d/%d ผ่าน)' % ('✔ ผ่านทั้งหมด' if ok == len(results) else '✘ มีข้อล้มเหลว', ok, len(results)))
    for n, g, m in results:
        if not g:
            print(' - %s :: %s' % (n, m))
    sys.exit(0 if ok == len(results) else 1)
