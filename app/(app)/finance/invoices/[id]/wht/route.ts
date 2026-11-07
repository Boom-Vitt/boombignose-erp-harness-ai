import { createClient } from "@/lib/supabase/server"
import { z } from "zod"
import { requireOrgContext } from "@/lib/auth"
import { invoiceSnapshotDocument, parseInvoiceSnapshot } from "@/lib/documents/invoice-snapshot"
import { calculateTax } from "@/lib/tax/totals"
import { renderWhtCertificate } from "@/lib/tax/wht-certificate"

/** GET /finance/invoices/[id]/wht — draft 50 ทวิ from the issued snapshot only. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) return new Response("Invoice not found", { status: 404 })
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const invoice = await supabase.from("invoices").select("id, issued_snapshot_id").eq("org_id", ctx.orgId).eq("id", id).maybeSingle()
  if (invoice.error) return new Response("Withholding certificate unavailable", { status: 503 })
  if (!invoice.data?.issued_snapshot_id) return new Response("Issue the operational invoice before drafting a withholding certificate", { status: 404 })
  const stored = await supabase.from("invoice_snapshots").select("snapshot").eq("org_id", ctx.orgId).eq("invoice_id", id).eq("id", invoice.data.issued_snapshot_id).maybeSingle()
  if (stored.error || !stored.data) return new Response("Issued document unavailable", { status: 503 })
  try {
    const doc = invoiceSnapshotDocument(stored.data.snapshot, "issued", 0, 0)
    const snapshot = parseInvoiceSnapshot(stored.data.snapshot)
    if (snapshot.kind === "legacy_operational_invoice") return new Response("A legacy record has no priced lines to draft a withholding certificate", { status: 404 })
    const totals = calculateTax(
      snapshot.lines.map((line) => ({ amount_satang: line.amountSatang, tax_rate_bps: line.taxRateBps })),
      snapshot.document.discountSatang,
      snapshot.document.pricesIncludeVat,
      snapshot.document.whtRateBps,
    )
    if (totals.whtSatang !== snapshot.document.whtSatang) return new Response("Issued withholding does not match the snapshot", { status: 503 })
    const html = renderWhtCertificate({
      reference: doc.number,
      issueDate: doc.issueDate ?? null,
      payerName: doc.clientName,
      payerAddress: doc.buyerAddress ?? null,
      payerTaxId: doc.buyerTaxId ?? null,
      payeeName: doc.orgName,
      payeeAddress: doc.sellerAddress ?? null,
      payeeTaxId: doc.sellerTaxId ?? null,
      income: snapshot.lines.map((line) => line.description).join("; "),
      baseSatang: totals.baseSatang,
      whtSatang: totals.whtSatang,
      whtRateBps: snapshot.document.whtRateBps,
    })
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" } })
  } catch (error) {
    const message = error instanceof Error ? error.message : "Withholding certificate unavailable"
    const status = message === "No withholding to certify" ? 404 : 503
    return new Response(message, { status })
  }
}
