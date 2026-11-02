import { describe, expect, it } from "vitest"
import { assembleAccountantPack, accountantPackCsv, type PackInvoiceRow, type PackPurchaseLine, type PackPurchaseWht } from "@/lib/finance/accountant-pack"
import { sha256Utf8 } from "@/lib/finance/export-integrity"
import { buildVatReport, rollAbbDaily, vatReportCsv, VAT_REPORT_DISCLAIMER_EN, VAT_REPORT_DISCLAIMER_TH } from "@/lib/finance/vat-report"
import { buildWhtReport, whtReportCsv, WHT_REPORT_DISCLAIMER_EN, WHT_REPORT_DISCLAIMER_TH } from "@/lib/finance/wht-report"

const inv = (patch: Partial<PackInvoiceRow>): PackInvoiceRow => ({
  id: "i", number: "TX-2026-000001", status: "sent", issueDate: "2026-10-02", clientId: "c", clientName: "ลูกค้า", clientTaxId: "0105555555555",
  totalSatang: 10700, vatSatang: 700, whtSatang: 0, ...patch,
})
const bill: PackPurchaseLine = { id: "b1", billDate: "2026-10-05", vendorName: "ร้านค้า", vendorTaxId: "0105111111111", reference: "B-1", kind: "bill", amountSatang: 107000, inputVatSatang: 7000, matched: true }
const wht = (patch: Partial<PackPurchaseWht>): PackPurchaseWht => ({
  id: "w1", costId: "b1", certificateNo: "WHT-2026-000001", paidOn: "2026-10-31", form: "pnd53", incomeType: "service_40_8", rateBps: 300,
  vendorName: "ร้านค้า", vendorTaxId: "0105111111111", baseSatang: 100000, whtSatang: 3000, ...patch,
})

function pack() {
  return assembleAccountantPack({
    orgName: "Fixture Co",
    month: "2026-10",
    invoices: [
      inv({}),
      inv({ id: "a1", number: "ABB-2026-000001", issueDate: "2026-10-03", totalSatang: 1070, vatSatang: 70 }),
      inv({ id: "a2", number: "ABB-2026-000002", issueDate: "2026-10-03", totalSatang: 2140, vatSatang: 140 }),
      inv({ id: "a3", number: "ABB-2026-000003", issueDate: "2026-10-04", totalSatang: 535, vatSatang: 35 }),
      inv({ id: "sep", number: "TX-2026-000000", issueDate: "2026-09-30" }),
    ],
    credits: [],
    purchaseLines: [bill],
    purchaseVat: [{ month: "2026-10-01", baseSatang: 100000, inputVatSatang: 7000 }],
    purchaseWithholdings: [
      wht({}),
      wht({ id: "w2", certificateNo: "WHT-2026-000002", form: "pnd3", vendorTaxId: null, baseSatang: 50000, whtSatang: 1500 }),
      wht({ id: "w3", certificateNo: "WHT-2026-000003", paidOn: "2026-11-01" }),
    ],
  })
}

describe("VAT support report", () => {
  it("rolls ABB into one row per day and keeps the pack totals to the satang", () => {
    const p = pack()
    const report = buildVatReport(p)
    const abb = report.output.filter((row) => row.kind === "abb_daily")
    expect(abb.map((row) => [row.date, row.documents, row.vatSatang])).toEqual([["2026-10-03", 2, 210], ["2026-10-04", 1, 35]])
    expect(abb[0]!.number).toBe("ABB-2026-000001 … ABB-2026-000002")
    expect(report.output.map((row) => row.kind)).toContain("invoice")
    expect(report.outputBaseSatang).toBe(p.outputBaseSatang)
    expect(report.outputVatSatang).toBe(p.outputVatSatang)
    expect(report.inputVatSatang).toBe(p.inputVatSatang)
    expect(report.netVatSatang).toBe(p.outputMinusInputVatSatang)
  })

  it("leaves a TX invoice as its own row", () => {
    expect(rollAbbDaily(pack().outputLines).filter((row) => row.kind === "invoice").map((row) => row.number)).toEqual(["TX-2026-000001"])
  })

  it("carries the not-a-filing disclaimer in both languages and a stable checksum", () => {
    const csv = vatReportCsv(buildVatReport(pack()))
    expect(csv).toContain(VAT_REPORT_DISCLAIMER_TH)
    expect(csv).toContain(VAT_REPORT_DISCLAIMER_EN)
    expect(VAT_REPORT_DISCLAIMER_EN).toMatch(/not a filing/i)
    expect(sha256Utf8(csv)).toBe(sha256Utf8(vatReportCsv(buildVatReport(pack()))))
    expect(sha256Utf8(csv)).toMatch(/^[a-f0-9]{64}$/)
  })
})

describe("purchase WHT lists", () => {
  it("splits ภ.ง.ด.3 and ภ.ง.ด.53, keeps only the month, and equals the pack total", () => {
    const p = pack()
    const report = buildWhtReport(p)
    expect(report.lists.map((list) => [list.form, list.rows.length, list.whtSatang])).toEqual([["pnd3", 1, 1500], ["pnd53", 1, 3000]])
    expect(report.whtSatang).toBe(p.purchaseWhtSatang)
    expect(report.whtSatang).toBe(4500)
    expect(report.lists[0]!.missingTaxId).toBe(1)
  })

  it("exports one form only on request", () => {
    expect(buildWhtReport(pack(), "pnd53").lists.map((list) => list.form)).toEqual(["pnd53"])
  })

  it("exports with the disclaimer and flags a missing payee tax ID", () => {
    const csv = whtReportCsv(buildWhtReport(pack()))
    expect(csv).toContain(WHT_REPORT_DISCLAIMER_TH)
    expect(csv).toContain(WHT_REPORT_DISCLAIMER_EN)
    expect(csv).toContain("Payee tax ID missing")
    expect(csv).toContain("WHT-2026-000001")
    expect(csv).not.toContain("WHT-2026-000003")
  })

  it("reconciles with the accountant pack CSV", () => {
    const p = pack()
    const csv = accountantPackCsv(p)
    expect(csv).toContain("purchase_wht")
    expect(csv).toContain("WHT-2026-000002")
    expect(p.purchaseWht).toHaveLength(2)
  })
})
