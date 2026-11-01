import { describe, expect, it } from "vitest"
import { FILING_LEAD_EN, FILING_LEAD_TH, FILING_LIMIT_EN, FILING_LIMIT_TH, FILING_PARTIES } from "@/lib/finance/filing-responsibility"

describe("filing responsibility copy", () => {
  it("names BoomBigNose, the accountant, and the Revenue Department in Thai and English", () => {
    expect(FILING_LEAD_TH).toContain("ปิดงบปฏิบัติการได้สบายๆ")
    expect(FILING_LEAD_EN).toContain("accountant")
    expect(FILING_PARTIES.map(party => party.en).join(" ")).toContain("Revenue Department")
    expect(FILING_PARTIES.map(party => party.th).join(" ")).toContain("กรมสรรพากร")
    expect(FILING_LIMIT_TH).toContain("ไม่ยื่นแบบ ภ.พ.30")
    expect(FILING_LIMIT_EN).toContain("does not file")
    expect(FILING_LIMIT_EN).not.toMatch(/e-Tax Invoice/)
    expect(`${FILING_LIMIT_TH} ${FILING_LIMIT_EN}`).not.toMatch(/ยื่นแบบสำเร็จ|filed successfully/)
  })
})
