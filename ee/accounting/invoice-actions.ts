"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"
import { invoiceToExternalPayload } from "@/ee/accounting/mapping"
import { connectionTransport, type ExportInvoice, type ExportLine } from "@/ee/accounting/flowaccount"
import { getProvider, type ProviderKey } from "@/ee/accounting/provider"

const EXPORTABLE = new Set(["sent", "paid", "partially_paid", "overdue"])

function contactOf(value: unknown): { name: string | null; tax_id: string | null; billing_address: string | null; email: string | null } | null {
  const row = Array.isArray(value) ? value[0] : value
  if (!row || typeof row !== "object") return null
  const record = row as Record<string, string | null>
  return {
    name: typeof record.name === "string" ? record.name : null,
    tax_id: typeof record.tax_id === "string" ? record.tax_id : null,
    billing_address: typeof record.billing_address === "string" ? record.billing_address : null,
    email: typeof record.email === "string" ? record.email : null,
  }
}

/**
 * Export one issued invoice through the connected adapter and record the
 * external document number. Fixture mode stays on this machine. Sandbox mode
 * posts to FlowAccount. Re-export updates the same sync row.
 */
export async function syncInvoiceToAccounting(
  invoiceId: string
): Promise<{ externalId?: string; error?: string }> {
  const ctx = await requireOrgContext()

  try {
    requireCapability(ctx, "accounting:manage")
  } catch {
    return { error: "Only an owner or admin can sync to accounting." }
  }

  if (!invoiceId) return { error: "Missing invoice." }

  const supabase = await createClient()

  const { data: conn } = await supabase
    .from("accounting_connections")
    .select("provider, status, config")
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (!conn || conn.status !== "connected") {
    return { error: "Connect an accounting provider first." }
  }

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("id, number, amount_satang, subtotal_satang, discount_satang, vat_satang, wht_satang, wht_rate_bps, total_satang, prices_include_vat, status, issue_date, due_date, notes, clients(name, tax_id, billing_address, email)")
    .eq("id", invoiceId)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (invErr) return { error: invErr.message }
  if (!invoice) return { error: "Invoice not found." }
  if (!EXPORTABLE.has(invoice.status)) {
    return { error: "Issue the invoice before exporting it. Drafts and cancelled invoices are not sent." }
  }

  const { data: lineRows, error: lineErr } = await supabase
    .from("invoice_items")
    .select("description, quantity, unit, unit_price_satang, amount_satang, position")
    .eq("org_id", ctx.orgId)
    .eq("invoice_id", invoice.id)
    .order("position")

  if (lineErr) return { error: lineErr.message }

  const contact = contactOf(invoice.clients)
  const lines: ExportLine[] = (lineRows ?? []).map((line) => ({
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPriceSatang: line.unit_price_satang,
    amountSatang: line.amount_satang,
  }))
  const exportInvoice: ExportInvoice = {
    payload: invoiceToExternalPayload(invoice, contact),
    subtotalSatang: invoice.subtotal_satang,
    discountSatang: invoice.discount_satang,
    vatSatang: invoice.vat_satang,
    whtSatang: invoice.wht_satang,
    whtRateBps: invoice.wht_rate_bps,
    totalSatang: invoice.total_satang,
    amountSatang: invoice.amount_satang,
    pricesIncludeVat: invoice.prices_include_vat,
    notes: invoice.notes,
    contactTaxId: contact?.tax_id ?? null,
    contactAddress: contact?.billing_address ?? null,
    contactEmail: contact?.email ?? null,
    lines,
  }

  const provider = getProvider(conn.provider as ProviderKey)
  let externalId: string
  try {
    const pushed = await provider.pushInvoice(exportInvoice, {
      transport: connectionTransport(conn.config),
      token: process.env.FLOWACCOUNT_ACCESS_TOKEN,
      baseUrl: process.env.FLOWACCOUNT_BASE_URL,
    })
    externalId = pushed.externalId
  } catch (error) {
    const message = error instanceof Error ? error.message : "Export failed."
    await supabase.from("accounting_sync_map").upsert(
      {
        org_id: ctx.orgId,
        provider: conn.provider,
        local_entity: "invoice",
        local_id: invoice.id,
        status: "error",
        last_error: message,
      },
      { onConflict: "org_id,provider,local_entity,local_id" }
    )
    return { error: message }
  }

  const { error: mapErr } = await supabase.from("accounting_sync_map").upsert(
    {
      org_id: ctx.orgId,
      provider: conn.provider,
      local_entity: "invoice",
      local_id: invoice.id,
      external_id: externalId,
      status: "synced",
      last_error: null,
      last_synced_at: new Date().toISOString(),
    },
    { onConflict: "org_id,provider,local_entity,local_id" }
  )
  if (mapErr) return { error: mapErr.message }

  await writeAudit(ctx, {
    entity: "invoice",
    entityId: invoice.id,
    action: "updated",
    summary: `Exported invoice ${invoice.number} to ${conn.provider} (${externalId})`,
    meta: { provider: conn.provider, externalId, transport: connectionTransport(conn.config) },
  })

  revalidatePath(`/finance/invoices/${invoice.id}`)
  return { externalId }
}
