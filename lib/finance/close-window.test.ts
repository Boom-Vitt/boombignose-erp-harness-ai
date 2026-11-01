import { describe, expect, it } from "vitest"
import { bangkokCalendarDate, monthEnd, previousCompletedMonth, resolveCloseMonth, resolveCloseThrough } from "@/lib/finance/close-window"

describe("close window", () => {
  it("uses the last calendar day, including a leap day", () => {
    expect(monthEnd("2026-01")).toBe("2026-01-31")
    expect(monthEnd("2026-02")).toBe("2026-02-28")
    expect(monthEnd("2024-02")).toBe("2024-02-29")
    expect(monthEnd("2026-13")).toBeNull()
    expect(monthEnd("January")).toBeNull()
  })

  it("steps back one calendar month", () => {
    expect(previousCompletedMonth("2026-03-01")).toBe("2026-02")
    expect(previousCompletedMonth("2026-01-15")).toBe("2025-12")
    expect(previousCompletedMonth("2026-02-31")).toBeNull()
  })

  it("defaults the close month and accepts an explicit month or every date", () => {
    expect(resolveCloseMonth("2026-11-01", undefined)).toEqual({ ok: true, month: "2026-10", periodEnd: "2026-10-31" })
    expect(resolveCloseMonth("2026-11-01", "2026-09")).toEqual({ ok: true, month: "2026-09", periodEnd: "2026-09-30" })
    expect(resolveCloseMonth("2026-11-01", "2026-13").ok).toBe(false)
    expect(resolveCloseThrough("2026-11-01", "all")).toEqual({ ok: true, scope: "all", month: null, periodEnd: null })
    expect(resolveCloseThrough("2026-11-01", undefined)).toMatchObject({ scope: "month", month: "2026-10", periodEnd: "2026-10-31" })
  })

  it("reads a payment instant as a Bangkok date", () => {
    expect(bangkokCalendarDate("2026-01-31T16:30:00.000Z")).toBe("2026-01-31")
    expect(bangkokCalendarDate("2026-01-31T17:30:00.000Z")).toBe("2026-02-01")
  })
})
