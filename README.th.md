<!-- BBN:HEADER:START -->
<img src="site/assets/brandmark.png" width="180" alt="BoomBigNose" />
<!-- BBN:HEADER:END -->

<div align="center">

<h2>BoomBigNose ERP</h2>
<p>ระบบ ERP โอเพนซอร์สสำหรับธุรกิจทุกขนาด</p>

[![License](https://img.shields.io/badge/license-AGPL--3.0%20%7C%20Commercial-blue?style=flat-square)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3FCF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)

[English](./README.md) · **ภาษาไทย**

</div>

<div align="center">
	<a href="https://boom-vitt.github.io/boombignose-erp-harness-ai/">เว็บไซต์</a>
	-
	<a href="./docs">เอกสาร</a>
	-
	<a href="https://github.com/Boom-Vitt/boombignose-erp-harness-ai/issues">Issues</a>
</div>

หน้าดาวน์โหลดอยู่ที่ [https://boom-vitt.github.io/boombignose-erp-harness-ai/](https://boom-vitt.github.io/boombignose-erp-harness-ai/) ที่อยู่เดิม [https://boom-vitt.github.io/boombignose-erp/](https://boom-vitt.github.io/boombignose-erp/) เลิกใช้แล้ว และตอบ HTTP 404 หลังดีพลอยชื่อใหม่ รายการ Release อยู่ที่ [https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/latest](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/latest) แท็ก `boombignose-v0.2.0` คือหน้าต่างเดสก์ท็อป แท็ก `boombignose-v0.1.1` คือคำสั่งฮาร์เนสชุดก่อน

Release `boombignose-v0.2.0` คือหน้าต่าง Wails ที่ GitHub Actions สร้างด้วย Go แล้วแนบไฟล์ `BoomBigNose-windows-x64-setup.exe` (NSIS ไม่ได้ลงชื่อร้านค้า), `BoomBigNose-macos-arm64.dmg` (เซ็นแบบ ad-hoc ไม่มีใบรับรองที่ซื้อจาก Apple), `BoomBigNose-linux-amd64.tar.gz`, `BoomBigNose-linux-amd64.AppImage` และ `SHA256SUMS` ติดตั้งแล้วเปิดเป็นหน้าต่าง ไม่ใช่แค่คำสั่ง harness ไฟล์ของแท็กนั้นไม่ได้รวม Node, Docker, Postgres หรือ Ollama และยังไม่ได้คลิกทดสอบบนเครื่องจริง ชื่อแอปเดสก์ท็อปคือ BoomBigNose ตั้งแต่แท็ก `boombignose-v0.3.0` ตัวติดตั้ง BoomBigNose พกรันไทม์ Node, `server.js`, Postgres, Auth, PostgREST และ Ollama ไว้ในแอป Node ไม่ใช่ชื่อผลิตภัณฑ์ แท็ก `boombignose-v0.1.1` เป็นคำสั่ง harness รุ่นเก่า Windows อาจขึ้น SmartScreen (More info แล้ว Run anyway) และ Smart App Control อาจบล็อกแอปที่ไม่ได้ลงชื่อ macOS อาจต้องกด Open Anyway Linux ต้องมี WebKitGTK 4.1

ผลิตภัณฑ์ที่ใช้งานคือหน้าต่างเดสก์ท็อปนั้น มันเปิด ERP บนเครื่องที่ `http://127.0.0.1:3100` ปิดงบเดือน รายการธนาคาร เงินสดตอนปิดงวด รายงานงบ ชุดข้อมูลนักบัญชี นำเข้าชีต และสำรองฐานข้อมูลในเครื่อง เป็นหน้าจอในหน้าต่างนั้น หน้าบน GitHub Pages เป็นโบรชัวร์และจุดดาวน์โหลดตัวติดตั้ง ไม่ใช่ที่ที่หน้าจอเหล่านั้นทำงาน

## BoomBigNose ERP

BoomBigNose ERP รวมงานขาย จัดซื้อ คลังสินค้า โปรเจกต์ และการวางบิลของธุรกิจไว้บนฐานข้อมูลเดียว ออกแบบสำหรับธุรกิจไทยเป็นหลัก รองรับภาษีมูลค่าเพิ่มและภาษีหัก ณ ที่จ่ายบนเอกสาร สกุลเงินบาท และเขตเวลา Asia/Bangkok ตั้งแต่แรก ใช้ได้ตั้งแต่ร้านที่มีสองคนไปจนถึงบริษัทที่กำลังเติบโตและมีหลายทีม

### ที่มา

ธุรกิจส่วนใหญ่เริ่มจาก CRM หนึ่งตัว เครื่องมือจัดการโปรเจกต์อีกตัว สเปรดชีตใบแจ้งหนี้ และรายการสต็อกที่ตัวเลขไม่เคยตรงกัน BoomBigNose ERP เก็บข้อมูลทั้งหมดไว้ในที่เดียว ใบเสนอราคากลายเป็นใบแจ้งหนี้ ใบแจ้งหนี้กลายเป็นการส่งของ และแดชบอร์ดแสดงสถานะเงินสดได้ทันทีโดยไม่ต้องคัดลอกตัวเลขข้ามระบบ ระบบนี้ดูแลงานปฏิบัติการของธุรกิจ ส่วนบัญชีตามกฎหมายยังอยู่กับโปรแกรมบัญชีที่คุณใช้อยู่ เช่น FlowAccount, PEAK หรือ Xero

### ฟีเจอร์หลัก

- **แดชบอร์ด**: เงินสด, burn รายเดือน, runway, รายได้, ใบแจ้งหนี้ค้างชำระและเกินกำหนด, MRR และมูลค่า pipeline ถ่วงน้ำหนักในหน้าเดียว พร้อมรายการที่ต้องจัดการ เช่น บิลผู้ขายที่เกินกำหนดและใบเบิกค่าใช้จ่ายที่รออนุมัติ
- **CRM**: ลูกค้าและผู้ติดต่อ พร้อมดีล ใบเสนอราคา ใบแจ้งหนี้ โปรเจกต์ และยอดค้างในมุมมองเดียว บอร์ดคัมบังของดีลพร้อมโอกาสปิดการขาย รายได้ที่คาดการณ์ และเหตุผลที่เสียดีล (บังคับกรอก) กิจกรรมที่นัดไว้แบ่งเป็น เลยกำหนด วันนี้ และที่จะมาถึง ฟอร์มรับลีดบนเว็บไซต์ที่เปลี่ยนคำถามจากลูกค้าเป็นดีล
- **การขาย**: ใบเสนอราคาพร้อมรายการสินค้าและ VAT ส่งอีเมลหรือพิมพ์ได้ ใบเสนอราคาที่ลูกค้าตอบรับแปลงเป็นใบแจ้งหนี้ได้หนึ่งใบหรือหลายใบ ตามจำนวนที่เหลือ จำนวนที่เลือก หรือเงินมัดจำแบบเปอร์เซ็นต์หรือจำนวนคงที่ การเรียกเก็บเงินแบบรายรอบ (subscription) ออกใบแจ้งหนี้ซ้ำตามรอบอัตโนมัติ
- **ใบแจ้งหนี้และการรับชำระ**: ใบแจ้งหนี้มีสถานะ ร่าง → ออกแล้ว → ชำระแล้ว และใบที่ออกแล้วจะถูกล็อกเลขที่และยอดเงินไว้ไม่ให้แก้ ภาษีหัก ณ ที่จ่าย 1, 2, 3 หรือ 5 เปอร์เซ็นต์ ข้อมูลภาษีของกิจการ การบันทึกรับชำระพร้อมวันที่เงินเข้าธนาคารและช่องทาง วันปิดงวดบัญชี และการรับใบแจ้งหนี้เก่าที่สร้างก่อนกฎปัจจุบันเข้าระบบ
- **จัดซื้อ**: ผู้ขาย ใบขอเสนอราคา (RFQ) ที่ส่งทางอีเมล ใบสั่งซื้อ การรับของบางส่วน บิลผู้ขาย และการคืนสินค้าพร้อมเครดิตจากผู้ขาย
- **คลังสินค้า**: คลังหลายแห่ง สต็อกคงเหลือและมูลค่า ประวัติการเคลื่อนไหวของสต็อกทั้งหมด การส่งของและรับคืนจากลูกค้าจากหน้าใบแจ้งหนี้ การตรวจนับ และการเติมสต็อกที่ร่างใบขอเสนอราคาแยกตามผู้ขายให้
- **สินค้า**: แคตตาล็อกพร้อม SKU หน่วย ราคา ต้นทุน อัตราภาษี และสถานะสินค้าที่นับสต็อก เลือกสินค้าในบรรทัดใบเสนอราคาหรือใบแจ้งหนี้แล้วข้อมูลจะเติมให้อัตโนมัติ
- **เบิกค่าใช้จ่าย**: พนักงานส่งใบเบิก ผู้จัดการอนุมัติหรือปฏิเสธ ไม่มีใครอนุมัติใบเบิกของตัวเองได้ และใบเบิกที่อนุมัติแล้วจะกลายเป็นต้นทุนในหน้าการเงิน
- **โปรเจกต์และไทม์ชีต**: โปรเจกต์แบบรายการหรือบอร์ดคัมบัง พร้อมงานย่อย milestones และเวลาที่บันทึก เปลี่ยนเวลาที่เรียกเก็บได้เป็นใบแจ้งหนี้ฉบับร่างในขั้นตอนเดียว อัตราต้นทุนของสมาชิกและกำไรของโปรเจกต์เห็นได้เฉพาะ owner และ admin
- **รายงานและปฏิทิน**: รายได้รายเดือนและรายลูกค้า ชั่วโมงงานต่อโปรเจกต์ และต้นทุนขาย ในรูปกราฟแท่ง กราฟเส้น หรือตาราง pivot งบกำไร VAT และอายุลูกหนี้เจ้าหนี้สำหรับงานปฏิบัติการ รายการตรวจปิดงบเดือน เงินสดตอนปิดงวด และชุดข้อมูลนักบัญชี (VAT ขาย VAT ซื้อ และภาษีหัก ณ ที่จ่าย) สำหรับนักบัญชีภายนอก มุมมองที่บันทึกไว้ (saved views) การส่งออก CSV และปฏิทินของงานติดตาม การประชุม วันครบกำหนด และเดดไลน์
- **ระบบอัตโนมัติและ AI**: เทมเพลตงานอัตโนมัติที่นำกลับมาใช้ซ้ำได้ การเตือนงานติดตามตามรอบเวลา outbox ที่ส่งเหตุการณ์ไปยัง n8n และ webhook ขาเข้าจาก n8n ผู้ช่วย AI สรุปดีล ร่างข้อความติดตาม สรุปโน้ตประชุม และโน้ตปิดงบเดือนบนหน้าการเงินเรียก Ollama บนเครื่องนี้ (ค่าเริ่มต้น `127.0.0.1:11434`) ถ้า Ollama ไม่ได้เปิด หน้าจอจะบอกตรงๆ และไม่เรียกโมเดลบนคลาวด์ หน้า Settings → โมเดล AI บนเครื่องนี้ ดาวน์โหลด แสดงรายการ และเอาโมเดลออกได้จากใน ERP ไม่ต้องติดตั้ง Ollama Desktop, ComfyUI, Whisper หรือแอปเสียงแยก สำหรับงานที่รุ่นนี้รันได้
- **ทั้งระบบ**: command palette ด้วย Ctrl/Cmd+K แถบค้นหาและตัวกรองในหน้ารายการ แถบสถานะด้านบนและประวัติโน้ต ไฟล์แนบ และกิจกรรมบนเอกสารธุรกิจ และ audit log สำหรับ owner และ admin
- **ทีม**: บทบาท owner, admin, accountant และ member และการเชิญสมาชิกด้วยลิงก์ นักบัญชีบันทึกการเงินและตรวจปิดงบได้ สมาชิกทั่วไปทำไม่ได้

### เบื้องหลังระบบ

- [**Next.js 16**](https://nextjs.org) แบบ App Router, React 19 Server Components และ Server Actions เขียนด้วย TypeScript Server Actions ตรวจข้อมูลจากฟอร์มด้วย [Zod](https://zod.dev)
- [**Supabase**](https://supabase.com) สำหรับ Postgres และการยืนยันตัวตน ทุกตารางมี `org_id` และเปิด Row Level Security แบบ force องค์กรหนึ่งจึงอ่านข้อมูลขององค์กรอื่นไม่ได้ และ service-role key ไม่เคยถูกส่งไปยังเบราว์เซอร์
- เงินเก็บเป็นสตางค์จำนวนเต็ม (`bigint`) ไม่ใช้ทศนิยมลอยตัว กฎทางธุรกิจเป็นฟังก์ชัน pure ใน `lib/` พร้อม unit test (Vitest) ที่ไม่ต้องใช้ฐานข้อมูล กฎในฐานข้อมูลมี SQL test ของตัวเอง และ Playwright ทดสอบเส้นทางหลักแบบ end to end

### โมเดลบนเครื่อง

หน้าต่างเดสก์ท็อปเริ่ม Ollama v0.40.11 ที่มากับแอปที่ `127.0.0.1:11434` การเปิดโปรแกรมไม่ได้ดาวน์โหลดโมเดล และน้ำหนักโมเดลไม่ได้อยู่ใน git หรือในไฟล์ติดตั้ง หน้า Settings (`/settings#local-models`) เป็นที่ติดตั้ง:

| งาน | ในรุ่นนี้ | โมเดล |
|---|---|---|
| ข้อความ (สรุปดีล โน้ตประชุม และโน้ตปิดงบเดือน) | Linux, Windows และ macOS | `qwen3:4b` |
| อ่านรูปบนเครื่องนี้ | Linux, Windows และ macOS | `qwen2.5vl:3b` |
| สร้างภาพ | เฉพาะ macOS | `x/flux2-klein:4b` (Apache-2.0) |
| อ่านออกเสียง | เฉพาะ Apple Silicon เสียงสำเร็จรูปภาษาอังกฤษ | `phonon` (Apache-2.0) ยังไม่มีเสียงภาษาไทยในรุ่นนี้ เพราะเสียงไทยของ espeak-ng ทอนวรรณยุกต์หาย และยังไม่ได้ปักไบนารี Piper ที่มีตัวแปลงเสียงไทย |
| ถอดเสียง | Linux และ Windows แอปดาวน์โหลด whisper.cpp b5454 และ `ggml-tiny.bin` เมื่อเจ้าของกดติดตั้ง | บน macOS ยังไม่มี จนกว่า ggml-org จะเผยแพร่ไฟล์ `whisper-cli` |
| วิดีโอ และโคลนเสียง | ยังไม่มีในรุ่นนี้ | ไม่มี |

การดาวน์โหลดเริ่มเมื่อเจ้าของหรือผู้ดูแลกดติดตั้งเท่านั้น หน้าจอแสดงความคืบหน้าและข้อผิดพลาดจากบริการบนเครื่อง เครื่องที่ Ollama 0.40.11 รันงานนั้นไม่ได้จะเห็นเหตุผลแทนปุ่มติดตั้ง Phonon ไม่โคลนเสียงและไม่พูดภาษาไทย โมเดลเหล่านี้ไม่ได้ลงรายการบัญชีและไม่ได้ยื่น ภ.พ.30 `boombignose pull-model` ยังดาวน์โหลด `qwen3:4b` ส่งชื่อที่อยู่ในรายการได้ เช่น `boombignose pull-model qwen2.5vl:3b` ชื่ออื่นถูกปฏิเสธ ดู `docs/desktop/local-stack.md` และ `docs/boombignose/BUNDLE.md`

### ขอบเขต

BoomBigNose ERP ไม่ใช่สมุดบัญชีแยกประเภท บัญชีตามกฎหมาย การยื่นภาษี เงินเดือน และการผลิต อยู่นอกขอบเขต ภาษีมูลค่าเพิ่มและภาษีหัก ณ ที่จ่ายเป็นการคำนวณบนเอกสารเท่านั้น ไม่ใช่ระบบภาษีตามกฎหมายหรือบริการ e-Tax Invoice ใบลดหนี้สำหรับลูกค้ากำลังพัฒนา

## รุ่นของระบบ (Editions)

| | Community | Pro |
|---|:---:|:---:|
| สัญญาอนุญาต | [AGPL-3.0](./LICENSE) หรือ [Commercial](./COMMERCIAL-LICENSE.md) | [Commercial](./ee/LICENSE) |
| ทุกโมดูลด้านบน | มี | มี |
| สมัครใช้งาน, พื้นที่ทำงานแรก, เชิญทีม, บทบาท owner/admin/accountant/member | มี | มี |
| ผู้ช่วย AI, ระบบอัตโนมัติ และงานตามรอบเวลา | มี | มี |
| พอร์ทัลลูกค้า: ลูกค้าดูเอกสาร ตอบรับใบเสนอราคา และแจ้งชำระเงิน | | มี |
| ส่งออกใบแจ้งหนี้ไป FlowAccount (เดโมในเครื่อง หรือ sandbox เมื่อเซิร์ฟเวอร์มีโทเคน) PEAK และ Xero ยังไม่เชื่อมในรุ่นนี้ | | มี |
| หลายพื้นที่ทำงาน พร้อมตัวสลับพื้นที่ทำงาน | | มี |
| การสร้างพื้นที่ทำงานสำหรับบริการแบบโฮสต์ | | มี |

ค่าเริ่มต้นของการ build คือ Community โค้ด Pro อยู่ใน [`ee/`](./ee/) และ build ด้วย `BBN_EDITION=pro` ดูรายละเอียดว่าอะไรอยู่ฝั่งไหนได้ที่ [เส้นแบ่ง open-core](./docs/OPEN_CORE_BOUNDARY.md)

## ติดตั้งสำหรับพัฒนา

### สิ่งที่ต้องมี

- [Node.js 22+](https://nodejs.org) และ [pnpm](https://pnpm.io)
- [Docker](https://docs.docker.com/get-docker/) สำหรับรัน Supabase บนเครื่อง
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) ติดตั้งมากับ dev dependencies แล้ว ใช้ `pnpm exec supabase` ได้เลยโดยไม่ต้องติดตั้งแบบ global

### รันบนเครื่อง

1. โคลนโปรเจกต์และติดตั้ง dependencies
   ```sh
   git clone https://github.com/Boom-Vitt/boombignose-erp-harness-ai.git
   cd boombignose-erp-harness-ai
   pnpm install
   ```

2. สตาร์ท Supabase แล้วรันไมเกรชันและโหลดข้อมูลเดโม
   ```sh
   pnpm exec supabase start
   pnpm exec supabase db reset
   ```

3. สร้าง `.env.local` แล้วใส่ URL และคีย์ที่ `supabase status` แสดง
   ```sh
   cp .env.example .env.local
   pnpm exec supabase status
   ```

4. รันแอปแล้วเปิด `http://localhost:3000`
   ```sh
   pnpm dev
   ```

ถ้าต้องการเริ่มจากฐานข้อมูลว่าง ให้รัน `pnpm exec supabase db reset --no-seed` สมัครที่ `/signup` ยืนยันอีเมล (อีเมลบนเครื่องจะไปที่กล่อง Inbucket ที่ `supabase status` แสดง) แล้วสร้างพื้นที่ทำงานที่ `/onboarding` ลิงก์ยืนยันใช้ `site_url` ใน `supabase/config.toml` (`http://127.0.0.1:3100`) จึงควรรันแอปที่ที่อยู่นั้นและตั้ง `NEXT_PUBLIC_APP_URL` ให้ตรงกัน หรือแก้ทั้งสองค่าแล้วรีสตาร์ท Supabase ถ้าต้องการตรวจข้อมูลเดโมและ Row Level Security หลัง reset ให้โหลด `.env.local` เข้า shell แล้วรัน `node scripts/verify-seed.mjs`

### บัญชีเดโม

| อีเมล | รหัสผ่าน | บทบาท |
|---|---|---|
| `demo@boombignose.org` | `BoomDemo123!` | owner |
| `nattapong@boombignose.org` | `BoomDemo123!` | member |
| `praewa@boombignose.org` | `BoomDemo123!` | member |

ปุ่ม **Use demo account** ในหน้าเข้าสู่ระบบจะแสดงเมื่อตั้ง `NEXT_PUBLIC_DEMO_LOGIN_EMAIL` และ `NEXT_PUBLIC_DEMO_LOGIN_PASSWORD` เท่านั้น ไม่ควรตั้งค่านี้บน production

### ตัวแปรสภาพแวดล้อม

| ตัวแปร | จำเป็น | หน้าที่ |
|---|:---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ใช่ | URL ของ Supabase API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ใช่ | anon key ของ Supabase ใช้ฝั่งเบราว์เซอร์ได้อย่างปลอดภัย |
| `SUPABASE_SERVICE_ROLE_KEY` | ใช่ | คีย์ฝั่งเซิร์ฟเวอร์เท่านั้น สำหรับงานตามรอบเวลา webhook คำเชิญ ฟอร์มรับลีดสาธารณะ และพอร์ทัลลูกค้าของ Pro |
| `NEXT_PUBLIC_APP_URL` | ใช่ | URL สาธารณะของแอป ใช้ในลิงก์คำเชิญ ฟอร์มรับลีด และอีเมล |
| `CRON_SECRET` | ใช่ | ตรวจ header `X-Cron-Secret` ของงานตามรอบเวลา |
| `N8N_WEBHOOK_SECRET` | ใช่ | ตรวจ header `X-Webhook-Secret` ของ webhook ขาเข้าจาก n8n |
| `N8N_OUTBOUND_URL`, `N8N_OUTBOUND_SECRET` | ไม่ | เปิดการส่งเหตุการณ์จาก outbox ไปยัง n8n |
| `OLLAMA_HOST`, `OLLAMA_MODEL` | ไม่ | ที่อยู่ Ollama บนเครื่อง (ค่าเริ่มต้น `127.0.0.1:11434`) และชื่อโมเดล ที่อยู่ที่ไม่ใช่ loopback ถูกปฏิเสธ |
| `RESEND_API_KEY` | ไม่ | เปิดการส่งอีเมลผ่าน Resend |
| `EMAIL_FROM` | ไม่ | อีเมลผู้ส่ง |
| `LEAD_FORM_TRUST_PROXY` | ไม่ | ตั้งเป็น `true` เมื่ออยู่หลัง proxy ที่เขียนทับ `X-Forwarded-For` เพื่อให้จำกัดอัตราการส่งฟอร์มรับลีดแยกตามผู้เข้าชม |
| `LEAD_FORM_IP_SECRET` | ไม่ | คีย์สำหรับ hash IP ของผู้ส่งฟอร์มรับลีด ถ้าไม่ตั้งจะใช้ service-role key แทน |
| `BBN_EDITION` | ไม่ | `community` (ค่าเริ่มต้น) หรือ `pro` เลือกตอน build |

ค่า `NEXT_PUBLIC_*` ถูกฝังไว้ตอน build ต้อง build ใหม่ทุกครั้งที่เปลี่ยน [`.env.example`](./.env.example) เป็นแม่แบบพร้อมคำอธิบาย

### คำสั่งที่ใช้บ่อย

```sh
pnpm dev          # dev server
pnpm build        # build สำหรับ production
pnpm test         # unit test ไม่ต้องใช้ฐานข้อมูล
pnpm typecheck    # ตรวจ TypeScript
pnpm lint         # ESLint
pnpm e2e          # Playwright test ต้องใช้ stack แยกตาม docs/testing/erp-gates.md
pnpm local:up     # สตาร์ท Supabase บนเครื่องและรันไมเกรชันที่ค้างอยู่
```

## ติดตั้งสำหรับใช้งานจริง

การติดตั้งแบบคำสั่งเดียวอยู่ในแผน ตอนนี้ติดตั้งใช้งานจริงได้ในสี่ขั้นตอน

1. สร้างโปรเจกต์ Supabase แล้วรันไมเกรชันด้วย `pnpm exec supabase link` และ `pnpm exec supabase db push` ไม่ควรโหลดข้อมูลเดโม
2. ใน Supabase Auth ตั้ง Site URL เป็น URL ของแอป เพิ่ม `<app URL>/auth/confirm` ใน redirect URLs และตั้งค่า SMTP ของคุณเอง เพื่อให้อีเมลยืนยันส่งถึงผู้ใช้
3. ตั้งค่าตัวแปรสภาพแวดล้อมด้านบน แล้วรัน `pnpm build` และ `pnpm start` บนเซิร์ฟเวอร์ Node.js 22 ใดก็ได้
4. เรียก `POST /api/cron/followups`, `/api/cron/outbox` และ `/api/cron/subscriptions` ตามรอบเวลา พร้อม header `X-Cron-Secret`

Pro ที่มีสัญญาอนุญาตต้องติดตั้ง `ee/supabase/provision-hosted-workspace.sql` เพิ่ม และ build ด้วย `BBN_EDITION=pro` ดูรายละเอียดที่ [เส้นแบ่ง open-core](./docs/OPEN_CORE_BOUNDARY.md#build-and-license-scope)

ถ้าต้องการ Pro แบบโฮสต์ ติดต่อ [boombignose.org](https://boombignose.org)

## เรียนรู้และชุมชน

1. [เอกสาร](./docs): เส้นแบ่ง open-core การเชื่อม n8n เกณฑ์การทดสอบ และบันทึกด้านความปลอดภัยและ PDPA
2. [เว็บไซต์](https://boom-vitt.github.io/boombignose-erp-harness-ai/): ภาพรวมของผลิตภัณฑ์
3. [Issues](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/issues): แจ้งบั๊กและขอฟีเจอร์

## การมีส่วนร่วม

1. [คู่มือการมีส่วนร่วม](./CONTRIBUTING.md): รัน `pnpm lint`, `pnpm typecheck`, `pnpm test` และ `pnpm build` ก่อนเปิด pull request
2. [Contributor License Agreement](./CLA.md): ต้องยอมรับในทุก pull request
3. [แม่แบบ issue](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/issues/new/choose): สำหรับแจ้งบั๊กและขอฟีเจอร์

## ความปลอดภัย

แจ้งช่องโหว่แบบส่วนตัวผ่าน [GitHub Security Advisories](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/security/advisories/new) โปรดอย่าเปิดเป็น issue สาธารณะ ดูสิ่งที่ควรแนบและช่องทางสำรองได้ที่ [SECURITY.md](./SECURITY.md) ไม่ควรใส่ข้อมูลลูกค้าจริงในระบบเดโม และอ่าน[บันทึก PDPA](./docs/PDPA_SECURITY_NOTES.md) ก่อนเริ่มใช้งานจริง

## สัญญาอนุญาต

Community Edition ใช้สัญญาอนุญาตคู่ คือ [AGPL-3.0-only](./LICENSE) หรือ [Commercial license](./COMMERCIAL-LICENSE.md) ที่ตกลงแยกต่างหาก โค้ด Pro ใน [`ee/`](./ee/) เป็นซอฟต์แวร์เชิงพาณิชย์ที่เปิดให้อ่านซอร์สโค้ดได้ (source-available) ไม่ใช่โอเพนซอร์ส ภายใต้ [`ee/LICENSE`](./ee/LICENSE) และต้องมีข้อตกลงเชิงพาณิชย์ก่อนใช้ใน production ส่วน [`bignose/`](./bignose/LICENSE) เป็นผลิตภัณฑ์ proprietary แยกต่างหากและไม่อยู่ภายใต้ AGPL สัญญาอนุญาตของบุคคลที่สามอยู่ใน [NOTICE](./NOTICE)

## โลโก้และเครื่องหมายการค้า

ชื่อและโลโก้ BoomBigNose สงวนสิทธิ์ไว้ fork ต้องเปลี่ยนชื่อและแบรนด์ตาม [TRADEMARK.md](./TRADEMARK.md)

<div align="center">
<br />
Copyright © 2026 BoomBigNose AI Co., Ltd.
</div>

<!-- BBN:FOOTER:START -->
[Made by BoomBigNose](https://github.com/Boom-Vitt)
<!-- BBN:FOOTER:END -->
