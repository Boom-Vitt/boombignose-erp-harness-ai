import { formatInTimeZone } from "date-fns-tz"
import { APP_TZ } from "@/lib/dates"

/** Calendar window for a month-end cash review. Not a ledger close. */

export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return false
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  return utc.getUTCFullYear() === year && utc.getUTCMonth() === month - 1 && utc.getUTCDate() === day
}

/** Last calendar day of `YYYY-MM`, or null when the month is not real. */
export function monthEnd(month: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return null
  const year = Number(match[1])
  const mon = Number(match[2])
  if (mon < 1 || mon > 12) return null
  const end = new Date(Date.UTC(year, mon, 0))
  if (end.getUTCFullYear() !== year || end.getUTCMonth() !== mon - 1) return null
  return `${match[1]}-${match[2]}-${String(end.getUTCDate()).padStart(2, "0")}`
}

/** Calendar month before `today`, or null when `today` is not a real date. */
export function previousCompletedMonth(today: string): string | null {
  if (!isCalendarDate(today)) return null
  const year = Number(today.slice(0, 4))
  const month = Number(today.slice(5, 7))
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
  return `${prev.year}-${String(prev.month).padStart(2, "0")}`
}

/** `YYYY-MM-DD` in Asia/Bangkok for a payment or bill timestamp. */
export function bangkokCalendarDate(instant: string): string {
  return formatInTimeZone(new Date(instant), APP_TZ, "yyyy-MM-dd")
}

export type CloseMonth =
  | { ok: true; month: string; periodEnd: string }
  | { ok: false; error: string }

/** A requested `YYYY-MM`, or the calendar month before today when omitted. */
export function resolveCloseMonth(today: string, month: string | undefined): CloseMonth {
  if (month) {
    const periodEnd = monthEnd(month)
    if (!periodEnd) return { ok: false, error: "Enter a month as YYYY-MM." }
    return { ok: true, month, periodEnd }
  }
  const previous = previousCompletedMonth(today)
  const periodEnd = previous ? monthEnd(previous) : null
  if (!previous || !periodEnd) return { ok: false, error: "Enter today as YYYY-MM-DD." }
  return { ok: true, month: previous, periodEnd }
}

export type CloseThrough =
  | { ok: true; scope: "month"; month: string; periodEnd: string }
  | { ok: true; scope: "all"; month: null; periodEnd: null }
  | { ok: false; error: string }

/**
 * Bank-line window. `through` is `YYYY-MM`, `all`, or omitted.
 * Omitted uses the calendar month before today.
 */
export function resolveCloseThrough(today: string, through: string | undefined): CloseThrough {
  if (through === "all") return { ok: true, scope: "all", month: null, periodEnd: null }
  if (through) {
    const month = resolveCloseMonth(today, through)
    if (!month.ok) return month
    return { ok: true, scope: "month", month: month.month, periodEnd: month.periodEnd }
  }
  const month = resolveCloseMonth(today, undefined)
  if (!month.ok) return month
  return { ok: true, scope: "month", month: month.month, periodEnd: month.periodEnd }
}
