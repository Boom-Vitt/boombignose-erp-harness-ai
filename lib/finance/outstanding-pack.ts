import { isCalendarDate } from "@/lib/finance/close-window"
import { toCsv } from "@/lib/export/csv"
import { satangToBahtString, sumSatang } from "@/lib/money"

/**
 * Line list of open receivables and unpaid vendor bills for an external
 * accountant. Bucket cuts match the statements report (not yet due, 1–30,
 * 31–60, 61–90, 91+). This file does not draw that report.
 *
 * Outstanding amounts are the balances stored now. Receipts and bill payments
 * after the close date are already subtracted. The pack is the open list, not
 * a reconstructed historical ledger.
 */

export type AgingBucket = "current" | "days1to30" | "days31to60" | "days61to90" | "days91plus"

export const AGING_BUCKET_LABEL: Record<AgingBucket, string> = {
  current: "Not yet due",
  days1to30: "1–30 days",
  days31to60: "31–60 days",
  days61to90: "61–90 days",
  days91plus: "91 days or more",
}

const ISSUED = new Set(["sent", "partially_paid", "paid", "overdue"])

/** Whole days after the due date. A missing or invalid due date counts as not yet due. */
export function daysPastDue(dueDate: string | null, asOf: string): number {
  if (!dueDate || !isCalendarDate(dueDate) || !isCalendarDate(asOf) || dueDate >= asOf) return 0
  const start = Date.parse(`${dueDate}T00:00:00Z`)
  const end = Date.parse(`${asOf}T00:00:00Z`)
  return Math.round((end - start) / 86_400_000)
}

export function agingBucket(dueDate: string | null, asOf: string): AgingBucket {
  const late = daysPastDue(dueDate, asOf)
  if (late <= 0) return "current"
  if (late <= 30) return "days1to30"
  if (late <= 60) return "days31to60"
  if (late <= 90) return "days61to90"
  return "days91plus"
}

export type OutstandingInvoice = {
  id: string
  number: string
  party: string
  status: string
  issueDate: string
  dueDate: string | null
  outstandingSatang: number
}

export type OutstandingBill = {
  id: string
  number: string
  party: string
  incurredOn: string
  dueDate: string | null
  amountSatang: number
  paidOn: string | null
  vendorId: string | null
  expenseClaimId: string | null
  kind: "bill" | "credit" | "return_adjustment" | null
}

export type OutstandingRow = {
  side: "AR" | "AP"
  id: string
  number: string
  party: string
  documentDate: string
  dueDate: string
  amountSatang: number
  daysPastDue: number
  bucket: AgingBucket
  status: string
}

export const OUTSTANDING_PACK_HEADERS = [
  "Side",
  "Document ID",
  "Number",
  "Party",
  "Document date",
  "Due date",
  "Amount (THB)",
  "Days past due",
  "Aging bucket",
  "Status",
]

function compareRows(a: OutstandingRow, b: OutstandingRow): number {
  if (a.side !== b.side) return a.side === "AR" ? -1 : 1
  const dueA = a.dueDate || "9999-99-99"
  const dueB = b.dueDate || "9999-99-99"
  if (dueA !== dueB) return dueA < dueB ? -1 : 1
  if (a.id !== b.id) return a.id < b.id ? -1 : 1
  return 0
}

export function outstandingPack(asOf: string, invoices: readonly OutstandingInvoice[], bills: readonly OutstandingBill[]): OutstandingRow[] {
  if (!isCalendarDate(asOf)) throw new Error("Enter the close date as YYYY-MM-DD.")
  const rows: OutstandingRow[] = []
  for (const invoice of invoices) {
    if (!ISSUED.has(invoice.status)) continue
    if (!isCalendarDate(invoice.issueDate) || invoice.issueDate > asOf) continue
    if (!Number.isSafeInteger(invoice.outstandingSatang) || invoice.outstandingSatang <= 0) continue
    rows.push({
      side: "AR",
      id: invoice.id,
      number: invoice.number,
      party: invoice.party,
      documentDate: invoice.issueDate,
      dueDate: invoice.dueDate && isCalendarDate(invoice.dueDate) ? invoice.dueDate : "",
      amountSatang: invoice.outstandingSatang,
      daysPastDue: daysPastDue(invoice.dueDate, asOf),
      bucket: agingBucket(invoice.dueDate, asOf),
      status: invoice.status,
    })
  }
  for (const bill of bills) {
    if (!bill.vendorId || bill.expenseClaimId) continue
    if (bill.kind === "credit" || bill.kind === "return_adjustment") continue
    if (!Number.isSafeInteger(bill.amountSatang) || bill.amountSatang <= 0) continue
    if (!isCalendarDate(bill.incurredOn) || bill.incurredOn > asOf) continue
    if (bill.paidOn && isCalendarDate(bill.paidOn) && bill.paidOn <= asOf) continue
    rows.push({
      side: "AP",
      id: bill.id,
      number: bill.number,
      party: bill.party,
      documentDate: bill.incurredOn,
      dueDate: bill.dueDate && isCalendarDate(bill.dueDate) ? bill.dueDate : "",
      amountSatang: bill.amountSatang,
      daysPastDue: daysPastDue(bill.dueDate, asOf),
      bucket: agingBucket(bill.dueDate, asOf),
      status: bill.paidOn && isCalendarDate(bill.paidOn) ? "unpaid at close" : "unpaid",
    })
  }
  return rows.sort(compareRows)
}

export function outstandingPackCsv(rows: readonly OutstandingRow[]): string {
  const arSatang = sumSatang(rows.filter(row => row.side === "AR").map(row => row.amountSatang))
  const apSatang = sumSatang(rows.filter(row => row.side === "AP").map(row => row.amountSatang))
  const data = rows.map(row => [
    row.side,
    row.id,
    row.number,
    row.party,
    row.documentDate,
    row.dueDate,
    satangToBahtString(row.amountSatang),
    row.daysPastDue,
    AGING_BUCKET_LABEL[row.bucket],
    row.status,
  ])
  data.push(["AR total", "", "", "", "", "", satangToBahtString(arSatang), "", "", ""])
  data.push(["AP total", "", "", "", "", "", satangToBahtString(apSatang), "", "", ""])
  return toCsv(OUTSTANDING_PACK_HEADERS, data)
}
