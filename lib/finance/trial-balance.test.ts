import { describe, expect, it } from "vitest"
import { TRIAL_BALANCE_LIMIT_EN, TRIAL_BALANCE_LIMIT_TH, trialBalance, trialBalanceThrough } from "@/lib/finance/trial-balance"

const accounts = [
  { code: "1110", nameTh: "เงินสด", nameEn: "Cash", kind: "asset" },
  { code: "4100", nameTh: "รายได้จากการขาย", nameEn: "Sales", kind: "income" },
  { code: "6100", nameTh: "ค่าใช้จ่ายในการดำเนินงาน", nameEn: "Operating expense", kind: "expense" },
]

const sale = [
  { entryDate: "2026-01-15", accountCode: "1110", debitSatang: 10700, creditSatang: 0 },
  { entryDate: "2026-01-15", accountCode: "4100", debitSatang: 0, creditSatang: 10700 },
]

describe("trial balance", () => {
  it("nets draft lines onto one side and keeps the totals equal", () => {
    const result = trialBalance([
      ...sale,
      { entryDate: "2026-01-20", accountCode: "6100", debitSatang: 5000, creditSatang: 0 },
      { entryDate: "2026-01-20", accountCode: "1110", debitSatang: 0, creditSatang: 5000 },
    ], accounts, "2026-01-31")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.balance.rows).toEqual([
      { code: "1110", nameTh: "เงินสด", nameEn: "Cash", kind: "asset", debitSatang: 5700, creditSatang: 0 },
      { code: "4100", nameTh: "รายได้จากการขาย", nameEn: "Sales", kind: "income", debitSatang: 0, creditSatang: 10700 },
      { code: "6100", nameTh: "ค่าใช้จ่ายในการดำเนินงาน", nameEn: "Operating expense", kind: "expense", debitSatang: 5000, creditSatang: 0 },
    ])
    expect(result.balance.debitSatang).toBe(10700)
    expect(result.balance.creditSatang).toBe(10700)
    expect(result.balance.balanced).toBe(true)
    expect(result.balance.lineCount).toBe(4)
  })

  it("leaves out lines after the through date and a fully reversed account", () => {
    const result = trialBalance([
      ...sale,
      { entryDate: "2026-02-01", accountCode: "6100", debitSatang: 5000, creditSatang: 0 },
      { entryDate: "2026-02-01", accountCode: "1110", debitSatang: 0, creditSatang: 5000 },
      { entryDate: "2026-01-15", accountCode: "1110", debitSatang: 0, creditSatang: 100 },
      { entryDate: "2026-01-15", accountCode: "1110", debitSatang: 100, creditSatang: 0 },
    ], accounts, "2026-01-31")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.balance.rows.map(row => row.code)).toEqual(["1110", "4100"])
    expect(result.balance.rows[0]?.debitSatang).toBe(10700)
    expect(result.balance.lineCount).toBe(4)
    expect(trialBalance(sale, accounts, null).ok).toBe(true)
  })

  it("shows a broken set instead of hiding it", () => {
    const result = trialBalance([
      { entryDate: "2026-01-15", accountCode: "1110", debitSatang: 100, creditSatang: 0 },
      { entryDate: "2026-01-15", accountCode: "4100", debitSatang: 0, creditSatang: 90 },
    ], accounts, null)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.balance.balanced).toBe(false)
    expect(result.balance.debitSatang).toBe(100)
    expect(result.balance.creditSatang).toBe(90)
  })

  it("refuses a bad date and an unsafe amount", () => {
    expect(trialBalance(sale, accounts, "January")).toEqual({ ok: false, error: "Enter a trial balance date." })
    expect(trialBalance([{ ...sale[0]!, entryDate: "2026-02-31" }, sale[1]!], accounts, null)).toEqual({ ok: false, error: "A journal date on this trial balance is not a calendar date." })
    expect(trialBalance([{ ...sale[0]!, debitSatang: 1.5 }, sale[1]!], accounts, null)).toEqual({ ok: false, error: "Journal line amount must be integer satang." })
    expect(trialBalanceThrough(undefined, "2026-01-31")).toEqual({ ok: true, through: "2026-01-31" })
    expect(trialBalanceThrough("all", "2026-01-31")).toEqual({ ok: true, through: null })
    expect(trialBalanceThrough("2026-01-15", null)).toEqual({ ok: true, through: "2026-01-15" })
    expect(trialBalanceThrough("soon", null)).toEqual({ ok: false, error: "Enter a trial balance date." })
  })

  it("does not call the trial balance signed statutory books or a filing", () => {
    const copy = `${TRIAL_BALANCE_LIMIT_TH} ${TRIAL_BALANCE_LIMIT_EN}`
    expect(copy).toContain("ไม่ใช่การยื่นแบบ ภ.พ.30")
    expect(copy).toContain("not signed statutory books")
    expect(copy).not.toMatch(/ยื่นแบบสำเร็จ|e-Tax Invoice|filed successfully/)
  })
})
