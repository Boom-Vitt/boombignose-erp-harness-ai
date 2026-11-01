import { isCalendarDate } from "@/lib/finance/close-window"
import { sumSatang } from "@/lib/money"

/**
 * Cash the workspace can point at on a close date, next to the cash figure
 * saved in Settings. This is not a bank balance and not a general ledger.
 */

export type CashReceipt = {
  id: string
  paidOn: string
  amountSatang: number
  verified: boolean
}

export type CashCost = {
  paidOn: string | null
  amountSatang: number
}

export type CashStatementLine = {
  bookedOn: string
  amountSatang: number
  matchedPaymentId: string | null
  closeNote: string | null
}

export type CashTruth = {
  asOf: string
  recordedBalanceSatang: number
  verifiedReceiptsSatang: number
  paidCostsSatang: number
  cashInSystemSatang: number
  differenceSatang: number
  statementNetSatang: number
  matchedStatementSatang: number
  openStatementSatang: number
  openStatementCount: number
  explainedStatementSatang: number
  explainedStatementCount: number
  receiptsWithoutStatementSatang: number
  receiptsWithoutStatementCount: number
}

export type CashTruthResult = { ok: true; truth: CashTruth } | { ok: false; error: string }

function onOrBefore(date: string, asOf: string): boolean {
  return isCalendarDate(date) && date <= asOf
}

function explained(line: CashStatementLine): boolean {
  return !line.matchedPaymentId && (line.closeNote ?? "").trim().length > 0
}

export function cashTruth(input: {
  asOf: string
  recordedBalanceSatang: number
  receipts: readonly CashReceipt[]
  costs: readonly CashCost[]
  statementLines: readonly CashStatementLine[]
}): CashTruthResult {
  if (!isCalendarDate(input.asOf)) return { ok: false, error: "Enter the close date as YYYY-MM-DD." }
  if (!Number.isSafeInteger(input.recordedBalanceSatang)) return { ok: false, error: "Recorded balance is not a whole number of satang." }

  const receipts = input.receipts.filter(row => row.verified && onOrBefore(row.paidOn, input.asOf))
  const costs = input.costs.filter(row => row.paidOn !== null && onOrBefore(row.paidOn, input.asOf))
  const lines = input.statementLines.filter(row => onOrBefore(row.bookedOn, input.asOf))
  const matchedIds = new Set(lines.flatMap(line => line.matchedPaymentId ? [line.matchedPaymentId] : []))
  const looseReceipts = receipts.filter(row => !matchedIds.has(row.id))
  const matched = lines.filter(line => line.matchedPaymentId !== null)
  const noted = lines.filter(explained)
  const open = lines.filter(line => !line.matchedPaymentId && !explained(line))

  const verifiedReceiptsSatang = sumSatang(receipts.map(row => row.amountSatang))
  const paidCostsSatang = sumSatang(costs.map(row => row.amountSatang))
  const cashInSystemSatang = verifiedReceiptsSatang - paidCostsSatang
  if (!Number.isSafeInteger(cashInSystemSatang)) throw new Error("Unsafe integer-satang sum")
  const differenceSatang = input.recordedBalanceSatang - cashInSystemSatang
  if (!Number.isSafeInteger(differenceSatang)) throw new Error("Unsafe integer-satang sum")

  return {
    ok: true,
    truth: {
      asOf: input.asOf,
      recordedBalanceSatang: input.recordedBalanceSatang,
      verifiedReceiptsSatang,
      paidCostsSatang,
      cashInSystemSatang,
      differenceSatang,
      statementNetSatang: sumSatang(lines.map(line => line.amountSatang)),
      matchedStatementSatang: sumSatang(matched.map(line => line.amountSatang)),
      openStatementSatang: sumSatang(open.map(line => line.amountSatang)),
      openStatementCount: open.length,
      explainedStatementSatang: sumSatang(noted.map(line => line.amountSatang)),
      explainedStatementCount: noted.length,
      receiptsWithoutStatementSatang: sumSatang(looseReceipts.map(row => row.amountSatang)),
      receiptsWithoutStatementCount: looseReceipts.length,
    },
  }
}
