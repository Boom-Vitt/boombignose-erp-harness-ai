<!-- BBN:HEADER:START -->
<p align="center">
  <img src="site/assets/brandmark.png" width="160" alt="BoomBigNose" />
</p>
<!-- BBN:HEADER:END -->

<div align="center">

# BoomBigNose ERP

### ระบบ ERP โอเพนซอร์สสำหรับธุรกิจไทย — ขาย · คลัง · โปรเจกต์ · การเงิน · AI บนเครื่องคุณ

[![GitHub stars](https://img.shields.io/github/stars/Boom-Vitt/nose-erp?style=flat-square&logo=github)](https://github.com/Boom-Vitt/nose-erp/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/Boom-Vitt/nose-erp?style=flat-square&logo=github)](https://github.com/Boom-Vitt/nose-erp/network/members)
[![License](https://img.shields.io/badge/license-AGPL--3.0%20%7C%20Commercial-blue?style=flat-square)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3FCF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Release](https://img.shields.io/github/v/release/Boom-Vitt/nose-erp?style=flat-square)](https://github.com/Boom-Vitt/nose-erp/releases/latest)

**ภาษาไทย** · [English](./README.en.md)

[เว็บไซต์](https://boom-vitt.github.io/nose-erp/) · [ดาวน์โหลด](https://github.com/Boom-Vitt/nose-erp/releases/latest) · [เอกสาร](./docs) · [แจ้งปัญหา](https://github.com/Boom-Vitt/nose-erp/issues)

</div>

---

## ทำไมต้อง BoomBigNose

ธุรกิจไทยส่วนใหญ่เริ่มจาก CRM หนึ่งตัว เครื่องมือโปรเจกต์อีกตัว สเปรดชีตใบแจ้งหนี้ และสต็อกที่ตัวเลขไม่ตรงกัน **BoomBigNose ERP** รวมงานขาย จัดซื้อ คลัง โปรเจกต์ และการวางบิลไว้บนฐานข้อมูลเดียว — ออกแบบสำหรับไทยเป็นหลัก (VAT / ภาษีหัก ณ ที่จ่าย · สกุลเงินบาท · เขตเวลา `Asia/Bangkok`)

> หน้าต่างเดสก์ท็อปเปิด ERP ที่ `http://127.0.0.1:3100` · AI รันบนเครื่องคุณผ่าน Ollama ที่มากับแอป · ไม่ยื่นภาษีแทนคุณ (บัญชีตามกฎหมายยังอยู่กับ FlowAccount / PEAK / Xero)

**สถานะรุ่น:** รุ่นเผยแพร่ที่ยืนยันแล้วคือ [1.4.4 (`ddc5c11`)](https://github.com/Boom-Vitt/nose-erp/releases/tag/boombignose-v1.4.4) ส่วนคำอธิบาย local AI/OCR, โปรไฟล์งาน, headless server และ private mobile ด้านล่างเป็น **ซอร์สที่กำลังพัฒนา ยังไม่ใช่ฟีเจอร์ที่เผยแพร่ใน 1.4.4** การมีโค้ด/เอกสารไม่ยืนยันว่าทุกหน้า ความแม่นยำ OCR/AI การกู้คืน หรือโทรศัพท์จริงผ่านการทดสอบครบแล้ว และไม่ใช่ใบรับรอง PDPA/cybersecurity

## สารบัญ

- [ไฮไลต์](#-ไฮไลต์)
- [ฟีเจอร์](#-ฟีเจอร์)
- [ดาวน์โหลดแอปเดสก์ท็อป](#-ดาวน์โหลดแอปเดสก์ท็อป)
- [เริ่มต้นเร็ว (นักพัฒนา)](#-เริ่มต้นเร็ว-นักพัฒนา)
- [รุ่น Community / Pro](#-รุ่น-community--pro)
- [สถาปัตยกรรม](#-สถาปัตยกรรม)
- [โมเดล AI บนเครื่อง](#-โมเดล-ai-บนเครื่อง)
- [ขอบเขตที่ไม่อยู่ในระบบ](#-ขอบเขตที่ไม่อยู่ในระบบ)
- [มีส่วนร่วม](#-มีส่วนร่วม)
- [ความปลอดภัย](#-ความปลอดภัย)
- [สัญญาอนุญาต](#-สัญญาอนุญาต)

## ✨ ไฮไลต์

| | |
|---|---|
| 🇹🇭 **ไทยเฟิร์ส** | VAT · WHT · THB · `Asia/Bangkok` ในเอกสารตั้งแต่แรก |
| 🖥️ **แอปเดสก์ท็อป** | หน้าต่าง Wails + สแต็กในเครื่อง (ตั้งแต่ v0.3.0) |
| 🔐 **หลายองค์กร** | สิทธิ์ workspace + Postgres RLS; งาน privileged มีขอบเขตและการยืนยันแยก ดู SECURITY.md |
| 🤖 **Local AI/OCR ในซอร์สปัจจุบัน** | Ollama บน loopback ไม่มี cloud fallback; ต้องตรวจผลกับหลักฐานก่อนใช้ |
| 🧩 **Open-core** | Community (AGPL) + Pro แยกใน `ee/` |

## 📦 ฟีเจอร์

- **แดชบอร์ด** — เงินสด burn runway รายได้ ใบแจ้งหนี้ค้าง/เกินกำหนด MRR pipeline และรายการที่ต้องจัดการ
- **CRM** — ลูกค้า ผู้ติดต่อ บอร์ดดีล โอกาสปิดการขาย กิจกรรม ฟอร์มรับลีด
- **การขาย** — ใบเสนอราคา → ใบแจ้งหนี้ (รวมมัดจำ / แยกจำนวน) · subscription
- **ใบแจ้งหนี้และการรับชำระ** — ล็อกเลขที่หลังออก · WHT 1–5% · วันปิดงวดบัญชี
- **จัดซื้อ** — ผู้ขาย RFQ PO รับของบางส่วน บิลผู้ขาย คืนสินค้า
- **คลังสินค้า** — หลายคลัง สต็อก ประวัติเคลื่อนไหว ส่งของ นับสต็อก เติมสต็อก
- **เบิกค่าใช้จ่าย / โปรเจกต์ / ไทม์ชีต** — อนุมัติแยกสิทธิ์ · เรียกเก็บจากเวลาได้
- **รายงานและปิดงบเดือน** — VAT อายุลูกหนี้ ชุดข้อมูลนักบัญชี CSV · ไม่ใช่การยื่นภาษี
- **อัตโนมัติ + AI** — n8n outbox/webhook · Ollama บนเครื่อง · Settings → โมเดล AI
- **ทีม** — owner / admin / accountant / member · เชิญด้วยลิงก์
- **โปรไฟล์งานในซอร์สปัจจุบัน** — งานส่วนตัว / ธุรกิจ SME / องค์กร ปรับหน้าเริ่มต้นและงานที่เน้น ไม่เปลี่ยน role ไม่ใช่ประเภทนิติบุคคล และยังใช้โมดูลร่วมที่มีสิทธิ์ได้ (`startup` เป็น key เดิมที่เก็บไว้ของโปรไฟล์องค์กร ไม่ได้หมายถึงประเภทบริษัท)
- **ภาพรวมองค์กร 3D (`/warehouse`) ในซอร์สปัจจุบัน** — จำนวนเอกสาร/ภาระงานจริงตามสิทธิ์ ณ เวลาที่อ่าน พร้อมลิงก์ทำงานและรายการสำรองเมื่อ WebGL ใช้ไม่ได้; ข้อมูลที่ถูกซ่อนไม่ใช่ศูนย์ ไม่ใช่สต็อกเชิงกายภาพหรือคะแนนความปลอดภัย
- **OCR ไทย/อังกฤษในซอร์สปัจจุบัน** — JPEG/PNG/WebP และ PDF ผ่าน PDF.js worker ในเครื่อง → Ollama local vision; เทียบต้นฉบับทุกช่องก่อนบันทึกค่าใช้จ่าย/จัดซื้อ ไม่อนุมัติหรือลงบัญชีเอง ดู [ข้อจำกัดและข้อมูลส่วนบุคคล](./docs/PDPA_SECURITY_NOTES.md#local-ai-ocr-and-attachments)
- **เครือข่าย 3D** — owner/admin ดู ERP, Mac ที่ลงทะเบียน และปลายทาง TCP จาก Go collector พร้อม policy CIDR และสัญญาณ “รอคนตรวจ” · แยก SSH ตัวอย่างจากข้อมูลจริง · ไม่ใช่การรับรองว่าไม่มีข้อมูลรั่ว ดู [ข้อกำหนดและผลตรวจ](./acceptance.md) และ [วิธีใช้ collector](./boombignose/README.md#native-macos-network-collector)

## ⬇️ ดาวน์โหลดแอปเดสก์ท็อป

หน้าดาวน์โหลด: [boom-vitt.github.io/nose-erp](https://boom-vitt.github.io/nose-erp/)  ·  [Releases ล่าสุด](https://github.com/Boom-Vitt/nose-erp/releases/latest)

| แพลตฟอร์ม | ไฟล์ |
|---|---|
| Windows | `BoomBigNose-windows-x64-setup.exe` (NSIS — อาจขึ้น SmartScreen) |
| macOS (Apple Silicon) | `BoomBigNose-macos-arm64.dmg` (เซ็น ad-hoc — อาจต้อง Open Anyway) |
| Linux | `.tar.gz` / `.AppImage` (ต้องมี WebKitGTK 4.1) |

ตั้งแต่แท็ก `boombignose-v0.3.0` ตัวติดตั้งพก Node runtime, Postgres/Auth/PostgREST และ Ollama ไว้ในแอป แท็ก `boombignose-v0.2.0` เป็นหน้าต่าง Wails ที่ยังไม่พกสแต็กเต็ม · `boombignose-v0.1.1` เป็น harness รุ่นเก่า

### Desktop / headless server จากซอร์สปัจจุบัน

เดสก์ท็อปยังเป็น Go/Wails ไม่ได้เปลี่ยนเป็นเว็บ wrapper ใหม่ ส่วน headless ใช้ CLI Go แยกที่ไม่ต้องมีจอหรือ WebKit; **อย่าคาดว่า binary 1.4.4 มีคำสั่งใหม่** ดู [ขั้นตอน native desktop/server, บัญชีแรก, systemd และ private Tailscale HTTPS](./docs/boombignose/BUNDLE.md#headless-server-installation-and-private-access) และ [สำรอง/secure-db/กู้คืน](./docs/boombignose/BUNDLE.md#backup-migration-and-recovery)

ERP, Auth/API, REST, PostgreSQL และโมเดลยัง bind loopback เท่านั้น โทรศัพท์ต้องมี tailnet ที่อนุญาตและ HTTPS front door ไปยัง **ERP port เดียว** ก่อน ใช้ login/MFA ปกติ; QR เป็นข้อมูลเชื่อมต่อ ไม่ใช่การส่งต่อ session หรือสิทธิ์ owner

## 🚀 เริ่มต้นเร็ว (นักพัฒนา)

**สิ่งที่ต้องมี:** Node.js 22+ · pnpm · Docker · Supabase CLI (`pnpm exec supabase`)

```sh
git clone https://github.com/Boom-Vitt/nose-erp.git
cd nose-erp
pnpm install
pnpm exec supabase start
pnpm exec supabase db reset
cp .env.example .env.local   # ใส่ค่าจาก `pnpm exec supabase status`
pnpm dev                     # http://localhost:3000
```

บัญชีเดโม (หลัง seed): `demo@boombignose.org` / `BoomDemo123!` (owner)

คำสั่งที่ใช้บ่อย: `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm build` · `pnpm e2e`

รายละเอียด env / production ดู [README.en.md](./README.en.md) หรือโฟลเดอร์ [`docs/`](./docs)

## 🏷️ รุ่น Community / Pro

| | Community | Pro |
|---|:---:|:---:|
| สัญญาอนุญาต | [AGPL-3.0](./LICENSE) หรือ [Commercial](./COMMERCIAL-LICENSE.md) | [ee/LICENSE](./ee/LICENSE) |
| โมดูลหลักทั้งหมด | ✅ | ✅ |
| พอร์ทัลลูกค้า · ส่งออก FlowAccount · หลาย workspace · โฮสต์ | | ✅ |

ค่าเริ่มต้นคือ Community · Pro อยู่ใน [`ee/`](./ee/) สร้างด้วย `BBN_EDITION=pro` · ดู [เส้นแบ่ง open-core](./docs/OPEN_CORE_BOUNDARY.md)

## 🏗️ สถาปัตยกรรม

- **Next.js 16** App Router · React 19 Server Components / Actions · TypeScript · Zod
- **Native Go supervisor** เริ่ม Node/Next ERP + PostgreSQL/Auth/PostgREST/Ollama บน loopback; browser login/MFA ใช้ same-origin `/auth/local/*` relay ใน native mode ไม่เปิด Auth/REST ให้โทรศัพท์โดยตรง
- **Supabase** Postgres + Auth · business reads/writes ใช้ session/workspace RLS; service-role อยู่เฉพาะ server แต่ใช้จริงใน cron, invitations, public token/device flows ที่ต้องตรวจสิทธิ์เอง ไม่ใช่ seed-only
- Auth cookies ของ `@supabase/ssr` อ่านได้จาก JavaScript (ไม่ใช่ httpOnly ทั้งหมด); HTTPS ป้องกันระหว่างทาง ไม่ได้เข้ารหัสดิสก์/backup ดู [security boundaries](./SECURITY.md#current-source-security-boundaries)
- เงินเป็นสตางค์จำนวนเต็ม (`bigint`) · กฎธุรกิจใน `lib/` มี Vitest · มี SQL tests และ Playwright

## 🤖 โมเดล AI บนเครื่อง

ค่าเริ่มต้นของ **ซอร์สปัจจุบัน** แยกเป็น `qwen3.5:9b-q4_k_m` สำหรับแชท ERP/ภาพของผู้ช่วย และ `qwen3.5:4b` สำหรับ OCR ผ่าน Ollama บน loopback (ปกติ `127.0.0.1:11434`) ไม่ดาวน์โหลดน้ำหนักตอนเปิดแอป ใช้ `boombignose pull-model` หรือ `boombignose pull-model qwen3.5:9b-q4_k_m` สำหรับแชท และ `boombignose pull-model qwen3.5:4b` สำหรับ OCR การติดตั้ง/ลบผ่านเว็บต้องมีทั้งสิทธิ์ owner/admin และสิทธิ์ผู้ดูแลเครื่องจาก `configure-operators` ดู [catalog ที่ใช้จริง](./boombignose/internal/bundle/ollama_models.json)

| งาน/ฮาร์ดแวร์ | ตัวเลือกในซอร์สปัจจุบัน | ใบอนุญาต/ข้อจำกัด |
|---|---|---|
| OCR ไทย/อังกฤษ · เผื่อ RAM ทั้ง ERP+โมเดล 12 GB | `qwen3.5:4b` · artifact ที่วัดบน Mac 3,973,305,013 ไบต์ | [Apache-2.0](https://huggingface.co/Qwen/Qwen3.5-4B/resolve/main/LICENSE); CER ไทย/อังกฤษ/เลขไทย 1.227%/0%/3.004% ยอด/เลขเอกสารภาพสะอาดตรง แต่ JPEG/PDF เอียงคุณภาพต่ำอ่านเดือนผิด ต้องให้คนตรวจ |
| แชท ERP/ภาพของผู้ช่วย · เผื่อ RAM 24 GB+ | `qwen3.5:9b-q4_k_m` · GGUF 6,550,825,550 ไบต์ | [Apache-2.0](https://huggingface.co/Qwen/Qwen3.5-9B/resolve/main/LICENSE); ต้องใช้ GGUF เพื่อบังคับ context แบบ portable ยังไม่มีผลยอมรับคุณภาพ AI ปัจจุบันครบชุดที่ผ่าน |
| สร้างภาพ · macOS | `x/flux2-klein:4b` | ตาม catalog; ไม่ใช่ OCR |
| อ่านออกเสียง · Apple Silicon | `phonon` | เสียงอังกฤษ ไม่ใช่เสียงไทย/voice clone |
| ถอดเสียง · Linux/Windows | whisper.cpp + `ggml-tiny.bin` | macOS ยังไม่มี runtime ในชุดนี้ |

RAM เป็นแนวทางเผื่อทรัพยากร ไม่ใช่ผลวัดขั้นต่ำ ผลจริงมาจาก Apple Silicon 48 GiB และ corpus ทดสอบ ไม่รับรองทุกคำถาม ทุกภาพ หรือ Linux/Windows/ฮาร์ดแวร์อื่น ดู [Ollama Qwen3.5](https://ollama.com/library/qwen3.5) ตั้ง `OLLAMA_MODEL` กับ `OCR_MODEL` แยกกันและ restart; ไม่มีการสลับรุ่น/ขึ้น cloud อัตโนมัติ ตัวเลขจริงและขอบเขตข้อมูลเป็นของ server ส่วนข้อเสนอของ AI รอคนตรวจ ไม่สร้าง อนุมัติ จ่าย หรือลบรายการ

แชทรับเฉพาะ GGUF และปิด truncate/context shift: GGUF ในเครื่องปฏิเสธ prompt 40,018 tokens เมื่อขอ context 32,768 แต่ bare `qwen3.5:9b` บน Mac ใช้ MLX และรับ prompt นั้น จึงใช้แทนค่าเริ่มต้นแบบ portable ไม่ได้ OCR แยกต่างหากยังใช้ local MLX ได้ ไม่มีการตัดข้อความหรือ fallback เงียบ ผล GGUF 9B ล่าสุดไม่ผ่านการตรวจหลักฐานอิสระ และขนาด 27B ไม่ใช่หลักฐานว่าดีกว่าหรือผ่านการรับรอง

แชทใช้ [sampling สำหรับ non-thinking ตามผู้เผยแพร่](https://huggingface.co/Qwen/Qwen3.5-9B#best-practices): temperature 0.7, top-p 0.8, top-k 20, min-p 0 และ repetition penalty 1; presence penalty 1.5 สำหรับ lookup และ 0.5 สำหรับแผนทบทวนขั้นสุดท้าย เคยพบการตอบวนเมื่อใช้ near-greedy จึงไม่แก้ด้วยการยืดจำนวน token; ยังตรวจตัวเลขและแหล่งอ้างอิง คำตอบก่อนหน้าไม่ใช่หลักฐาน ERP ปัจจุบัน คำถามเกี่ยวกับรายการต้องอ่านข้อมูลที่มีสิทธิ์ใหม่ และคำแนะนำที่ไม่มีแหล่งข้อมูลต้องไม่มีข้อค้นพบหรือแสดงเป็นยอดเงินที่ยืนยันแล้ว

Assistant มีตัวเลือก **การอ่านข้อมูล**: ค่าเริ่มต้น **ERP records** บังคับอ่านข้อมูลใหม่ตามสิทธิ์แม้เป็นคำถามต่อเนื่อง ส่วน **Guidance / documents** ไม่อ่าน ERP ใช้กับคำแนะนำหรืออ่านไฟล์โดยไม่เทียบรายการ เปลี่ยนขอบเขตจะเริ่มบทสนทนาใหม่อย่างชัดเจน คำตอบ ERP เป็นข้อมูลจริงจาก server กับรหัสงานให้คนตรวจ ไม่ให้โมเดลเขียนยอด/สถานะซ้ำเอง ยอดค้างทั้ง workspace แสดงก่อนและเปิดรายละเอียดอื่นแยกได้ การตรวจ UUID ระบุเพียงผลอ่านตามขอบเขต/ข้อมูลบางส่วน ไม่ยืนยันการมีอยู่ของรายการในองค์กรอื่น ไม่ตัดข้อความเก่าทิ้งเพื่อให้ส่งคำถามต่อได้; เมื่อเกินขอบเขตต้องเริ่มบทสนทนาใหม่ รูปส่งเฉพาะข้อความปัจจุบัน จึงต้องแนบรูปอีกครั้งเมื่อต้องการถามต่อจากภาพ

ไม่เลือก Typhoon OCR เป็นค่าเริ่มต้น: แม้ model card ระบุ Apache แต่ [Terms ทางการ](https://opentyphoon.ai/tac) มีข้อจำกัด personal-data input, competitive benchmarking และบริการลักษณะเดียวกัน รวมถึงอ้างการเข้าถึงผ่าน third-party/model download ต้องทบทวนกฎหมาย/ขอคำชี้แจงก่อนนำมาใช้ ไม่ได้ตัดสินข้อกฎหมายว่าข้อใดมีผลเหนือ license

การ pull ติดต่อ registry เพื่อดาวน์โหลดน้ำหนัก; inference รับเฉพาะ loopback และตรวจ metadata ปฏิเสธ remote/cloud alias ก่อนส่งข้อมูลธุรกิจ ตัว daemon ที่ผู้ใช้รันเองยังต้องตั้ง no-cloud/OS firewall เอง Local-first ไม่ใช่ sandbox ของเครื่อง และไม่ปิดการส่งออก/webhook/บริการที่ผู้ใช้ตั้งไว้อย่างอื่น โมเดล **ไม่ได้**ลงบัญชีหรือยื่น ภ.พ.30; ต้องตรวจยอด วันที่ และหลักฐานต้นฉบับเสมอ

## 🚫 ขอบเขตที่ไม่อยู่ในระบบ

สมุดบัญชีแยกประเภท · การยื่นภาษี · เงินเดือน · การผลิต · e-Tax Invoice ตามกฎหมาย — อยู่นอกขอบเขต (north star: Thai statutory/legal close ยังเป็นเป้าหมายระยะยาว)

## 🤝 มีส่วนร่วม

1. อ่าน [CONTRIBUTING.md](./CONTRIBUTING.md) — รัน `pnpm lint` · `typecheck` · `test` · `build` ก่อนเปิด PR
2. ยอมรับ [CLA.md](./CLA.md)
3. ใช้ [แม่แบบ Issue](https://github.com/Boom-Vitt/nose-erp/issues/new/choose)

## 🔒 ความปลอดภัย

แจ้งช่องโหว่ผ่าน [Security Advisories](https://github.com/Boom-Vitt/nose-erp/security/advisories/new) เท่านั้น · ดู [SECURITY.md](./SECURITY.md) และ [บันทึก PDPA](./docs/PDPA_SECURITY_NOTES.md)

## 📄 สัญญาอนุญาต

Community: [AGPL-3.0-only](./LICENSE) หรือ [Commercial](./COMMERCIAL-LICENSE.md) · Pro ใน `ee/` เป็น source-available เชิงพาณิชย์ · [`bignose/`](./bignose/LICENSE) เป็นผลิตภัณฑ์แยก · ชื่อ/โลโก้สงวนตาม [TRADEMARK.md](./TRADEMARK.md) · บุคคลที่สามใน [NOTICE](./NOTICE)

---

<div align="center">

ถ้าโปรเจกต์นี้มีประโยชน์ กด ⭐ ให้ด้วย — ช่วยให้ธุรกิจไทยหาเจอได้ง่ายขึ้น

<br />

Copyright © 2026 BoomBigNose AI Co., Ltd.

</div>

<!-- BBN:FOOTER:START -->
[Made by BoomBigNose](https://github.com/Boom-Vitt)
<!-- BBN:FOOTER:END -->
