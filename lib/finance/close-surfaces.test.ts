import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => createElement("a", { href, ...props }, children),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/app/(app)/finance/actions", () => ({ updateFinanceLockDate: vi.fn() }))
vi.mock("@/app/(app)/finance/close-summary-actions", () => ({ summarizeMonthEnd: vi.fn() }))
vi.mock("@/app/(app)/finance/bank/actions", () => ({ addBankLine: vi.fn(), matchBankLine: vi.fn(), noteBankLine: vi.fn() }))

import { CloseSummary } from "@/app/(app)/finance/_components/close-summary"
import { AddBankLineForm, ExplainBankLineForm, MatchBankLineButton } from "@/app/(app)/finance/bank/bank-forms"
import { FinanceLockForm } from "@/app/(app)/settings/finance/finance-lock-form"
import { SupportFigures } from "@/app/(app)/reports/statements/support-figures"

const figures = {
  month: "2026-10",
  asOf: "2026-10-31",
  profit: { revenueSatang: 100_000, cogsSatang: 5_000, expenseSatang: 18_600, profitSatang: 76_400 },
  balance: { cashSatang: 50_000, receivablesSatang: 107_000, payablesSatang: 20_000 },
  vat: { outputVatSatang: 7_000, inputVatSatang: 1_400, netVatSatang: 5_600 },
  receivableAging: { current: 1, days1to30: 2, days31to60: 3, days61to90: 4, days91plus: 5 },
  payableAging: { current: 0, days1to30: 0, days31to60: 0, days61to90: 0, days91plus: 20_000 },
}

describe("close surfaces", () => {
  it("renders support statements in Thai with baht, VAT 7%, and พ.ศ.", () => {
    const html = renderToStaticMarkup(createElement(SupportFigures, figures))
    expect(html).toContain("2026-10 (10/2569)")
    expect(html).toContain("2026-10-31 (31/10/2569)")
    expect(html).toContain("จำนวนเงินเป็นบาท")
    expect(html).toContain("รายได้ก่อนภาษีมูลค่าเพิ่ม / Revenue before VAT")
    expect(html).toContain("฿1,000.00")
    expect(html).toContain("ภาษีขาย / Output VAT")
    expect(html).toContain("฿70.00")
    expect(html).toContain("ไม่ใช่การยื่นแบบ ภ.พ.30")
    expect(html).toContain("Not a ภ.พ.30 filing")
    expect(html).toContain("ยังไม่ถึงกำหนด / Not yet due")
    expect(html).toContain("เกิน 1–30 วัน / 1–30 days")
    expect(html).toContain("เกิน 91 วันขึ้นไป / 91 days or more")
    expect(html).toContain("ต้นทุนขาย / Cost of goods sold")
    expect(html).toContain("ลูกหนี้ / Receivables")
    expect(html).toContain("เจ้าหนี้ / Payables")
    expect(html).not.toMatch(/ยื่นแบบสำเร็จ|e-Tax Invoice/i)
  })

  it("offers a local month-end note without filing language", () => {
    const html = renderToStaticMarkup(createElement(CloseSummary))
    expect(html).toContain("สรุปปิดเดือน / Month-end note")
    expect(html).toContain("เขียนบันทึก / Write the note")
    expect(html).toContain("ไม่ลงบัญชีและไม่ยื่นภาษี")
    expect(html).toContain("does not post a journal or file tax")
  })

  it("keeps the finance-lock control names the signed-in tests use, and shows พ.ศ.", () => {
    const html = renderToStaticMarkup(createElement(FinanceLockForm, { orgId: "org", lockDate: "2026-01-31", today: "2026-02-15" }))
    expect(html).toContain("ล็อกเอกสารถึงวันที่ / ")
    expect(html).toContain("Lock transactions through")
    expect(html).toContain("aria-hidden=\"true\"")
    expect(html).toContain("Save finance lock")
    expect(html).toContain("2026-01-31 (31/01/2569)")
    expect(html).toContain("ปิดเดือนที่จบแล้ว / Close a completed month")
    expect(html).toContain("ไม่ใช่การปิดบัญชีแยกประเภทและไม่ใช่การยื่นภาษี")
  })

  it("labels a new bank line in baht", () => {
    const html = renderToStaticMarkup(createElement(AddBankLineForm, { today: "2026-10-31" }))
    expect(html).toContain("วันที่ / Date")
    expect(html).toContain("จำนวนเงิน (บาท ติดลบคือเงินออก) / Amount (THB, negative for money out)")
    expect(html).toContain("เพิ่มรายการธนาคาร / Add bank line")
    expect(html).toContain("2026-10-31")
  })

  it("labels a close note and a receipt match without turning either into a journal", () => {
    const empty = renderToStaticMarkup(createElement(ExplainBankLineForm, { lineId: "line", note: null }))
    expect(empty).toContain("บันทึกเหตุผล / Note for close")
    expect(empty).toContain("บันทึกเหตุผล / Save note")
    expect(empty).not.toContain("ล้างเหตุผล / Clear note")

    const noted = renderToStaticMarkup(createElement(ExplainBankLineForm, { lineId: "line", note: "ค่าธรรมเนียม" }))
    expect(noted).toContain("แก้เหตุผล / Update note")
    expect(noted).toContain("ล้างเหตุผล / Clear note")
    expect(noted).toContain("ค่าธรรมเนียม")

    const match = renderToStaticMarkup(createElement(MatchBankLineButton, { lineId: "line", paymentId: "receipt" }))
    expect(match).toContain("จับคู่ใบเสร็จนี้ / Match this receipt")
    expect(match).not.toMatch(/ยื่นแบบ|e-Filing|journal/)
  })

  it("does not invent a Buddhist-era label when the lock date is blank", () => {
    const html = renderToStaticMarkup(createElement(FinanceLockForm, { orgId: "org", lockDate: "", today: "2026-02-15" }))
    expect(html).toContain("Lock transactions through")
    expect(html).toContain("Save finance lock")
    expect(html).not.toContain("2569")
    expect(html).not.toContain("2568")
  })
})
