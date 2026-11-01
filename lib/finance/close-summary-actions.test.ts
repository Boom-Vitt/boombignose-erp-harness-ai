import { beforeEach, expect, it, vi } from "vitest"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"

vi.mock("server-only", () => ({}))

const { AINotConfiguredError, createClient, generateText, isAIConfigured } = vi.hoisted(() => {
  class AINotConfiguredError extends Error {}
  return {
    AINotConfiguredError,
    createClient: vi.fn(),
    generateText: vi.fn(),
    isAIConfigured: vi.fn(() => true),
  }
})

vi.mock("@/lib/supabase/server", () => ({ createClient }))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => ({ orgId: "org-1", userId: "user-1", role: "owner" }),
}))
vi.mock("@/lib/ai/client", () => ({
  generateText,
  isAIConfigured,
  AINotConfiguredError,
}))

import { summarizeMonthEnd } from "@/app/(app)/finance/close-summary-actions"

const tables = {
  invoices: [
    { id: "overdue", org_id: "org-1", status: "sent", amount_satang: 10_000, due_date: "2020-01-01" },
    { id: "paid", org_id: "org-1", status: "sent", amount_satang: 5_000, due_date: "2020-01-01" },
    { id: "other", org_id: "org-2", status: "sent", amount_satang: 99_000, due_date: "2020-01-01" },
  ],
  invoice_balances: [
    { invoice_id: "overdue", org_id: "org-1", paid_satang: 2_000, credited_satang: 1_000 },
    { invoice_id: "paid", org_id: "org-1", paid_satang: 5_000, credited_satang: 0 },
  ],
  costs: [
    { id: "bill", org_id: "org-1", vendor_id: "vendor", paid_at: null, amount_satang: 4_000 },
    { id: "paid-bill", org_id: "org-1", vendor_id: "vendor", paid_at: "2026-01-01", amount_satang: 8_000 },
    { id: "other-bill", org_id: "org-2", vendor_id: "vendor", paid_at: null, amount_satang: 50_000 },
  ],
  bank_lines: [
    { id: "open", org_id: "org-1", matched_payment_id: null },
    { id: "matched", org_id: "org-1", matched_payment_id: "receipt" },
    { id: "other-line", org_id: "org-2", matched_payment_id: null },
  ],
}

beforeEach(() => {
  createClient.mockReset()
  generateText.mockReset()
  isAIConfigured.mockReset()
  isAIConfigured.mockReturnValue(true)
  createClient.mockResolvedValue(databaseFixture(tables))
})

it("asks Ollama with this workspace's open-item counts", async () => {
  generateText.mockResolvedValue("เก็บลูกหนี้ก่อน")
  const result = await summarizeMonthEnd()
  expect(result).toMatchObject({
    content: "เก็บลูกหนี้ก่อน",
    counts: {
      overdueReceivableCount: 1,
      overdueReceivableSatang: 7_000,
      unpaidBillCount: 1,
      unpaidBillSatang: 4_000,
      unmatchedBankCount: 1,
    },
  })
  const prompt = String(generateText.mock.calls[0]?.[0]?.prompt)
  expect(prompt).toContain("Overdue receivables: 1")
  expect(prompt).toContain("70.00")
  expect(prompt).toContain("Unmatched bank lines: 1")
})

it("returns the counts when Ollama is down and does not call another model", async () => {
  generateText.mockRejectedValue(new AINotConfiguredError("down"))
  const down = await summarizeMonthEnd()
  expect(down).toMatchObject({ notConfigured: true, counts: { overdueReceivableCount: 1 } })
  expect(down).not.toHaveProperty("content")

  generateText.mockClear()
  isAIConfigured.mockReturnValue(false)
  const refused = await summarizeMonthEnd()
  expect(refused).toMatchObject({ notConfigured: true })
  expect(generateText).not.toHaveBeenCalled()
})

it("keeps this workspace's counts when Ollama returns no note", async () => {
  generateText.mockRejectedValue(new Error("boom"))
  const result = await summarizeMonthEnd()
  expect(result).toMatchObject({ counts: { overdueReceivableCount: 1, unmatchedBankCount: 1 } })
  expect(result).not.toHaveProperty("content")
  expect(result).not.toHaveProperty("notConfigured")
  if (!("error" in result) || !("counts" in result)) throw new Error("expected counts and an error")
  expect(result.error).toContain("Ollama ไม่ได้ส่งบันทึกกลับมา")
  expect(result.error).toContain("Ollama returned no note")
  expect(result.error).not.toMatch(/ภ\.พ\.30|e-Tax/)
})
