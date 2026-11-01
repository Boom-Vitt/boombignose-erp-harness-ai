import { isCalendarDate } from "@/lib/finance/close-window"
import { sumSatang } from "@/lib/money"
import { draftJournalLines, journalDateInClosedPeriod, type DraftJournalLine } from "@/lib/finance/draft-journal"
import { SALES_JOURNAL_ACCOUNTS, type SalesVatBucket, type SalesVatTreatment } from "@/lib/finance/sales-invoice-journal"

/**
 * A credit note reverses part of a sales invoice already in the draft journal.
 * A verified receipt clears part of that receivable.
 *
 * Cash posts to cash. A transfer, PromptPay, card, or cheque posts to the bank
 * account. This chart has no card-clearing account and no undeposited-cheque
 * account. Withholding, an unallocated remainder, method "other", and a
 * deposit invoice are refused. A deposit is not a receipt: the chart has no
 * customer-deposit account, and the final invoice already folds that amount
 * into its discount.
 * This is not signed statutory books and not a ภ.พ.30 or e-Tax filing.
 */

export const FOLLOW_ON_JOURNAL_LIMIT_TH =
  "รายการนี้ลงบันทึกรายวันฉบับร่างจากใบลดหนี้หรือใบเสร็จ ไม่ใช่งบที่ลงนามตามกฎหมาย และไม่ใช่การยื่นแบบ ภ.พ.30 หรือ e-Tax"

export const FOLLOW_ON_JOURNAL_LIMIT_EN =
  "This posts a credit note or a verified receipt into the draft journal. A transfer, PromptPay, card, or cheque is posted to the bank account. This chart has no card-clearing account and no undeposited-cheque account. It is not signed statutory books and not a ภ.พ.30 or e-Tax filing."

export const CASH_ACCOUNT = "1110"
export const BANK_ACCOUNT = "1120"
export const BANK_RECEIPT_METHODS = ["transfer", "promptpay", "card", "cheque"] as const

const MAX_SATANG = 9007199254740991

export type FollowOnJournal =
  | { ok: true; entryDate: string; memo: string; lines: DraftJournalLine[]; debitSatang: number; vatTreatment: SalesVatTreatment | "cash" | "bank" }
  | { ok: false; error: string }

function halfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * BigInt(2) + denominator) / (denominator * BigInt(2))
}

function safeMoney(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_SATANG
}

function buckets(value: unknown): SalesVatBucket[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const rows: SalesVatBucket[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") return null
    const row = item as { rateBps?: unknown; baseSatang?: unknown; vatSatang?: unknown }
    if (typeof row.rateBps !== "number" || typeof row.baseSatang !== "number" || typeof row.vatSatang !== "number") return null
    if (!Number.isSafeInteger(row.rateBps) || !Number.isSafeInteger(row.baseSatang) || !Number.isSafeInteger(row.vatSatang)) return null
    rows.push({ rateBps: row.rateBps, baseSatang: row.baseSatang, vatSatang: row.vatSatang })
  }
  return rows
}

function bucketVatAgrees(bucket: SalesVatBucket, pricesIncludeVat: boolean): boolean {
  if (!Number.isInteger(bucket.rateBps) || bucket.rateBps < 0 || bucket.rateBps > 10000) return false
  if (!safeMoney(bucket.baseSatang) || !safeMoney(bucket.vatSatang)) return false
  const rate = BigInt(bucket.rateBps)
  const base = BigInt(bucket.baseSatang)
  const vat = BigInt(bucket.vatSatang)
  const expected = pricesIncludeVat
    ? halfUp((base + vat) * rate, BigInt(10000) + rate)
    : halfUp(base * rate, BigInt(10000))
  return expected === vat
}

export type CreditNoteJournalInput = {
  snapshot: unknown
  rowAmountSatang: number
  rowNumber: string
  rowIssueDate: string
  invoicePosted: boolean
  invoicePricesIncludeVat: boolean
  invoiceBaseSatang: number
  invoiceVatSatang: number
  invoiceTotalSatang: number
  postedCreditBaseSatang: number
  postedCreditVatSatang: number
  postedCreditTotalSatang: number
  postedReceiptSatang: number
  lockDate: string | null
  accounts: readonly string[]
}

/** Reverse stored sales and output VAT, and credit the receivable, for one issued credit note. */
export function creditNoteJournal(input: CreditNoteJournalInput): FollowOnJournal {
  if (!input.snapshot || typeof input.snapshot !== "object" || Array.isArray(input.snapshot)) {
    return { ok: false, error: "Only an issued credit note can post." }
  }
  const body = input.snapshot as { kind?: unknown; document?: unknown }
  if (body.kind !== "credit_note") return { ok: false, error: "Only an issued credit note can post." }
  if (!input.invoicePosted) return { ok: false, error: "Post the sales invoice before this credit note." }
  const document = body.document
  if (!document || typeof document !== "object") return { ok: false, error: "The issued snapshot does not match the credit note." }
  const row = document as Record<string, unknown>
  const vatByRate = buckets(row.vatByRate)
  const baseSatang = typeof row.baseSatang === "number" ? row.baseSatang : null
  const vatSatang = typeof row.vatSatang === "number" ? row.vatSatang : null
  const totalSatang = typeof row.totalSatang === "number" ? row.totalSatang : null
  const whtSatang = typeof row.whtSatang === "number" ? row.whtSatang : null
  const whtRateBps = typeof row.whtRateBps === "number" ? row.whtRateBps : null
  const amountDueSatang = typeof row.amountDueSatang === "number" ? row.amountDueSatang : null
  const pricesIncludeVat = row.pricesIncludeVat
  if (row.number !== input.rowNumber || row.issueDate !== input.rowIssueDate || amountDueSatang !== input.rowAmountSatang || typeof pricesIncludeVat !== "boolean" || !vatByRate || baseSatang === null || vatSatang === null || totalSatang === null || whtSatang === null || whtRateBps === null || amountDueSatang === null) {
    return { ok: false, error: "The issued snapshot does not match the credit note." }
  }
  if (whtSatang !== 0 || whtRateBps !== 0) return { ok: false, error: "Withholding is not posted from the credit note." }
  if (pricesIncludeVat !== input.invoicePricesIncludeVat) return { ok: false, error: "The credit note VAT treatment does not match the invoice." }
  if (!isCalendarDate(input.rowIssueDate)) return { ok: false, error: "The issued snapshot does not match the credit note." }
  const closed = journalDateInClosedPeriod(input.rowIssueDate, input.lockDate)
  if (!closed.ok) return closed
  if (!safeMoney(baseSatang) || !safeMoney(vatSatang) || !safeMoney(totalSatang) || !safeMoney(input.invoiceBaseSatang) || !safeMoney(input.invoiceVatSatang) || !safeMoney(input.invoiceTotalSatang) || !safeMoney(input.postedCreditBaseSatang) || !safeMoney(input.postedCreditVatSatang) || !safeMoney(input.postedCreditTotalSatang) || !safeMoney(input.postedReceiptSatang)) {
    return { ok: false, error: "Journal line amount must be integer satang." }
  }
  if (vatByRate.some(bucket => !bucketVatAgrees(bucket, pricesIncludeVat))) return { ok: false, error: "The stored VAT does not match the stated rate." }
  let bucketBase: number
  let bucketVat: number
  try {
    bucketBase = sumSatang(vatByRate.map(bucket => bucket.baseSatang))
    bucketVat = sumSatang(vatByRate.map(bucket => bucket.vatSatang))
  } catch {
    return { ok: false, error: "Journal line amount must be integer satang." }
  }
  if (bucketBase !== baseSatang || bucketVat !== vatSatang || baseSatang + vatSatang !== totalSatang || amountDueSatang !== totalSatang || totalSatang <= 0) {
    return { ok: false, error: "The stored totals do not match the VAT treatment." }
  }
  if (baseSatang > input.invoiceBaseSatang - input.postedCreditBaseSatang || vatSatang > input.invoiceVatSatang - input.postedCreditVatSatang || totalSatang > input.invoiceTotalSatang - input.postedCreditTotalSatang) {
    return { ok: false, error: "This credit is larger than the sale still posted." }
  }
  if (totalSatang > input.invoiceTotalSatang - input.postedCreditTotalSatang - input.postedReceiptSatang) {
    return { ok: false, error: "This credit is larger than the receivable still posted." }
  }
  const needed = [SALES_JOURNAL_ACCOUNTS.receivable, ...(baseSatang > 0 ? [SALES_JOURNAL_ACCOUNTS.sales] : []), ...(vatSatang > 0 ? [SALES_JOURNAL_ACCOUNTS.vatOutput] : [])]
  if (needed.some(code => !input.accounts.includes(code))) return { ok: false, error: "Journal line account is not on the chart." }
  const lines: DraftJournalLine[] = []
  if (baseSatang > 0) lines.push({ accountCode: SALES_JOURNAL_ACCOUNTS.sales, debitSatang: baseSatang, creditSatang: 0 })
  if (vatSatang > 0) lines.push({ accountCode: SALES_JOURNAL_ACCOUNTS.vatOutput, debitSatang: vatSatang, creditSatang: 0 })
  lines.push({ accountCode: SALES_JOURNAL_ACCOUNTS.receivable, debitSatang: 0, creditSatang: totalSatang })
  const memo = `Issued credit note ${input.rowNumber}`
  if (memo.length > 200) return { ok: false, error: "Enter a journal memo." }
  const checked = draftJournalLines(lines, input.accounts)
  if (!checked.ok) return checked
  const vatTreatment: SalesVatTreatment = vatSatang === 0 ? "no_vat" : pricesIncludeVat ? "vat_inclusive" : "vat_exclusive"
  return { ok: true, entryDate: input.rowIssueDate, memo, lines, debitSatang: checked.debitSatang, vatTreatment }
}

export type CashReceiptAllocation = { invoiceId: string; amountSatang: number }

export type CashReceiptInvoice = {
  invoiceId: string
  posted: boolean
  whtSatang: number
  totalSatang: number
  postedCreditSatang: number
  postedReceiptSatang: number
}

export type CashReceiptJournalInput = {
  verificationState: string
  method: string
  reversal: boolean
  refund: boolean
  amountSatang: number
  paidOn: string
  reference: string
  allocations: readonly CashReceiptAllocation[]
  invoices: readonly CashReceiptInvoice[]
  lockDate: string | null
  accounts: readonly string[]
}

function receiptAccount(method: string): { account: string; treatment: "cash" | "bank"; label: "Cash" | "Bank" } | null {
  if (method === "cash") return { account: CASH_ACCOUNT, treatment: "cash", label: "Cash" }
  if ((BANK_RECEIPT_METHODS as readonly string[]).includes(method)) return { account: BANK_ACCOUNT, treatment: "bank", label: "Bank" }
  return null
}

/** Debit cash or bank and credit accounts receivable. The receipt must be verified and fully allocated. */
export function cashReceiptJournal(input: CashReceiptJournalInput): FollowOnJournal {
  if (input.verificationState !== "verified" || input.reversal || input.refund || !safeMoney(input.amountSatang) || input.amountSatang <= 0) {
    return { ok: false, error: "Only a verified receipt can post." }
  }
  const account = receiptAccount(input.method)
  if (!account) return { ok: false, error: "This receipt method is not posted." }
  const closed = journalDateInClosedPeriod(input.paidOn, input.lockDate)
  if (!closed.ok) return closed
  if (input.allocations.length === 0 || input.allocations.some(row => !row.invoiceId || !safeMoney(row.amountSatang) || row.amountSatang <= 0)) {
    return { ok: false, error: "This receipt is not fully allocated to posted invoices." }
  }
  let allocated: number
  try {
    allocated = sumSatang(input.allocations.map(row => row.amountSatang))
  } catch {
    return { ok: false, error: "Journal line amount must be integer satang." }
  }
  if (allocated !== input.amountSatang) return { ok: false, error: "This receipt is not fully allocated to posted invoices." }
  const byInvoice = new Map<string, number[]>()
  for (const row of input.allocations) {
    const amounts = byInvoice.get(row.invoiceId) ?? []
    amounts.push(row.amountSatang)
    byInvoice.set(row.invoiceId, amounts)
  }
  const known = new Map(input.invoices.map(invoice => [invoice.invoiceId, invoice]))
  for (const [invoiceId, amounts] of byInvoice) {
    const invoice = known.get(invoiceId)
    if (!invoice || !invoice.posted) return { ok: false, error: "Post the sales invoice before this receipt." }
    if (invoice.whtSatang !== 0) return { ok: false, error: "Withholding is not posted from the receipt." }
    if (!safeMoney(invoice.totalSatang) || !safeMoney(invoice.postedCreditSatang) || !safeMoney(invoice.postedReceiptSatang)) {
      return { ok: false, error: "Journal line amount must be integer satang." }
    }
    let slice: number
    try { slice = sumSatang(amounts) } catch { return { ok: false, error: "Journal line amount must be integer satang." } }
    if (slice > invoice.totalSatang - invoice.postedCreditSatang - invoice.postedReceiptSatang) {
      return { ok: false, error: "This receipt is larger than the receivable still posted." }
    }
  }
  if (!input.accounts.includes(account.account) || !input.accounts.includes(SALES_JOURNAL_ACCOUNTS.receivable)) {
    return { ok: false, error: "Journal line account is not on the chart." }
  }
  const reference = input.reference.trim()
  const memo = reference ? `${account.label} receipt ${input.paidOn} ${reference}` : `${account.label} receipt ${input.paidOn}`
  if (memo.length > 200) return { ok: false, error: "Enter a journal memo." }
  const lines: DraftJournalLine[] = [
    { accountCode: account.account, debitSatang: input.amountSatang, creditSatang: 0 },
    { accountCode: SALES_JOURNAL_ACCOUNTS.receivable, debitSatang: 0, creditSatang: input.amountSatang },
  ]
  const checked = draftJournalLines(lines, input.accounts)
  if (!checked.ok) return checked
  return { ok: true, entryDate: input.paidOn, memo, lines, debitSatang: checked.debitSatang, vatTreatment: account.treatment }
}
