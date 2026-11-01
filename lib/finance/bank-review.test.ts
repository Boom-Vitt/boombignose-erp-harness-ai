import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import type { BankCandidate } from "@/lib/finance/bank-match"
import { bankLineInQueue, bankLineStatus, classifyBankLines, parseBankQueue, summarizeBankClose, type BankLineInput } from "@/lib/finance/bank-review"

const receipt = (id: string, amount: number, reference: string | null, extra: Partial<BankCandidate> = {}): BankCandidate => ({
  id, amountSatang: amount, reference, verified: true, reversal: false, ...extra,
})

const line = (extra: Partial<BankLineInput> & Pick<BankLineInput, "id" | "amountSatang">): BankLineInput => ({
  bookedOn: "2026-10-15",
  reference: "REF",
  matchedPaymentId: null,
  closeNote: null,
  ...extra,
})

describe("bankLineStatus", () => {
  const payments = [receipt("a", 1000, "REF"), receipt("b", 1000, "REF"), receipt("c", 500, "ONE")]

  it("names a match, an explanation, one candidate, and a duplicate", () => {
    expect(bankLineStatus({ amountSatang: 1000, reference: "REF", matchedPaymentId: "a", closeNote: null }, payments, new Set(["a"]))).toEqual({ status: "matched", suggestedPaymentId: null })
    expect(bankLineStatus({ amountSatang: 1000, reference: "REF", matchedPaymentId: null, closeNote: "ค่าธรรมเนียม" }, payments, new Set())).toEqual({ status: "explained", suggestedPaymentId: null })
    expect(bankLineStatus({ amountSatang: 500, reference: "ONE", matchedPaymentId: null, closeNote: null }, payments, new Set())).toEqual({ status: "ready", suggestedPaymentId: "c" })
    expect(bankLineStatus({ amountSatang: 1000, reference: "REF", matchedPaymentId: null, closeNote: "  " }, payments, new Set())).toEqual({ status: "ambiguous", suggestedPaymentId: null })
  })

  it("leaves money in without a receipt unmatched, and money out as money out", () => {
    expect(bankLineStatus({ amountSatang: 700, reference: "NONE", matchedPaymentId: null, closeNote: null }, payments, new Set()).status).toBe("unmatched")
    expect(bankLineStatus({ amountSatang: -200, reference: "FEE", matchedPaymentId: null, closeNote: null }, payments, new Set()).status).toBe("money_out")
    expect(bankLineStatus({ amountSatang: -200, reference: "FEE", matchedPaymentId: null, closeNote: "bank fee" }, payments, new Set()).status).toBe("explained")
  })
})

describe("month-end bank queue", () => {
  const payments = [receipt("c", 500, "ONE")]
  const lines = classifyBankLines([
    line({ id: "open", amountSatang: 700, reference: "NONE" }),
    line({ id: "ready", amountSatang: 500, reference: "ONE" }),
    line({ id: "noted", amountSatang: -50, reference: "FEE", closeNote: "bank fee" }),
    line({ id: "matched", amountSatang: 500, reference: "OLD", matchedPaymentId: "taken" }),
    line({ id: "later", amountSatang: 900, reference: "NEXT", bookedOn: "2026-11-02" }),
  ], payments, "2026-10-31")

  it("keeps explained and matched lines out of the close queue and counts later lines apart", () => {
    const summary = summarizeBankClose(lines, "2026-10-31")
    expect(summary.openCount).toBe(2)
    expect(summary.openNetSatang).toBe(1200)
    expect(summary.readyCount).toBe(1)
    expect(summary.unmatchedCount).toBe(1)
    expect(summary.explainedCount).toBe(1)
    expect(summary.explainedNetSatang).toBe(-50)
    expect(summary.matchedCount).toBe(1)
    expect(summary.laterOpenCount).toBe(1)
    expect(lines.filter(row => bankLineInQueue(row, "open", "2026-10-31")).map(row => row.id)).toEqual(["open", "ready"])
    expect(lines.filter(row => bankLineInQueue(row, "explained", "2026-10-31")).map(row => row.id)).toEqual(["noted"])
    expect(parseBankQueue("later")).toBe("open")
    expect(parseBankQueue("matched")).toBe("matched")
  })

  it("does not guess a taken receipt", () => {
    const classified = classifyBankLines([
      line({ id: "first", amountSatang: 500, reference: "ONE", matchedPaymentId: "c" }),
      line({ id: "second", amountSatang: 500, reference: "ONE" }),
    ], payments, "2026-10-31")
    expect(classified.find(row => row.id === "second")?.status).toBe("unmatched")
  })
})

describe("bank line note migration", () => {
  it("lets staff record a close note and clears it when the line is matched", () => {
    const sql = readFileSync("supabase/migrations/20261101120100_bank_line_close_note.sql", "utf8")
    expect(sql).toContain("close_note")
    expect(sql).toContain("private.is_org_staff")
    expect(sql).toContain("role::text = 'accountant'")
    expect(sql).toContain("Matched bank line does not take a close note")
    expect(sql).toContain("new.close_note := null")
    expect(sql).not.toContain("create or replace function public.match_bank_line")
    expect(sql).toContain("grant execute on function public.note_bank_line(uuid, uuid, text) to authenticated")
  })
})
