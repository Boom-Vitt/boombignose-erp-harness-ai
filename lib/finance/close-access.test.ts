import { describe, expect, it } from "vitest"
import { canReviewFinanceClose } from "@/lib/finance/close-access"

describe("canReviewFinanceClose", () => {
  it("allows owners, admins, and an accountant, and refuses a member", () => {
    expect(canReviewFinanceClose("owner")).toBe(true)
    expect(canReviewFinanceClose("admin")).toBe(true)
    expect(canReviewFinanceClose("accountant")).toBe(true)
    expect(canReviewFinanceClose("member")).toBe(false)
    expect(canReviewFinanceClose("")).toBe(false)
  })
})
