import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { readAll } from "@/lib/supabase/read-all"
import {
  accountantPackMonth,
  assembleAccountantPack,
  canDownloadAccountantPack,
  readStoredCreditSupport,
  type AccountantPack,
  type PackCreditRow,
  type PackInvoiceRow,
  type PackPurchaseLine,
} from "@/lib/finance/accountant-pack"

export type PackLoad =
  | { ok: true; pack: AccountantPack }
  | { ok: false; status: 400 | 403 | 503; message: string }

type ClientEmbed = { name?: string | null; tax_id?: string | null } | { name?: string | null; tax_id?: string | null }[] | null

type InvoiceSource = {
  id: string
  number?: string | null
  status?: string | null
  issue_date?: string | null
  client_id?: string | null
  total_satang?: number | null
  vat_satang?: number | null
  wht_satang?: number | null
  clients?: ClientEmbed
}

/**
 * Workspace read for one month. Input VAT lines are matched vendor bills,
 * and their totals must equal `monthly_purchase_vat`.
 */
export async function loadAccountantPack(month: string): Promise<PackLoad> {
  const ctx = await requireOrgContext()
  if (!canDownloadAccountantPack(ctx.role)) {
    return { ok: false, status: 403, message: "Only an owner, an admin, or an accountant can download this pack." }
  }
  const parsed = accountantPackMonth(month)
  if (!parsed) return { ok: false, status: 400, message: "Choose a month as YYYY-MM." }
  try {
    const supabase = await createClient()
    const [invoicesRes, creditsRes, costsRes, vatRes] = await Promise.all([
      readAll((from, to) => supabase.from("invoices")
        .select("id, number, status, issue_date, client_id, total_satang, vat_satang, wht_satang, clients(name, tax_id)")
        .eq("org_id", ctx.orgId)
        .gte("issue_date", parsed.from)
        .lt("issue_date", parsed.toExclusive)
        .order("id")
        .range(from, to)),
      readAll((from, to) => supabase.from("credit_notes")
        .select("id, number, issue_date, invoice_id, snapshot")
        .eq("org_id", ctx.orgId)
        .gte("issue_date", parsed.from)
        .lt("issue_date", parsed.toExclusive)
        .order("id")
        .range(from, to)),
      readAll((from, to) => supabase.from("costs")
        .select("id, bill_date, vendor_id, vendor, vendor_invoice_reference, purchase_cost_kind, amount_satang, input_vat_satang, vendor_bill_match_id")
        .eq("org_id", ctx.orgId)
        .gte("bill_date", parsed.from)
        .lt("bill_date", parsed.toExclusive)
        .not("vendor_bill_match_id", "is", null)
        .order("id")
        .range(from, to)),
      readAll((from, to) => supabase.from("monthly_purchase_vat")
        .select("month, base_satang, input_vat_satang")
        .eq("org_id", ctx.orgId)
        .eq("month", parsed.from)
        .order("month")
        .range(from, to)),
    ])
    if (invoicesRes.error || creditsRes.error || costsRes.error || vatRes.error) {
      return { ok: false, status: 503, message: "Accountant pack unavailable. Reload before relying on totals." }
    }
    const invoices = (invoicesRes.data ?? []) as InvoiceSource[]
    const credits = creditsRes.data ?? []
    const known = new Map(invoices.map((row) => [row.id, row]))
    const missing = [...new Set(credits.map((row) => row.invoice_id).filter((id) => !known.has(id)))]
    for (let index = 0; index < missing.length; index += 100) {
      const ids = missing.slice(index, index + 100)
      const extra = await readAll((from, to) => supabase.from("invoices")
        .select("id, client_id, clients(name, tax_id)")
        .eq("org_id", ctx.orgId)
        .in("id", ids)
        .order("id")
        .range(from, to))
      if (extra.error) return { ok: false, status: 503, message: "Accountant pack unavailable. Reload before relying on totals." }
      for (const row of (extra.data ?? []) as InvoiceSource[]) known.set(row.id, row)
    }
    const vendorIds = [...new Set((costsRes.data ?? []).map((row) => row.vendor_id).filter((id): id is string => !!id))]
    const vendors = new Map<string, { name: string; tax_id: string | null }>()
    if (vendorIds.length > 0) {
      const vendorRes = await readAll((from, to) => supabase.from("vendors")
        .select("id, name, tax_id")
        .eq("org_id", ctx.orgId)
        .in("id", vendorIds)
        .order("id")
        .range(from, to))
      if (vendorRes.error) return { ok: false, status: 503, message: "Accountant pack unavailable. Reload before relying on totals." }
      for (const row of vendorRes.data ?? []) vendors.set(row.id, { name: row.name, tax_id: row.tax_id })
    }
    const pack = assembleAccountantPack({
      orgName: ctx.orgName,
      month: parsed.month,
      invoices: invoices.filter((row) => isIssued(row.status) && inSpan(row.issue_date, parsed)).map(toInvoice),
      credits: credits.filter((row) => inSpan(row.issue_date, parsed)).map((row) => toCredit(row, known)),
      purchaseLines: (costsRes.data ?? [])
        .filter((row) => row.vendor_bill_match_id != null && inSpan(row.bill_date, parsed))
        .map((row) => toPurchase(row, vendors)),
      purchaseVat: (vatRes.data ?? []).map((row) => ({ month: row.month, baseSatang: row.base_satang, inputVatSatang: row.input_vat_satang })),
    })
    return { ok: true, pack }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Accountant pack unavailable. Reload before relying on totals."
    return { ok: false, status: 503, message }
  }
}

function toInvoice(row: InvoiceSource): PackInvoiceRow {
  const client = embeddedClient(row.clients)
  return {
    id: row.id,
    number: row.number ?? "",
    status: row.status ?? "",
    issueDate: row.issue_date ?? "",
    clientId: row.client_id ?? "",
    clientName: client.name,
    clientTaxId: client.taxId,
    totalSatang: row.total_satang ?? 0,
    vatSatang: row.vat_satang ?? 0,
    whtSatang: row.wht_satang ?? 0,
  }
}

function toCredit(row: { id: string; number: string; issue_date: string; invoice_id: string; snapshot: unknown }, known: Map<string, InvoiceSource>): PackCreditRow {
  const invoice = known.get(row.invoice_id)
  if (!invoice) throw new Error(`Credit note ${row.number} is missing its invoice in this workspace`)
  const stored = readStoredCreditSupport(row.snapshot)
  const client = embeddedClient(invoice.clients)
  return {
    id: row.id,
    number: row.number,
    issueDate: row.issue_date,
    invoiceId: row.invoice_id,
    clientId: invoice.client_id ?? "",
    clientName: client.name,
    clientTaxId: client.taxId,
    buyerName: stored.buyerName,
    buyerTaxId: stored.buyerTaxId,
    baseSatang: stored.baseSatang,
    vatSatang: stored.vatSatang,
    whtSatang: stored.whtSatang,
    originalNumber: stored.originalNumber,
  }
}

function toPurchase(row: {
  id: string
  bill_date: string | null
  vendor_id: string | null
  vendor: string | null
  vendor_invoice_reference: string | null
  purchase_cost_kind: "bill" | "credit" | "return_adjustment" | null
  amount_satang: number
  input_vat_satang: number
  vendor_bill_match_id: string | null
}, vendors: Map<string, { name: string; tax_id: string | null }>): PackPurchaseLine {
  const vendor = row.vendor_id ? vendors.get(row.vendor_id) : undefined
  return {
    id: row.id,
    billDate: row.bill_date ?? "",
    vendorName: vendor?.name || row.vendor?.trim() || "Unassigned vendor",
    vendorTaxId: vendor?.tax_id?.trim() || null,
    reference: row.vendor_invoice_reference?.trim() || row.id,
    kind: row.purchase_cost_kind,
    amountSatang: row.amount_satang,
    inputVatSatang: row.input_vat_satang,
    matched: row.vendor_bill_match_id != null,
  }
}

function embeddedClient(value: ClientEmbed | undefined): { name: string; taxId: string | null } {
  const row = Array.isArray(value) ? value[0] : value
  const name = row?.name?.trim() ?? ""
  const taxId = row?.tax_id?.trim() ?? ""
  return { name: name || "Unassigned customer", taxId: taxId || null }
}

function isIssued(status: string | null | undefined): boolean {
  return status !== "draft" && status !== "cancelled"
}

function inSpan(date: string | null | undefined, span: { from: string; toExclusive: string }): boolean {
  return !!date && date >= span.from && date < span.toExclusive
}
