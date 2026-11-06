# ข้อเสนอ: ERP Network Explorer 3D

## เป้าหมายที่ผู้ใช้ยืนยัน

แสดง ERP → เครื่องคอมพิวเตอร์ที่เชื่อมต่อ ERP → อุปกรณ์และเครือข่ายอื่นที่เครื่องเหล่านั้นติดต่อ เพื่อช่วยตรวจสอบการส่งข้อมูลออกนอกเครือข่ายที่อนุญาต ไม่ใช่กราฟความสัมพันธ์ clients/deals/invoices และไม่ใช่กราฟ SSH ตัวอย่างเพียงอย่างเดียว

ฐานโค้ดตรวจและอัปเดตจาก GitHub `main` แล้ว: `797aa59`, release `boombignose-v1.4.3`; branch ทำงาน `feat/network-explorer-3d` ไม่มีการ push หรือ deploy

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

## สถานะและหลักฐาน — 2026-11-06

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
