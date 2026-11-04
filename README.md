<!-- BBN:HEADER:START -->
<p align="center">
  <img src="site/assets/brandmark.png" width="160" alt="BoomBigNose" />
</p>
<!-- BBN:HEADER:END -->

<div align="center">

# BoomBigNose ERP

### ระบบ ERP โอเพนซอร์สสำหรับธุรกิจไทย — ขาย · คลัง · โปรเจกต์ · การเงิน · AI บนเครื่องคุณ

[![GitHub stars](https://img.shields.io/github/stars/Boom-Vitt/boombignose-erp-harness-ai?style=flat-square&logo=github)](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/Boom-Vitt/boombignose-erp-harness-ai?style=flat-square&logo=github)](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/network/members)
[![License](https://img.shields.io/badge/license-AGPL--3.0%20%7C%20Commercial-blue?style=flat-square)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3FCF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Release](https://img.shields.io/github/v/release/Boom-Vitt/boombignose-erp-harness-ai?style=flat-square)](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/latest)

**ภาษาไทย** · [English](./README.en.md)

[เว็บไซต์](https://boom-vitt.github.io/boombignose-erp-harness-ai/) · [ดาวน์โหลด](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/latest) · [เอกสาร](./docs) · [แจ้งปัญหา](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/issues)

</div>

---

## ทำไมต้อง BoomBigNose

ธุรกิจไทยส่วนใหญ่เริ่มจาก CRM หนึ่งตัว เครื่องมือโปรเจกต์อีกตัว สเปรดชีตใบแจ้งหนี้ และสต็อกที่ตัวเลขไม่ตรงกัน **BoomBigNose ERP** รวมงานขาย จัดซื้อ คลัง โปรเจกต์ และการวางบิลไว้บนฐานข้อมูลเดียว — ออกแบบสำหรับไทยเป็นหลัก (VAT / ภาษีหัก ณ ที่จ่าย · สกุลเงินบาท · เขตเวลา `Asia/Bangkok`)

> หน้าต่างเดสก์ท็อปเปิด ERP ที่ `http://127.0.0.1:3100` · AI รันบนเครื่องคุณผ่าน Ollama ที่มากับแอป · ไม่ยื่นภาษีแทนคุณ (บัญชีตามกฎหมายยังอยู่กับ FlowAccount / PEAK / Xero)

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
| 🔐 **หลายองค์กรปลอดภัย** | Postgres + Row Level Security บังคับทุกตาราง |
| 🤖 **AI บนเครื่อง** | สรุปดีล · ร่างติดตาม · โน้ตปิดงบ — ไม่ส่งขึ้นคลาวด์ |
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

## ⬇️ ดาวน์โหลดแอปเดสก์ท็อป

หน้าดาวน์โหลด: [boom-vitt.github.io/boombignose-erp-harness-ai](https://boom-vitt.github.io/boombignose-erp-harness-ai/)  ·  [Releases ล่าสุด](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/latest)

| แพลตฟอร์ม | ไฟล์ |
|---|---|
| Windows | `BoomBigNose-windows-x64-setup.exe` (NSIS — อาจขึ้น SmartScreen) |
| macOS (Apple Silicon) | `BoomBigNose-macos-arm64.dmg` (เซ็น ad-hoc — อาจต้อง Open Anyway) |
| Linux | `.tar.gz` / `.AppImage` (ต้องมี WebKitGTK 4.1) |

ตั้งแต่แท็ก `boombignose-v0.3.0` ตัวติดตั้งพก Node runtime, Postgres/Auth/PostgREST และ Ollama ไว้ในแอป แท็ก `boombignose-v0.2.0` เป็นหน้าต่าง Wails ที่ยังไม่พกสแต็กเต็ม · `boombignose-v0.1.1` เป็น harness รุ่นเก่า

## 🚀 เริ่มต้นเร็ว (นักพัฒนา)

**สิ่งที่ต้องมี:** Node.js 22+ · pnpm · Docker · Supabase CLI (`pnpm exec supabase`)

```sh
git clone https://github.com/Boom-Vitt/boombignose-erp-harness-ai.git
cd boombignose-erp-harness-ai
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
- **Supabase** Postgres + Auth · `org_id` + RLS บังคับ · service-role ไม่ถึงเบราว์เซอร์
- เงินเป็นสตางค์จำนวนเต็ม (`bigint`) · กฎธุรกิจใน `lib/` มี Vitest · มี SQL tests และ Playwright

## 🤖 โมเดล AI บนเครื่อง

หน้าต่างเดสก์ท็อปเริ่ม Ollama `v0.40.11` ที่ `127.0.0.1:11434` · น้ำหนักโมเดลไม่อยู่ใน git · ติดตั้งที่ **Settings → โมเดล AI** (`/settings#local-models`)

| งาน | แพลตฟอร์ม | โมเดล |
|---|---|---|
| ข้อความ (ดีล / โน้ต / ปิดงบ) | Linux · Windows · macOS | `qwen2.5:3b` |
| อ่านรูป | Linux · Windows · macOS | `qwen2.5vl:3b` |
| สร้างภาพ | macOS | `x/flux2-klein:4b` |
| อ่านออกเสียง | Apple Silicon (EN) | `phonon` — ยังไม่มีเสียงไทยในรุ่นนี้ |
| ถอดเสียง | Linux · Windows | whisper.cpp + `ggml-tiny.bin` |

โมเดลเหล่านี้**ไม่ได้**ลงบัญชีหรือยื่น ภ.พ.30

## 🚫 ขอบเขตที่ไม่อยู่ในระบบ

สมุดบัญชีแยกประเภท · การยื่นภาษี · เงินเดือน · การผลิต · e-Tax Invoice ตามกฎหมาย — อยู่นอกขอบเขต (north star: Thai statutory/legal close ยังเป็นเป้าหมายระยะยาว)

## 🤝 มีส่วนร่วม

1. อ่าน [CONTRIBUTING.md](./CONTRIBUTING.md) — รัน `pnpm lint` · `typecheck` · `test` · `build` ก่อนเปิด PR
2. ยอมรับ [CLA.md](./CLA.md)
3. ใช้ [แม่แบบ Issue](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/issues/new/choose)

## 🔒 ความปลอดภัย

แจ้งช่องโหว่ผ่าน [Security Advisories](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/security/advisories/new) เท่านั้น · ดู [SECURITY.md](./SECURITY.md) และ [บันทึก PDPA](./docs/PDPA_SECURITY_NOTES.md)

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
