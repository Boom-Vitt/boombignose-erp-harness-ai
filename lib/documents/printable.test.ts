import { describe, it, expect } from "vitest"

import { escapeHtml, renderDocumentHtml, type PrintableDocument } from "./printable"

describe("escapeHtml", () => {
  it("escapes the html-significant characters", () => {
    expect(escapeHtml(`<b>a&b "c" 'd'</b>`)).toBe(
      "&lt;b&gt;a&amp;b &quot;c&quot; &#39;d&#39;&lt;/b&gt;"
    )
  })
})

const doc: PrintableDocument = {
  kind: "Invoice",
  number: "INV-2026-001",
  status: "sent",
  orgName: "BoomBigNose",
  clientName: "Acme Co",
  issueDate: "2026-07-01",
  dueDate: "2026-07-31",
  items: [
    { description: "Design", quantity: 2, unit_price_satang: 50000, amount_satang: 100000 },
  ],
  subtotalSatang: 100000,
  discountSatang: 10000,
  totalSatang: 90000,
  notes: "Thanks!",
}

describe("renderDocumentHtml", () => {
  it("prints a billing unit next to the quantity and escapes untrusted units", () => {
    const line = { ...doc.items[0], unit: 'hour <img src=x onerror="alert(1)">' }
    const html = renderDocumentHtml({ ...doc, items: [line] })
    expect(html).toContain('<td class="num">2 hour &lt;img src=x onerror=&quot;alert(1)&quot;&gt;</td>')
    expect(html).not.toContain('<img src=x')
  })
  it("renders a full standalone html document", () => {
    const html = renderDocumentHtml(doc)
    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html).toContain("INV-2026-001")
    expect(html).not.toContain("Public reference")
    expect(html).toContain("2026-07-01 (01/07/2569)")
    expect(html).toContain("2026-07-31 (31/07/2569)")
    expect(html).toContain("Acme Co")
    expect(html).toContain("Design")
    expect(html).toContain("Discount")
    expect(html).not.toContain("<svg ")
  })

  it("escapes untrusted field values", () => {
    const html = renderDocumentHtml({
      ...doc,
      clientName: `<script>alert(1)</script>`,
    })
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("prints an optional public reference beside the document number and tax ID", () => {
    const html = renderDocumentHtml({
      ...doc,
      sellerTaxId: "1234567890123",
      publicReference: "inv1qqqq-qqqq-qqqq-qqqq-qqqq",
    })
    expect(html).toContain("INV-2026-001")
    expect(html).toContain("1234567890123")
    expect(html).toContain("inv1qqqq-qqqq-qqqq-qqqq-qqqq")
    expect(html.indexOf("INV-2026-001")).toBeLessThan(html.indexOf("inv1qqqq-qqqq-qqqq-qqqq-qqqq"))
  })

  it("shows a zero discount consistently with the totals block", () => {
    const html = renderDocumentHtml({ ...doc, discountSatang: 0 })
    expect(html).toContain("Discount")
  })

  it("adds a local PromptPay QR when an invoice has a 13-digit seller tax ID and an amount due", () => {
    const html = renderDocumentHtml({
      ...doc,
      kind: "Tax Invoice / ใบกำกับภาษี",
      taxInvoice: { docType: "TX", branchCode: "00000", copyLabel: "ต้นฉบับ" },
      sellerTaxId: "1234567890123",
      amountDueSatang: 104000,
    })
    expect(html).toContain("<svg ")
    expect(html).toContain("สร้างบนเครื่องนี้")
    expect(html).toContain("Not a bank confirmation")
    expect(html).not.toContain("000201010212")
  })

  it("prints section and note rows between the priced lines, escaped and without amounts", () => {
    const html = renderDocumentHtml({
      ...doc,
      items: [doc.items[0], { description: "Hosting", quantity: 1, unit_price_satang: 2000, amount_satang: 2000 }],
      sections: [
        { kind: "note", description: "Paid <b>monthly</b>", lines_before: 2, position: 1 },
        { kind: "section", description: "Phase 1", lines_before: 0, position: 0 },
      ],
    })
    const order = ["Phase 1", "Design", "Hosting", "Paid &lt;b&gt;monthly&lt;/b&gt;"].map(text => html.indexOf(text))
    expect(order.every(index => index > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(html).toContain('<tr class="section"><td colspan="4">Phase 1</td></tr>')
    expect(html).toContain('<tr class="note"><td colspan="4">Paid &lt;b&gt;monthly&lt;/b&gt;</td></tr>')
    expect(html).not.toContain("No line items.")
  })

  it("shows an empty-state row when there are no items", () => {
    const html = renderDocumentHtml({ ...doc, items: [] })
    expect(html).toContain("No line items.")
  })

  it("shows verified receipts and outstanding separately from document total", () => {
    const html = renderDocumentHtml({ ...doc, verifiedPaidSatang: 10001, outstandingSatang: 79999 })
    expect(html).toContain("รับเงินที่ตรวจสอบแล้ว / Verified receipts")
    expect(html).toContain("ยอดคงค้าง / Outstanding")
    expect(html).toContain("100.01")
    expect(html).toContain("799.99")
    expect(html).toContain('lang="th"')
  })
})
