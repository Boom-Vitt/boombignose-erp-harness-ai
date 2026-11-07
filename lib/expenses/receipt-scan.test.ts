import { describe, expect, it } from "vitest"
import { emptyOcrFields } from "@/lib/ocr/contracts"
import { ExpenseLineInput } from "./schema"
import { reviewedReceiptDraft } from "./receipt-scan"

const fields = { ...emptyOcrFields(), vendor: "ร้านสมชาย", date: "2026-10-28", totalSatang: 128450, vatSatang: 8403, description: "ปูน 4 ถุง" }

describe("reviewed receipt form adapter", () => {
  it("prefills only editable expense values with exact integer-satang conversion", () => {
    const draft = reviewedReceiptDraft(fields)!
    expect(draft).toEqual({ vendor: "ร้านสมชาย", spent_on: "2026-10-28", amountBaht: "1284.50", vatBaht: "84.03", description: "ร้านสมชาย — ปูน 4 ถุง" })
    const line = ExpenseLineInput.parse({ claim_id: "7f9c24e8-3b4a-4f6e-9c1d-0a1b2c3d4e5f", spent_on: draft.spent_on, category: "other", description: draft.description, amountBaht: draft.amountBaht, project_id: "" })
    expect(line.amount_satang).toBe(128450)
    expect(draft).not.toHaveProperty("claim_id")
    expect(draft).not.toHaveProperty("approved")
    expect(draft).not.toHaveProperty("purchase_order_id")
  })
  it("leaves unknown, invalid or unsafe amounts/dates out of the form", () => {
    for (const change of [{ vendor: null }, { vendor: " " }, { date: null }, { date: "2026-02-30" }, { date: "03/04/2026" }, { totalSatang: null }, { totalSatang: 0 }, { totalSatang: 100.5 }, { totalSatang: Number.MAX_SAFE_INTEGER + 1 }, { vatSatang: 128451 }, { vatSatang: -1 }]) expect(reviewedReceiptDraft({ ...fields, ...change })).toBeNull()
    expect(reviewedReceiptDraft({ ...fields, vatSatang: 0 })?.vatBaht).toBe("0.00")
    expect(reviewedReceiptDraft({ ...fields, vatSatang: null })?.vatBaht).toBeNull()
  })
})
