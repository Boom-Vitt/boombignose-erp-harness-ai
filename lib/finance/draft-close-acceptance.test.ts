import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { DRAFT_CLOSE_ACCEPTANCE_EN, DRAFT_CLOSE_ACCEPTANCE_TH, draftCloseAcceptance, draftCloseFiguresPayload, draftCloseFiguresSha256 } from "@/lib/finance/draft-close-acceptance"
import type { TrialBalance } from "@/lib/finance/trial-balance"

const balance: TrialBalance = {
  rows: [
    { code: "1110", nameTh: "เงินสด", nameEn: "Cash", kind: "asset", debitSatang: 5700, creditSatang: 0 },
    { code: "4100", nameTh: "รายได้จากการขาย", nameEn: "Sales", kind: "income", debitSatang: 0, creditSatang: 10700 },
  ],
  debitSatang: 5700,
  creditSatang: 5700,
  balanced: true,
  lineCount: 4,
}

describe("draft close acceptance", () => {
  it("accepts a balanced trial balance inside the lock and names the figures", () => {
    const payload = draftCloseFiguresPayload("2026-01-31", balance)
    expect(payload).toBe([
      "v1",
      "2026-01-31",
      "1110 5700 0\n4100 0 10700",
      "5700",
      "5700",
      "4",
    ].join("\n"))
    expect(draftCloseFiguresSha256(payload)).toBe("0d81d438d9aa57c10218f99424be58d9ccd7ebe7836f7ed732bf0922a74b6722")
    const result = draftCloseAcceptance("2026-01-31", "2026-01-31", balance)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.figures.sha256).toBe(draftCloseFiguresSha256(payload))
    expect(result.figures.debitSatang).toBe(5700)
  })

  it("refuses an open period and a trial balance that does not balance", () => {
    expect(draftCloseAcceptance(null, "2026-01-31", balance)).toEqual({ ok: false, error: "Accept a draft close only inside a locked period." })
    expect(draftCloseAcceptance("2026-01-31", null, balance)).toEqual({ ok: false, error: "Accept a draft close only inside a locked period." })
    expect(draftCloseAcceptance("2026-01-15", "2026-01-31", balance)).toEqual({ ok: false, error: "Accept a draft close only inside a locked period." })
    expect(draftCloseAcceptance("2026-01-31", "2026-01-31", { ...balance, balanced: false, creditSatang: 5000 })).toEqual({ ok: false, error: "Accept a trial balance only when debits equal credits." })
  })

  it("does not call the acceptance a statutory sign-off or a filing", () => {
    const copy = `${DRAFT_CLOSE_ACCEPTANCE_TH} ${DRAFT_CLOSE_ACCEPTANCE_EN}`
    expect(copy).toContain("ไม่ใช่การยื่นแบบ ภ.พ.30")
    expect(copy).toContain("not a statutory sign-off")
    expect(copy).toContain("Purchases and expenses")
    expect(copy).not.toMatch(/ยื่นแบบสำเร็จ|e-Tax Invoice/)
    const sql = readFileSync("supabase/migrations/20261101230000_draft_close_acceptance.sql", "utf8")
    expect(sql).toContain("Accept a draft close only inside a locked period.")
    expect(sql).toContain("Accept a trial balance only when debits equal credits.")
    expect(sql).toContain("A different owner, admin, or accountant must confirm this acceptance.")
    expect(sql).toContain("Not a statutory sign-off")
    expect(sql).toContain("draft_close_accepted")
  })
})
