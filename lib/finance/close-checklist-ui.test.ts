import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => createElement("a", { href, ...props }, children),
}))

import { MonthEndCloseSection } from "@/app/(app)/reports/_components/month-end-close"
import { monthEndCloseChecklist, type CloseChecklistInput } from "@/lib/finance/close-checklist"

const input: CloseChecklistInput = {
  month: "2026-01",
  today: "2026-02-15",
  lockDate: null,
  viewerId: "viewer",
  invoices: [{ status: "sent", issueDate: "2026-01-05", dueDate: "2026-01-20", amountSatang: 5000, paidSatang: 0, creditedSatang: 0, vatSatang: 350 }],
  bills: [{ vendorId: "v", expenseClaimId: null, paidAt: null, dueDate: "2026-01-10", amountSatang: 2000, kind: "bill" }],
  bankLines: [{ bookedOn: "2026-01-15", amountSatang: 400, matched: false }],
  claims: [{ status: "submitted", employeeId: "other" }],
  credits: [],
  purchaseVat: [{ month: "2026-01-01", inputVatSatang: 70 }],
  tax: { legalName: "", address: "", taxId: "", branchLabel: "", taxStatus: "unknown" },
}

describe("MonthEndCloseSection", () => {
  it("lists close blockers with counts, amounts, and deep links", () => {
    const result = monthEndCloseChecklist(input)
    if (!result.ok) throw new Error(result.error)
    const html = renderToStaticMarkup(createElement(MonthEndCloseSection, { checklist: result.checklist }))
    expect(html).toContain("ปิดงบเดือน / Month-end close")
    expect(html).toContain("5 to review")
    expect(html).toContain("ลูกหนี้เกินกำหนด / Overdue receivables")
    expect(html).toContain('href="/finance?status=overdue"')
    expect(html).toContain('href="/finance?tab=costs"')
    expect(html).toContain('href="/finance/bank"')
    expect(html).toContain('href="/finance?status=draft"')
    expect(html).toContain('href="/expenses?tab=approve"')
    expect(html).toContain('href="/finance/business-profile"')
    expect(html).toContain('href="/reports#purchase-vat"')
    expect(html).toContain('href="/settings/finance"')
    expect(html).toContain("฿50.00")
    expect(html).toContain("฿20.00")
    expect(html).toContain("Output")
    expect(html).toContain("฿3.50")
    expect(html).toContain("Input")
    expect(html).toContain("฿0.70")
    expect(html).toContain("Not a ภ.พ.30 filing")
    expect(html).toContain("ปิดงบปฏิบัติการได้สบายๆ")
    expect(html).toContain("Revenue Department")
    expect(html).toContain("does not file")
    expect(html).toContain("not a general-ledger close")
    expect(html).toContain('data-close-item="overdue_ar"')
    expect(html).toContain('data-state="review"')
    expect(html).toContain('data-state="info"')
  })

  it("says the month is closed when the lock already covers a quiet list", () => {
    const result = monthEndCloseChecklist({ ...input, lockDate: "2026-01-31", invoices: [], bills: [], bankLines: [], claims: [], tax: { legalName: "ร้าน", address: "กรุงเทพ", taxId: "1234567890123", branchLabel: "สำนักงานใหญ่", taxStatus: "registered" } })
    if (!result.ok) throw new Error(result.error)
    const html = renderToStaticMarkup(createElement(MonthEndCloseSection, { checklist: result.checklist }))
    expect(html).toContain("Closed")
    expect(html).toContain("งวด 2026-01 ล็อกแล้ว")
    expect(html).not.toContain("Ready to close")
  })

  it("keeps open items visible after the month is locked", () => {
    const result = monthEndCloseChecklist({ ...input, lockDate: "2026-01-31" })
    if (!result.ok) throw new Error(result.error)
    const html = renderToStaticMarkup(createElement(MonthEndCloseSection, { checklist: result.checklist }))
    expect(html).toContain("still open")
    expect(html).toContain("The lock does not clear them")
  })
})