import { describe, expect, it } from "vitest"
import { aging, balanceSupport, monthBounds, profitAndLoss, vatSupport, type StatementCost, type StatementInvoice } from "./statements"

const invoice: StatementInvoice = {
  issueDate: "2026-10-15",
  dueDate: "2026-09-01",
  status: "sent",
  netSatang: 100_000,
  vatSatang: 7_000,
  outstandingSatang: 107_000,
}

const cost: StatementCost = {
  incurredOn: "2026-10-02",
  dueDate: "2026-08-01",
  paidAt: null,
  netSatang: 18_600,
  inputVatSatang: 1_400,
  payableSatang: 20_000,
}

describe("support statements", () => {
  it("builds an operational profit figure without treating VAT as income", () => {
    const result = profitAndLoss({ from: "2026-10-01", to: "2026-10-31", invoices: [invoice, { ...invoice, status: "draft", issueDate: "2026-10-20" }], costs: [cost], cogsSatang: 5_000 })
    expect(result).toMatchObject({ revenueSatang: 100_000, outputVatSatang: 7_000, expenseSatang: 18_600, cogsSatang: 5_000, profitSatang: 76_400 })
  })

  it("reports ภ.พ.30 support figures and does not balance a ledger", () => {
    expect(vatSupport({ from: "2026-10-01", to: "2026-10-31", invoices: [invoice], costs: [cost] })).toEqual({
      outputVatSatang: 7_000,
      inputVatSatang: 1_400,
      netVatSatang: 5_600,
    })
    expect(balanceSupport({ asOf: "2026-10-31", cashSatang: 50_000, invoices: [invoice], costs: [cost] })).toEqual({
      cashSatang: 50_000,
      receivablesSatang: 107_000,
      payablesSatang: 20_000,
      balances: false,
    })
  })

  it("ages receivables and payables from the due date", () => {
    expect(aging("2026-10-31", [
      { dueDate: "2026-11-15", amountSatang: 1 },
      { dueDate: "2026-10-20", amountSatang: 2 },
      { dueDate: "2026-09-15", amountSatang: 3 },
      { dueDate: "2026-08-15", amountSatang: 4 },
      { dueDate: "2026-07-01", amountSatang: 5 },
      { dueDate: null, amountSatang: 6 },
    ])).toEqual({ current: 7, days1to30: 2, days31to60: 3, days61to90: 4, days91plus: 5 })
    expect(monthBounds("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" })
    expect(monthBounds("2026-13")).toBeNull()
  })
})
