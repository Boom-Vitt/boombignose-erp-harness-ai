import { describe, expect, it } from "vitest"

import { openItemCounts } from "@/lib/finance/close-summary"
import { closeSummaryPrompt } from "@/lib/ai/prompts"

const today = "2026-11-01"

describe("openItemCounts", () => {
  it("counts overdue receivables after credits, unpaid vendor bills, and unmatched bank lines", () => {
    const counts = openItemCounts({
      today,
      invoices: [
        { status: "sent", amount_satang: 10_000, due_date: "2026-10-01", paid_satang: 2_000, credited_satang: 1_000 },
        { status: "sent", amount_satang: 5_000, due_date: "2026-10-01", paid_satang: 5_000, credited_satang: 0 },
        { status: "draft", amount_satang: 9_000, due_date: "2026-01-01", paid_satang: 0, credited_satang: 0 },
        { status: "sent", amount_satang: 4_000, due_date: "2026-12-01", paid_satang: 0, credited_satang: 0 },
      ],
      bills: [
        { vendor_id: "vendor", paid_at: null, amount_satang: 4_000 },
        { vendor_id: "vendor", paid_at: "2026-10-02T00:00:00Z", amount_satang: 8_000 },
        { vendor_id: null, paid_at: null, amount_satang: 3_000 },
        { vendor_id: "vendor", paid_at: null, amount_satang: -500 },
      ],
      bankLines: [
        { matched_payment_id: null },
        { matched_payment_id: "receipt" },
      ],
    })
    expect(counts).toEqual({
      asOf: today,
      overdueReceivableCount: 1,
      overdueReceivableSatang: 7_000,
      unpaidBillCount: 1,
      unpaidBillSatang: 4_000,
      unmatchedBankCount: 1,
    })
  })

  it("leaves bank lines unknown when they were not read", () => {
    const counts = openItemCounts({ today, invoices: [], bills: [], bankLines: null })
    expect(counts.unmatchedBankCount).toBeNull()
    const { prompt, system } = closeSummaryPrompt(counts)
    expect(prompt).toContain("Unmatched bank lines: not available")
    expect(prompt).toContain("Overdue receivables: 0")
    expect(system).toMatch(/not a statutory close/)
    expect(prompt).toMatch(/do not tell them to file a tax return/i)
  })
})
