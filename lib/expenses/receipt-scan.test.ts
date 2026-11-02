import { describe, expect, it } from "vitest"
import { ExpenseLineInput } from "./schema"
import { parseReceiptDraft } from "./receipt-scan"

// Golden = what a correct read of each bill must produce. Replies are shaped like qwen2.5vl output (plain, fenced, Thai/BE dates).
const golden = [
  { reply: '{"vendor":"ร้านวัสดุก่อสร้างสมชาย","date":"2026-10-28","total":1284.5,"vat":84.03,"items":"ปูน 4 ถุง"}', want: { vendor: "ร้านวัสดุก่อสร้างสมชาย", spent_on: "2026-10-28", amountBaht: "1284.50", vatBaht: "84.03" } },
  { reply: 'Here you go:\n```json\n{"vendor":"7-Eleven","date":"31/10/2569","total":"฿1,052.00","vat":null,"items":""}\n```', want: { vendor: "7-Eleven", spent_on: "2026-10-31", amountBaht: "1052.00", vatBaht: null } },
  { reply: '{"vendor":"Grab","date":"2026-11-01","total":"250","vat":"16.36","items":"Taxi"}', want: { vendor: "Grab", spent_on: "2026-11-01", amountBaht: "250.00", vatBaht: "16.36" } },
]

describe("parseReceiptDraft", () => {
  it("matches the golden fixtures on every field (≥80% required)", () => {
    let hit = 0, total = 0
    for (const { reply, want } of golden) {
      const got = parseReceiptDraft(reply)
      for (const [k, v] of Object.entries(want)) { total++; if (got?.[k as keyof typeof want] === v) hit++ }
    }
    expect(hit / total).toBeGreaterThanOrEqual(0.8)
    expect(hit).toBe(total)
  })

  it("yields values the expense line schema accepts, and nothing else (no posting fields)", () => {
    const draft = parseReceiptDraft(golden[0].reply)!
    expect(Object.keys(draft).sort()).toEqual(["amountBaht", "description", "spent_on", "vatBaht", "vendor"])
    const line = ExpenseLineInput.safeParse({ claim_id: "7f9c24e8-3b4a-4f6e-9c1d-0a1b2c3d4e5f", spent_on: draft.spent_on, category: "other", description: draft.description, amountBaht: draft.amountBaht, project_id: "" })
    expect(line.success && line.data.amount_satang).toBe(128450)
  })

  it("returns null for guesses: missing total, bad date, zero, non-JSON", () => {
    for (const bad of ['{"vendor":"x","date":"2026-10-28","total":null}', '{"vendor":"x","date":"2026-02-30","total":10}', '{"vendor":"x","date":"2026-10-28","total":0}', "I cannot read this image", '{"date":"2026-10-28","total":5}'])
      expect(parseReceiptDraft(bad)).toBeNull()
  })
})
