import { describe, expect, it } from "vitest"
import {
  ACCOUNTANT_PACK_DISCLAIMER_EN,
  ACCOUNTANT_PACK_DISCLAIMER_TH,
  VENDOR_WHT_NOTE,
  accountantPackCsv,
  accountantPackMonth,
  assembleAccountantPack,
  canDownloadAccountantPack,
  previousCalendarMonth,
  readStoredCreditSupport,
  renderAccountantPackHtml,
  type PackCreditRow,
  type PackInvoiceRow,
  type PackPurchaseLine,
  type PackPurchaseVatTotal,
} from "@/lib/finance/accountant-pack"

const invoice = (patch: Partial<PackInvoiceRow> = {}): PackInvoiceRow => ({
  id: "inv1",
  number: "INV-1",
  status: "sent",
  issueDate: "2026-10-02",
  clientId: "c1",
  clientName: "ลูกค้า",
  clientTaxId: "0105555555555",
  totalSatang: 10700,
  vatSatang: 700,
  whtSatang: 300,
  ...patch,
})

const credit = (patch: Partial<PackCreditRow> = {}): PackCreditRow => ({
  id: "cn1",
  number: "CN-1",
  issueDate: "2026-10-20",
  invoiceId: "old",
  clientId: "c1",
  clientName: "ลูกค้า",
  clientTaxId: "0105555555555",
  buyerName: "ลูกค้า",
  buyerTaxId: "0105555555555",
  baseSatang: 1000,
  vatSatang: 70,
  whtSatang: 30,
  originalNumber: "OLD",
  ...patch,
})

const bill = (patch: Partial<PackPurchaseLine> = {}): PackPurchaseLine => ({
  id: "bill",
  billDate: "2026-10-05",
  vendorName: "ร้านค้า",
  vendorTaxId: "111",
  reference: "BILL-1",
  kind: "bill",
  amountSatang: 1070,
  inputVatSatang: 70,
  matched: true,
  ...patch,
})

function pack() {
  const purchaseVat: PackPurchaseVatTotal[] = [
    { month: "2026-10-01", baseSatang: 800, inputVatSatang: 56 },
    { month: "2026-09-01", baseSatang: 1000, inputVatSatang: 70 },
  ]
  return assembleAccountantPack({
    orgName: "บริษัท <Acme>",
    month: "2026-10",
    invoices: [
      invoice(),
      invoice({ id: "inv2", number: "INV-2", issueDate: "2026-10-18", clientId: "c2", clientName: "=cmd|", clientTaxId: null, totalSatang: 5000, vatSatang: 0, whtSatang: 0 }),
      invoice({ id: "draft", number: "DRAFT", status: "draft", issueDate: "2026-10-18", vatSatang: 7, whtSatang: 1, totalSatang: 100 }),
      invoice({ id: "cancel", number: "CAN", status: "cancelled", issueDate: "2026-10-18", vatSatang: 9, whtSatang: 1, totalSatang: 100 }),
      invoice({ id: "old", number: "OLD", issueDate: "2026-09-30", vatSatang: 1400, whtSatang: 400, totalSatang: 21400 }),
    ],
    credits: [credit(), credit({ id: "cn-next", number: "CN-NEXT", issueDate: "2026-11-01", vatSatang: 7, whtSatang: 3, baseSatang: 100 })],
    purchaseLines: [
      bill(),
      bill({ id: "cn-v", billDate: "2026-10-22", reference: "VCN-1", kind: "credit", amountSatang: -214, inputVatSatang: -14 }),
      bill({ id: "loose", reference: "LOOSE", amountSatang: 2140, inputVatSatang: 140, matched: false }),
      bill({ id: "other-month", billDate: "2026-09-01", reference: "OLD-BILL" }),
    ],
    purchaseVat,
  })
}

describe("accountant pack assembly", () => {
  it("nets output VAT and withholding with credit notes and keeps matched purchase VAT", () => {
    const result = pack()
    expect(result.outputLines.map((row) => row.number)).toEqual(["INV-1", "INV-2", "CN-1"])
    expect(result.outputBaseSatang).toBe(14000)
    expect(result.outputVatSatang).toBe(630)
    expect(result.outputWhtSatang).toBe(270)
    expect(result.inputLines.map((row) => row.number)).toEqual(["BILL-1", "VCN-1"])
    expect(result.inputBaseSatang).toBe(800)
    expect(result.inputVatSatang).toBe(56)
    expect(result.outputMinusInputVatSatang).toBe(574)
    expect(result.whtParties).toEqual([
      { partyKind: "customer", partyId: "c1", partyName: "ลูกค้า", taxId: "0105555555555", baseSatang: 9000, whtSatang: 270, documentCount: 2 },
    ])
    expect(result.whtSatang).toBe(270)
    expect(result.buddhistMonth).toBe("10/2569")
  })

  it("refuses a purchase VAT total that disagrees with the matched bills", () => {
    expect(() => assembleAccountantPack({
      orgName: "Acme",
      month: "2026-10",
      invoices: [],
      credits: [],
      purchaseLines: [bill()],
      purchaseVat: [{ month: "2026-10-01", baseSatang: 1000, inputVatSatang: 71 }],
    })).toThrow("Matched vendor bills do not match the purchase VAT table for this month")
  })

  it("allows an empty month when the purchase VAT table is empty", () => {
    const result = assembleAccountantPack({ orgName: "Acme", month: "2026-02", invoices: [], credits: [], purchaseLines: [], purchaseVat: [] })
    expect(result.outputVatSatang).toBe(0)
    expect(result.inputVatSatang).toBe(0)
    expect(result.whtParties).toEqual([])
  })

  it("reads withholding and VAT stored on a credit note snapshot", () => {
    expect(readStoredCreditSupport({
      buyer: { name: " ลูกค้า ", taxId: " 010 " },
      originalNumber: "INV-9",
      document: { baseSatang: 1000, vatSatang: 70, whtSatang: 30 },
    })).toEqual({ buyerName: "ลูกค้า", buyerTaxId: "010", baseSatang: 1000, vatSatang: 70, whtSatang: 30, originalNumber: "INV-9" })
    expect(() => readStoredCreditSupport({ buyer: { name: "ลูกค้า" }, document: { baseSatang: 1.5, vatSatang: 0, whtSatang: 0 } })).toThrow("stored VAT or withholding")
    expect(() => readStoredCreditSupport({ buyer: { name: "ลูกค้า" }, document: { baseSatang: 100, vatSatang: 7, totalSatang: 200, whtSatang: 0 } })).toThrow("stored VAT or withholding")
  })

  it("labels the CSV and printable summary as support data", () => {
    const result = pack()
    const csv = accountantPackCsv(result)
    const html = renderAccountantPackHtml(result, "2026-11-01")
    expect(csv).toContain(ACCOUNTANT_PACK_DISCLAIMER_EN)
    expect(csv).toContain(ACCOUNTANT_PACK_DISCLAIMER_TH)
    expect(csv).toContain(VENDOR_WHT_NOTE)
    expect(csv).toContain("-0.70")
    expect(csv).not.toContain("'-0.70")
    expect(csv).toContain("'=cmd|")
    expect(html).toContain(ACCOUNTANT_PACK_DISCLAIMER_EN)
    expect(html).toContain(ACCOUNTANT_PACK_DISCLAIMER_TH)
    expect(html).toContain("&lt;Acme&gt;")
    expect(html).not.toContain("<Acme>")
    expect(html).toContain("Not tax payable")
    expect(html).not.toMatch(/ยื่นแบบสำเร็จ|filed successfully|e-Tax Invoice/i)
  })

  it("knows who may download a pack and which month string is real", () => {
    expect(canDownloadAccountantPack("owner")).toBe(true)
    expect(canDownloadAccountantPack("admin")).toBe(true)
    expect(canDownloadAccountantPack("accountant")).toBe(true)
    expect(canDownloadAccountantPack("member")).toBe(false)
    expect(previousCalendarMonth("2026-03-01")).toBe("2026-02")
    expect(previousCalendarMonth("2026-01-15")).toBe("2025-12")
    expect(accountantPackMonth("2026-02")).toEqual({ month: "2026-02", from: "2026-02-01", toExclusive: "2026-03-01" })
    expect(accountantPackMonth("2026-12")).toEqual({ month: "2026-12", from: "2026-12-01", toExclusive: "2027-01-01" })
    expect(accountantPackMonth("2026-13")).toBeNull()
    expect(accountantPackMonth("2026-1")).toBeNull()
  })
})
