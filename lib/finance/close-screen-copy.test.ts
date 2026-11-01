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
  "app/(app)/audit/close/review-pack-button.tsx",
  "app/(app)/finance/journal/page.tsx",
  "app/(app)/finance/journal/journal-form.tsx",
  "app/(app)/finance/journal/trial-balance/page.tsx",
  "app/(app)/finance/journal/trial-balance-view.tsx",
  "app/(app)/settings/chart/page.tsx",
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
    expect(closeActivity).toContain("/audit/close/export")
    expect(closeActivity).toContain("ดาวน์โหลด CSV / Download CSV")
    expect(closeActivity).toContain("SUPPORT_REVIEW_MARK_EN")

    const journal = readFileSync("lib/finance/draft-journal.ts", "utf8")
    expect(journal).toContain("ไม่ใช่การยื่นแบบ ภ.พ.30")
    expect(journal).toContain("not signed statutory books")
    expect(journal).not.toMatch(/ยื่นแบบสำเร็จ|e-Tax Invoice/)

    const journalPage = readFileSync("app/(app)/finance/journal/page.tsx", "utf8")
    expect(journalPage).toContain("บันทึกรายวันฉบับร่าง / Draft journal")
    expect(journalPage).toContain("DRAFT_JOURNAL_LIMIT_TH")

    const trial = readFileSync("lib/finance/trial-balance.ts", "utf8")
    expect(trial).toContain("ไม่ใช่การยื่นแบบ ภ.พ.30")
    expect(trial).toContain("not signed statutory books")
    expect(trial).not.toMatch(/ยื่นแบบสำเร็จ|e-Tax Invoice/)

    const trialPage = readFileSync("app/(app)/finance/journal/trial-balance/page.tsx", "utf8")
    expect(trialPage).toContain("งบทดลองฉบับร่าง / Draft trial balance")
    expect(trialPage).toContain("TRIAL_BALANCE_LIMIT_TH")

    const chart = readFileSync("app/(app)/settings/chart/page.tsx", "utf8")
    expect(chart).toContain("/finance/journal")
    expect(chart).toContain("not signed statutory books")

    const review = readFileSync("lib/finance/support-review.ts", "utf8")
    expect(review).toContain("not a statutory sign-off")
    expect(review).toContain("ไม่ใช่การยื่นแบบ ภ.พ.30")
    expect(review).not.toMatch(/ยื่นแบบสำเร็จ|e-Tax Invoice/)

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
