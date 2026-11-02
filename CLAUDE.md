# CLAUDE.md — คำสั่งประจำโปรเจกต์ HBT Teaching System (v0.6.3)

ไฟล์นี้อ่านโดย Claude ที่ทำงานในโฟลเดอร์นี้ (Claude Desktop / Claude Code) · ผู้ใช้คืออาจารย์ มทร.รัตนโกสินทร์ (@rmutr.ac.th) ใช้ภาษาไทย

## โปรเจกต์คืออะไร
ระบบสอนรวม: เช็คชื่อ · ส่งงาน · สอบออนไลน์ · คะแนน · สำรอง/ลบข้อมูลสิ้นภาคเรียน
- `web/`  หน้าเว็บ static → GitHub Pages (workflow อยู่ที่ `.github/workflows/pages.yml`)
- `gas/`  Core API = Google Apps Script โปรเจกต์ที่ 1 (ชีต HBT_Core)
- `exam/` Exam API = Google Apps Script โปรเจกต์ที่ 2 (ชีต HBT_Exam)
- `tests/` ชุดทดสอบ (ตัวจำลอง Apps Script) · `node tests/run_all.js`
- เอกสาร: `STEPS_FOR_YOU.md` (**ขั้นตอนที่ผู้ใช้ต้องทำเอง A–J เรียงตามลำดับ — ใช้ตอบเมื่อผู้ใช้ถามว่าต้องทำอะไรต่อ**) · `README.md` (ระบบทำอะไร) · `INSTALL.md` (ติดตั้งแบบวางไฟล์เอง) · **`GUIDE_GIT.md` (ติดตั้งแบบ Git + clasp — แผนหลักของงานนี้)**

## กติกาเหล็ก
1. **ถามก่อนลงมือ** ทุกครั้งที่ต้องเลือกทาง หรือคำสั่งที่เปลี่ยนสิ่งนอกโฟลเดอร์นี้: ติดตั้งโปรแกรม, สร้าง/ push repo, `clasp login/create-script/push/create-deployment` — บอกว่าจะทำอะไรแล้วรอคำตอบ
2. **ความลับห้ามขึ้น Git ห้ามพิมพ์ในแชท:** `Setup.local.gs`, `.clasp.json`, `~/.clasprc.json`, ค่า `SEC_TOKEN`, ค่า `SEC_PIN`
   - ก่อน commit ทุกครั้งรัน `git status` แล้วตรวจ; ก่อน push รัน `git ls-files | findstr /R "Setup.local.gs \.clasp\.json$ \.env"` (Windows) หรือ `git ls-files | grep -E 'Setup\.local\.gs|\.clasp\.json$|\.env'` — ต้องไม่มีผลลัพธ์
   - ห้ามใช้ `git add -A` / `git add .` โดยไม่ดู `git status` ก่อน
3. **โค้ด Apps Script แก้ที่ repo เท่านั้น** แล้ว `clasp push` ขึ้นไป — ห้ามแก้ในตัวแก้ไขของ Apps Script (ครั้งถัดไปที่ push จะถูกทับ)
4. **ก่อน push/ปล่อยทุกครั้ง** `node tests/run_all.js` ต้องผ่านทุกชุด
5. `clasp` ต้องรันจากในโฟลเดอร์ `gas/` หรือ `exam/` เท่านั้น (แต่ละโฟลเดอร์มี `.clasp.json` ของตัวเอง — ห้ามรันที่ราก repo)
6. คำสั่งล้มซ้ำ 2 ครั้ง → หยุด รายงานข้อความ error ตามจริง แล้วถามผู้ใช้ ห้ามเดาแก้ต่อเรื่อยๆ
7. ห้ามเปลี่ยน/ลบ `SEC_PIN` (PIN นักศึกษาทุกคนจะใช้ไม่ได้) · ห้ามเปลี่ยน `SEC_TOKEN` โดยไม่ได้รับอนุญาต (ทุกคนต้องล็อกอินใหม่ และต้องแก้ Exam ด้วย)

## clasp (ตรวจเมื่อ 2 พ.ย. 2569 กับ README ของ google/clasp)
- ต้องใช้ Node ≥ 22 · ติดตั้ง: `npm install -g @google/clasp` · ต้องเปิด Apps Script API ที่ https://script.google.com/home/usersettings ก่อน
- ชื่อคำสั่งใน v3: `clasp login` · `clasp create-script --type standalone --title "..." --rootDir .` · `clasp push` (`--force` = ยอมทับ appsscript.json ฝั่งเซิร์ฟเวอร์ ใช้ตอน push ครั้งแรก) · `clasp create-deployment --description "..."` (ใส่ `--deploymentId <id>` เพื่อ deploy ทับของเดิมและ **คง URL เดิม**) · `clasp open-script` · `clasp open-web-app`
- ก่อนใช้ ให้รัน `clasp --help` ยืนยันชื่อคำสั่งของเวอร์ชันที่ติดตั้งจริง (v3 เปลี่ยนชื่อหลายคำสั่ง; ชื่อคำสั่งดู deployment ที่มีอยู่ไม่ได้ยืนยันไว้ที่นี่)
- Windows PowerShell อาจฟ้อง "running scripts is disabled" กับ `clasp.ps1` → แจ้งผู้ใช้ให้ตั้ง `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` (ถามก่อน) หรือใช้ `clasp.cmd`

## ลำดับการติดตั้ง S0–S7 (รายละเอียดใน GUIDE_GIT.md)
| ขั้น | งาน | ใครทำ |
|---|---|---|
| S0 | ตรวจเครื่อง: `node -v` ≥ 22, `git --version`, `clasp --version` (ขาดอะไรให้บอกวิธีติดตั้ง ถามก่อนติดตั้ง) · ผู้ใช้เปิด Apps Script API | Claude ตรวจ · ผู้ใช้เปิด API |
| S1 | `node tests/run_all.js` → `git init -b main` + commit แรก → ผู้ใช้สร้าง **repo เปล่าสาธารณะ (ไม่ติ๊ก README/.gitignore/license)** บน GitHub แล้วให้ URL → `git remote add origin` + push (Windows อาจเด้งหน้าต่างล็อกอิน GitHub ให้ผู้ใช้กด) | Claude (ผู้ใช้สร้าง repo / ล็อกอิน GitHub) |
| S2 | ผู้ใช้เปิด Pages: Settings → Pages → Source = **GitHub Actions** (ควรทำก่อน push ครั้งแรก; ถ้าทำหลัง push ให้ไปแท็บ Actions กด Run workflow) → ได้ URL เว็บ `https://<owner>.github.io/<repo>/` · origin ที่ใช้ในขั้น S3 คือ `https://<owner>.github.io` (ไม่มี path ไม่มี `/` ท้าย) | ผู้ใช้ |
| S3 | สร้าง OAuth Client ID ตาม INSTALL.md ตอนที่ 2 ด้วย origin จาก S2 | ผู้ใช้ (Claude ช่วยอ่านหน้าจอที่ผู้ใช้ส่งมา) |
| S4 | **Core:** `clasp login` → ใน `gas/`: `create-script --title "HBT Core"` → คัดลอก `Setup.local.example.txt` เป็น `Setup.local.gs` ใส่ Client ID + อีเมลแอดมิน → `clasp push --force` → ผู้ใช้เปิด editor รัน `setupDiag` (ต้องขึ้น "ไฟล์โค้ดครบ") แล้ว `setupCore` (กดอนุญาตสิทธิ์) แล้ว `setupCheck` → `clasp create-deployment` → ได้ **CORE_URL** | Claude + ผู้ใช้ |
| S5 | **Exam:** ผู้ใช้รัน `setupShowSecret` ใน Core แล้วคัดลอก SEC_TOKEN **ใส่เองในไฟล์** `exam/Setup.local.gs` (อย่าแปะในแชท) พร้อม CORE_URL → ใน `exam/`: `create-script --title "HBT Exam"` → `clasp push --force` → ผู้ใช้รัน `setupDiag`, `setupExam` → **เปลี่ยน SEC_TOKEN ในไฟล์เป็น `''` แล้ว `clasp push` ทับ** → `create-deployment` ได้ **EXAM_URL** → ใส่ `EXAM_URL` ใน `gas/Setup.local.gs` → `clasp push` → `create-deployment --deploymentId <id เดิมของ Core>` → ผู้ใช้รัน `setupCore` ซ้ำ | Claude + ผู้ใช้ |
| S6 | แก้ `web/assets/config.js` ใส่ `GOOGLE_CLIENT_ID`, `CORE_URL`, `EXAM_URL` (ค่าเหล่านี้เป็นข้อมูลสาธารณะ commit ได้) → run_all → commit → push → ดู Actions จนเขียว | Claude |
| S7 | เช็กลิสต์ทดสอบ INSTALL.md ตอนที่ 7 (รวมข้อสอบที่มีรูป) | ผู้ใช้ทำ Claude ช่วยอ่านผล |

ถ้า S0 เปิด Apps Script API ไม่ได้ (ผู้ดูแล Google Workspace ของมหาวิทยาลัยปิดไว้) หรือ `clasp push` ถูกปฏิเสธเรื่องสิทธิ์ → หยุด บอกผู้ใช้ แล้วเสนอทางสำรอง: ติดตั้งแบบวางไฟล์เองตาม INSTALL.md (ใช้ `setupDiag` ตรวจว่าไฟล์ครบ)

## ข้อจำกัดที่ต้องบอกผู้ใช้ตรงๆ
- ชุดทดสอบทั้งหมดรันกับ **ตัวจำลอง** Apps Script/Drive ไม่ใช่ของจริง · ยังไม่เคยรันบน Apps Script/Drive/Google Sign-In จริง และยังไม่เคยทดสอบโหลดพร้อมกัน
- รูปในข้อสอบพึ่งการแชร์ลิงก์ Drive (`Quiz.gs` เรียก `setSharing` แบบ try/catch เงียบ) — ถ้านโยบายมหาวิทยาลัยห้ามแชร์ รูปจะไม่ขึ้นโดยไม่มีคำเตือน → ต้องทดสอบใน S7
- ค่า `VERSION` ที่ API ตอบยังเป็น `0.6.0` (v0.6.1–v0.6.3 แก้เฉพาะเว็บ/Setup)
