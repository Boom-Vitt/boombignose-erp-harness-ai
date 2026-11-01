import { describe, expect, it } from "vitest"
import { SUPPORT_REVIEW_MARK_EN, SUPPORT_REVIEW_MARK_TH, reviewedChecksums } from "@/lib/finance/support-review"

const hash = "ab".repeat(32)

describe("support pack review mark", () => {
  it("counts only this person's review of a stored checksum", () => {
    const mine = reviewedChecksums([
      { action: "support_exported", actorId: "me", sha256: hash },
      { action: "support_pack_reviewed", actorId: "me", sha256: hash },
      { action: "support_pack_reviewed", actorId: "other", sha256: "cd".repeat(32) },
    ], "me")
    expect([...mine]).toEqual([hash])
    expect(reviewedChecksums([{ action: "support_pack_reviewed", actorId: "other", sha256: hash }], "me").size).toBe(0)
  })

  it("does not call the mark a statutory sign-off or a filing", () => {
    const copy = `${SUPPORT_REVIEW_MARK_TH} ${SUPPORT_REVIEW_MARK_EN}`
    expect(copy).toContain("ไม่ใช่การยื่นแบบ ภ.พ.30")
    expect(copy).toContain("not a statutory sign-off")
    expect(copy).not.toMatch(/ยื่นแบบสำเร็จ|e-Tax Invoice|filed successfully/)
  })
})
