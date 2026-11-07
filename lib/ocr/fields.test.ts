import { describe, expect, it } from "vitest"
import { parseOcrFields, printedDate, printedMoneySatang, reviewOcrFields } from "./fields"

describe("printed THB and date boundaries", () => {
  it("converts valid printed amounts exactly to integer satang, including zero VAT", () => {
    expect(printedMoneySatang("฿1,284.50")).toBe(128450)
    expect(printedMoneySatang("84.03 บาท")).toBe(8403)
    expect(printedMoneySatang("0.00")).toBe(0)
    expect(printedMoneySatang("THB 12.3")).toBe(1230)
    expect(printedMoneySatang("๑,๒๘๔.๕๐ บาท")).toBe(128450)
  })
  it("rejects plausible malformed amounts instead of stripping or rounding", () => {
    for (const value of ["12.345", "1,28.50", "1 234", "1,234,56", "1e3", "+12.30", "-2", "12..3", "12.00 USD", "NaN", "", "90071992547409.92", 12.345, null]) expect(printedMoneySatang(value)).toBeNull()
  })
  it("normalizes explicit BE dates but leaves ambiguous order and impossible dates unknown", () => {
    expect(printedDate("31/10/2569")).toBe("2026-10-31")
    expect(printedDate("2026-11-06")).toBe("2026-11-06")
    expect(printedDate("06/11/2569")).toBe("2026-11-06")
    expect(printedDate("๓๑/๑๐/๒๕๖๙")).toBe("2026-10-31")
    for (const value of ["06/11/2026", "2026-02-30", "31/04/2569", "11/31/2026", "2026-13-01", "01/01/99", null]) expect(printedDate(value)).toBeNull()
  })
  it("keeps correctly quoted Thai month dates from actual OCR, including Thai numerals", () => {
    for (const date of ["6 พฤศจิกายน 2569", "๖ พฤศจิกายน ๒๕๖๙", "6 พฤศจิกายน 2026"]) {
      expect(printedDate(date)).toBe("2026-11-06")
      const result = parseOcrFields(JSON.stringify({ date }), `วันที่ ${date}`)
      expect(result.fields.date).toBe("2026-11-06")
    }
    expect(printedDate("29 กุมภาพันธ์ 2567")).toBe("2024-02-29")
    for (const date of ["29 กุมภาพันธ์ 2569", "31 เมษายน 2569", "6 พฤศิกายน 2569", "6 พฤศจิกายน 69", "0 พฤศจิกายน 2569"]) {
      expect(printedDate(date)).toBeNull()
    }
    expect(parseOcrFields('{"date":"2026-11-06"}', "วันที่ 6 พฤศจิกายน 2569").fields.date).toBeNull()
  })
})

describe("separate structured review suggestions", () => {
  const source = "ร้านสมชาย\nINV-01\n2026-10-28\nปูน 4 ถุง\nSubtotal 1,200.00\nVAT 84.00\nTotal 1,284.00"
  const raw = { vendor: "ร้านสมชาย", documentNumber: "INV-01", date: "2026-10-28", description: "ปูน 4 ถุง", subtotal: "1,200.00", vat: "84.00", total: "1,284.00" }
  it("accepts only quoted source values and returns no IDs, quantities, posting status or confidence", () => {
    const result = parseOcrFields(JSON.stringify({ ...raw, purchase_order_id: "invented", quantity: 4, confidence: 0.99 }), source)
    expect(result.fields).toEqual({ vendor: "ร้านสมชาย", documentNumber: "INV-01", date: "2026-10-28", description: "ปูน 4 ถุง", subtotalSatang: 120000, vatSatang: 8400, totalSatang: 128400 })
    expect(result.warnings.join(" ")).toMatch(/not calculated or certified/)
  })
  it("rejects hallucinated values even if they look plausible", () => {
    const result = parseOcrFields(JSON.stringify({ ...raw, vendor: "Another shop", total: "1284.00", date: "2026-10-29" }), source)
    expect(result.fields.vendor).toBeNull()
    expect(result.fields.totalSatang).toBeNull()
    expect(result.fields.date).toBeNull()
    expect(result.fields.vatSatang).toBeNull()
    expect(result.warnings.join(" ")).toMatch(/unsupported by the extracted source/)
  })
  it("does not round inconsistent VAT/subtotal arithmetic or infer a rate", () => {
    const result = parseOcrFields(JSON.stringify({ ...raw, subtotal: "1,200.01" }), source.replace("1,200.00", "1,200.01"))
    expect(result.fields.totalSatang).toBe(128400)
    expect(result.fields.subtotalSatang).toBeNull()
    expect(result.fields.vatSatang).toBeNull()
    expect(result.warnings.join(" ")).toMatch(/exactly in satang/)
  })
  it("preserves unknown rather than accepting structured prose or unreadable fields", () => {
    expect(Object.values(parseOcrFields("I cannot read it", source).fields).every(value => value === null)).toBe(true)
    expect(Object.values(parseOcrFields("null", source).fields).every(value => value === null)).toBe(true)
    expect(parseOcrFields('{"total":"12.345"}', "Total 12.345").fields.totalSatang).toBeNull()
  })
})

describe("explicit human review boundary", () => {
  const values = { vendor: "Shop", date: "2026-11-06", documentNumber: "INV-01", description: "Pens", subtotal: "100", vat: "7", total: "107" }
  it("cannot release even valid suggestions until the user acknowledges review", () => {
    expect(reviewOcrFields(values, false)).toEqual({ error: expect.stringMatching(/acknowledge review/) })
    expect(reviewOcrFields(values, true).fields).toMatchObject({ totalSatang: 10700, vatSatang: 700, subtotalSatang: 10000 })
  })
  it("revalidates human edits rather than rounding or trusting a previous model pass", () => {
    for (const change of [{ total: "107.001" }, { vat: "108" }, { subtotal: "100.01" }, { date: "2026-02-30" }, { total: "0" }]) expect(reviewOcrFields({ ...values, ...change }, true).error).toBeTruthy()
    const unknown = reviewOcrFields({ vendor: "", date: "", documentNumber: "", description: "", total: "", vat: "", subtotal: "" }, true)
    expect(Object.values(unknown.fields!).every(value => value === null)).toBe(true)
  })
  it("does not turn foreign currency, unreadable labels or numerical JSON into THB suggestions", () => {
    expect(parseOcrFields('{"total":"107.00"}', "Total USD 107.00").fields.totalSatang).toBeNull()
    expect(parseOcrFields('{"vendor":"[unreadable]"}', "[unreadable]").fields.vendor).toBeNull()
    expect(parseOcrFields('{"total":107}', "Total 107").fields.totalSatang).toBeNull()
  })
})
