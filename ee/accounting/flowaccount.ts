/**
 * FlowAccount export adapter.
 *
 * One concrete provider path. The document shape follows FlowAccount's public
 * inline tax-invoice body (`POST /{culture}/tax-invoices/inline-document`).
 * Sending it creates a sales document in FlowAccount. It does not file e-Tax
 * and it does not post a journal in this app.
 *
 * `fixture` never leaves the process: the same response parser reads a local
 * envelope. `sandbox` POSTs to https://openapi.flowaccount.com or to loopback
 * (tests). The access token is read from the server environment and is never
 * stored on `accounting_connections`.
 */
import { satangToBaht } from "@/lib/money"
import type { ExternalInvoicePayload } from "@/ee/accounting/provider"

export const FLOWACCOUNT_PUSH_PATH = "/th/tax-invoices/inline-document"
export const FLOWACCOUNT_SANDBOX_ORIGIN = "https://openapi.flowaccount.com/sandbox"

export type AccountingTransport = "fixture" | "sandbox"

export type ExportLine = {
  description: string
  quantity: number
  unit: string | null
  unitPriceSatang: number
  amountSatang: number
}

/** Issued invoice plus the contact and lines FlowAccount's inline body needs. */
export type ExportInvoice = {
  payload: ExternalInvoicePayload
  subtotalSatang: number
  discountSatang: number
  vatSatang: number
  whtSatang: number
  whtRateBps: number
  totalSatang: number
  amountSatang: number
  pricesIncludeVat: boolean
  notes: string | null
  contactTaxId: string | null
  contactAddress: string | null
  contactEmail: string | null
  lines: ExportLine[]
}

export type FlowAccountLine = {
  name: string
  description: string
  quantity: number
  unitName: string
  pricePerUnit: number
  total: number
}

/** Subset of FlowAccount's inline document that this export fills. */
export type FlowAccountDocument = {
  contactName: string
  contactAddress: string
  contactTaxId: string
  contactEmail: string
  contactGroup: 1
  publishedOn: string
  creditType: 1
  creditDays: number
  dueDate: string
  reference: string
  isVatInclusive: boolean
  isVat: boolean
  subTotal: number
  discountAmount: number
  totalAfterDiscount: number
  vatAmount: number
  grandTotal: number
  documentShowWithholdingTax: boolean
  documentWithholdingTaxPercentage: number
  documentWithholdingTaxAmount: number
  remarks: string
  internalNotes: string
  items: FlowAccountLine[]
}

export function connectionTransport(config: unknown): AccountingTransport {
  if (!config || typeof config !== "object" || Array.isArray(config)) return "fixture"
  return (config as { transport?: unknown }).transport === "sandbox" ? "sandbox" : "fixture"
}

function baht(satang: number): number {
  return satangToBaht(satang)
}

function preferPositive(primary: number, fallback: number): number {
  return Number.isSafeInteger(primary) && primary > 0 ? primary : fallback
}

/** Whole days from issue to due. A missing or earlier due date is 0. */
export function creditDays(issueDate: string | null, dueDate: string | null): number {
  if (!issueDate || !dueDate) return 0
  const issue = Date.parse(`${issueDate}T00:00:00Z`)
  const due = Date.parse(`${dueDate}T00:00:00Z`)
  if (!Number.isFinite(issue) || !Number.isFinite(due) || due < issue) return 0
  return Math.round((due - issue) / 86_400_000)
}

function taxId(value: string | null): string {
  const digits = (value ?? "").replace(/\D/g, "")
  return digits.length === 13 ? digits : ""
}

function clip(value: string | null | undefined, max: number): string {
  return (value ?? "").trim().slice(0, max)
}

/**
 * Map one issued invoice onto the FlowAccount inline body.
 * Header totals come from the invoice. A document with no positive lines
 * becomes a single line so the body still has `items`.
 */
export function toFlowAccountDocument(invoice: ExportInvoice): FlowAccountDocument {
  const subtotalSatang = preferPositive(invoice.subtotalSatang, invoice.amountSatang)
  const totalSatang = preferPositive(invoice.totalSatang, invoice.amountSatang)
  const discountSatang = Number.isSafeInteger(invoice.discountSatang) && invoice.discountSatang > 0 ? invoice.discountSatang : 0
  const afterDiscount = Math.max(0, subtotalSatang - discountSatang)
  const publishedOn = invoice.payload.issueDate ?? invoice.payload.dueDate
  if (!publishedOn) throw new Error("The invoice needs an issue date before it can be exported.")
  const dueDate = invoice.payload.dueDate ?? publishedOn
  const items = invoice.lines.flatMap((line) => {
    if (!Number.isFinite(line.quantity) || line.quantity <= 0) return []
    if (!Number.isSafeInteger(line.amountSatang)) return []
    const name = clip(line.description, 255) || invoice.payload.reference
    return [{
      name,
      description: clip(line.description, 500),
      quantity: line.quantity,
      unitName: clip(line.unit, 40),
      pricePerUnit: baht(line.unitPriceSatang),
      total: baht(line.amountSatang),
    }]
  })
  if (items.length === 0) {
    items.push({
      name: invoice.payload.reference,
      description: "",
      quantity: 1,
      unitName: "",
      pricePerUnit: baht(subtotalSatang),
      total: baht(subtotalSatang),
    })
  }
  const wht = Number.isSafeInteger(invoice.whtSatang) && invoice.whtSatang > 0
  return {
    contactName: invoice.payload.customerName,
    contactAddress: clip(invoice.contactAddress, 500),
    contactTaxId: taxId(invoice.contactTaxId),
    contactEmail: clip(invoice.contactEmail, 200),
    contactGroup: 1,
    publishedOn,
    creditType: 1,
    creditDays: creditDays(invoice.payload.issueDate, invoice.payload.dueDate),
    dueDate,
    reference: invoice.payload.reference,
    isVatInclusive: invoice.pricesIncludeVat,
    isVat: invoice.vatSatang > 0,
    subTotal: baht(subtotalSatang),
    discountAmount: baht(discountSatang),
    totalAfterDiscount: baht(afterDiscount),
    vatAmount: baht(invoice.vatSatang > 0 ? invoice.vatSatang : 0),
    grandTotal: baht(totalSatang),
    documentShowWithholdingTax: wht,
    documentWithholdingTaxPercentage: wht ? invoice.whtRateBps / 100 : 0,
    documentWithholdingTaxAmount: wht ? baht(invoice.whtSatang) : 0,
    remarks: clip(invoice.notes, 500),
    internalNotes: `BoomBigNose ${invoice.payload.reference}`,
    items,
  }
}

/** Read `documentSerial`, then `recordId`, from a FlowAccount create response. */
export function parseFlowAccountPushResponse(body: unknown): { externalId: string } {
  if (!body || typeof body !== "object") throw new Error("FlowAccount returned an unreadable response.")
  const record = body as { status?: unknown; message?: unknown; data?: unknown }
  if (record.status !== true) {
    const message = typeof record.message === "string" && record.message.trim()
      ? record.message.trim()
      : "FlowAccount refused the document."
    throw new Error(message.slice(0, 200))
  }
  const data = record.data
  if (!data || typeof data !== "object") throw new Error("FlowAccount returned no document.")
  const serial = (data as { documentSerial?: unknown }).documentSerial
  if (typeof serial === "string" && serial.trim()) return { externalId: serial.trim() }
  const recordId = (data as { recordId?: unknown }).recordId
  if (typeof recordId === "number" && Number.isSafeInteger(recordId)) return { externalId: String(recordId) }
  if (typeof recordId === "string" && /^\d+$/.test(recordId.trim())) return { externalId: recordId.trim() }
  throw new Error("FlowAccount returned no document number.")
}

export function fixtureEnvelope(document: FlowAccountDocument): { status: true; data: { recordId: number; documentSerial: string } } {
  return {
    status: true,
    data: {
      recordId: fixtureRecordId(document.reference),
      documentSerial: `FA-${document.reference}`,
    },
  }
}

function fixtureRecordId(reference: string): number {
  let hash = 0
  for (const char of reference) hash = (Math.imul(hash, 33) + char.charCodeAt(0)) >>> 0
  return (hash % 1_000_000_000) || 1
}

/** Sandbox root or loopback only. The token is not part of the URL. */
export function flowAccountPushUrl(baseUrl = FLOWACCOUNT_SANDBOX_ORIGIN): string {
  let url: URL
  try {
    url = new URL(baseUrl)
  } catch {
    throw new Error("FLOWACCOUNT_BASE_URL is not a valid URL.")
  }
  if (url.username || url.password) throw new Error("FLOWACCOUNT_BASE_URL must not include a password.")
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1"
  if (loopback) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("FlowAccount URL must be http or https.")
  } else if (host !== "openapi.flowaccount.com" || url.protocol !== "https:") {
    throw new Error("FlowAccount URL must be https://openapi.flowaccount.com or a loopback address.")
  }
  const basePath = url.pathname.replace(/\/$/, "")
  return `${url.origin}${basePath}${FLOWACCOUNT_PUSH_PATH}`
}

function redact(message: string, token: string): string {
  const cleaned = token ? message.split(token).join("[token]") : message
  return cleaned.replace(/\s+/g, " ").trim().slice(0, 200)
}

export async function pushFlowAccountInvoice(
  document: FlowAccountDocument,
  options: {
    transport: AccountingTransport
    fetchImpl?: typeof fetch
    token?: string
    baseUrl?: string
  },
): Promise<{ externalId: string }> {
  if (options.transport === "fixture") return parseFlowAccountPushResponse(fixtureEnvelope(document))

  const token = options.token?.trim() ?? ""
  if (!token) {
    throw new Error("Sandbox export needs FLOWACCOUNT_ACCESS_TOKEN on the server. The token is not saved in the workspace. Use the fixture demo until then.")
  }
  const url = flowAccountPushUrl(options.baseUrl)
  const fetchImpl = options.fetchImpl ?? fetch
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(document),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ""
    if (/redirect/i.test(message)) throw new Error("FlowAccount redirected the export. The request was stopped.")
    throw new Error("FlowAccount could not be reached.")
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    const message = body && typeof body === "object" && typeof (body as { message?: unknown }).message === "string"
      ? (body as { message: string }).message
      : ""
    throw new Error(redact(`FlowAccount returned HTTP ${response.status}. ${message}`, token))
  }
  return parseFlowAccountPushResponse(body)
}
