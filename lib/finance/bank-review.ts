import { matchingReceipts, type BankCandidate } from "@/lib/finance/bank-match"
import { isCalendarDate } from "@/lib/finance/close-window"
import { sumSatang } from "@/lib/money"

/**
 * Status of one statement line during month-end. A match is still only a note
 * on the line. An explanation records why the line is not a customer receipt.
 * Neither one posts a journal.
 */
export type BankLineStatus = "matched" | "explained" | "ready" | "ambiguous" | "unmatched" | "money_out"

export const BANK_LINE_STATUS_LABEL: Record<BankLineStatus, string> = {
  matched: "จับคู่แล้ว / Matched",
  explained: "บันทึกเหตุผลแล้ว / Explained",
  ready: "พร้อมจับคู่ / Ready to match",
  ambiguous: "มีใบเสร็จซ้ำ / More than one receipt",
  unmatched: "ยังไม่มีใบเสร็จ / No receipt",
  money_out: "เงินออก / Money out",
}

const OPEN_STATUSES: ReadonlySet<BankLineStatus> = new Set(["ready", "ambiguous", "unmatched", "money_out"])

export type BankLineInput = {
  id: string
  bookedOn: string
  amountSatang: number
  reference: string
  matchedPaymentId: string | null
  closeNote: string | null
}

export type ClassifiedBankLine = BankLineInput & {
  status: BankLineStatus
  suggestedPaymentId: string | null
  blocksClose: boolean
}

export function bankLineStatus(
  line: { amountSatang: number; reference: string; matchedPaymentId: string | null; closeNote: string | null },
  payments: readonly BankCandidate[],
  taken: ReadonlySet<string>,
): { status: BankLineStatus; suggestedPaymentId: string | null } {
  if (line.matchedPaymentId) return { status: "matched", suggestedPaymentId: null }
  if ((line.closeNote ?? "").trim().length > 0) return { status: "explained", suggestedPaymentId: null }
  const hits = matchingReceipts(line, payments, taken)
  if (hits.length === 1) return { status: "ready", suggestedPaymentId: hits[0]!.id }
  if (hits.length > 1) return { status: "ambiguous", suggestedPaymentId: null }
  if (line.amountSatang < 0) return { status: "money_out", suggestedPaymentId: null }
  return { status: "unmatched", suggestedPaymentId: null }
}

function inWindow(bookedOn: string, periodEnd: string | null): boolean {
  if (periodEnd === null) return true
  return isCalendarDate(bookedOn) && bookedOn <= periodEnd
}

export function classifyBankLines(
  lines: readonly BankLineInput[],
  payments: readonly BankCandidate[],
  periodEnd: string | null,
): ClassifiedBankLine[] {
  const taken = new Set(lines.map(line => line.matchedPaymentId).filter((id): id is string => !!id))
  return lines.map(line => {
    const result = bankLineStatus(line, payments, taken)
    return {
      ...line,
      status: result.status,
      suggestedPaymentId: result.suggestedPaymentId,
      blocksClose: inWindow(line.bookedOn, periodEnd) && OPEN_STATUSES.has(result.status),
    }
  })
}

export type BankCloseSummary = {
  periodEnd: string | null
  openCount: number
  openNetSatang: number
  readyCount: number
  ambiguousCount: number
  unmatchedCount: number
  moneyOutCount: number
  explainedCount: number
  explainedNetSatang: number
  matchedCount: number
  matchedNetSatang: number
  laterOpenCount: number
}

export function summarizeBankClose(lines: readonly ClassifiedBankLine[], periodEnd: string | null): BankCloseSummary {
  const window = lines.filter(line => inWindow(line.bookedOn, periodEnd))
  const open = window.filter(line => line.blocksClose)
  const explained = window.filter(line => line.status === "explained")
  const matched = window.filter(line => line.status === "matched")
  const laterOpen = periodEnd === null
    ? []
    : lines.filter(line => isCalendarDate(line.bookedOn) && line.bookedOn > periodEnd && OPEN_STATUSES.has(line.status))
  return {
    periodEnd,
    openCount: open.length,
    openNetSatang: sumSatang(open.map(line => line.amountSatang)),
    readyCount: open.filter(line => line.status === "ready").length,
    ambiguousCount: open.filter(line => line.status === "ambiguous").length,
    unmatchedCount: open.filter(line => line.status === "unmatched").length,
    moneyOutCount: open.filter(line => line.status === "money_out").length,
    explainedCount: explained.length,
    explainedNetSatang: sumSatang(explained.map(line => line.amountSatang)),
    matchedCount: matched.length,
    matchedNetSatang: sumSatang(matched.map(line => line.amountSatang)),
    laterOpenCount: laterOpen.length,
  }
}

export type BankQueue = "open" | "explained" | "matched" | "all"

export function parseBankQueue(value: string | undefined): BankQueue {
  if (value === "explained" || value === "matched" || value === "all") return value
  return "open"
}

export function bankLineInQueue(line: ClassifiedBankLine, queue: BankQueue, periodEnd: string | null): boolean {
  if (!inWindow(line.bookedOn, periodEnd)) return false
  if (queue === "all") return true
  if (queue === "open") return line.blocksClose
  return line.status === queue
}
