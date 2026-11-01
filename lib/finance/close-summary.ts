/**
 * Open operational items for a month-end note.
 * Counts only. No journal, no VAT return, no aging buckets.
 */
import { deriveInvoiceStatus, outstandingSatang, type InvoiceStatus } from "@/lib/metrics/invoice-status"
import { sumSatang } from "@/lib/money"

export type CloseInvoice = {
  status: InvoiceStatus
  amount_satang: number
  due_date: string | null
  paid_satang: number
  credited_satang: number
}

export type CloseBill = {
  vendor_id: string | null
  paid_at: string | null
  amount_satang: number
}

export type CloseBankLine = {
  matched_payment_id: string | null
}

export type CloseOpenItems = {
  asOf: string
  overdueReceivableCount: number
  overdueReceivableSatang: number
  unpaidBillCount: number
  unpaidBillSatang: number
  /** Null when bank lines could not be read. Zero means the table was read and nothing is unmatched. */
  unmatchedBankCount: number | null
}

export function openItemCounts(input: {
  today: string
  invoices: readonly CloseInvoice[]
  bills: readonly CloseBill[]
  bankLines: readonly CloseBankLine[] | null
}): CloseOpenItems {
  const overdue = input.invoices.flatMap((invoice) => {
    const status = deriveInvoiceStatus(invoice, invoice.paid_satang, input.today)
    if (status !== "overdue") return []
    const outstanding = outstandingSatang(invoice.amount_satang, invoice.paid_satang, invoice.credited_satang)
    return outstanding > 0 ? [outstanding] : []
  })
  const unpaid = input.bills.flatMap((bill) => (
    bill.vendor_id && bill.paid_at == null && bill.amount_satang > 0 ? [bill.amount_satang] : []
  ))
  return {
    asOf: input.today,
    overdueReceivableCount: overdue.length,
    overdueReceivableSatang: sumSatang(overdue),
    unpaidBillCount: unpaid.length,
    unpaidBillSatang: sumSatang(unpaid),
    unmatchedBankCount: input.bankLines === null
      ? null
      : input.bankLines.filter((line) => line.matched_payment_id == null).length,
  }
}
