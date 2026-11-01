import Link from "next/link"
import { Receipt, Users, Package } from "lucide-react"
import { requireOrgContext } from "@/lib/auth"
import { inventoryData, stockMoveCount } from "@/lib/inventory/queries"
import { createClient } from "@/lib/supabase/server"
import { can } from "@/lib/permissions"
import { purchaseDetail, purchaseOptions } from "@/lib/purchasing/queries"
import { billAmount, hasUnbilledQuantities, purchaseTotal, receiptLimit } from "@/lib/purchasing/quantities"
import { formatTHB } from "@/lib/money"
import { PURCHASE_FLOW } from "@/lib/record/status"
import { PageHeader } from "@/components/page-header"
import { PublicReferenceSlot } from "@/components/documents/public-reference-slot"
import { StatusBar } from "@/components/record/status-bar"
import { SmartButtons } from "@/components/record/smart-buttons"
import { RecordHistory } from "@/components/record/record-history"
import { Button } from "@/components/ui/button"
import { LineGrid } from "@/components/line-grid/line-grid"
import { gridRows } from "@/lib/line-grid/queries"
import { transitionPurchase, approvePurchase, reopenPurchaseRFQ } from "../actions"
import { sendPurchaseRFQ } from "../email-actions"
import { PurchaseAction } from "../_components/action-button"
import { PurchaseForm } from "../_components/purchase-form"
import { ReceiptForm, PurchaseReturnForm } from "../_components/receipt-form"
import { BillForm } from "../_components/bill-form"
import { VendorBills } from "../_components/bills"

export const dynamic = "force-dynamic"
export default async function PurchasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await requireOrgContext()
  const [{ order, lines, bills, matches, toleranceBps }, { warehouses }, receiptCount, lineRows] = await Promise.all([purchaseDetail(id), inventoryData(), stockMoveCount({ sourceId: id }), createClient().then(db => gridRows(db, ctx.orgId, "purchase_order", id))])
  const db = await createClient()
  const { data: policy, error: policyError } = await db.from("org_settings").select("over_receipt_tolerance_percent,purchase_approval_threshold_satang").eq("org_id", ctx.orgId).maybeSingle()
  if (policyError) throw new Error("Purchase policy unavailable")
  const manage = can(ctx.role, "purchase:manage")
  const editable = manage && order.status === "draft"
  const options = editable ? await purchaseOptions() : { products: [], vendors: [] }
  const products = options.products
  const tolerancePercent = policy?.over_receipt_tolerance_percent ?? 0
  const receivable = ["confirmed", "received", "billed"].includes(order.status) && lines.some(line => line.received_quantity < receiptLimit(line, tolerancePercent))
  const unbilled = billAmount(lines)
  const billable = hasUnbilledQuantities(lines)
  const hasReceipts = lines.some(line => line.received_quantity > 0)
  const flow = { ...PURCHASE_FLOW, next: { ...PURCHASE_FLOW.next, confirmed: { ...PURCHASE_FLOW.next.confirmed, secondary: PURCHASE_FLOW.next.confirmed.secondary?.filter(action => !("to" in action) || (action.to === "closed" ? hasReceipts : action.to !== "cancelled" || !hasReceipts)) } } }
  return <div className="space-y-6">
    <PageHeader title={order.number} description={order.vendors?.name ?? "Purchase order"}>
      <Button variant="outline" render={<Link href={`/inventory/documents?sourceId=${id}`} />}>Receipt documents</Button>
      <Button variant="outline" render={<Link href={`/purchases/${id}/pdf`} target="_blank" />}>Print RFQ / PDF</Button>
    </PageHeader>
    <PublicReferenceSlot kind="purchase_order" recordId={id} />
    <StatusBar label="Purchase status" flow={flow} status={order.status} transition={manage ? transitionPurchase.bind(null, id) : undefined} commands={manage ? {
      send_rfq: ({ label, variant }) => <PurchaseAction action={sendPurchaseRFQ.bind(null, id)} label={label} variant={variant} />,
      receive: "#receive",
      ...(billable ? { bill: "#match-bill" } : {}),
    } : {}} />
    {order.rfq_delivery_key && <p role="status" className="rounded-lg border p-3 text-sm">{order.rfq_delivered_at ? "RFQ delivery accepted." : order.rfq_delivery_error ? `RFQ delivery failed: ${order.rfq_delivery_error}. Verify non-delivery with the provider before reopening. An interrupted request may already have been accepted.` : "RFQ delivery claimed. Verify its outcome before recovery; it will not be sent again automatically."}</p>}
    {manage && ["draft", "sent"].includes(order.status) && policy?.purchase_approval_threshold_satang != null && purchaseTotal(lines) > policy.purchase_approval_threshold_satang && <div className="space-y-2 rounded-lg border p-3"><p>Owner/admin approval is required before confirmation. Editing the approved content requires approval again.</p>{order.approved_at && <p>Last approved {new Date(order.approved_at).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })}.</p>}<PurchaseAction action={approvePurchase.bind(null, id)} label="Approve purchase order" /></div>}
    {manage && order.status === "sent" && order.rfq_delivery_error && !order.rfq_delivered_at && order.rfq_delivery_key && <PurchaseAction action={reopenPurchaseRFQ.bind(null, id, order.rfq_delivery_key, true)} label="Verified not delivered: reopen RFQ for editing" />}
    <SmartButtons buttons={[
      { label: "Receipts", icon: Package, href: `/inventory/moves?sourceId=${id}`, count: receiptCount, nextStep: true },
      { label: "Bills", icon: Receipt, href: "#bills", count: bills.length, nextStep: true },
      { label: "Vendor", icon: Users, href: `/vendors/${order.vendor_id}`, count: 1, value: order.vendors?.name },
    ]} />
    <dl className="grid gap-4 rounded-xl border p-5 sm:grid-cols-3"><div><dt className="text-sm text-muted-foreground">Order date</dt><dd>{order.order_date}</dd></div><div><dt className="text-sm text-muted-foreground">Expected date</dt><dd>{order.expected_date ?? "—"}</dd></div><div><dt className="text-sm text-muted-foreground">Total</dt><dd className="font-semibold">{formatTHB(purchaseTotal(lines))}</dd></div>{order.notes && <div className="sm:col-span-3"><dt className="text-sm text-muted-foreground">Notes</dt><dd className="whitespace-pre-wrap">{order.notes}</dd></div>}</dl>
    <section aria-label="Purchase lines" className="space-y-2">
      <LineGrid document="purchase_order" documentId={id} rows={lineRows} editable={editable} products={products} canManageProducts={can(ctx.role, "product:manage")} />
      {!lines.length && <p className="text-sm text-muted-foreground">Add a line before sending or confirming this order.</p>}
    </section>
    {editable && <PurchaseForm vendors={options.vendors} today={order.order_date} order={order} />}
    {manage && receivable && <ReceiptForm orderId={id} lines={lines} warehouses={warehouses.filter(w => w.active)} tolerancePercent={tolerancePercent} />}
    {manage && can(ctx.role, "inventory:manage") && hasReceipts && <PurchaseReturnForm orderId={id} lines={lines.filter(line => line.received_quantity > 0)} warehouses={warehouses.filter(w => w.active)} />}
    {order.status === "closed" && <p className="text-sm">The remaining quantities are closed. Received quantities can still be billed or returned.</p>}
    {unbilled > 0 && <p className="text-sm">Received and not yet billed: {formatTHB(unbilled)}</p>}
    {manage && billable && ["confirmed", "received", "closed", "billed"].includes(order.status) && <BillForm key={lines.map(line => `${line.id}:${line.received_quantity}:${line.returned_quantity}:${line.billed_quantity}`).join(",")} orderId={id} lines={lines} terms={order.vendors?.payment_terms_days ?? 30} toleranceBps={toleranceBps} />}
    {matches.filter(match => match.variance_reason).map(match => <p key={match.id} className="rounded-lg border p-3 text-sm">{match.vendor_reference} · Accepted variance · {match.variance_reason}</p>)}
    <VendorBills bills={bills} canManage={manage} lines={lines} matches={matches} />
    <RecordHistory recordType="purchase_order" recordId={id} />
  </div>
}
