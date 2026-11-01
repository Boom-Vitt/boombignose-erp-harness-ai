import { describe, expect, it } from "vitest"
import { cashTruth } from "@/lib/finance/cash-truth"

const asOf = "2026-10-31"

describe("cashTruth", () => {
  it("compares the saved cash figure with verified receipts minus paid costs through the date", () => {
    const result = cashTruth({
      asOf,
      recordedBalanceSatang: 1_000_000,
      receipts: [
        { id: "in", paidOn: "2026-10-10", amountSatang: 800_000, verified: true },
        { id: "late", paidOn: "2026-11-01", amountSatang: 50_000, verified: true },
        { id: "pending", paidOn: "2026-10-11", amountSatang: 20_000, verified: false },
        { id: "reversal", paidOn: "2026-10-12", amountSatang: -100_000, verified: true },
      ],
      costs: [
        { paidOn: "2026-10-20", amountSatang: 200_000 },
        { paidOn: "2026-11-01", amountSatang: 10_000 },
        { paidOn: null, amountSatang: 90_000 },
      ],
      statementLines: [
        { bookedOn: "2026-10-10", amountSatang: 800_000, matchedPaymentId: "in", closeNote: null },
        { bookedOn: "2026-10-18", amountSatang: -30_000, matchedPaymentId: null, closeNote: null },
        { bookedOn: "2026-10-19", amountSatang: -5_000, matchedPaymentId: null, closeNote: "bank fee" },
        { bookedOn: "2026-11-02", amountSatang: 40_000, matchedPaymentId: null, closeNote: null },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.truth.verifiedReceiptsSatang).toBe(700_000)
    expect(result.truth.paidCostsSatang).toBe(200_000)
    expect(result.truth.cashInSystemSatang).toBe(500_000)
    expect(result.truth.differenceSatang).toBe(500_000)
    expect(result.truth.statementNetSatang).toBe(765_000)
    expect(result.truth.matchedStatementSatang).toBe(800_000)
    expect(result.truth.openStatementCount).toBe(1)
    expect(result.truth.openStatementSatang).toBe(-30_000)
    expect(result.truth.explainedStatementCount).toBe(1)
    expect(result.truth.explainedStatementSatang).toBe(-5_000)
    expect(result.truth.receiptsWithoutStatementCount).toBe(1)
    expect(result.truth.receiptsWithoutStatementSatang).toBe(-100_000)
  })

  it("treats a receipt matched only by a later statement line as still off the statement", () => {
    const result = cashTruth({
      asOf,
      recordedBalanceSatang: 0,
      receipts: [{ id: "in", paidOn: "2026-10-10", amountSatang: 100, verified: true }],
      costs: [],
      statementLines: [{ bookedOn: "2026-11-03", amountSatang: 100, matchedPaymentId: "in", closeNote: null }],
    })
    expect(result.ok && result.truth.receiptsWithoutStatementCount).toBe(1)
    expect(result.ok && result.truth.statementNetSatang).toBe(0)
  })

  it("refuses a close date that is not a calendar date", () => {
    expect(cashTruth({ asOf: "2026-02-31", recordedBalanceSatang: 0, receipts: [], costs: [], statementLines: [] })).toEqual({
      ok: false,
      error: "Enter the close date as YYYY-MM-DD.",
    })
  })
})
