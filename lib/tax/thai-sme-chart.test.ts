import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { THAI_SME_CHART } from "@/lib/tax/thai-sme-chart"

describe("THAI_SME_CHART", () => {
  it("uses one four-digit code per account and only the five kinds", () => {
    const kinds = new Set(["asset", "liability", "equity", "income", "expense"])
    expect(new Set(THAI_SME_CHART.map(account => account.code)).size).toBe(THAI_SME_CHART.length)
    for (const account of THAI_SME_CHART) {
      expect(account.code).toMatch(/^[0-9]{4}$/)
      expect(kinds.has(account.kind)).toBe(true)
      expect(account.nameTh.trim()).not.toBe("")
      expect(account.nameEn.trim()).not.toBe("")
    }
  })

  it("is the chart the migration inserts, without deleting custom codes", () => {
    const sql = [
      readFileSync("supabase/migrations/20261028120100_thai_sme_chart.sql", "utf8"),
      readFileSync("supabase/migrations/20261101220000_customer_deposit_account.sql", "utf8"),
    ].join("\n")
    expect(sql).toContain("where not exists")
    expect(sql).not.toMatch(/delete\s+from\s+public\.gl_accounts/i)
    for (const account of THAI_SME_CHART) {
      expect(sql).toContain(`'${account.code}','${account.nameTh}','${account.nameEn}','${account.kind}'`)
    }
  })
})
