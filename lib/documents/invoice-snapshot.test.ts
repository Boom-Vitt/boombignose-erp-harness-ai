import { expect, it } from "vitest"
import { invoiceSnapshotDocument } from "./invoice-snapshot"
import { renderDocumentHtml } from "./printable"
const snapshot = {
  version: 1,
  seller: { legalName: "ร้านเดิม", address: "ที่อยู่เดิม", taxId: null, taxStatus: "unknown" },
  buyer: { id: "client", name: "ลูกค้าเดิม", address: "ที่อยู่ลูกค้า", taxId: null },
  document: { number: "INV-FROZEN", issueDate: "2026-01-01", dueDate: "2026-02-01", notes: "frozen", subtotalSatang: 10001, discountSatang: 1000, totalSatang: 9001 },
  lines: [{ description: "งานเดิม", quantity: 1, unitPriceSatang: 10001, amountSatang: 10001, position: 0 }],
}
it("renders the issued seller/buyer/amount from the snapshot and current verified balance separately", () => {
  const doc = invoiceSnapshotDocument(snapshot, "partially_paid", 1001)
  expect(doc.orgName).toBe("ร้านเดิม")
  expect(doc.clientName).toBe("ลูกค้าเดิม")
  expect(doc.discountSatang).toBe(1000)
  expect(doc.totalSatang).toBe(9001)
  expect(doc.outstandingSatang).toBe(8000)
  expect(doc.sellerAddress).toBe("ที่อยู่เดิม")
})
it("fails closed for unknown snapshot versions or corrupted unsafe totals", () => {
  expect(() => invoiceSnapshotDocument({ ...snapshot, version: 2 }, "sent", 0)).toThrow()
  expect(() => invoiceSnapshotDocument({ ...snapshot, document: { ...snapshot.document, totalSatang: Number.MAX_SAFE_INTEGER + 1 } }, "sent", 0)).toThrow()
  expect(() => invoiceSnapshotDocument({ ...snapshot, document: { ...snapshot.document, totalSatang: 9999 } }, "sent", 0)).toThrow()
})

it("preserves issued units through parsing and printable rendering", () => {
  const doc = invoiceSnapshotDocument({ ...snapshot, lines: [{ ...snapshot.lines[0], unit: "hour" }] }, "sent", 0)
  expect(doc.items[0]).toMatchObject({ unit: "hour" })
  expect(renderDocumentHtml(doc)).toContain('<td class="num">1 hour</td>')
})

it.each([undefined, null])("renders legacy or null-unit snapshots without inventing a unit (%s)", (unit) => {
  const doc = invoiceSnapshotDocument({ ...snapshot, lines: [{ ...snapshot.lines[0], unit }] }, "sent", 0)
  expect(renderDocumentHtml(doc)).toContain('<td class="num">1</td>')
})

it("preserves a space-padded unit accepted by the database", () => {
  const unit = `${" ".repeat(40)}hour${" ".repeat(40)}`
  expect(invoiceSnapshotDocument({ ...snapshot, lines: [{ ...snapshot.lines[0], unit }] }, "sent", 0).items[0]).toMatchObject({ unit })
})

it("prints VAT-registered issued totals, tax IDs, branches and the collectible balance", () => {
  const issued = {
    ...snapshot,
    seller: { ...snapshot.seller, vatRegistered: true, taxId: "1234567890123", branchLabel: "Head office" },
    buyer: { ...snapshot.buyer, taxId: "9876543210123", branchLabel: "Branch 001" },
    document: { ...snapshot.document, subtotalSatang: 100000, discountSatang: 0, totalSatang: 107000, vatSatang: 7000, whtRateBps: 300, whtSatang: 3000, amountDueSatang: 104000 },
    lines: [{ ...snapshot.lines[0], amountSatang: 100000, unitPriceSatang: 100000, taxRateBps: 700 }],
  }
  const doc = invoiceSnapshotDocument(issued, "partially_paid", 4000)
  expect(doc.kind).toBe("Invoice") // VAT registration alone never makes an operational invoice a tax invoice
  expect(doc.taxInvoice).toBeUndefined()
  expect(doc.outstandingSatang).toBe(100000)
  const html = renderDocumentHtml(doc)
  for (const text of ["VAT 7%", "WHT 3%", "Amount due", "Head office", "Branch 001", "1234567890123", "9876543210123", "1,040.00"]) expect(html).toContain(text)
  for (const field of ["vatSatang", "whtSatang", "amountDueSatang"]) expect(() => invoiceSnapshotDocument({ ...issued, document: { ...issued.document, [field]: 1 } }, "sent", 0)).toThrow("Invalid issued snapshot totals")
  expect(invoiceSnapshotDocument({ ...issued, seller: { ...issued.seller, vatRegistered: false } }, "sent", 0).kind).toBe("Invoice")
})

const legacySnapshot = {
  ...snapshot,
  kind: "legacy_operational_invoice",
  seller: { ...snapshot.seller, vatRegistered: true },
  document: {
    ...snapshot.document,
    subtotalSatang: 30000, discountSatang: 2000, totalSatang: 29000,
    vatSatang: 1000, whtSatang: 3000, whtRateBps: 300, amountDueSatang: 26000,
    vatByRate: [{ rateBps: 700, baseSatang: 25000, vatSatang: 1750 }],
  },
}

it("preserves adopted legacy headers and tax breakdown independently of priced lines", () => {
  const doc = invoiceSnapshotDocument(legacySnapshot, "partially_paid", 6000)
  expect(doc).toMatchObject({
    kind: "Invoice", number: "INV-FROZEN", issueDate: "2026-01-01", dueDate: "2026-02-01",
    subtotalSatang: 30000, discountSatang: 2000, totalSatang: 29000,
    vatSatang: 1000, whtSatang: 3000, whtRateBps: 300, amountDueSatang: 26000,
    vatByRate: legacySnapshot.document.vatByRate, outstandingSatang: 20000,
    items: [{ description: "งานเดิม", quantity: 1, unit_price_satang: 10001, amount_satang: 10001 }],
  })
})

it("renders adopted legacy invoices without inventing lines or changing their totals", () => {
  const doc = invoiceSnapshotDocument({ ...legacySnapshot, lines: [] }, "sent", 0)
  expect(doc.items).toEqual([])
  expect(doc.amountDueSatang).toBe(26000)
  expect(renderDocumentHtml(doc)).toContain("No line items.")
})

it("keeps ordinary snapshots strict and rejects unknown kinds", () => {
  for (const kind of [undefined, "operational_invoice"]) {
    expect(() => invoiceSnapshotDocument({ ...snapshot, kind, lines: [] }, "sent", 0)).toThrow()
    expect(() => invoiceSnapshotDocument({ ...legacySnapshot, kind }, "sent", 0)).toThrow("Invalid issued snapshot totals")
  }
  expect(() => invoiceSnapshotDocument({ ...snapshot, kind: "unknown" }, "sent", 0)).toThrow()
})

it.each([
  { ...legacySnapshot, document: { ...legacySnapshot.document, amountDueSatang: Number.MAX_SAFE_INTEGER + 1 } },
  { ...legacySnapshot, lines: [{ ...snapshot.lines[0], amountSatang: 0.5 }] },
  { ...legacySnapshot, document: { ...legacySnapshot.document, vatByRate: [{ rateBps: 700, vatSatang: -1 }] } },
  { ...legacySnapshot, document: { ...legacySnapshot.document, vatByRate: [{ rateBps: 700, baseSatang: Number.MAX_SAFE_INTEGER + 1, vatSatang: 1 }] } },
  { ...legacySnapshot, document: { ...legacySnapshot.document, vatByRate: [{ rateBps: 10001, vatSatang: 1 }] } },
  { ...legacySnapshot, document: { ...legacySnapshot.document, vatByRate: {} } },
])("rejects unsafe or malformed adopted legacy money and tax breakdowns (%#)", (value) => {
  expect(() => invoiceSnapshotDocument(value, "sent", 0)).toThrow()
})

const taxIssued = {
  ...snapshot,
  seller: { ...snapshot.seller, vatRegistered: true, taxId: "1234567890123", branchLabel: "Head office" },
  buyer: { ...snapshot.buyer, taxId: "9876543210123", address: "1 Buyer Road" },
  document: { ...snapshot.document, number: "TX-2026-000001", subtotalSatang: 100000, discountSatang: 0, totalSatang: 107000, vatSatang: 7000, amountDueSatang: 107000 },
  lines: [{ ...snapshot.lines[0], amountSatang: 100000, unitPriceSatang: 100000, taxRateBps: 700 }],
  taxInvoice: { docType: "TX", branchCode: "00000", copyLabel: "ต้นฉบับ" },
}

it("prints a TX snapshot as a tax invoice with frozen branch code and original label, and a reprint as copy", () => {
  const doc = invoiceSnapshotDocument(taxIssued, "sent", 0)
  expect(doc.kind).toBe("Tax Invoice / ใบกำกับภาษี")
  const html = renderDocumentHtml(doc)
  for (const text of ["TX-2026-000001", "00000", "ต้นฉบับ", "9876543210123", "1 Buyer Road", "Not an e-Tax Invoice"]) expect(html).toContain(text)
  expect(html).not.toContain("Operational document, not a legal tax invoice")
  const copy = renderDocumentHtml(invoiceSnapshotDocument(taxIssued, "sent", 0, 0, { copy: true }))
  expect(copy).toContain("สำเนา")
  expect(copy).not.toContain("ต้นฉบับ")
})

it("prints an ABB snapshot as abbreviated and never prints the buyer tax ID or address, even if stored", () => {
  const abb = { ...taxIssued, document: { ...taxIssued.document, number: "ABB-2026-000001" }, taxInvoice: { ...taxIssued.taxInvoice, docType: "ABB" } }
  const doc = invoiceSnapshotDocument(abb, "sent", 0)
  expect(doc.kind).toBe("Abbreviated Tax Invoice / ใบกำกับภาษีอย่างย่อ")
  const html = renderDocumentHtml(doc)
  expect(html).toContain("ABB-2026-000001")
  expect(html).not.toContain("9876543210123")
  expect(html).not.toContain("1 Buyer Road")
})

it("rejects a malformed tax-invoice block", () => {
  for (const taxInvoice of [{ docType: "INV", branchCode: "00000", copyLabel: "x" }, { docType: "TX", branchCode: "12", copyLabel: "x" }, { docType: "TX", branchCode: "00000", copyLabel: "" }])
    expect(() => invoiceSnapshotDocument({ ...taxIssued, taxInvoice }, "sent", 0)).toThrow()
})
