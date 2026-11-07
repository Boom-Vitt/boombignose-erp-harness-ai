import { notFound } from "next/navigation"
import { z } from "zod"
import { requireOrgContext } from "@/lib/auth"
import { renderDocumentHtml } from "@/lib/documents/printable"
import { publicReferenceForDocument } from "@/lib/documents/public-reference-query"
import { purchaseDetail } from "@/lib/purchasing/queries"
import { purchaseTotal } from "@/lib/purchasing/quantities"
import { serviceLineAmount } from "@/lib/workflows/service"
import { createClient } from "@/lib/supabase/server"
import { documentSections } from "@/lib/line-grid/queries"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext()
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const db = await createClient()
  const [{ order, lines }, sections, reference] = await Promise.all([
    purchaseDetail(id),
    documentSections(db, ctx.orgId, "purchase_order", id),
    publicReferenceForDocument(db, ctx.orgId, "purchase_order", id),
  ])
  const total = purchaseTotal(lines)
  return new Response(renderDocumentHtml({
    kind: ["draft", "sent"].includes(order.status) ? "Request for quotation" : "Purchase order",
    number: order.number, status: order.status, orgName: ctx.orgName, clientName: order.vendors?.name ?? "Vendor",
    buyerAddress: order.vendors?.address, buyerTaxId: order.vendors?.tax_id, issueDate: order.order_date,
    notes: order.notes, subtotalSatang: total, totalSatang: total, sections,
    items: lines.map(line => ({ description: `${line.description} (${line.unit})`, quantity: line.quantity, unit_price_satang: line.unit_cost_satang, amount_satang: serviceLineAmount(line.quantity, line.unit_cost_satang) })),
    publicReference: reference.display,
  }), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } })
}
