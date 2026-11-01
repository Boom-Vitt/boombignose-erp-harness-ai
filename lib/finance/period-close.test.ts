import { describe, expect, it } from "vitest"
import { closeAccountingPeriod, financeLockChange, lockChangeIsReopen, reopenReason } from "@/lib/finance/period-close"

describe("closeAccountingPeriod", () => {
  it("locks through the last day of a completed month", () => {
    expect(closeAccountingPeriod("2026-01", "2026-02-01", null)).toEqual({ ok: true, lockDate: "2026-01-31" })
    expect(closeAccountingPeriod("2026-02", "2026-03-01", "")).toEqual({ ok: true, lockDate: "2026-02-28" })
    expect(closeAccountingPeriod("2024-02", "2024-03-01", null)).toEqual({ ok: true, lockDate: "2024-02-29" })
  })

  it("extends a lock across later completed months", () => {
    expect(closeAccountingPeriod("2026-03", "2026-04-01", "2026-01-31")).toEqual({ ok: true, lockDate: "2026-03-31" })
  })

  it("refuses the current month, a future month, and a month the lock already covers", () => {
    expect(closeAccountingPeriod("2026-01", "2026-01-31", null)).toEqual({ ok: false, error: "Close a completed month. The current month stays open." })
    expect(closeAccountingPeriod("2026-12", "2026-02-01", null)).toEqual({ ok: false, error: "Close a completed month. The current month stays open." })
    expect(closeAccountingPeriod("2026-01", "2026-04-01", "2026-01-31").ok).toBe(false)
    expect(closeAccountingPeriod("2026-01", "2026-04-01", "2026-03-31")).toEqual({ ok: false, error: "That month is already closed." })
  })

  it("refuses a future lock date and accepts a blank reopen", () => {
    expect(financeLockChange("", "2026-11-01")).toEqual({ ok: true, lockDate: null })
    expect(financeLockChange("2026-01-31", "2026-11-01")).toEqual({ ok: true, lockDate: "2026-01-31" })
    expect(financeLockChange("2026-11-01", "2026-11-01")).toEqual({ ok: true, lockDate: "2026-11-01" })
    expect(financeLockChange("2026-11-02", "2026-11-01")).toEqual({ ok: false, error: "Finance lock date cannot be in the future." })
    expect(financeLockChange("2026-02-30", "2026-11-01").ok).toBe(false)
    expect(financeLockChange("2026-01-31", "today").ok).toBe(false)
  })

  it("refuses a month that is not a calendar month", () => {
    expect(closeAccountingPeriod("2026-13", "2026-04-01", null)).toEqual({ ok: false, error: "Enter a month as YYYY-MM." })
    expect(closeAccountingPeriod("January", "2026-04-01", null)).toEqual({ ok: false, error: "Enter a month as YYYY-MM." })
    expect(closeAccountingPeriod("2026-01", "today", null)).toEqual({ ok: false, error: "Enter today as YYYY-MM-DD." })
  })

  it("refuses a today that is not a real calendar day", () => {
    expect(closeAccountingPeriod("2026-01", "2026-02-31", null)).toEqual({ ok: false, error: "Enter today as YYYY-MM-DD." })
    expect(closeAccountingPeriod("2024-02", "2024-02-29", null)).toEqual({ ok: false, error: "Close a completed month. The current month stays open." })
    expect(closeAccountingPeriod("2026-01", "2026-04-01", "2026-01-30")).toEqual({ ok: true, lockDate: "2026-01-31" })
  })

  it("requires a reason only when the lock moves earlier or is cleared", () => {
    expect(lockChangeIsReopen("2026-03-31", "")).toBe(true)
    expect(lockChangeIsReopen("2026-03-31", "2026-01-31")).toBe(true)
    expect(lockChangeIsReopen("2026-01-31", "2026-03-31")).toBe(false)
    expect(lockChangeIsReopen("", "2026-01-31")).toBe(false)
    expect(lockChangeIsReopen("2026-01-31", "2026-01-31")).toBe(false)
    expect(reopenReason("  Bank statement arrived late  ")).toEqual({ ok: true, reason: "Bank statement arrived late" })
    expect(reopenReason("   ").ok).toBe(false)
    expect(reopenReason("x".repeat(201)).ok).toBe(false)
  })

  it("does not treat an impossible lock date as a completed close", () => {
    expect(closeAccountingPeriod("2026-03", "2026-04-01", "not-a-date")).toEqual({ ok: false, error: "The current lock date is not a calendar day." })
    expect(closeAccountingPeriod("2026-01", "2026-04-01", "2026-02-31")).toEqual({ ok: false, error: "The current lock date is not a calendar day." })
    expect(closeAccountingPeriod("2026-02", "2026-03-01", "")).toEqual({ ok: true, lockDate: "2026-02-28" })
  })
})
