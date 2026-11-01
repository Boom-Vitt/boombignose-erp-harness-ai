import { draftJournalLines, type DraftJournalLine } from "@/lib/finance/draft-journal"
import { SALES_JOURNAL_ACCOUNTS, salesInvoiceJournal, type SalesInvoiceJournal, type SalesInvoicePost } from "@/lib/finance/sales-invoice-journal"

/**
 * A deposit invoice credits a customer-deposit liability, not sales.
 * The final invoice applies that liability only when the deduction in its
 * discount equals the whole posted deposit base. A partial or mixed-rate
 * netting is refused.
 * This is not signed statutory books and not a ภ.พ.30 or e-Tax filing.
 */

export const DEPOSIT_ACCOUNT = "2120"

export const DEPOSIT_JOURNAL_LIMIT_TH =
  "เงินมัดจำเป็นหนี้สินเงินรับล่วงหน้า ไม่ใช่รายได้ จนกว่าใบแจ้งหนี้สุดท้ายจะหักยอดมัดจำที่บันทึกไว้ทั้งก้อน ไม่ใช่งบที่ลงนามตามกฎหมาย และไม่ใช่การยื่นแบบ ภ.พ.30 หรือ e-Tax"

export const DEPOSIT_JOURNAL_LIMIT_EN =
  "A deposit is a customer-deposit liability, not sales, until the final invoice applies the whole posted deposit. It is not signed statutory books and not a ภ.พ.30 or e-Tax filing."

export type DepositInvoiceInput = SalesInvoicePost & { sourceQuoteId: string | null }

export type FinalDepositInput = SalesInvoicePost & {
  sourceQuoteId: string | null
  quoteDiscountSatang: number
  postedDepositBaseSatang: number
  unpostedDeposit: boolean
  depositHasCreditNote: boolean
}

function withSalesAccount(accounts: readonly string[]): string[] {
  return accounts.includes(SALES_JOURNAL_ACCOUNTS.sales) ? [...accounts] : [...accounts, SALES_JOURNAL_ACCOUNTS.sales]
}

/** Dr receivable, Cr customer deposits for the base, Cr output VAT when the stored split has VAT. */
export function depositInvoiceJournal(input: DepositInvoiceInput): SalesInvoiceJournal {
  if (input.quoteInvoiceKind !== "deposit" || input.quoteDepositSatang <= 0 || input.quoteDepositDeductionSatang !== 0 || !input.sourceQuoteId) {
    return { ok: false, error: "A deposit invoice is not posted." }
  }
  const checked = salesInvoiceJournal({
    ...input,
    quoteInvoiceKind: "lines",
    quoteDepositSatang: 0,
    quoteDepositDeductionSatang: 0,
    accounts: withSalesAccount(input.accounts),
  })
  if (!checked.ok) return checked
  const held = checked.lines.find(line => line.accountCode === SALES_JOURNAL_ACCOUNTS.sales && line.creditSatang > 0)
  if (!held || held.creditSatang !== input.quoteDepositSatang) return { ok: false, error: "The deposit base does not match the stored sale." }
  if (!input.accounts.includes(DEPOSIT_ACCOUNT)) return { ok: false, error: "Journal line account is not on the chart." }
  const lines = checked.lines.map(line => line.accountCode === SALES_JOURNAL_ACCOUNTS.sales ? { ...line, accountCode: DEPOSIT_ACCOUNT } : line)
  const memo = `Issued deposit invoice ${input.number}`
  if (memo.length > 200) return { ok: false, error: "Enter a journal memo." }
  return { ...checked, memo, lines }
}

/**
 * Post the remainder as a sale, then move the whole posted deposit into sales.
 * The deduction must already sit inside the invoice discount, and it must equal
 * the posted deposit base. Anything else is refused.
 */
export function finalInvoiceWithDepositJournal(input: FinalDepositInput): SalesInvoiceJournal {
  if (input.quoteInvoiceKind !== "lines" || input.quoteDepositDeductionSatang <= 0 || input.quoteDepositSatang !== 0 || !input.sourceQuoteId) {
    return { ok: false, error: "This final invoice does not apply the whole posted deposit." }
  }
  if (input.depositHasCreditNote) return { ok: false, error: "A credit note on a deposit invoice is not applied." }
  if (input.unpostedDeposit) return { ok: false, error: "Post the deposit invoice before this final invoice." }
  if (input.discountSatang !== input.quoteDiscountSatang + input.quoteDepositDeductionSatang) {
    return { ok: false, error: "This deposit deduction is not in the invoice discount." }
  }
  if (input.postedDepositBaseSatang !== input.quoteDepositDeductionSatang) {
    return { ok: false, error: "This final invoice does not apply the whole posted deposit." }
  }
  const remainder = salesInvoiceJournal({ ...input, quoteDepositSatang: 0, quoteDepositDeductionSatang: 0 })
  if (!remainder.ok) return remainder
  if (!input.accounts.includes(DEPOSIT_ACCOUNT)) return { ok: false, error: "Journal line account is not on the chart." }
  const deduction = input.quoteDepositDeductionSatang
  const lines: DraftJournalLine[] = remainder.lines.map(line => line.accountCode === SALES_JOURNAL_ACCOUNTS.sales && line.creditSatang > 0
    ? { ...line, creditSatang: line.creditSatang + deduction }
    : line)
  if (!lines.some(line => line.accountCode === SALES_JOURNAL_ACCOUNTS.sales && line.creditSatang > 0)) {
    lines.push({ accountCode: SALES_JOURNAL_ACCOUNTS.sales, debitSatang: 0, creditSatang: deduction })
  }
  lines.push({ accountCode: DEPOSIT_ACCOUNT, debitSatang: deduction, creditSatang: 0 })
  const checked = draftJournalLines(lines, input.accounts)
  if (!checked.ok) return checked
  const memo = `Issued sales invoice ${input.number} applying posted deposit`
  if (memo.length > 200) return { ok: false, error: "Enter a journal memo." }
  return { ok: true, entryDate: remainder.entryDate, memo, lines, debitSatang: checked.debitSatang, vatTreatment: remainder.vatTreatment }
}
