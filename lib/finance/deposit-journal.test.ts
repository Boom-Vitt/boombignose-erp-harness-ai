import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { DEPOSIT_JOURNAL_LIMIT_EN, DEPOSIT_JOURNAL_LIMIT_TH, depositInvoiceJournal, finalInvoiceWithDepositJournal, type DepositInvoiceInput, type FinalDepositInput } from "@/lib/finance/deposit-journal"

const accounts = ["1130", "2120", "2130", "4100"]

function deposit(overrides: Partial<DepositInvoiceInput> = {}): DepositInvoiceInput {
  return {
    status: "sent",
    snapshotKind: "operational_invoice",
    quoteInvoiceKind: "deposit",
    quoteDepositSatang: 2500,
    quoteDepositDeductionSatang: 0,
    sourceQuoteId: "quote",
    issueDate: "2026-01-15",
    snapshotIssueDate: "2026-01-15",
    number: "INV-2026-000001",
    snapshotNumber: "INV-2026-000001",
    pricesIncludeVat: false,
    subtotalSatang: 2500,
    discountSatang: 0,
    vatSatang: 175,
    totalSatang: 2675,
    whtSatang: 0,
    whtRateBps: 0,
    amountDueSatang: 2675,
    vatByRate: [{ rateBps: 700, baseSatang: 2500, vatSatang: 175 }],
    snapshotAgrees: true,
    lockDate: "2026-01-31",
    accounts,
    ...overrides,
  }
}

function finalInvoice(overrides: Partial<FinalDepositInput> = {}): FinalDepositInput {
  return {
    ...deposit(),
    quoteInvoiceKind: "lines",
    quoteDepositSatang: 0,
    quoteDepositDeductionSatang: 2500,
    quoteDiscountSatang: 0,
    number: "INV-2026-000002",
    snapshotNumber: "INV-2026-000002",
    issueDate: "2026-01-20",
    snapshotIssueDate: "2026-01-20",
    subtotalSatang: 10000,
    discountSatang: 2500,
    vatSatang: 525,
    totalSatang: 8025,
    amountDueSatang: 8025,
    vatByRate: [{ rateBps: 700, baseSatang: 7500, vatSatang: 525 }],
    postedDepositBaseSatang: 2500,
    unpostedDeposit: false,
    depositHasCreditNote: false,
    ...overrides,
  }
}

describe("customer deposit journal", () => {
  it("holds the deposit base as a liability and recognizes only the stored VAT", () => {
    expect(depositInvoiceJournal(deposit())).toEqual({
      ok: true,
      entryDate: "2026-01-15",
      memo: "Issued deposit invoice INV-2026-000001",
      debitSatang: 2675,
      vatTreatment: "vat_exclusive",
      lines: [
        { accountCode: "1130", debitSatang: 2675, creditSatang: 0 },
        { accountCode: "2130", debitSatang: 0, creditSatang: 175 },
        { accountCode: "2120", debitSatang: 0, creditSatang: 2500 },
      ],
    })
  })

  it("applies the whole posted deposit to sales on the final invoice", () => {
    const result = finalInvoiceWithDepositJournal(finalInvoice())
    expect(result.ok && result.lines).toEqual([
      { accountCode: "1130", debitSatang: 8025, creditSatang: 0 },
      { accountCode: "2130", debitSatang: 0, creditSatang: 525 },
      { accountCode: "4100", debitSatang: 0, creditSatang: 10000 },
      { accountCode: "2120", debitSatang: 2500, creditSatang: 0 },
    ])
    expect(result.ok && result.debitSatang).toBe(10525)
  })

  it("refuses a partial deposit, a missing post, a credit note, and a deduction that is not in the discount", () => {
    expect(finalInvoiceWithDepositJournal(finalInvoice({ postedDepositBaseSatang: 2000 }))).toEqual({ ok: false, error: "This final invoice does not apply the whole posted deposit." })
    expect(finalInvoiceWithDepositJournal(finalInvoice({ unpostedDeposit: true }))).toEqual({ ok: false, error: "Post the deposit invoice before this final invoice." })
    expect(finalInvoiceWithDepositJournal(finalInvoice({ depositHasCreditNote: true }))).toEqual({ ok: false, error: "A credit note on a deposit invoice is not applied." })
    expect(finalInvoiceWithDepositJournal(finalInvoice({ quoteDiscountSatang: 100, discountSatang: 2500 }))).toEqual({ ok: false, error: "This deposit deduction is not in the invoice discount." })
    expect(depositInvoiceJournal(deposit({ quoteDepositSatang: 2000 }))).toEqual({ ok: false, error: "The deposit base does not match the stored sale." })
  })

  it("does not call the deposit signed statutory books or a filing", () => {
    const copy = `${DEPOSIT_JOURNAL_LIMIT_TH} ${DEPOSIT_JOURNAL_LIMIT_EN}`
    expect(copy).toContain("ไม่ใช่การยื่นแบบ ภ.พ.30")
    expect(copy).toContain("not signed statutory books")
    expect(copy).not.toMatch(/ยื่นแบบสำเร็จ|e-Tax Invoice/)
    const sql = readFileSync("supabase/migrations/20261101220000_customer_deposit_account.sql", "utf8")
    expect(sql).toContain("'2120','เงินรับล่วงหน้า','Customer deposits','liability'")
    expect(sql).toContain("Post the deposit invoice before this final invoice.")
    expect(sql).toContain("This final invoice does not apply the whole posted deposit.")
    expect(sql).toContain("This deposit deduction is not in the invoice discount.")
    expect(sql).not.toMatch(/delete\s+from\s+public\.gl_accounts/i)
  })
})
