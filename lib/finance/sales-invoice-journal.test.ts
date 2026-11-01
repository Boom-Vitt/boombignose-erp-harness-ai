import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { SALES_INVOICE_JOURNAL_LIMIT_EN, SALES_INVOICE_JOURNAL_LIMIT_TH, salesInvoiceJournal, salesSnapshotAgrees, type SalesInvoicePost, type StoredSalesInvoice } from "@/lib/finance/sales-invoice-journal"

const accounts = ["1110", "1130", "2130", "4100"]

function post(overrides: Partial<SalesInvoicePost> = {}): SalesInvoicePost {
  return {
    status: "sent",
    snapshotKind: "operational_invoice",
    quoteInvoiceKind: "lines",
    quoteDepositSatang: 0,
    quoteDepositDeductionSatang: 0,
    hasCreditNote: false,
    issueDate: "2026-01-15",
    snapshotIssueDate: "2026-01-15",
    number: "INV-2026-000001",
    snapshotNumber: "INV-2026-000001",
    pricesIncludeVat: false,
    subtotalSatang: 100000,
    discountSatang: 0,
    vatSatang: 7000,
    totalSatang: 107000,
    whtSatang: 0,
    whtRateBps: 0,
    amountDueSatang: 107000,
    vatByRate: [{ rateBps: 700, baseSatang: 100000, vatSatang: 7000 }],
    snapshotAgrees: true,
    lockDate: "2026-01-31",
    accounts,
    ...overrides,
  }
}

describe("issued sales invoice journal", () => {
  it("posts VAT exclusive as receivable, sales, and output VAT", () => {
    const result = salesInvoiceJournal(post())
    expect(result).toEqual({
      ok: true,
      entryDate: "2026-01-15",
      memo: "Issued sales invoice INV-2026-000001",
      debitSatang: 107000,
      vatTreatment: "vat_exclusive",
      lines: [
        { accountCode: "1130", debitSatang: 107000, creditSatang: 0 },
        { accountCode: "2130", debitSatang: 0, creditSatang: 7000 },
        { accountCode: "4100", debitSatang: 0, creditSatang: 100000 },
      ],
    })
  })

  it("posts VAT inclusive from the stored split and posts no VAT line when the rate is zero", () => {
    const inclusive = salesInvoiceJournal(post({
      pricesIncludeVat: true,
      subtotalSatang: 107000,
      vatByRate: [{ rateBps: 700, baseSatang: 100000, vatSatang: 7000 }],
    }))
    expect(inclusive.ok && inclusive.vatTreatment).toBe("vat_inclusive")
    expect(inclusive.ok && inclusive.lines).toEqual([
      { accountCode: "1130", debitSatang: 107000, creditSatang: 0 },
      { accountCode: "2130", debitSatang: 0, creditSatang: 7000 },
      { accountCode: "4100", debitSatang: 0, creditSatang: 100000 },
    ])
    const none = salesInvoiceJournal(post({
      pricesIncludeVat: false,
      subtotalSatang: 5000,
      vatSatang: 0,
      totalSatang: 5000,
      amountDueSatang: 5000,
      vatByRate: [{ rateBps: 0, baseSatang: 5000, vatSatang: 0 }],
    }))
    expect(none.ok && none.vatTreatment).toBe("no_vat")
    expect(none.ok && none.lines).toEqual([
      { accountCode: "1130", debitSatang: 5000, creditSatang: 0 },
      { accountCode: "4100", debitSatang: 0, creditSatang: 5000 },
    ])
  })

  it("refuses withholding, a deposit, a credit note, a legacy adoption, and a rate that does not match", () => {
    expect(salesInvoiceJournal(post({ whtSatang: 3000, whtRateBps: 300, amountDueSatang: 104000 }))).toEqual({ ok: false, error: "Withholding is not posted from the invoice." })
    expect(salesInvoiceJournal(post({ quoteInvoiceKind: "deposit", quoteDepositSatang: 1000 }))).toEqual({ ok: false, error: "A deposit invoice is not posted." })
    expect(salesInvoiceJournal(post({ hasCreditNote: true }))).toEqual({ ok: false, error: "A credit note already changes this invoice. Credit notes are not posted yet." })
    expect(salesInvoiceJournal(post({ snapshotKind: "legacy_operational_invoice" }))).toEqual({ ok: false, error: "Only an issued operational sales invoice can post." })
    expect(salesInvoiceJournal(post({ status: "draft" }))).toEqual({ ok: false, error: "Only an issued operational sales invoice can post." })
    expect(salesInvoiceJournal(post({ vatByRate: [{ rateBps: 700, baseSatang: 100000, vatSatang: 6999 }] }))).toEqual({ ok: false, error: "The stored VAT does not match the stated rate." })
    expect(salesInvoiceJournal(post({ lockDate: null }))).toEqual({ ok: false, error: "Post a journal only into a closed period." })
    expect(salesInvoiceJournal(post({ accounts: ["1130", "4100"] }))).toEqual({ ok: false, error: "Journal line account is not on the chart." })
    expect(salesInvoiceJournal(post({ snapshotAgrees: false }))).toEqual({ ok: false, error: "The issued snapshot does not match the invoice." })
  })

  it("accepts a snapshot only when the frozen tax figures are the same", () => {
    const invoice: StoredSalesInvoice = {
      status: "paid",
      quoteInvoiceKind: "lines",
      quoteDepositSatang: 0,
      quoteDepositDeductionSatang: 0,
      issueDate: "2026-01-15",
      number: "INV-2026-000001",
      pricesIncludeVat: false,
      subtotalSatang: 100000,
      discountSatang: 0,
      vatSatang: 7000,
      totalSatang: 107000,
      whtSatang: 0,
      whtRateBps: 0,
      amountDueSatang: 107000,
      vatByRate: [{ rateBps: 700, baseSatang: 100000, vatSatang: 7000 }],
    }
    const snapshot = { kind: "operational_invoice", document: { ...invoice, vatByRate: invoice.vatByRate } }
    expect(salesSnapshotAgrees(snapshot, invoice)).toBe(true)
    expect(salesSnapshotAgrees({ ...snapshot, document: { ...snapshot.document, vatSatang: 1 } }, invoice)).toBe(false)
    const copy = `${SALES_INVOICE_JOURNAL_LIMIT_TH} ${SALES_INVOICE_JOURNAL_LIMIT_EN}`
    expect(copy).toContain("ไม่ใช่การยื่นแบบ ภ.พ.30")
    expect(copy).toContain("not signed statutory books")
    expect(copy).not.toMatch(/ยื่นแบบสำเร็จ|e-Tax Invoice/)
    const sql = readFileSync("supabase/migrations/20261101190000_sales_invoice_journal.sql", "utf8")
    for (const message of [
      "Only an issued operational sales invoice can post.",
      "A deposit invoice is not posted.",
      "A credit note already changes this invoice. Credit notes are not posted yet.",
      "Withholding is not posted from the invoice.",
      "The issued snapshot does not match the invoice.",
      "The stored VAT does not match the stated rate.",
      "The stored totals do not match the VAT treatment.",
      "This invoice is already posted.",
      "not signed statutory books",
    ]) expect(sql).toContain(message)
  })
})
