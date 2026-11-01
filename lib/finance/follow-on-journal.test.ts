import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { FOLLOW_ON_JOURNAL_LIMIT_EN, FOLLOW_ON_JOURNAL_LIMIT_TH, cashReceiptJournal, creditNoteJournal, type CashReceiptJournalInput, type CreditNoteJournalInput } from "@/lib/finance/follow-on-journal"

const accounts = ["1110", "1120", "1130", "2130", "4100"]

function credit(overrides: Partial<CreditNoteJournalInput> = {}): CreditNoteJournalInput {
  return {
    snapshot: {
      kind: "credit_note",
      document: {
        number: "CN-2026-000001",
        issueDate: "2026-01-20",
        pricesIncludeVat: false,
        baseSatang: 10000,
        vatSatang: 700,
        totalSatang: 10700,
        whtSatang: 0,
        whtRateBps: 0,
        amountDueSatang: 10700,
        vatByRate: [{ rateBps: 700, baseSatang: 10000, vatSatang: 700 }],
      },
    },
    rowAmountSatang: 10700,
    rowNumber: "CN-2026-000001",
    rowIssueDate: "2026-01-20",
    invoicePosted: true,
    invoicePricesIncludeVat: false,
    invoiceBaseSatang: 100000,
    invoiceVatSatang: 7000,
    invoiceTotalSatang: 107000,
    postedCreditBaseSatang: 0,
    postedCreditVatSatang: 0,
    postedCreditTotalSatang: 0,
    postedReceiptSatang: 0,
    lockDate: "2026-01-31",
    accounts,
    ...overrides,
  }
}

function receipt(overrides: Partial<CashReceiptJournalInput> = {}): CashReceiptJournalInput {
  return {
    verificationState: "verified",
    method: "cash",
    reversal: false,
    refund: false,
    amountSatang: 5000,
    paidOn: "2026-01-21",
    reference: "เงินสดหน้าร้าน",
    allocations: [{ invoiceId: "inv", amountSatang: 5000 }],
    invoices: [{ invoiceId: "inv", posted: true, whtSatang: 0, totalSatang: 107000, postedCreditSatang: 10700, postedReceiptSatang: 0 }],
    lockDate: "2026-01-31",
    accounts,
    ...overrides,
  }
}

describe("credit note and cash receipt journals", () => {
  it("reverses a credit note against sales, output VAT, and the receivable", () => {
    const result = creditNoteJournal(credit())
    expect(result).toEqual({
      ok: true,
      entryDate: "2026-01-20",
      memo: "Issued credit note CN-2026-000001",
      debitSatang: 10700,
      vatTreatment: "vat_exclusive",
      lines: [
        { accountCode: "4100", debitSatang: 10000, creditSatang: 0 },
        { accountCode: "2130", debitSatang: 700, creditSatang: 0 },
        { accountCode: "1130", debitSatang: 0, creditSatang: 10700 },
      ],
    })
  })

  it("posts a fully allocated cash receipt against the receivable still open", () => {
    const result = cashReceiptJournal(receipt())
    expect(result).toEqual({
      ok: true,
      entryDate: "2026-01-21",
      memo: "Cash receipt 2026-01-21 เงินสดหน้าร้าน",
      debitSatang: 5000,
      vatTreatment: "cash",
      lines: [
        { accountCode: "1110", debitSatang: 5000, creditSatang: 0 },
        { accountCode: "1130", debitSatang: 0, creditSatang: 5000 },
      ],
    })
  })

  it("refuses an unposted invoice, withholding, a bank receipt, and a credit larger than the open receivable", () => {
    expect(creditNoteJournal(credit({ invoicePosted: false }))).toEqual({ ok: false, error: "Post the sales invoice before this credit note." })
    expect(creditNoteJournal(credit({ snapshot: { kind: "credit_note", document: { ...(credit().snapshot as { document: object }).document, whtSatang: 300, whtRateBps: 300, amountDueSatang: 10400 } }, rowAmountSatang: 10400 }))).toEqual({ ok: false, error: "Withholding is not posted from the credit note." })
    expect(creditNoteJournal(credit({ postedReceiptSatang: 100000 }))).toEqual({ ok: false, error: "This credit is larger than the receivable still posted." })
    const transfer = cashReceiptJournal(receipt({ method: "transfer" }))
    expect(transfer.ok && transfer.vatTreatment).toBe("bank")
    for (const method of ["transfer", "promptpay", "card", "cheque"]) {
      const posted = cashReceiptJournal(receipt({ method, reference: "" }))
      expect(posted.ok && posted.lines[0]).toEqual({ accountCode: "1120", debitSatang: 5000, creditSatang: 0 })
      expect(posted.ok && posted.memo).toBe("Bank receipt 2026-01-21")
    }
    expect(cashReceiptJournal(receipt({ method: "other" }))).toEqual({ ok: false, error: "This receipt method is not posted." })
    expect(cashReceiptJournal(receipt({ invoices: [{ invoiceId: "inv", posted: false, whtSatang: 0, totalSatang: 107000, postedCreditSatang: 0, postedReceiptSatang: 0 }] }))).toEqual({ ok: false, error: "Post the sales invoice before this receipt." })
    expect(cashReceiptJournal(receipt({ allocations: [{ invoiceId: "inv", amountSatang: 4000 }] }))).toEqual({ ok: false, error: "This receipt is not fully allocated to posted invoices." })
    expect(cashReceiptJournal(receipt({ amountSatang: 100000, allocations: [{ invoiceId: "inv", amountSatang: 100000 }] }))).toEqual({ ok: false, error: "This receipt is larger than the receivable still posted." })
  })

  it("does not call either post signed statutory books or a filing", () => {
    const copy = `${FOLLOW_ON_JOURNAL_LIMIT_TH} ${FOLLOW_ON_JOURNAL_LIMIT_EN}`
    expect(copy).toContain("ไม่ใช่การยื่นแบบ ภ.พ.30")
    expect(copy).toContain("not signed statutory books")
    expect(copy).not.toMatch(/ยื่นแบบสำเร็จ|e-Tax Invoice/)
    const sql = readFileSync("supabase/migrations/20261101200000_follow_on_journal.sql", "utf8")
    for (const message of [
      "Post the sales invoice before this credit note.",
      "Withholding is not posted from the credit note.",
      "This credit is larger than the receivable still posted.",
      "This receipt is not fully allocated to posted invoices.",
      "This receipt is larger than the receivable still posted.",
      "not signed statutory books",
    ]) expect(sql).toContain(message)
    const bank = readFileSync("supabase/migrations/20261101210000_bank_receipt_journal.sql", "utf8")
    expect(bank).toContain("This receipt method is not posted.")
    expect(bank).toContain("'1120'")
    expect(bank).toContain("no card-clearing account")
  })
})
