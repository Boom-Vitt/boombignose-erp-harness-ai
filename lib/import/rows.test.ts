import { deflateRawSync } from "node:zlib"
import { describe, expect, it } from "vitest"
import { parseCsv, parseXlsx } from "./sheet"
import { validateImport } from "./rows"

describe("spreadsheet import", () => {
  it("reads Thai customer headers from CSV, including a quoted comma", () => {
    const grid = parseCsv("ชื่อ,เลขผู้เสียภาษี,ที่อยู่,โทร,อีเมล\nร้านทดสอบ,1234567890123,\"12, ถนนสุขุมวิท\",0812345678,shop@example.invalid\n,,ที่อยู่,\n")
    const result = validateImport("customers", grid)
    expect(result.errors).toEqual([{ row: 3, message: "ชื่อ is required and must be 200 characters or fewer." }])
    expect(result.customers).toEqual([{
      name: "ร้านทดสอบ",
      taxId: "1234567890123",
      address: "12, ถนนสุขุมวิท",
      phone: "0812345678",
      email: "shop@example.invalid",
    }])
  })

  it("reads a product sheet from a minimal xlsx workbook", () => {
    const sheet = `<?xml version="1.0" encoding="UTF-8"?>
<worksheet><sheetData>
<row r="1"><c r="A1" t="inlineStr"><is><t>รหัส</t></is></c><c r="B1" t="inlineStr"><is><t>ชื่อ</t></is></c><c r="C1" t="inlineStr"><is><t>ราคา</t></is></c><c r="D1" t="inlineStr"><is><t>ประเภท</t></is></c><c r="E1" t="inlineStr"><is><t>ภาษี</t></is></c></row>
<row r="2"><c r="A2" t="inlineStr"><is><t>RICE</t></is></c><c r="B2" t="inlineStr"><is><t>ข้าวสาร</t></is></c><c r="C2"><v>50.5</v></c><c r="D2" t="inlineStr"><is><t>สินค้า</t></is></c><c r="E2"><v>7</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>RICE</t></is></c><c r="B3" t="inlineStr"><is><t>ซ้ำ</t></is></c></row>
</sheetData></worksheet>`
    const result = validateImport("products", parseXlsx(xlsx({ "xl/worksheets/sheet1.xml": sheet })))
    expect(result.products[0]).toMatchObject({ sku: "RICE", name: "ข้าวสาร", priceSatang: 5050, type: "goods", stockable: true, taxRateBps: 700 })
    expect(result.errors).toEqual([{ row: 3, message: "รหัส is repeated in this file." }])
  })

  it("requires a quantity and a unit cost for opening stock", () => {
    const grid = parseCsv("รหัส;จำนวน;ต้นทุนต่อหน่วย\nRICE;1.5;10\nRICE;2;10\nNONE;;\n")
    const result = validateImport("opening-stock", grid)
    expect(result.stock).toEqual([{ sku: "RICE", quantity: "1.5", unitCostSatang: 1000 }])
    expect(result.errors.map((error) => error.message)).toEqual([
      "รหัส is repeated in this file.",
      "จำนวน must be greater than zero with at most three decimals.",
      "ต้นทุนต่อหน่วย is required.",
    ])
  })
})

function xlsx(files: Record<string, string>): Buffer {
  const parts: Buffer[] = []
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8")
    const compressed = deflateRawSync(data)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(8, 8)
    header.writeUInt32LE(compressed.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(Buffer.byteLength(name), 26)
    parts.push(header, Buffer.from(name, "utf8"), compressed)
  }
  return Buffer.concat(parts)
}
