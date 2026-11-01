import { isCalendarDate } from "@/lib/finance/close-window"
import { sumSatang } from "@/lib/money"
import { draftJournalLines, journalDateInClosedPeriod, type DraftJournalLine } from "@/lib/finance/draft-journal"

/**
 * One issued sales invoice becomes a balanced draft journal.
 * The stored snapshot is posted. VAT is not recomputed from a guess.
 *
 * No VAT: debit accounts receivable, credit sales, both for the total.
 * VAT exclusive: sales is the base before VAT. Output VAT is the stored VAT.
 *   That VAT must equal half-up rounding of base × rate / 10000 for each rate.
 * VAT inclusive: sales is the base after VAT is taken out. Output VAT is the stored VAT.
 *   That VAT must equal half-up rounding of gross × rate / (10000 + rate).
 *
 * Withholding, deposits, and a legacy adoption are refused.
 * A later credit note is a separate journal. It does not block this sale.
 * This is not signed statutory books and not a ภ.พ.30 or e-Tax filing.
 */

export const SALES_INVOICE_JOURNAL_LIMIT_TH =
  "รายการนี้ลงบันทึกรายวันฉบับร่างจากใบแจ้งหนี้ที่ออกแล้ว ไม่ใช่งบที่ลงนามตามกฎหมาย และไม่ใช่การยื่นแบบ ภ.พ.30 หรือ e-Tax"

export const SALES_INVOICE_JOURNAL_LIMIT_EN =
  "This posts an issued sales invoice into the draft journal. It is not signed statutory books and not a ภ.พ.30 or e-Tax filing."

export const SALES_JOURNAL_ACCOUNTS = { receivable: "1130", sales: "4100", vatOutput: "2130" } as const

export const ISSUED_SALES_STATUSES = ["sent", "partially_paid", "paid", "overdue"] as const

export type SalesVatTreatment = "no_vat" | "vat_exclusive" | "vat_inclusive"

export type SalesVatBucket = { rateBps: number; baseSatang: number; vatSatang: number }

export type SalesInvoicePost = {
  status: string
  snapshotKind: string
  quoteInvoiceKind: string
  quoteDepositSatang: number
  quoteDepositDeductionSatang: number
  issueDate: string
  snapshotIssueDate: string
  number: string
  snapshotNumber: string
  pricesIncludeVat: boolean
  subtotalSatang: number
  discountSatang: number
  vatSatang: number
  totalSatang: number
  whtSatang: number
  whtRateBps: number
  amountDueSatang: number
  vatByRate: unknown
  snapshotAgrees: boolean
  lockDate: string | null
  accounts: readonly string[]
}

export type SalesInvoiceJournal =
  | { ok: true; entryDate: string; memo: string; lines: DraftJournalLine[]; debitSatang: number; vatTreatment: SalesVatTreatment }
  | { ok: false; error: string }

const MAX_SATANG = 9007199254740991

function halfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * BigInt(2) + denominator) / (denominator * BigInt(2))
}

function safeMoney(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_SATANG
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

/** Balanced lines for one plain issued sales invoice, or a refusal. */
export function salesInvoiceJournal(input: SalesInvoicePost): SalesInvoiceJournal {
  if (input.snapshotKind !== "operational_invoice" || !(ISSUED_SALES_STATUSES as readonly string[]).includes(input.status)) {
    return { ok: false, error: "Only an issued operational sales invoice can post." }
  }
  if (input.quoteInvoiceKind !== "lines" || input.quoteDepositSatang !== 0 || input.quoteDepositDeductionSatang !== 0) {
    return { ok: false, error: "A deposit invoice is not posted." }
  }
  if (input.whtRateBps !== 0 || input.whtSatang !== 0) return { ok: false, error: "Withholding is not posted from the invoice." }
  if (!isCalendarDate(input.issueDate) || input.issueDate !== input.snapshotIssueDate || input.number !== input.snapshotNumber) {
    return { ok: false, error: "The issued snapshot does not match the invoice." }
  }
  if (!input.snapshotAgrees) return { ok: false, error: "The issued snapshot does not match the invoice." }
  const closed = journalDateInClosedPeriod(input.issueDate, input.lockDate)
  if (!closed.ok) return closed
  if (!safeMoney(input.subtotalSatang) || !safeMoney(input.discountSatang) || !safeMoney(input.vatSatang) || !safeMoney(input.totalSatang) || !safeMoney(input.amountDueSatang)) {
    return { ok: false, error: "Journal line amount must be integer satang." }
  }
  const vatByRate = buckets(input.vatByRate)
  if (input.discountSatang > input.subtotalSatang || !vatByRate) {
    return { ok: false, error: "The stored totals do not match the VAT treatment." }
  }
  if (vatByRate.some(bucket => !bucketVatAgrees(bucket, input.pricesIncludeVat))) {
    return { ok: false, error: "The stored VAT does not match the stated rate." }
  }
  let baseSatang: number
  let vatSatang: number
  try {
    baseSatang = sumSatang(vatByRate.map(bucket => bucket.baseSatang))
    vatSatang = sumSatang(vatByRate.map(bucket => bucket.vatSatang))
  } catch {
    return { ok: false, error: "Journal line amount must be integer satang." }
  }
  const gross = input.pricesIncludeVat ? input.totalSatang : baseSatang
  if (vatSatang !== input.vatSatang || baseSatang + vatSatang !== input.totalSatang || input.amountDueSatang !== input.totalSatang || input.subtotalSatang - input.discountSatang !== gross || input.totalSatang <= 0) {
    return { ok: false, error: "The stored totals do not match the VAT treatment." }
  }
  const needed = [SALES_JOURNAL_ACCOUNTS.receivable, ...(baseSatang > 0 ? [SALES_JOURNAL_ACCOUNTS.sales] : []), ...(vatSatang > 0 ? [SALES_JOURNAL_ACCOUNTS.vatOutput] : [])]
  if (needed.some(code => !input.accounts.includes(code))) return { ok: false, error: "Journal line account is not on the chart." }
  const lines: DraftJournalLine[] = [
    { accountCode: SALES_JOURNAL_ACCOUNTS.receivable, debitSatang: input.totalSatang, creditSatang: 0 },
  ]
  if (vatSatang > 0) lines.push({ accountCode: SALES_JOURNAL_ACCOUNTS.vatOutput, debitSatang: 0, creditSatang: vatSatang })
  if (baseSatang > 0) lines.push({ accountCode: SALES_JOURNAL_ACCOUNTS.sales, debitSatang: 0, creditSatang: baseSatang })
  const memo = `Issued sales invoice ${input.number}`
  if (memo.length > 200) return { ok: false, error: "Enter a journal memo." }
  const checked = draftJournalLines(lines, input.accounts)
  if (!checked.ok) return checked
  const vatTreatment: SalesVatTreatment = vatSatang === 0 ? "no_vat" : input.pricesIncludeVat ? "vat_inclusive" : "vat_exclusive"
  return { ok: true, entryDate: input.issueDate, memo, lines, debitSatang: checked.debitSatang, vatTreatment }
}

function whole(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null
}

function buckets(value: unknown): SalesVatBucket[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const rows: SalesVatBucket[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") return null
    const row = item as { rateBps?: unknown; baseSatang?: unknown; vatSatang?: unknown }
    const rateBps = whole(row.rateBps)
    const baseSatang = whole(row.baseSatang)
    const vatSatang = whole(row.vatSatang)
    if (rateBps === null || baseSatang === null || vatSatang === null) return null
    rows.push({ rateBps, baseSatang, vatSatang })
  }
  return rows
}

export type StoredSalesInvoice = {
  status: string
  quoteInvoiceKind: string
  quoteDepositSatang: number
  quoteDepositDeductionSatang: number
  issueDate: string
  number: string
  pricesIncludeVat: boolean
  subtotalSatang: number
  discountSatang: number
  vatSatang: number
  totalSatang: number
  whtSatang: number
  whtRateBps: number
  amountDueSatang: number
  vatByRate: unknown
}

/** True when the frozen snapshot document carries the same tax figures as the invoice row. */
export function salesSnapshotAgrees(snapshot: unknown, invoice: StoredSalesInvoice): boolean {
  if (!snapshot || typeof snapshot !== "object") return false
  const document = (snapshot as { document?: unknown }).document
  if (!document || typeof document !== "object") return false
  const row = document as Record<string, unknown>
  const snapBuckets = buckets(row.vatByRate)
  const invoiceBuckets = buckets(invoice.vatByRate)
  if (!snapBuckets || !invoiceBuckets) return false
  return row.number === invoice.number
    && row.issueDate === invoice.issueDate
    && row.pricesIncludeVat === invoice.pricesIncludeVat
    && whole(row.subtotalSatang) === invoice.subtotalSatang
    && whole(row.discountSatang) === invoice.discountSatang
    && whole(row.vatSatang) === invoice.vatSatang
    && whole(row.totalSatang) === invoice.totalSatang
    && whole(row.whtSatang) === invoice.whtSatang
    && whole(row.whtRateBps) === invoice.whtRateBps
    && whole(row.amountDueSatang) === invoice.amountDueSatang
    && JSON.stringify(snapBuckets) === JSON.stringify(invoiceBuckets)
}
