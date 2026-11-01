import { describe, expect, it, vi } from "vitest"

import {
  connectionTransport,
  creditDays,
  flowAccountPushUrl,
  parseFlowAccountPushResponse,
  pushFlowAccountInvoice,
  toFlowAccountDocument,
  type ExportInvoice,
} from "@/ee/accounting/flowaccount"
import { getProvider } from "@/ee/accounting/provider"

const invoice: ExportInvoice = {
  payload: {
    reference: "INV-2026-001",
    customerName: "Acme Co",
    issueDate: "2026-06-01",
    dueDate: "2026-06-30",
    currency: "THB",
    totalBaht: 1070,
    status: "sent",
  },
  subtotalSatang: 100000,
  discountSatang: 0,
  vatSatang: 7000,
  whtSatang: 3000,
  whtRateBps: 300,
  totalSatang: 107000,
  amountSatang: 104000,
  pricesIncludeVat: false,
  notes: "June work",
  contactTaxId: "1-2345-67890-12-3",
  contactAddress: "Bangkok",
  contactEmail: "owner@acme.test",
  lines: [{
    description: "Consulting",
    quantity: 2,
    unit: "hour",
    unitPriceSatang: 50000,
    amountSatang: 100000,
  }],
}

describe("FlowAccount document", () => {
  it("maps header totals, withholding, and the customer tax id", () => {
    const document = toFlowAccountDocument(invoice)
    expect(document.reference).toBe("INV-2026-001")
    expect(document.contactName).toBe("Acme Co")
    expect(document.contactTaxId).toBe("1234567890123")
    expect(document.publishedOn).toBe("2026-06-01")
    expect(document.dueDate).toBe("2026-06-30")
    expect(document.creditDays).toBe(29)
    expect(document.subTotal).toBe(1000)
    expect(document.vatAmount).toBe(70)
    expect(document.grandTotal).toBe(1070)
    expect(document.isVat).toBe(true)
    expect(document.documentShowWithholdingTax).toBe(true)
    expect(document.documentWithholdingTaxPercentage).toBe(3)
    expect(document.documentWithholdingTaxAmount).toBe(30)
    expect(document.items).toEqual([{
      name: "Consulting",
      description: "Consulting",
      quantity: 2,
      unitName: "hour",
      pricePerUnit: 500,
      total: 1000,
    }])
  })

  it("drops a short tax id and invents one line when none qualify", () => {
    const document = toFlowAccountDocument({
      ...invoice,
      contactTaxId: "123",
      vatSatang: 0,
      whtSatang: 0,
      lines: [{ description: "Skip", quantity: 0, unit: null, unitPriceSatang: 0, amountSatang: 0 }],
    })
    expect(document.contactTaxId).toBe("")
    expect(document.isVat).toBe(false)
    expect(document.documentShowWithholdingTax).toBe(false)
    expect(document.items).toEqual([{
      name: "INV-2026-001",
      description: "",
      quantity: 1,
      unitName: "",
      pricePerUnit: 1000,
      total: 1000,
    }])
  })

  it("counts credit days only when the due date is on or after the issue date", () => {
    expect(creditDays("2026-06-01", "2026-06-01")).toBe(0)
    expect(creditDays("2026-06-30", "2026-06-01")).toBe(0)
    expect(creditDays(null, "2026-06-01")).toBe(0)
  })
})

describe("FlowAccount response", () => {
  it("prefers the document serial and falls back to the record id", () => {
    expect(parseFlowAccountPushResponse({ status: true, data: { documentSerial: "EXP1", recordId: 9 } })).toEqual({ externalId: "EXP1" })
    expect(parseFlowAccountPushResponse({ status: true, data: { recordId: 42 } })).toEqual({ externalId: "42" })
  })

  it("refuses a failed status", () => {
    expect(() => parseFlowAccountPushResponse({ status: false, message: "duplicate" })).toThrow("duplicate")
  })
})

describe("FlowAccount push", () => {
  it("returns a fixture serial without calling fetch", async () => {
    const fetchImpl = vi.fn()
    const result = await getProvider("flowaccount").pushInvoice(invoice, { transport: "fixture", fetchImpl })
    expect(result.externalId).toBe("FA-INV-2026-001")
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("posts the sandbox document and reads the serial", async () => {
    const calls: { url: string; init?: RequestInit }[] = []
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify({
        status: true,
        data: { documentSerial: "EXP2026060001", recordId: 15 },
      }), { status: 200 })
    })
    const result = await pushFlowAccountInvoice(toFlowAccountDocument(invoice), {
      transport: "sandbox",
      token: "sandbox-token",
      baseUrl: "https://openapi.flowaccount.com/sandbox",
      fetchImpl: fetchImpl as typeof fetch,
    })
    expect(result.externalId).toBe("EXP2026060001")
    expect(calls).toHaveLength(1)
    const { url, init } = calls[0]!
    expect(url).toBe("https://openapi.flowaccount.com/sandbox/th/tax-invoices/inline-document")
    expect(init?.method).toBe("POST")
    expect(init?.redirect).toBe("error")
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer sandbox-token")
    const body = JSON.parse(String(init?.body)) as { reference: string; grandTotal: number }
    expect(body.reference).toBe("INV-2026-001")
    expect(body.grandTotal).toBe(1070)
  })

  it("does not call fetch when the sandbox token or host is missing", async () => {
    const fetchImpl = vi.fn()
    const document = toFlowAccountDocument(invoice)
    await expect(pushFlowAccountInvoice(document, { transport: "sandbox", fetchImpl })).rejects.toThrow(/FLOWACCOUNT_ACCESS_TOKEN/)
    await expect(pushFlowAccountInvoice(document, {
      transport: "sandbox",
      token: "sandbox-token",
      baseUrl: "https://evil.example/sandbox",
      fetchImpl,
    })).rejects.toThrow(/openapi\.flowaccount\.com/)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("accepts a loopback base and hides the token from an error body", async () => {
    expect(flowAccountPushUrl("http://127.0.0.1:9/sandbox")).toBe("http://127.0.0.1:9/sandbox/th/tax-invoices/inline-document")
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ message: "bad sandbox-token" }), { status: 401 }))
    await expect(pushFlowAccountInvoice(toFlowAccountDocument(invoice), {
      transport: "sandbox",
      token: "sandbox-token",
      baseUrl: "http://127.0.0.1:9",
      fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toThrow("FlowAccount returned HTTP 401. bad [token]")
  })

  it("stops when the provider redirects", async () => {
    const fetchImpl = vi.fn(async () => { throw new Error("redirect mode is set to error") })
    await expect(pushFlowAccountInvoice(toFlowAccountDocument(invoice), {
      transport: "sandbox",
      token: "sandbox-token",
      fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toThrow(/redirected/)
  })

  it("refuses a password, a non-https host, and a missing issue date", async () => {
    let thrown = ""
    try {
      flowAccountPushUrl("https://user:sandbox-token@openapi.flowaccount.com")
    } catch (error) {
      thrown = String(error)
    }
    expect(thrown).toMatch(/password/)
    expect(thrown).not.toContain("sandbox-token")
    expect(() => flowAccountPushUrl("http://openapi.flowaccount.com/sandbox")).toThrow(/https:\/\/openapi\.flowaccount\.com/)
    expect(() => flowAccountPushUrl("ftp://127.0.0.1/sandbox")).toThrow(/http or https/)
    expect(connectionTransport(null)).toBe("fixture")
    expect(connectionTransport([])).toBe("fixture")
    expect(connectionTransport({ transport: "peak" })).toBe("fixture")
    expect(() => toFlowAccountDocument({
      ...invoice,
      payload: { ...invoice.payload, issueDate: null, dueDate: null },
    })).toThrow(/issue date/)
    const fetchImpl = vi.fn(async () => { throw new Error("ECONNREFUSED 10.1.2.3") })
    await expect(pushFlowAccountInvoice(toFlowAccountDocument(invoice), {
      transport: "sandbox",
      token: "   ",
      fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toThrow(/FLOWACCOUNT_ACCESS_TOKEN/)
    await expect(pushFlowAccountInvoice(toFlowAccountDocument(invoice), {
      transport: "sandbox",
      token: "sandbox-token",
      fetchImpl: fetchImpl as typeof fetch,
    })).rejects.toThrow("FlowAccount could not be reached.")
    expect(parseFlowAccountPushResponse({ status: true, data: { recordId: "15" } })).toEqual({ externalId: "15" })
    expect(() => parseFlowAccountPushResponse({ status: true, data: {} })).toThrow(/no document number/)
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it("refuses PEAK and Xero in this build", async () => {
    await expect(getProvider("peak").pushInvoice(invoice, { transport: "fixture" })).rejects.toThrow(/FlowAccount only/)
    await expect(getProvider("xero").pushInvoice(invoice, { transport: "fixture" })).rejects.toThrow(/FlowAccount only/)
    expect(connectionTransport({})).toBe("fixture")
    expect(connectionTransport({ transport: "sandbox" })).toBe("sandbox")
  })
})
