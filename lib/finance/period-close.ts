import { isCalendarDate } from "@/lib/finance/close-window"

/**
 * Close a completed calendar month by moving the finance lock to that
 * month's last day. Transactions on or before the lock stay blocked.
 * This is an operational date lock, not a general-ledger close or a tax filing.
 */

export type PeriodClose =
  | { ok: true; lockDate: string }
  | { ok: false; error: string }

function lastDay(month: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return null
  const year = Number(match[1])
  const mon = Number(match[2])
  if (mon < 1 || mon > 12) return null
  const end = new Date(Date.UTC(year, mon, 0))
  if (end.getUTCFullYear() !== year || end.getUTCMonth() !== mon - 1) return null
  return `${match[1]}-${match[2]}-${String(end.getUTCDate()).padStart(2, "0")}`
}

export type FinanceLockChange =
  | { ok: true; lockDate: string | null }
  | { ok: false; error: string }

/**
 * A manual lock date. Blank reopens every day. A date after `today` is refused.
 * Moving the date earlier stays allowed and is audited as a reopen.
 * This does not require a month-end; closing a month uses `closeAccountingPeriod`.
 */
export function financeLockChange(lockDate: string, today: string): FinanceLockChange {
  if (lockDate === "") return { ok: true, lockDate: null }
  if (!isCalendarDate(lockDate) || !isCalendarDate(today)) return { ok: false, error: "Enter a valid lock date or leave it blank." }
  if (lockDate > today) return { ok: false, error: "Finance lock date cannot be in the future." }
  return { ok: true, lockDate }
}

export function closeAccountingPeriod(month: string, today: string, currentLock: string | null): PeriodClose {
  const lockDate = lastDay(month)
  if (!lockDate) return { ok: false, error: "Enter a month as YYYY-MM." }
  if (!isCalendarDate(today)) return { ok: false, error: "Enter today as YYYY-MM-DD." }
  if (lockDate >= today) return { ok: false, error: "Close a completed month. The current month stays open." }
  if (currentLock) {
    if (!isCalendarDate(currentLock)) return { ok: false, error: "The current lock date is not a calendar day." }
    if (currentLock >= lockDate) return { ok: false, error: "That month is already closed." }
  }
  return { ok: true, lockDate }
}
