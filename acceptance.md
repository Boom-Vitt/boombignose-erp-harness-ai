# Acceptance: ERP Network 3D · Local AI · Thai/English OCR

## เป้าหมายที่ผู้ใช้ยืนยัน

แสดง ERP → เครื่องคอมพิวเตอร์ที่เชื่อมต่อ ERP → อุปกรณ์และเครือข่ายอื่นที่เครื่องเหล่านั้นติดต่อ เพื่อช่วยตรวจสอบการส่งข้อมูลออกนอกเครือข่ายที่อนุญาต ไม่ใช่กราฟความสัมพันธ์ clients/deals/invoices และไม่ใช่กราฟ SSH ตัวอย่างเพียงอย่างเดียว

ฐาน Network 3D รวมเข้า GitHub `main` แล้วผ่าน [PR #153](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/pull/153), commit `ddc5c11`; desktop 1.4.4 ติดตั้งและเปิดใช้งานแล้วพร้อม cold backup ข้อมูลเดิม ส่วนงานขยาย ERP/AI/OCR ด้านล่างยังต้องพิสูจน์แยก ไม่ใช้ผลตรวจ Network 3D รับรองงานใหม่

## Acceptance criteria เดิม — ต้องคงไว้

[x] แสดงเครื่อง + เส้น SSH จากข้อมูลตัวอย่าง
[x] คลิกเส้น → เห็นรายละเอียดเหตุการณ์
[x] กฎสัญญาณมีเทสต์ทุกข้อ (Vitest)
[x] ทุกสัญญาณ = รอคนตรวจ · ไม่แสดง secret

## Acceptance criteria เพิ่มเติม — การเชื่อมต่อจริงกับ ERP

[x] แสดง node ของ ERP, Mac ที่ลงทะเบียน และ IP ปลายทางใน 3D; ลูกศรรายงาน/SSH มีทิศทาง ส่วน TCP ระบุว่าไม่ทราบผู้เริ่มเชื่อมต่อ ไม่อ้างว่า IP คือ identity ของเครื่องปลายทาง
[x] แยกข้อมูลตัวอย่างออกจากข้อมูลจริงอย่างชัดเจน ข้อมูลตัวอย่างไม่ใช้รับรองความปลอดภัย
[x] เครื่องมี identity จากการลงทะเบียน collector ไม่ใช้ IP อย่างเดียว; ไม่ใช่ hardware attestation และเครื่องที่ไม่ได้ลงทะเบียนยังไม่ถูกสังเกต
[x] แสดงแหล่งข้อมูล เวลาเก็บข้อมูล server last seen ความสด และสถานะ collector ต่อเครื่อง
[x] แสดง TCP ปลายทางจาก collector จริง ไม่อนุมาน traffic ทั้งเครื่องจาก browser session
[x] คลิกเส้นเพื่อดูเวลา ต้นทาง ปลายทาง protocol/port และ process/PID ที่เก็บได้; เนื้อหา bytes และ SSH authentication จาก socket แสดง unknown
[x] กำหนด policy CIDR และแยก allowed, outside_policy, unknown; allowed ไม่ยืนยันว่าไม่มีข้อมูลรั่ว
[x] ปลายทางนอก policy และข้อมูลขาดหาย/เก่าสร้างสัญญาณ “รอคนตรวจ” พร้อม ID หลักฐาน
[x] เครื่องที่ลงทะเบียนแต่ไม่มีรายงาน รายงานเก่า หรือถูกตัดที่ 500 sockets แสดง unknown/coverage gap ไม่อ้างว่า safe
[x] ทุกกฎสัญญาณและ policy มี Vitest กรณีบวก/ลบ ขอบเขตเวลา IPv4/IPv6 และข้อมูลไม่ครบ
[x] telemetry ผูก credential กับ device; owner/admin session และ workspace RLS จำกัดการอ่าน/ตั้ง policy/เพิกถอน ทดสอบกับฐานข้อมูลจริงแยก
[x] telemetry และ graph API แสดงเฉพาะ allowlisted metadata ไม่แสดง payload, password, token, cookie, private key, arguments หรือ raw log; credential download ครั้งเดียวสำหรับ enrollment เป็นช่องทางส่วนตัวแยกต่างหาก
[x] รัน Go desktop binary → API ingestion → policy/signals → รายละเอียดและ canvas ใน ERP production build จริงบน disposable stack

## ข้อจำกัดที่ต้องแสดงในผลิตภัณฑ์

- เว็บไซต์ ERP มองไม่เห็นการเชื่อมต่อทั้งหมดของคอมพิวเตอร์ผู้ใช้ ต้องมี endpoint collector หรือ firewall/router/flow telemetry ที่ครอบคลุมเครื่องนั้น
- การเห็น connection หรือ bytes ไม่พิสูจน์ว่าเป็นข้อมูล ERP หรือว่าข้อมูลลับถูกส่งออก โดยเฉพาะ TLS, VPN และ tunnel; ต้องไม่แสดงข้อสรุปเกินหลักฐาน
- การไม่พบเหตุการณ์ไม่เท่ากับไม่มี traffic โดยเฉพาะ collector ที่เก็บแบบ snapshot ซึ่งพลาด connection อายุสั้นได้ ต้องระบุข้อจำกัดของแหล่งข้อมูล
- ฟีเจอร์นี้เป็นการสังเกตและรอคนตรวจ ไม่ใช่ระบบป้องกันการส่งข้อมูลออก ไม่มีการบล็อก เปิด SSH สแกนเครือข่าย หรือดักถอดรหัสอัตโนมัติ
- การติดตั้ง collector/ตั้งค่า firewall และสิทธิ์ระดับเครื่องต้องกำหนดตาม OS และสภาพแวดล้อมที่ผู้ใช้เลือกก่อน implementation ของการเก็บข้อมูลจริง

## กฎสัญญาณ

### กฎสำหรับเหตุการณ์ SSH (เมื่อมีข้อมูล SSH authentication)

| รหัส | เงื่อนไข | ขอบเขต |
| --- | --- | --- |
| `failed_burst` | login ไม่สำเร็จอย่างน้อย 5 ครั้งในหน้าต่างเลื่อน 5 นาที | คู่เครื่องต้นทาง/ปลายทางเดียวกัน รวมขอบเขต 5 นาที; หนึ่งสัญญาณต่อคู่ต่อชุดข้อมูล |
| `root_login` | login สำเร็จด้วยบัญชี `root` | หนึ่งสัญญาณต่อเหตุการณ์ |
| `off_hours` | login สำเร็จก่อน 06:00 หรือตั้งแต่ 22:00 Asia/Bangkok | 06:00 ไม่เข้าเงื่อนไข; 22:00 เข้าเงื่อนไข |

SSH connection metadata อย่างเดียวไม่ยืนยันผล authentication ห้ามสร้างเหตุการณ์ login สำเร็จ/ล้มเหลวจาก socket ที่เปิดอยู่

### กฎสำหรับการสังเกตเครือข่ายจริง

| รหัส | เงื่อนไข | ผลลัพธ์ |
| --- | --- | --- |
| `outside_policy` | collector พบปลายทางที่ไม่อยู่ในเครือข่าย/ปลายทางที่อนุญาตของ workspace | รอคนตรวจ พร้อม policy และหลักฐาน ไม่ตัดสินว่าข้อมูลรั่ว |
| `coverage_gap` | เครื่องที่ลงทะเบียนไม่มี telemetry, เวลาเกิน 120 วินาที, เวลาไม่ถูกต้อง/อนาคต หรือ snapshot ถูกตัดที่ 500 sockets | รอคนตรวจ พร้อมขอบเขตที่ไม่ทราบ ไม่ระบุว่าเครื่องปลอดภัย |

ค่า policy และ freshness threshold ต้องเป็นค่าที่กำหนดชัดเจนในผลิตภัณฑ์และมีเทสต์ ไม่ใช้กฎ SSH ตัวอย่างแทนกฎตรวจ egress จริง

## แผนงานตาม dependency

1. สร้างและปรับเอกสาร acceptance นี้ก่อน implementation — ทำแล้ว; คงเกณฑ์เดิมและเพิ่มเป้าหมายจริงตามคำชี้แจงผู้ใช้
2. ตัดสินแหล่ง telemetry และขอบเขตเครื่องที่จะตรวจ: endpoint collector บนแต่ละเครื่อง หรือ firewall/router ที่มีอยู่; ระบุ OS, วิธีผูกเครื่องกับ ERP และระดับ coverage จริง
3. อ่านและใช้ระบบ auth/workspace/RLS ที่มีอยู่ ออกแบบ metadata schema, machine enrollment, telemetry ingestion และ policy โดยไม่ส่ง secret ไปยัง client
4. ทำ collector/adapter จริงสำหรับแหล่งที่เลือก พร้อมสถานะ freshness/coverage และยืนยัน flow end-to-end โดยไม่กระทบ ERP desktop ที่กำลังทำงาน
5. เพิ่มหน้า `/network` และ navigation ใช้ React Three Fiber / Three.js ที่มีอยู่ แสดง ERP, เครื่อง, เครือข่าย, ทิศทางเส้น และแผงเหตุการณ์แบบคีย์บอร์ดใช้งานได้
6. เพิ่ม sample mode แยกต่างหากสำหรับเครื่องและ SSH events; IP ตัวอย่างใช้ RFC 5737 และไม่มี credential จริง
7. เขียน Vitest ครบทุกกฎ signal/policy และตรวจ secret projection, workspace isolation, stale/missing telemetry; ทดสอบ positive/negative/boundary ไม่ใช่เพียง wiring
8. เปิด ERP จริง ตรวจเส้น รายละเอียด กฎ outside-policy และ coverage gap พร้อมหลักฐานจาก telemetry จริง; ตรวจ type/lint และบันทึกผล acceptance ตามที่รันจริง


## ขอบเขต implementation ที่เลือกแล้ว

- ผู้ใช้เลือก **endpoint collectors บนเครื่องที่เชื่อม ERP** และระบบปฏิบัติการ **macOS**
- Collector เป็นโปรแกรม **Go native** ในโมดูล desktop ใช้ `lsof` บน Mac อ่าน TCP connections แบบ snapshot ไม่ต้องติดตั้ง Node.js บนเครื่องที่เฝ้าดู; ไม่ขอสิทธิ์ root อัตโนมัติ แสดงว่าเห็นเฉพาะ process ที่ OS อนุญาต และอาจพลาด connection อายุสั้น
- อุปกรณ์ลงทะเบียนกับ ERP ด้วย credential เฉพาะเครื่องที่เพิกถอนได้ เก็บ hash ฝั่ง server; credential ใช้ส่ง telemetry เท่านั้น ไม่ใช่สิทธิ์อ่าน ERP
- Credential ถูกส่งเป็นไฟล์ตั้งค่าส่วนตัวในการลงทะเบียนโดย owner/admin เท่านั้น ไม่แสดงบนกราฟ รายละเอียด telemetry หรือ log; การส่งข้ามเครื่องใช้ HTTPS และ HTTP อนุญาตเฉพาะ loopback สำหรับ local testing
- เก็บล่าสุดต่อเครื่องใน Supabase โดยแยก workspace และจำกัด owner/admin; ไม่เพิ่มระบบเก็บ packet หรือ payload
- Policy เป็น CIDR ที่ owner/admin กำหนด; ถ้ายังไม่ตั้ง policy ให้แสดง unknown ไม่เดาว่า private IP ทั้งหมดปลอดภัย
- กำหนด stale threshold 120 วินาที collector ส่ง snapshot ทุก 30 วินาที; heartbeat ที่ไม่มี connections ไม่ถูกอ้างว่าเป็นหลักฐานว่าไม่มี traffic
- แยกเส้น collector → ERP (หลักฐานการส่งรายงาน) ออกจากเส้น TCP ที่ collector สังเกตจริง; ไม่อนุมานว่า socket คือการส่งข้อมูล ERP หรือยืนยันทิศทางเริ่มต้นของ TCP
- TCP snapshot ไม่ให้ bytes หรือผล SSH authentication จึงแสดง unknown; sample mode แยกต่างหากมี SSH events เพื่อทดสอบเกณฑ์เดิม

## หลักฐานเฟส Network 3D ก่อนอนุมัติเผยแพร่ — 2026-11-06

- สร้าง acceptance ก่อน implementation แล้วปรับตามคำชี้แจงเรื่อง ERP-connected computers, macOS และ Go; ขอบเขต/วิธีรันอยู่ใน `boombignose/README.md`
- GitHub: remote ถูกต้อง; fetch ตรวจว่า branch เดิมตามหลัง main 41 commits ไม่มี commit เฉพาะ local จึงสร้าง `feat/network-explorer-3d` จาก `797aa59` (release v1.4.3) โดยเก็บ screenshot เดิมไว้ ไม่มี commit/push/release/install
- Native Go: `go test ./internal/networkcollector ./cmd/boombignose` ผ่าน; CLI build และ `go build -tags desktop` ผ่าน
- Native smoke: `BOOMBIGNOSE_NETWORK_COLLECTOR_SMOKE=1 ... TestMacOSLiveCollectorToIsolatedSink` ผ่านด้วย `lsof` จริง; จากนั้น Wails desktop executable โหมด `--network-collector --once` ส่ง 73 sockets เข้า dev ERP และ 84 sockets เข้า production ERP บน stack แยกสำเร็จ
- ฐานข้อมูลแยก: replay migrations ทั้ง 100 ไฟล์สำเร็จ รวม migration ใหม่; ใช้ PostgreSQL/GoTrue/PostgREST ที่ bundle มากับแอป บนพอร์ตแยก ไม่เปลี่ยนข้อมูลหรือ process ของ desktop ที่ติดตั้ง
- Browser: sign-in ด้วยบัญชีสังเคราะห์; enrollment/download config ส่วนตัว; save CIDR; live topology/TCP event details/process/PID; stale → unknown/coverage_gap; review-only signals; Thai/English; canvas edge raycast เปิด SSH events; หมุนและ reset; WebGL context loss แล้วยังใช้รายการเหตุการณ์ได้; production surface ไม่มี horizontal overflow
- API/DB security จริง: token ผิด → 401; device ID ไม่ตรง → 400; replay → 409; คนละ workspace มองไม่เห็น/เพิกถอนไม่ได้ (404); member อ่านไม่ได้; owner อ่าน token hash หรือเขียน telemetry ตรงไม่ได้; revoke แล้ว native collector → 401 ไม่มี success heartbeat; graph JSON ไม่มี credential/payload fields
- `pnpm test`: **230 files / 1,728 tests ผ่าน** รวมทุกกฎสัญญาณ; scoped ESLint และ `pnpm typecheck` ผ่าน; `pnpm build` ผ่าน มีคำเตือน dynamic filesystem tracing 3 จุดใน `lib/ai/asr-install.ts` ที่ไม่ได้แก้ในงานนี้
- แก้ bug ที่เจอจาก smoke จริง: Canvas fallback child ถูก mount แม้ WebGL ใช้ได้; Next internal localhost origin ต่างจาก public loopback origin; Go RFC3339Nano timestamp ต้องรับแล้ว normalize เป็น milliseconds เพิ่ม regression สำหรับ origin และ timestamp
- ข้อจำกัดการตรวจ: `go test ./...` มี 2 integration tests ใน `internal/cutover` ไม่ผ่านเพราะไม่มี PostgreSQL client binaries; pgTAP script `supabase/tests/network_visibility.sql` ยังไม่รันเพราะ native cluster ไม่มี pgTAP จึงใช้ real scoped SQL/API smoke ตรวจ RLS/replay/revocation แทน ไม่อ้างว่า pgTAP ผ่าน
- ไม่มีการอัปเดต `/Applications/BoomBigNose.app`, migrate ฐานข้อมูลใช้งานจริง หรือเผยแพร่ installer; การนำไปใช้ต้อง build/package รุ่นใหม่ apply migration ตามปกติ และลงทะเบียน Mac ที่ต้องการตรวจผ่าน HTTPS ที่เข้าถึงได้
- ปิด browser task และ service ทดสอบทั้งหมดแล้ว ลบฐานข้อมูลสังเคราะห์ config/session ส่วนตัว binary ทดสอบ และ screenshot ที่มี metadata จริง; เก็บเฉพาะภาพตัวอย่างที่ไม่มีข้อมูลจริงใน `/tmp` แอปเดิมยังตอบ login HTTP 200

## ข้อกำหนดเพิ่มเติมจากผู้ใช้ — ERP + AI ครบ workflow

สถานะเริ่มต้น: ยังไม่ผ่าน acceptance ของเฟสนี้ ข้อกำหนดต้องพิสูจน์กับ runtime จริง ข้อมูลสังเคราะห์ที่แยกจากฐานใช้งาน และโมเดลบนเครื่องจริง ไม่ถือว่า mock response หรือการ build ผ่านเพียงอย่างเดียวเพียงพอ

- [x] ทำบัญชีทุก page route รวม dynamic routes แล้วตรวจการโหลดจริง ไม่มี unhandled server/client exception; anonymous, owner/admin/accountant/member ได้ผลตามสิทธิ์; valid/invalid ID และข้อมูลว่างมีผลลัพธ์ที่ออกแบบไว้
- [ ] งานหลักบนหน้าที่เปลี่ยนใช้ได้จริงด้วยคีย์บอร์ดและจอมือถือ ไม่มีส่วนซ้อน/บัง controls หรือ horizontal overflow ที่ทำให้งานใช้ไม่ได้
- [ ] Local AI สนทนาไทย/อังกฤษ อ้างอิงข้อมูล workspace ปัจจุบันผ่าน read-only tools แสดงแหล่งอ้างอิง ข้อจำกัด และ next actions ที่แยกจากข้อเท็จจริง; ไม่แต่งยอดเงินหรืออ้างว่าเขียนข้อมูลสำเร็จ
- [ ] ทดสอบโมเดลจริงกับคำถามยอดเงิน รายการ/สถานะ งานติดตาม และข้อมูลไม่พอ; ตรวจ tenant/role isolation, prompt injection จากข้อมูล และผลลัพธ์เมื่อโมเดลหาย/หยุด/หมดเวลา
- [x] เลือกและแนะนำโมเดลที่ติดตั้งได้จริงตาม RAM, platform, license, ความสามารถ และ latency ที่วัดได้; ไม่ส่งข้อมูลธุรกิจไป cloud fallback และไม่ดึง weights โดยไม่มีการเริ่มติดตั้งชัดเจน
- [x] เพิ่ม OCR open-source ที่รองรับภาษาไทยและอังกฤษ อ่านเอกสาร รูป และบิลผ่านโมเดลในเครื่อง; ใช้ prompt/parameters ของผู้เผยแพร่และตรวจ license ของ checkpoint จริง
- [x] เอกสาร PDF หลายหน้าและรูปมีข้อจำกัดขนาด/จำนวนหน้า/ชนิดไฟล์ที่ชัดเจน; ตรวจไฟล์จริง ไม่โหลด URL ที่ผู้ใช้อ้างขึ้นเอง ไม่ execute script และไม่ render HTML ของ OCR แบบไม่ sanitize
- [x] OCR แสดงข้อความต้นฉบับ ผลแยก fields และรายการที่ต้องตรวจ; วันที่/สกุลเงิน/ยอดรวม/ภาษีไม่เดาเมื่ออ่านไม่ได้ ต้องให้คนยืนยันก่อนสร้าง draft และไม่ post บัญชี/ยื่นภาษีอัตโนมัติ
- [x] พิสูจน์ OCR กับเอกสารไทย อังกฤษ ไทยปนอังกฤษ บิล และภาพอ่านไม่ชัด/ข้อมูลขาด โดยระบุความผิดพลาดจริง ไม่ใช้คำว่าแม่นยำ 100%
- [x] ออกแบบโหมดบุคคลธรรมดา SME และบริษัท/องค์กรให้มีงานเริ่มต้น navigation และ 3D ที่ต่างกันตามความจำเป็น ไม่ใช่แค่สลับ label/สีหรือจัดลำดับเมนูเดิม; เปลี่ยนโหมดไม่เปลี่ยนสิทธิ์หรือทำข้อมูลหาย
- [x] โหมดองค์กรมีภาพรวม 3D ที่เชื่อมกับข้อมูล ERP จริงและมีงานที่กดทำต่อได้; แยกความหมาย Campus/Blueprint/Network ให้ชัด ไม่มีฉากหรือ controls ซ้อนจนรบกวนงาน; มี reduced-motion และทางเลือกแบบรายการเมื่อ WebGL ใช้ไม่ได้
- [x] ทบทวน PDPA/ความเป็นส่วนตัว RBAC/MFA secret handling retention/upload และ cybersecurity ตามบริบทไทย; บันทึกแหล่งกฎหมายและขอบเขตที่ต้องให้ผู้เชี่ยวชาญตรวจ ไม่อ้าง certification หรือ legal/tax compliance ที่ไม่ได้พิสูจน์
- [x] มีทางติดตั้ง server ที่ทำซ้ำได้ ตั้งค่า secrets ส่วนตัว ตรวจ prerequisites/start/health/backup/restore/upgrade และแยก local-only default จาก remote HTTPS ที่ผู้ดูแลเปิดเอง; คง Go เป็น native desktop/service supervisor
- [ ] ติดตั้ง/ตั้งค่า Tailscale บนเครื่อง server ด้วยบัญชีที่ผู้ใช้ควบคุม ใช้ private HTTPS Serve เท่านั้น ไม่มี Funnel/port-forward สาธารณะ; ตรวจ auth/MFA, origin/cookie, pairing/revocation และจำกัดสิทธิ์ตาม tailnet policy
- [ ] ยืนยันการใช้จาก mobile จริงผ่าน tailnet และการถูกปฏิเสธเมื่อไม่มีสิทธิ์; หากติด account/OS approval ให้ระบุ prerequisite จริงและไม่อ้างว่าตรวจสำเร็จจาก localhost เพียงอย่างเดียว
- [ ] GitHub Pages ใช้ screenshot จาก build ปัจจุบันหรือโมเดล 3D ปัจจุบันที่เปิดได้จริง ด้วยข้อมูลตัวอย่าง ไม่มีข้อมูลส่วนตัว/QR/session/secret; ลิงก์ดาวน์โหลดตรงกับ release ที่มี assets/checksums ครบ และตรวจหน้าที่ deploy จริงทั้ง desktop/mobile
- [ ] แชทค้นและอ่านข้อมูลธุรกิจทุก domain ที่บัญชีปัจจุบันได้รับอนุญาต พร้อม catalog/fields/pagination/แหล่งอ้างอิง; ไม่จำกัดเพียงรายการ ERP เดิมไม่กี่เครื่องมือ และไม่เปิด credential/token/ข้อมูลข้าม workspace
- [ ] ข้อความยาว แชท WhatsApp และเอกสารไทย/อังกฤษที่รับเข้ามาเก็บครบ ค้นและอ่านถึงช่วงท้ายได้จริง มีช่วง/coverage/hash/quote ที่ตรวจได้ ไม่ตอบปฏิเสธความสามารถแบบกว้าง ๆ หรือแอบตัดข้อความ
- [ ] ใช้ backend ชุดที่จำเป็นและ Ollama ที่แชร์ตัวเดียว แชท/OCR ไม่สร้าง daemon ซ้ำ; supervisor จำกัดโมเดลค้างหนึ่งตัว ไม่ทิ้ง QA stacks/runners และไม่ปิดโปรเซสของผู้ใช้โดยพลการ

หลักฐาน candidate ที่ตรวจแล้ว: route inventory 92 page templates, 1,034 HTTP observations ผ่าน login จริง 6 บทบาท และ 159 browser observations รวมจอ 390×844 จำนวน 13 กรณี ไม่พบ unexpected read/render/5xx/transport/console-error/overflow; เป็น render/read smoke ไม่ใช่การรับรองทุกธุรกรรมหรือฟีเจอร์ Pro. แยก native backend ด้วย JWT และ record ที่มีเฉพาะฐานนั้น ไม่ใช้ fixture ที่เหมือนกันเป็นหลักฐาน routing.

OCR ใช้ Qwen3.5:4b จริง: corpus ภาษาไทย/อังกฤษ/เลขไทยมี normalized CER 1.227%/0%/3.004%; ภาพเสื่อมคุณภาพและ PDF ภาษาไทยยังอ่านเดือนผิดได้ จึงต้องตรวจคน. Native workflow ผ่าน review reset → prefill ที่ยังไม่บันทึก → Add line 133,804 สตางค์ใน draft ที่ยังไม่ submit/approve/pay; ต้นฉบับแนบแยกและดาวน์โหลดเทียบ hash ได้ ข้าม workspace 404/anonymous 401. โมเดลแชท/ภาพในซอร์สใช้ qwen3.5:9b-q4_k_m แบบ GGUF เพื่อบังคับขอบเขต context จริง แยกจาก OCR; ไม่ถือว่า 4b มีคุณภาพงาน ERP ซับซ้อนเท่ากัน.

องค์กร 3D ผ่าน keyboard/raycast, reduced motion และ WebGL-loss list fallback; ภาพ Individual ปัจจุบันตรวจแล้วไม่มี decorative WebGL canvas. HTTP recovery หลังแก้ default-ACL ผ่าน owner/table/column ACL 110 แถว ข้อมูลธุรกิจ 80 ตาราง บัญชี 6 บัญชี RLS/sequence และ attachment isolation; ลบ MFA/session ทดสอบแล้ว. Release/desktop/Tailscale/mobile และ AI follow-up หลังแก้ sampling ยังไม่ถือว่าผ่านจากหลักฐานเหล่านี้.

Headless native smoke บน Mac ผ่าน bundle จริงด้วยพอร์ตแยก 6 พอร์ต: pure-Go raster, PostgreSQL clients 16.15, health, signup/signin, model daemon ใน HOME ชั่วคราวที่ไม่มีโมเดล/manifest/blob และ graceful shutdown ปิดทุกพอร์ต ไม่แตะแอปหรือ model daemon ใช้งานจริง. Linux/systemd และ installer ที่แจกยังเป็น release CI gate ไม่ใช่หลักฐานจาก Mac.

Native explicit-source proof ผ่านโมเดลจริงแล้ว: Thai 200/28.51s, English follow-up 200/27.95s พร้อมผลอ่านใหม่; injection/empty/member/permission-denial/foreign-reference/image ผ่านขอบเขตที่คาด และ context overflow ปฏิเสธชัดเจนโดยไม่ทิ้งประวัติ. Full 241 files/1,970 Vitest, typecheck และ production build ผ่านก่อนขยายข้อกำหนดล่าสุด. ข้อ 106–107 ยังไม่ทำเครื่องหมายผ่านจนกว่าจะรวมและพิสูจน์การอ่านทุก domain/ข้อความยาวและ UI ใหม่ตามที่ผู้ใช้เพิ่ม; หยุด QA ERP/frontend/site แล้ว เหลือ shared Ollama ตัวเดียวไม่มีโมเดลค้าง ณ เวลาตรวจ.

### ลำดับ implementation และ proof

1. ตรวจ source/route/tooling ปัจจุบันและค้น primary sources เรื่องโมเดล OCR licensing Tailscale กฎหมายและ security; สรุป tradeoff ก่อนเลือก
2. ตั้ง disposable runtime และ fixture ครอบคลุมทุก route เก็บ failure จริงก่อนแก้ โดยไม่แตะข้อมูล desktop ที่ผู้ใช้กำลังทำงาน
3. แก้ local AI/OCR ด้วย contract ข้อมูลที่ตรวจสอบได้และ human-review boundary; รันโมเดลจริงและ regression ของ consumer-visible edge cases
4. แยก workspace modes และปรับ organization 3D ตาม task/data ไม่เพิ่มฉากเพื่อความสวยอย่างเดียว; ตรวจ browser/mobile และ WebGL fallback
5. ทำ server/Tailscale deployment ที่ private-by-default พร้อม backup/recovery และ user-controlled account/OS approvals
6. รัน affected checks และ smoke ทั้งระบบ บันทึกผลแต่ละข้อ อัปเดตภาพ/หน้า GitHub Pages และเผยแพร่รุ่นที่ตรวจแล้วเท่านั้น

## ข้อกำหนดเพิ่มเติม — Go runtime และ AIC ล่าสุด

- [ ] ย้าย production application backend ไป Go โดยรักษา workflow เดิมทั้งหมด ไม่ใช่เพียง static shell; browser/WebView ยังคงใช้ static React/3D assets เพื่อรองรับ desktop และมือถือ
- [ ] ตัด Node application server และ PostgREST application runtime ออกจาก production เมื่อย้าย caller ครบและตรวจจริงแล้วเท่านั้น; PostgreSQL, GoTrue และ Ollama ตัวเดียวใช้ซ้ำ ไม่สร้าง backend/provider ที่ทำงานซ้ำ
- [ ] ใช้ capability matrix กลางเดียวกันสำหรับ Go และ UI; verified identity, live membership/current workspace, MFA, trusted origin และ machine operator ต้องไม่มาจาก model หรือ request body
- [ ] เงินยังเป็น integer satang ที่ไม่เกิน safe-integer boundary; unknown/partial/empty ต้องไม่กลายเป็นศูนย์หรือยอดรวมที่อ้างว่าครบ และธุรกรรม/idempotency/audit เดิมต้องยังทำงาน
- [ ] AI อ่านทุก business domain ที่ผู้ใช้มีสิทธิ์ รวมข้อความ/เอกสารยาวแบบอ่านต่อครบและตรวจ hash/quote ได้; ไม่มี secret, cross-workspace access หรือการอนุมัติ/จ่ายเงินอัตโนมัติ
- [ ] ย้าย API, server actions/queries, เอกสาร/ใบหักภาษี/รายงาน/PDF/CSV, automation, private attachments, backup/restore, network collector และ mobile access ครบ ไม่เก็บ Node fallback หรือ endpoint ที่ทำงานหลอก
- [ ] ใช้ AIC จาก GitHub ล่าสุดที่ pin commit และตรวจ interface จริง; งานขนานต้องมี contract/เจ้าของ output/workspace แยก และให้ integration owner ตรวจผล ไม่ใช้จำนวน agent เป็นเกณฑ์คุณภาพ
- [ ] เปรียบเทียบ resource ด้วย workload ที่เทียบกันได้ แยก Go/backend, WebView และ model weights ก่อนอ้างว่าเบาลง; พิสูจน์การสลับ chat 9B → OCR 4B โดยไม่ค้างสองโมเดล
- [ ] ตรวจ integrated Go artifact ด้วย role/org/MFA/CSRF/privacy/money/restore/model/browser/native scenarios และ independent security review ก่อน publish/install
- [ ] รักษา installed 1.4.4 และ recovery backup ที่ตรวจแล้วจนกว่าจะปิดแอปตามปกติและยืนยัน cutover; ไม่ force quit ไม่ reset ข้อมูล และไม่ถือว่า GitHub/desktop/Tailscale/mobile สำเร็จก่อนมีหลักฐานจริง

### ลำดับ Go cutover

1. Integration owner กำหนด shared authorization, database/HTTP และ evidence/task contracts โดยใช้ policy เดิมเป็นแหล่งอ้างอิง
2. แยก implementation ที่ interface พร้อมและ output ไม่ทับกัน: ใช้ source snapshot แยกสำหรับ read-tool/AI; domain packages ใหม่ใช้ exclusive paths ที่ไม่มีผู้เขียนร่วม โดย parent ถือ shared contracts, integration และ verification
3. รวม caller ทุกตัวและลบ runtime เก่าที่หมดหน้าที่; ตรวจ financial/privacy boundaries และ run จริงก่อนวัด resource
4. ตรวจ independent review, ภาพปัจจุบัน, release CI, recovery และ desktop/mobile cutover ตามเกณฑ์เดิมทั้งหมด

AIC ที่เลือกคือ `Boom-Vitt/aic` main commit `d90246f330a9e2799f773254583862669dd449f7`: development `0.0.1` หลังเจ้าของรีเซ็ตเลขเวอร์ชัน ไม่ใช่ release `v2.0.2` ที่เก่ากว่า main. ติดตั้ง generic skill ใน user skill root โดยไม่เปิด daemon/provider/maintainer; offline verifier ผ่าน 260 tests (skip 1). อ่าน skill file และเรียก CLI จริงแล้ว แต่ named skill discovery ใน host ปัจจุบันยังไม่ refresh จึงไม่อ้างว่าทดสอบ discovery สำเร็จ.

Shared Go contract gate 302 ผ่าน Go package tests, actual `go run` consumer (member/finance, forged-JSON authority, MFA downgrade, expiry, owner≠machine operator, exact satang boundary), Vitest สิทธิ์เดิม 6 tests และ TypeScript. ใช้ policy JSON เดียวใน Go/UI แล้ว ไม่ได้เปิด backend เพิ่ม. Gate นี้ยังไม่ใช่หลักฐานว่า live auth/RLS, Go ERP runtime, model/OCR หรือ UI cutover เสร็จ; เริ่ม isolated Go read-tool และ local-AI/OCR implementations ตาม AIC coordinated-delivery ที่ validate แล้ว โดย parent ถือ integration/verification.

Go component gate 303 ผ่าน erpwire/erpdata/localai/bundle tests และ erpcore compile (ยังไม่มี erpcore permanent tests). Real Go→Ollama proof 304 อ่านบิลไทยได้ subtotal/VAT/total 100,000/7,000/107,000 สตางค์ hash source/raster/visible text ตรง มี human-review warning และเห็น resident 9B เพียงตัวเดียวก่อนสลับเป็น 4B เพียงตัวเดียว; ไม่เปิด ERP/model provider เพิ่ม. ยังไม่ถือว่า OCR corpus/PDF/UI ใหม่ผ่านทั้งหมด.

Real Go auth/RLS probe 311 ใช้ populated fixture จริงกับ PostgreSQL+GoTrue เท่านั้น ไม่มี Node/PostgREST/gateway: ผูก owner/admin/accountant/member/foreign ได้, unassigned ต้อง onboarding, อ่าน 71 entities ได้ตามขอบเขต, canonical snapshot อ่านจริง, member อ่าน profit ไม่ได้, ไม่มี verified request อ่าน SQL ไม่ได้, model เปลี่ยน org ไม่ได้, foreign อ่าน invoice อีก org ไม่ได้ และ insert/update rollback ไม่เหลือ client ทดสอบ. ปิด owned infrastructure แล้ว; ยังไม่ใช่ HTTP/UI migration หรือ acceptance ของทุก workflow.

Real Go model proof 312 ผ่าน: WhatsApp ไทย 132,291 bytes ค้นหาและอ่านช่วงท้ายจริง 8.020s, English follow-up อ่านต้นฉบับใหม่ 6.315s, OCR ไทย 3.285s/hash/100,000+7,000=107,000 สตางค์ตรง; เห็น resident chat 9B เพียงตัวเดียวก่อนสลับเป็น OCR 4B เพียงตัวเดียว ไม่มี provider/backend เพิ่ม. เป็น component proof ไม่ใช่ HTTP/UI/all-page acceptance.

Independent Go boundary review พบ 4 จุดและ reproduce จริง: reference ที่ถูกตัด quote/มีเลขนำหน้า, อักษรล่องหนหลบ numeric guard, NULL optional parent ทำให้ update ไม่เกิด และ composite tenant FK join ใช้ไม่ได้. เพิ่ม regressions ของ source ownership/Unicode, ตรวจ boundary ในข้อความที่อ่านจริง (ขอบ partial range ที่ไม่รู้บริบทไม่รับรองเป็น whole code), normalize default-ignorable เฉพาะการตรวจไม่เปลี่ยน display/hash/quote. SQL probe 313 ล้มก่อนแก้; 314 พบ parameter typing เพิ่ม; 315 ผ่าน forward/reverse tenant join และล้าง project พร้อมแก้ notes จริงใน transaction ที่ rollback โดยยังผ่าน 71 entities/role/org boundaries. Actual model หลัง hardening กำลังตรวจใหม่ ไม่อ้างว่า integration/security review ทั้งระบบผ่าน.

AIC domain plan validate แล้ว: CRM, expenses, subscriptions และ dashboard/blueprint/organization ใช้ erpwire operation/actor/store เดียวและ exclusive new Go packages, parent ทำ HTTP/storage/browser/native integration. เก็บ result/redirect/refresh, Map และ field/file presence เป็น typed transport; ใช้ strict exact decimal parserร่วม ไม่เพิ่ม runtime. Package/source report ยังไม่ใช่ผลตรวจ workflow หรือหลักฐานว่า Go production cutover เสร็จ.
