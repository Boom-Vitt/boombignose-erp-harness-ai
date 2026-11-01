import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { TrialBalanceView } from "@/app/(app)/finance/journal/trial-balance-view"
import { trialBalance } from "@/lib/finance/trial-balance"

const accounts = [
  { code: "1110", nameTh: "เงินสด", nameEn: "Cash", kind: "asset" },
  { code: "4100", nameTh: "รายได้จากการขาย", nameEn: "Sales", kind: "income" },
]

describe("trial balance view", () => {
  it("shows the net lines, equal totals, and the limit on what this is", () => {
    const result = trialBalance([
      { entryDate: "2026-01-15", accountCode: "1110", debitSatang: 10700, creditSatang: 0 },
      { entryDate: "2026-01-15", accountCode: "4100", debitSatang: 0, creditSatang: 10700 },
    ], accounts, "2026-01-31")
    if (!result.ok) throw new Error(result.error)
    const html = renderToStaticMarkup(createElement(TrialBalanceView, { balance: result.balance, through: "2026-01-31", lockDate: "2026-01-31" }))
    expect(html).toContain("งบทดลองนี้รวมเฉพาะบันทึกรายวันฉบับร่าง")
    expect(html).toContain("not signed statutory books")
    expect(html).toContain("Issued invoices and receipts are not in these totals.")
    expect(html).toContain("1110")
    expect(html).toContain("เงินสด / Cash · asset")
    expect(html).toContain("฿107.00")
    expect(html).toContain("ยอดเดบิตเท่ากับยอดเครดิต")
    expect(html).toContain("2026-01-31 (31/01/2569)")
    expect(html).not.toMatch(/ยื่นแบบสำเร็จ|e-Tax Invoice/)
  })
})
