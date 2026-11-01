import { isCalendarDate } from "@/lib/finance/close-window"
import { sumSatang } from "@/lib/money"

/**
 * Trial balance of stored draft journal lines. Issued documents are not included.
 * This is not signed statutory books and not a Revenue Department filing.
 */

export const TRIAL_BALANCE_LIMIT_TH =
  "งบทดลองนี้รวมเฉพาะบันทึกรายวันฉบับร่าง ไม่ใช่งบที่ลงนามตามกฎหมาย และไม่ใช่การยื่นแบบ ภ.พ.30 หรือ e-Tax"

export const TRIAL_BALANCE_LIMIT_EN =
  "This trial balance adds up draft journal lines only. It is not signed statutory books and not a ภ.พ.30 or e-Tax filing."

export const TRIAL_BALANCE_BALANCED_EN = "Debits equal credits."
export const TRIAL_BALANCE_OPEN_EN = "Debits do not equal credits. Do not use this as a closed set of books."

const MAX_SATANG = 9007199254740991

export type TrialBalanceAccount = {
  code: string
  nameTh: string
  nameEn: string
  kind: string
}

export type TrialBalanceLine = {
  entryDate: string
  accountCode: string
  debitSatang: number
  creditSatang: number
}

export type TrialBalanceRow = {
  code: string
  nameTh: string
  nameEn: string
  kind: string
  debitSatang: number
  creditSatang: number
}

export type TrialBalance = {
  rows: TrialBalanceRow[]
  debitSatang: number
  creditSatang: number
  balanced: boolean
  lineCount: number
}

export type TrialBalanceResult = { ok: true; balance: TrialBalance } | { ok: false; error: string }

function safeAmount(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_SATANG
}

function added(amounts: number[]): number | null {
  try {
    const total = sumSatang(amounts)
    return total >= 0 && total <= MAX_SATANG ? total : null
  } catch {
    return null
  }
}

/**
 * Net each account onto one side. `through` keeps lines on or before that day.
 * A null through date keeps every posted line.
 */
export function trialBalance(
  lines: readonly TrialBalanceLine[],
  accounts: readonly TrialBalanceAccount[],
  through: string | null,
): TrialBalanceResult {
  if (through !== null && !isCalendarDate(through)) return { ok: false, error: "Enter a trial balance date." }
  const names = new Map(accounts.map(account => [account.code, account]))
  const buckets = new Map<string, { debit: number[]; credit: number[] }>()
  let lineCount = 0
  for (const line of lines) {
    if (!isCalendarDate(line.entryDate)) return { ok: false, error: "A journal date on this trial balance is not a calendar date." }
    if (through !== null && line.entryDate > through) continue
    if (line.accountCode.trim() === "") return { ok: false, error: "Journal line account is not on the chart." }
    if (!safeAmount(line.debitSatang) || !safeAmount(line.creditSatang)) {
      return { ok: false, error: "Journal line amount must be integer satang." }
    }
    lineCount += 1
    const bucket = buckets.get(line.accountCode) ?? { debit: [], credit: [] }
    if (line.debitSatang > 0) bucket.debit.push(line.debitSatang)
    if (line.creditSatang > 0) bucket.credit.push(line.creditSatang)
    buckets.set(line.accountCode, bucket)
  }

  const rows: TrialBalanceRow[] = []
  const debitSides: number[] = []
  const creditSides: number[] = []
  for (const code of [...buckets.keys()].sort()) {
    const bucket = buckets.get(code)
    if (!bucket) continue
    const debit = added(bucket.debit)
    const credit = added(bucket.credit)
    if (debit === null || credit === null) return { ok: false, error: "Journal line amount must be integer satang." }
    const net = debit - credit
    if (net === 0) continue
    const account = names.get(code)
    const row: TrialBalanceRow = {
      code,
      nameTh: account?.nameTh ?? "",
      nameEn: account?.nameEn ?? "",
      kind: account?.kind ?? "",
      debitSatang: net > 0 ? net : 0,
      creditSatang: net < 0 ? -net : 0,
    }
    rows.push(row)
    if (row.debitSatang > 0) debitSides.push(row.debitSatang)
    if (row.creditSatang > 0) creditSides.push(row.creditSatang)
  }
  const debitSatang = added(debitSides)
  const creditSatang = added(creditSides)
  if (debitSatang === null || creditSatang === null) return { ok: false, error: "Journal line amount must be integer satang." }
  return {
    ok: true,
    balance: { rows, debitSatang, creditSatang, balanced: debitSatang === creditSatang, lineCount },
  }
}

/** Missing request uses the finance lock. `all` keeps every posted line. */
export function trialBalanceThrough(raw: string | undefined, lockDate: string | null): { ok: true; through: string | null } | { ok: false; error: string } {
  if (raw === "all") return { ok: true, through: null }
  if (raw === undefined || raw === "") {
    return { ok: true, through: lockDate && isCalendarDate(lockDate) ? lockDate : null }
  }
  if (!isCalendarDate(raw)) return { ok: false, error: "Enter a trial balance date." }
  return { ok: true, through: raw }
}
