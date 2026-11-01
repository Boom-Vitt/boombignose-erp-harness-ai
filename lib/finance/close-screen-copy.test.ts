import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

const screens = [
  "app/(app)/finance/cash/page.tsx",
  "app/(app)/finance/bank/page.tsx",
  "app/(app)/finance/page.tsx",
  "app/(app)/reports/page.tsx",
  "app/(app)/reports/statements/page.tsx",
  "app/(app)/reports/accountant-pack/page.tsx",
  "app/(app)/settings/finance/page.tsx",
  "app/(app)/audit/close/page.tsx",
  "ee/accounting/settings-page.tsx",
] as const

const forbidden = /ยื่นแบบสำเร็จ|e-Tax Invoice|e-Filing|internet banking|bank login/i

describe("close screens stay support data", () => {
  it("keeps Thai close labels on the server pages", () => {
    const cash = readFileSync("app/(app)/finance/cash/page.tsx", "utf8")
    expect(cash).toContain("เงินสดตอนปิดงวด / Cash at close")
    expect(cash).toContain("Not a bank balance and not a ledger")
    expect(cash).toContain("BAHT_CAPTION_TH")
    expect(cash).toContain("แสดง / Show")
    expect(cash).toContain("closeDateLabel")

    const bank = readFileSync("app/(app)/finance/bank/page.tsx", "utf8")
    expect(bank).toContain("รายการธนาคาร / Bank lines")
    expect(bank).toContain("การบันทึกไม่ได้ลงบัญชี")
    expect(bank).toContain("ใบเสร็จลูกค้า / Customer receipts")
    expect(bank).toContain("bankLineStatusHelp")

    const reports = readFileSync("app/(app)/reports/page.tsx", "utf8")
    expect(reports).toContain("ภาษีซื้อรายเดือน / Purchase VAT by month")
    expect(reports).toContain("VAT_SUPPORT_TH")
    expect(reports).toContain("ไม่ยื่นแบบ ภ.พ.30")

    const settings = readFileSync("app/(app)/settings/finance/page.tsx", "utf8")
    expect(settings).toContain("ตั้งค่างวดบัญชี / Finance settings")
    expect(settings).toContain("ไม่ใช่การยื่นภาษี")
    expect(settings).toContain("/audit/close")

    const closeActivity = readFileSync("app/(app)/audit/close/page.tsx", "utf8")
    expect(closeActivity).toContain("กิจกรรมปิดงวด / Close activity")
    expect(closeActivity).toContain("Not a Revenue Department filing")

    const flowaccount = readFileSync("ee/accounting/settings-page.tsx", "utf8")
    expect(flowaccount).toContain("ส่งออก FlowAccount ไม่ใช่บัญชีแยกประเภท / FlowAccount export — not a general ledger")
    expect(flowaccount).toContain("ไม่ยื่นแบบ ภ.พ.30 และไม่แทนนักบัญชี")
    expect(flowaccount).toContain("does not replace an accountant")

    const pack = readFileSync("app/(app)/reports/accountant-pack/page.tsx", "utf8")
    expect(pack).toContain("ดาวน์โหลด CSV / Download CSV")
    expect(pack).toContain("packDateLabel")
    expect(pack).toContain("ไม่ใช่การยื่นแบบ ภ.พ.30")
  })

  it("does not describe a filing or a bank login", () => {
    for (const path of screens) {
      expect(readFileSync(path, "utf8"), path).not.toMatch(forbidden)
    }
  })
})
