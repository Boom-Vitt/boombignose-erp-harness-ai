import { isCalendarDate } from "@/lib/finance/close-window"
import { sumSatang } from "@/lib/money"
import { moneyInput } from "@/lib/payments/input"

/**
 * A working journal for a closed operational period. Balanced lines are stored.
 * They are not signed statutory books and not a Revenue Department filing.
 */

export const DRAFT_JOURNAL_LIMIT_TH =
  "รายการนี้เป็นบันทึกรายวันฉบับร่างในช่วงที่ปิดแล้ว ไม่ใช่งบที่ลงนามตามกฎหมาย และไม่ใช่การยื่นแบบ ภ.พ.30 หรือ e-Tax"

export const DRAFT_JOURNAL_LIMIT_EN =
  "This is a draft journal in a closed period. It is not signed statutory books and not a ภ.พ.30 or e-Tax filing."

export type DraftJournalLine = {
  accountCode: string
  debitSatang: number
  creditSatang: number
}

export type DraftJournalCheck =
  | { ok: true; debitSatang: number }
  | { ok: false; error: string }

const MAX_SATANG = 9007199254740991

export function journalDateInClosedPeriod(entryDate: string, lockDate: string | null): DraftJournalCheck {
  if (!isCalendarDate(entryDate)) return { ok: false, error: "Enter a journal date." }
  if (!lockDate || !isCalendarDate(lockDate) || entryDate > lockDate) return { ok: false, error: "Post a journal only into a closed period." }
  return { ok: true, debitSatang: 0 }
}

/** Empty baht input is zero. Anything else must be exact THB with at most two decimals. */
export function journalAmountSatang(raw: string): { ok: true; satang: number } | { ok: false; error: string } {
  const trimmed = raw.trim()
  if (trimmed === "") return { ok: true, satang: 0 }
  try {
    return { ok: true, satang: moneyInput(trimmed) }
  } catch {
    return { ok: false, error: "Journal line amount must be integer satang." }
  }
}

export function journalMemo(memo: string): { ok: true; memo: string } | { ok: false; error: string } {
  const trimmed = memo.trim()
  if (trimmed.length < 1 || trimmed.length > 200) return { ok: false, error: "Enter a journal memo." }
  return { ok: true, memo: trimmed }
}

function lineAmount(value: number, label: string): string | null {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SATANG) return `${label} must be integer satang.`
  return null
}

/** Refuse a journal that does not balance or does not use the chart. */
export function draftJournalLines(lines: readonly DraftJournalLine[], accounts: readonly string[]): DraftJournalCheck {
  if (lines.length < 2 || lines.length > 20) return { ok: false, error: "A journal needs 2 to 20 lines." }
  const known = new Set(accounts)
  const debits: number[] = []
  const credits: number[] = []
  for (const line of lines) {
    if (!/^[0-9]{4}$/.test(line.accountCode) || !known.has(line.accountCode)) return { ok: false, error: "Journal line account is not on the chart." }
    const debitError = lineAmount(line.debitSatang, "Journal line amount")
    const creditError = lineAmount(line.creditSatang, "Journal line amount")
    if (debitError || creditError) return { ok: false, error: "Journal line amount must be integer satang." }
    if (line.debitSatang > 0 && line.creditSatang > 0) return { ok: false, error: "A journal line is debit or credit, not both." }
    if (line.debitSatang === 0 && line.creditSatang === 0) return { ok: false, error: "A journal line needs an amount." }
    if (line.debitSatang > 0) debits.push(line.debitSatang)
    if (line.creditSatang > 0) credits.push(line.creditSatang)
  }
  const debitSatang = sumSatang(debits)
  const creditSatang = sumSatang(credits)
  if (debitSatang !== creditSatang || debitSatang <= 0) return { ok: false, error: "Journal debits and credits do not balance." }
  if (debitSatang > MAX_SATANG) return { ok: false, error: "Journal line amount must be integer satang." }
  return { ok: true, debitSatang }
}
