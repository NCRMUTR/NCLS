# ติดตั้งด้วย Git + clasp + Claude Desktop (แบบในคลิป)

ใช้แทนการคัดลอกไฟล์ลง Apps Script ทีละไฟล์ใน `INSTALL.md` — ต้นเหตุของ error แบบ `Users is not defined` คือไฟล์ในตัวแก้ไข Apps Script หายหรือวางไม่ครบ แบบนี้ให้ Git เป็นต้นฉบับ แล้ว **clasp** (เครื่องมือของ Google) ดันไฟล์ขึ้นให้ครบตรงต้นฉบับ

> **ขั้นตอนที่คุณต้องทำเองทีละขั้น (ละเอียด) อยู่ใน `STEPS_FOR_YOU.md`** — ไฟล์นี้เป็นภาพรวม

> สิ่งที่ยังไม่เคยทดสอบ: ขั้นตอนทั้งหมดเขียนจากเอกสารของ clasp/GitHub และชุดทดสอบกับตัวจำลอง ยังไม่เคยรันกับบัญชี Google ของคุณจริง ถ้าขั้นไหนไม่เป็นไปตามที่เขียน ให้หยุดแล้วส่งข้อความ error ให้ดู

## สิ่งที่ Claude ทำให้ / สิ่งที่คุณต้องทำเอง

| Claude ทำให้ | คุณต้องทำเองเสมอ (Claude ทำแทนไม่ได้) |
|---|---|
| รันเทสต์ · จัด Git · commit · push | ล็อกอิน GitHub และตั้งชื่อ repo |
| `clasp create-script` · `clasp push` · `clasp create-deployment` | `clasp login` (กดอนุญาตในเบราว์เซอร์) |
| เขียนค่าลง `Setup.local.gs` และ `config.js` | สร้าง OAuth Client ID ใน Google Cloud |
| ตรวจว่าไฟล์ครบ (`setupDiag`) | กด **Run** ฟังก์ชัน `setupCore` / `setupExam` ในตัวแก้ไข Apps Script (ต้องกดอนุญาตสิทธิ์ครั้งแรก) |
| ประกอบ URL ของ Core / Exam | คัดลอก `SEC_TOKEN` จาก Core ไปใส่ไฟล์ของ Exam ด้วยมือ **อย่าแปะในแชท** |

## ก่อนเริ่ม (ทำครั้งเดียว บน Windows)

1. ติดตั้ง **Node.js LTS ที่เป็นเวอร์ชัน 22 ขึ้นไป** จาก nodejs.org (clasp รุ่นปัจจุบันบังคับ Node 22+)
2. ติดตั้ง **Git for Windows** จาก git-scm.com
3. เปิด PowerShell ใหม่ แล้วเช็ก: `node -v` · `git --version`
4. ติดตั้ง clasp: `npm install -g @google/clasp` แล้วเช็ก `clasp --version`
   - ถ้า PowerShell ฟ้องว่า *running scripts is disabled on this system* ให้รัน `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` แล้วเปิด PowerShell ใหม่
5. เปิด Apps Script API ด้วยบัญชี @rmutr.ac.th ที่ https://script.google.com/home/usersettings (สวิตช์ *Google Apps Script API* เป็น On)
   - ถ้าเปิดไม่ได้หรือสวิตช์ถูกล็อก แสดงว่าผู้ดูแล Google Workspace ของมหาวิทยาลัยปิดไว้ → ใช้วิธีเดิมใน `INSTALL.md` แทน แล้วรัน `setupDiag` ตรวจว่าไฟล์ครบ
6. สมัคร/ล็อกอิน GitHub (บัญชีฟรีเปิด Pages ได้เฉพาะ repo แบบ Public)

## เริ่มงานใน Claude Desktop

1. แตก zip นี้ไว้ในโฟลเดอร์ที่หาง่าย เช่น `C:\Users\<ชื่อ>\Documents\hbt-teaching-system`
2. เปิดโฟลเดอร์นั้นเป็นโฟลเดอร์ทำงานในแอป Claude Desktop (เหมือนที่คลิปทำกับ `AI Food Apps`)
3. เปิดไฟล์ `START_PROMPT.md` คัดลอกข้อความในกรอบไปวาง — Claude จะสรุปแผนให้ตรวจก่อน (Plan Mode) แล้วค่อยลงมือทีละขั้น

## ขั้น S0–S7 โดยย่อ

ละเอียดอยู่ใน `CLAUDE.md` (Claude อ่านอัตโนมัติ)

| ขั้น | ได้อะไร |
|---|---|
| S0 | เครื่องพร้อม (Node, Git, clasp, Apps Script API) |
| S1 | โค้ดอยู่บน GitHub (ผ่านเทสต์ก่อน push) |
| S2 | เปิด GitHub Pages: Settings → Pages → Build and deployment → Source = **GitHub Actions** → ได้ URL เว็บ |
| S3 | OAuth Client ID (ใช้ `INSTALL.md` ตอนที่ 2; Authorized JavaScript origins = `https://<ชื่อบัญชี>.github.io` ไม่มี path ไม่มี `/` ท้าย) |
| S4 | Core ขึ้น Apps Script → รัน `setupCore` → deploy → **CORE_URL** |
| S5 | Exam ขึ้น Apps Script → รัน `setupExam` → deploy → **EXAM_URL** → ใส่กลับใน Core |
| S6 | ใส่ 3 ค่าใน `web/assets/config.js` → push → เว็บอัปเดตเอง |
| S7 | เช็กลิสต์ทดสอบ `INSTALL.md` ตอนที่ 7 (อย่าข้ามข้อสอบที่มีรูป) |

## ไฟล์ที่ห้ามขึ้น Git

`Setup.local.gs` (ใน `gas/` และ `exam/`) · `.clasp.json` · `~/.clasprc.json` · ค่า `SEC_TOKEN` — `.gitignore` กันไว้ให้แล้ว และ `CLAUDE.md` สั่งให้ Claude ตรวจก่อน push ทุกครั้ง
ถ้าเผลอ push ความลับขึ้นไป: รัน `setupRotateSecret` ที่ Core (ทุกคนต้องล็อกอินใหม่) แล้วใส่ค่าใหม่ที่ Exam และลบไฟล์ออกจากประวัติ Git

## ต่อไปเมื่อต้องแก้โค้ด

1. ให้ Claude แก้ในโฟลเดอร์นี้ → `node tests/run_all.js` ต้องผ่านทุกชุด
2. `git commit` + `git push` → **หน้าเว็บอัปเดตเองภายในไม่กี่นาที** (เมื่อไฟล์ใน `web/` เปลี่ยน)
3. ถ้าแก้ `gas/` หรือ `exam/`: `clasp push` ในโฟลเดอร์นั้น แล้ว `clasp create-deployment --deploymentId <id เดิม>` เพื่อให้ URL ไม่เปลี่ยน (ถ้าลืมขั้นนี้ โค้ดใหม่ยังไม่ทำงาน)
4. ห้ามแก้โค้ดในตัวแก้ไข Apps Script โดยตรง ครั้งหน้าที่ push จะถูกทับ

## ถ้าอยากใช้ Vercel แทน GitHub Pages

- แผนฟรี (Hobby) จำกัดเฉพาะการใช้งานส่วนตัวที่ไม่ใช่เชิงพาณิชย์ และเอกสารของ Vercel นิยามเชิงพาณิชย์รวมถึงงานที่ผู้เกี่ยวข้องกับการผลิต (รวมพนักงานที่เขียนโค้ด) ได้ประโยชน์ทางการเงิน — ระบบสอนที่ทำในหน้าที่ประจำอาจเข้าข่ายหรือไม่ก็ได้ ควรถาม Vercel Support ก่อน
- วิธีเชื่อม: Vercel → Add New Project → Import repo นี้ → **Root Directory = `web`** → Framework Preset = Other → ไม่ต้องมี Build Command → Deploy
- Authorized JavaScript origins ใน Google Cloud ต้องเปลี่ยนเป็นโดเมน `*.vercel.app` ที่ได้ (ระบุทีละโดเมน ห้ามใช้ wildcard) และถ้าเปิดทั้ง Pages กับ Vercel ต้องใส่ทั้งสอง origin
