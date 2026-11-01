import { describe, expect, it } from "vitest"
import { CLOSE_ACTIVITY_CHAIN_EN, CLOSE_ACTIVITY_DISCLAIMER_EN, CLOSE_ACTIVITY_LEGACY_EN, closeActivityCsv, closeActivityView, isCloseAuditAction } from "@/lib/finance/close-activity"
import { readReopenRequests, readStoredSupportExport } from "@/lib/finance/reopen-request"

describe("close activity fields", () => {
  it("shows the previous date, the reason, and the export checksum as fields", () => {
    const reopen = closeActivityView("finance_lock_reopened", {
      previousLockDate: "2026-03-31",
      lockDate: "2026-01-31",
      reason: "Bank statement arrived late",
      kind: "operational_lock",
    })
    expect(reopen.actionLabel).toContain("เปิดงวดใหม่")
    expect(reopen.previousLockDate).toContain("2026-03-31")
    expect(reopen.previousLockDate).toContain("2569")
    expect(reopen.reason).toBe("Bank statement arrived late")
    expect(reopen.control).toBe("คนเดียว / one owner or admin")
    expect(closeActivityView("finance_lock_reopened", { reason: "Correction", requestedBy: "a", confirmedBy: "b" }).control).toContain("second owner or admin")
    expect(closeActivityView("finance_lock_reopened", {}).control).toContain("older command")
    expect(reopen.kind).toBeNull()

    const exported = closeActivityView("support_exported", {
      sha256: "ab".repeat(32),
      period: "2026-01",
      bytes: 12,
      kind: "accountant_pack_csv",
    })
    expect(exported.sha256).toBe("ab".repeat(32))
    expect(exported.period).toBe("2026-01")
    expect(exported.bytes).toBe(12)
    expect(exported.kind).toBe("accountant_pack_csv")
    expect(isCloseAuditAction("support_exported")).toBe(true)
    expect(isCloseAuditAction("invoice_issued")).toBe(false)
  })
})

describe("close activity export", () => {
  it("exports the existing rows in a stable order and does not claim a filing", () => {
    const csv = closeActivityCsv([
      { id: "b", createdAt: "2026-02-01T00:00:00Z", actorEmail: "owner@example.invalid", action: "finance_lock_reopened", summary: "Reopened the finance lock", meta: {}, chainSeq: 2, chainPrev: "aa", chainSha256: "bb" },
      { id: "a", createdAt: "2026-02-01T00:00:00Z", actorEmail: null, action: "period_closed", summary: "Closed operational month 2026-01", meta: { month: "2026-01", lockDate: "2026-01-31", kind: "operational_close" }, chainSeq: 1, chainPrev: "", chainSha256: "aa" },
    ], "2026-11-01")
    expect(csv).toContain(CLOSE_ACTIVITY_DISCLAIMER_EN)
    expect(csv).toContain(CLOSE_ACTIVITY_LEGACY_EN)
    expect(csv).toContain(CLOSE_ACTIVITY_CHAIN_EN)
    expect(csv).toContain("older command, no reason recorded")
    expect(csv.indexOf(",a,")).toBeGreaterThan(csv.indexOf(",b,"))
    expect(csv).toContain("2026-01-31")
    expect(csv).not.toMatch(/ยื่นแบบสำเร็จ|e-Tax Invoice|filed successfully/)
  })
})

describe("reopen request reads", () => {
  it("keeps a complete pending request and drops a row without a reason", () => {
    const requests = readReopenRequests([
      { id: "req-1", requestedBy: "user-1", requesterEmail: "owner@example.invalid", lockDate: null, previousLockDate: "2026-01-31", reason: "Correction", createdAt: "2026-02-01T00:00:00Z" },
      { id: "req-2", requestedBy: "user-1", reason: "", createdAt: "2026-02-01T00:00:00Z" },
    ])
    expect(requests).toEqual([
      { id: "req-1", requestedBy: "user-1", requesterEmail: "owner@example.invalid", lockDate: null, previousLockDate: "2026-01-31", reason: "Correction", createdAt: "2026-02-01T00:00:00Z" },
    ])
    expect(readReopenRequests({ id: "nope" })).toEqual([])
  })

  it("reads a stored export checksum", () => {
    expect(readStoredSupportExport({ sha256: "ab".repeat(32), kind: "outstanding_pack_csv", period: "2026-01-31", bytes: 8, summary: "Exported" })).toMatchObject({ bytes: 8, period: "2026-01-31" })
    expect(readStoredSupportExport(null)).toBeNull()
  })
})
