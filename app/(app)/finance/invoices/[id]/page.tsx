import { ReversePaymentForm } from "../../_components/reverse-payment-form"
import { CreditNoteForm } from "../../_components/credit-note-form"
import { invoiceDisplayNumber } from "@/lib/documents/numbering"
import { CancelDraftButton } from "../../_components/cancel-draft-button"
import { readAll } from "@/lib/supabase/read-all"
import { DocumentTotals } from "@/components/document-totals"
import { WithholdingForm } from "../../_components/withholding-form"
import { RecordHistory } from "@/components/record/record-history"
import Link from "next/link"
import { notFound } from "next/navigation"
import { FileSignature, FileText, FolderKanban, Wallet, Truck } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import { formatTHB, satangToBahtString } from "@/lib/money"
import {
  deriveInvoiceStatus,
  outstandingSatang,
} from "@/lib/metrics/invoice-status"
import type { Enums } from "@/lib/types/database"
import { inventoryData, invoiceStockData, stockMoveCount } from "@/lib/inventory/queries"
import { DeliveryForm, CustomerReturnForm } from "@/app/(app)/inventory/_components/delivery-form"
import { INVOICE_FLOW } from "@/lib/record/status"

import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { InvoiceStatusBadge } from "@/components/status-badge"
import { StatusBar } from "@/components/record/status-bar"
import { RequireSaved } from "@/components/record/record-guard"
import { SmartButtons } from "@/components/record/smart-buttons"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

import { updateInvoice } from "../../actions"
import { activeProductOptions } from "@/lib/products/queries"
import { can } from "@/lib/permissions"
import {
  InvoiceForm,
  type InvoiceFormValues,
  type InvoiceFormSubmitValues,
} from "../../_components/invoice-form"
import { LineGrid } from "@/components/line-grid/line-grid"
import { gridRows } from "@/lib/line-grid/queries"
import { IssueInvoiceForm } from "../../_components/issue-invoice-form"
import { AdoptLegacyInvoiceForm } from "../../_components/adopt-legacy-invoice-form"
import { PaymentForm } from "../../_components/payment-form"
import { ReviewClaimForm } from "../../_components/review-claim-form"
import { getInvoiceAccounting, InvoiceAccountingControls, InvoiceAccountingStatus } from "@edition"
import { EmailInvoiceButton } from "../../_components/email-invoice-button"
import type { Option } from "../../_components/form-fields"

export const dynamic = "force-dynamic"

const PAYMENT_METHOD_LABEL: Record<Enums<"payment_method">, string> = {
  transfer: "Bank transfer",
  cash: "Cash",
  card: "Card",
  promptpay: "PromptPay",
  cheque: "Cheque",
  other: "Other",
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

export default async function InvoiceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const today = todayISO()
  const [deliveryCount, stock] = await Promise.all([stockMoveCount({ sourceId: id }), invoiceStockData(id)])
  const inventory = stock.lines.length > 0 ? await inventoryData() : { products: [], warehouses: [] }
  const stockableCount = stock.lines.length
  const pendingDelivery = stock.lines.filter(line => line.delivered_quantity < line.quantity)
  const manageStock = can(ctx.role, "inventory:manage")
  const canFinance = can(ctx.role, "payment:verify")
  const canReverse = can(ctx.role, "invoice:delete")

  const [
    claimsRes,
    legacyRes,
    invoiceRes,
    lineRows,
    paymentsRes,
    paymentCountRes,
    balanceRes,
    clientsRes,
    projectsRes,
    accounting,
    settingsRes,
  ] = await Promise.all([
    readAll((from, to) => supabase.from("payment_claims").select("id, amount_satang, reference, status").eq("org_id", ctx.orgId).eq("invoice_id",id).order("created_at").order("id").range(from, to)),
    readAll((from, to) => supabase.from("payments").select("id, amount_satang, notes, paid_at, method, verification_state, reconciled_payment_id").eq("org_id", ctx.orgId).neq("verification_state","verified").eq("invoice_id",id).order("id").range(from, to)),
    supabase
      .from("invoices")
      .select(
        "id, number, amount_satang, status, issue_date, due_date, is_recurring, recurring_interval, notes, client_id, project_id, discount_satang, subtotal_satang, vat_satang, total_satang, wht_satang, wht_rate_bps, tax_breakdown, prices_include_vat, source_quote_id, source_milestone_id, version, issued_snapshot_id, clients(name), projects(name)"
      ).eq("org_id", ctx.orgId)
      .eq("id", id)
      .maybeSingle(),
    gridRows(supabase, ctx.orgId, "invoice", id),
    readAll((from, to) => supabase
      .from("invoice_receipts")
      .select("id, amount_satang, paid_at, method, notes").eq("verification_state", "verified").eq("org_id", ctx.orgId)
      .eq("invoice_id", id)
      .order("paid_at", { ascending: false }).order("id").range(from, to)),
    supabase.from("invoice_receipts").select("id", { count: "exact", head: true }).eq("verification_state", "verified").eq("org_id", ctx.orgId).eq("invoice_id", id),
    supabase.from("invoice_balances").select("paid_satang, credited_satang").eq("org_id", ctx.orgId).eq("invoice_id", id).maybeSingle(),
    supabase.from("clients").select("id, name").eq("org_id", ctx.orgId).order("name"),
    supabase.from("projects").select("id, name").eq("org_id", ctx.orgId).order("name"),
    getInvoiceAccounting(ctx.orgId, id),
    supabase.from("org_settings").select("vat_registered, vat_rate_bps").eq("org_id", ctx.orgId).maybeSingle(),
  ])

  const invoice = invoiceRes.data
  if (!invoice) notFound()

  const creditLines = lineRows.filter(row => row.kind === "line")
  const payments = paymentsRes.data ?? []
  if (paymentsRes.error || balanceRes.error || legacyRes.error || settingsRes.error || paymentCountRes.error) throw new Error("Invoice evidence unavailable. Reload before making financial changes.")
  const paid = balanceRes.data?.paid_satang ?? 0
  const credited = balanceRes.data?.credited_satang ?? 0
  const outstanding = outstandingSatang(invoice.amount_satang, paid, credited)
  const effectiveStatus = deriveInvoiceStatus({ ...invoice, credited_satang: credited }, paid, today)

  const clients: Option[] = (clientsRes.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }))
  const projects: Option[] = (projectsRes.data ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }))

  const defaultValues: InvoiceFormValues = {
    client_id: invoice.client_id,
    project_id: invoice.project_id ?? "",
    number: invoice.number,
    issue_date: invoice.issue_date ?? "",
    due_date: invoice.due_date ?? "",
    amountBaht: satangToBahtString(invoice.amount_satang),
    is_recurring: invoice.is_recurring,
    recurring_interval: invoice.recurring_interval ?? undefined,
    notes: invoice.notes ?? "",
  }

  // Bind the invoice id into a real server action. The "use client" InvoiceForm
  // can't receive a plain closure across the RSC boundary — it must be a server
  // action reference (like the /new page passes `createInvoice` directly).
  // Capture the narrowed id in a const so the closure doesn't see `invoice` as
  // possibly-null (control-flow narrowing doesn't cross into nested functions).
  const invoiceId = invoice.id
  async function saveInvoice(values: InvoiceFormSubmitValues) {
    "use server"
    return updateInvoice({ id: invoiceId, ...values })
  }

  const vatRate = settingsRes.data?.vat_registered ? settingsRes.data.vat_rate_bps : 0
  const pendingClaim = (claimsRes.data ?? []).some(claim => claim.status === "pending")
  const lineLock = invoice.issued_snapshot_id ? "Issued lines are frozen; corrections must preserve the original document."
    : invoice.source_quote_id ? "Lines come from the accepted quote."
    : paid > 0 || pendingClaim ? "Payment evidence locks these lines." : null

  return (
    <div className="space-y-6">
      <PageHeader
        title={invoiceDisplayNumber(invoice)}
        description={invoice.clients?.name ?? "Invoice"}
        breadcrumbs={[{ label: "Finance", href: "/finance" }]}
      >
        <InvoiceAccountingControls invoiceId={invoice.id} connected={accounting.connected} />
        <Button
          variant="outline"
          render={
            <Link
              href={`/finance/invoices/${invoice.id}/pdf`}
              target="_blank"
              rel="noopener noreferrer"
            />
          }
        >
          <FileText /> Print / PDF
        </Button>
        <EmailInvoiceButton invoiceId={invoice.id} />
      </PageHeader>

      <Link className="underline" href={`/inventory/documents?sourceId=${id}`}>Delivery documents</Link>
      <SmartButtons
        buttons={[
          { label: "Deliveries", icon: Truck, count: deliveryCount, href: `/inventory/moves?sourceId=${id}`, nextStep: !!invoice.issued_snapshot_id && stockableCount > 0 },
          { label: "Payments", icon: Wallet, count: paymentCountRes.count ?? 0, href: "#payments" },
          {
            label: "Source quote",
            icon: FileSignature,
            count: invoice.source_quote_id ? 1 : 0,
            href: `/quotes/${invoice.source_quote_id}`,
          },
          {
            label: "Project",
            icon: FolderKanban,
            count: invoice.project_id ? 1 : 0,
            href: `/projects/${invoice.project_id}`,
          },
        ]}
      />
      <StatusBar
        label="Invoice status"
        flow={INVOICE_FLOW}
        status={effectiveStatus}
        commands={
          !canFinance
            ? {}
            : {
                issue: "#issue-invoice",
                ...(manageStock && invoice.issued_snapshot_id && pendingDelivery.length > 0 && invoice.status !== "cancelled"
                  ? { deliver: "#deliver" }
                  : {}),
                ...(outstanding > 0 && !["draft", "cancelled"].includes(invoice.status)
                  ? { pay: "#payment-claims" }
                  : {}),
              }
        }
      />

      {manageStock && invoice.issued_snapshot_id && invoice.status !== "cancelled" && pendingDelivery.length > 0 && <DeliveryForm invoiceId={id} lines={pendingDelivery} warehouses={inventory.warehouses.filter(w => w.active)} products={inventory.products} />}
      {stock.lines.length > 0 && invoice.issued_snapshot_id && <div className="space-y-2 rounded-xl border p-4"><h2 className="font-semibold">Stock fulfillment</h2>{stock.lines.map(line => <p key={line.id} className="text-sm">{line.description} · Delivered {line.delivered_quantity} of {line.quantity} {line.unit} · Returned {line.returned_quantity}</p>)}</div>}
      {manageStock && stock.moves.some(move => move.kind === "delivery") && <section className="space-y-3"><h2 className="font-semibold">Customer returns</h2>{stock.moves.filter(move => move.kind === "delivery").map(move => <CustomerReturnForm key={move.id} invoiceId={id} move={move} returnedQuantity={stock.moves.filter(row => row.return_of_move_id === move.id).reduce((sum, row) => sum + Math.round(row.quantity * 1000), 0) / 1000} description={stock.lines.find(line => line.id === move.source_line_id)?.description ?? inventory.products.find(product => product.id === move.product_id)?.name ?? "product"} warehouse={inventory.warehouses.find(warehouse => warehouse.id === move.warehouse_id)?.name ?? "Original warehouse"} />)}</section>}
      <p className="text-sm text-muted-foreground">เอกสารเพื่อการดำเนินงาน / Operational records. VAT and withholding are document calculations only, not a legal tax system, accounting ledger, filing service or e-Tax Invoice. <Link className="underline" href="/finance/business-profile">Business profile</Link></p>
      {invoice.issued_snapshot_id && invoice.wht_satang > 0 ? <p className="text-sm"><Link className="underline" href={`/finance/invoices/${invoice.id}/wht`}>ร่าง 50 ทวิ / Draft withholding certificate</Link>. The payer issues the statutory certificate. This draft is not a Revenue Department form.</p> : null}
      {invoice.status === "draft" && canFinance ? <Card id="issue-invoice"><CardHeader><CardTitle className="text-base">ออกใบแจ้งหนี้ / Issue invoice</CardTitle></CardHeader><CardContent><RequireSaved message="Save your invoice changes below before issuing it."><IssueInvoiceForm orgId={ctx.orgId} invoiceId={invoice.id} version={invoice.version} /></RequireSaved><CancelDraftButton invoiceId={invoice.id} /></CardContent></Card> : null}
      {invoice.issued_snapshot_id ? <p className="text-sm">Issued snapshot retained. Corrections must preserve the original document.</p> : invoice.status !== "draft" ? <div className="space-y-3"><p role="alert" className="text-sm">This legacy record has no issued snapshot. Review it before treating the printable record as an issued document.</p>{can(ctx.role, "payment:verify") && ["sent", "partially_paid", "paid", "overdue"].includes(invoice.status) ? <AdoptLegacyInvoiceForm orgId={ctx.orgId} invoiceId={invoice.id} version={invoice.version} /> : null}</div> : null}
      <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle className="text-base">Overview</CardTitle>
              <InvoiceStatusBadge status={effectiveStatus} />
            </CardHeader>
            <CardContent>
              <DocumentTotals subtotal={invoice.subtotal_satang} discount={invoice.discount_satang} vat={invoice.vat_satang} total={invoice.total_satang} wht={invoice.wht_satang} whtRate={invoice.wht_rate_bps} amountDue={invoice.amount_satang} breakdown={invoice.tax_breakdown} inclusive={invoice.prices_include_vat} />
              {canFinance && invoice.status === "draft" && !invoice.issued_snapshot_id && paid === 0 && !(claimsRes.data ?? []).some(claim => claim.status === "pending") ? <div className="my-4"><WithholdingForm invoiceId={invoice.id} rate={invoice.wht_rate_bps} /></div> : null}
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
                <Field label="Amount" value={formatTHB(invoice.amount_satang)} />
                <Field label="Verified receipts" value={formatTHB(paid)} />
                <Field
                  label="Outstanding"
                  value={
                    <span className={outstanding > 0 ? "font-medium" : ""}>
                      {formatTHB(outstanding)}
                    </span>
                  }
                />
                <Field label="Discount" value={formatTHB(invoice.discount_satang)} />
                <Field label="Issue date" value={invoice.issue_date ?? "—"} />
                <Field label="Due date" value={invoice.due_date ?? "—"} />
                <Field
                  label="Client"
                  value={invoice.clients?.name ?? "—"}
                />
                <Field
                  label="Project"
                  value={invoice.projects?.name ?? "—"}
                />
                <Field
                  label="Recurring"
                  value={
                    invoice.is_recurring
                      ? `Yes · ${invoice.recurring_interval ?? "—"}`
                      : "No"
                  }
                />
                <Field
                  label="Stored status"
                  value={<InvoiceStatusBadge status={invoice.status} />}
                />
                <InvoiceAccountingStatus sync={accounting.sync} />
              </dl>
              {invoice.source_quote_id ? <p className="mt-4 text-sm">Accepted quote terms are authoritative. Linked corrections are needed for changes. Source quote: <Link className="underline" href={`/quotes/${invoice.source_quote_id}`}>View accepted quote</Link></p> : null}
              {invoice.source_milestone_id && invoice.project_id ? <p className="text-sm">Delivery milestone: <Link className="underline" href={`/projects/${invoice.project_id}`}>View project and milestones</Link></p> : null}
              {invoice.notes ? (
                <>
                  <Separator className="my-4" />
                  <Field label="Notes" value={invoice.notes} />
                </>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Line items</CardTitle>
            </CardHeader>
            <CardContent>
              <LineGrid
                document="invoice"
                documentId={invoice.id}
                rows={lineRows}
                editable={!lineLock && can(ctx.role, "payment:verify")}
                lockedMessage={lineLock ?? undefined}
                products={lineLock ? [] : await activeProductOptions()}
                canManageProducts={can(ctx.role, "product:manage")}
                taxRates={vatRate ? [0, vatRate] : [0]}
                defaultTaxRateBps={vatRate}
                basis={{ discountSatang: invoice.discount_satang, pricesIncludeVat: invoice.prices_include_vat, whtRateBps: invoice.wht_rate_bps }}
              />
            </CardContent>
          </Card>

          <Card id="payments">
            <CardHeader>
              <CardTitle className="text-base">Payments</CardTitle>
            </CardHeader>
            <CardContent>
              {payments.length === 0 ? (
                <EmptyState
                  icon={Wallet}
                  title="No payments yet"
                  description="Only verified receipts appear here. Report a payment in the queue before verification."
                  className="border-0"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>{todayISO(new Date(p.paid_at))}</TableCell>
                        <TableCell>{PAYMENT_METHOD_LABEL[p.method]}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {p.notes ?? "—"}
                          {canReverse && p.amount_satang > 0 ? <ReversePaymentForm orgId={ctx.orgId} invoiceId={id} paymentId={p.id} today={today} /> : null}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTHB(p.amount_satang)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card id="payment-claims">
            <CardHeader>
              <CardTitle className="text-base">ตรวจสอบการชำระ / Payment claims</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">Customer reports await verification. Only verified receipts reduce the open balance.</p>
              {claimsRes.error ? <p role="alert">Payment queue unavailable. Reload before approving.</p> : (claimsRes.data ?? []).map(claim => <div key={claim.id} className="space-y-2 border-b py-4">
                <p>{formatTHB(claim.amount_satang)} · {claim.reference} · {claim.status}</p>
                {claim.status === "pending" && canFinance ? <ReviewClaimForm today={today} orgId={ctx.orgId} claimId={claim.id} invoiceId={invoice.id} suggestedBaht={satangToBahtString(claim.amount_satang)} /> : null}
              </div>)}
              {canFinance && outstanding > 0 && !["draft", "cancelled"].includes(invoice.status) && !(claimsRes.data ?? []).some(claim => claim.status === "pending") && !claimsRes.error ? <div className="border-t pt-4"><h3 className="mb-3 text-sm font-medium">แจ้งชำระโดยเจ้าหน้าที่ / Staff report</h3><PaymentForm today={today} orgId={ctx.orgId} invoiceId={invoice.id} suggestedBaht={satangToBahtString(outstanding)} /></div> : null}
              {legacyRes.data?.length ? <div className="mt-6 space-y-4"><h3 className="text-sm font-medium">ตรวจสอบยอดเดิม / Legacy reconciliation</h3><p className="text-xs text-muted-foreground">Retained records are excluded from verified cash. Match each to bank evidence before creating a linked verified receipt.</p>{legacyRes.data.map(legacy => <div key={legacy.id} className="rounded border p-3 space-y-2"><p className="text-sm">{formatTHB(legacy.amount_satang)} · {todayISO(new Date(legacy.paid_at))} · {legacy.verification_state}</p><p className="text-xs text-muted-foreground">{legacy.notes ?? "No original reference"}</p>{legacy.reconciled_payment_id ? <p className="text-xs">Linked verified receipt: {legacy.reconciled_payment_id}</p> : null}{legacy.verification_state === "legacy_unverified" && canFinance && outstanding > 0 && !["draft", "cancelled"].includes(invoice.status) ? <PaymentForm today={today} orgId={ctx.orgId} invoiceId={invoice.id} legacyPaymentId={legacy.id} suggestedBaht={satangToBahtString(Math.min(legacy.amount_satang, outstanding))} /> : null}</div>)}</div> : null}
            </CardContent>
          </Card>
        </div>
      </div>

      {canFinance && invoice.status === "draft" && !invoice.source_quote_id && !invoice.issued_snapshot_id && paid === 0 && !(claimsRes.data ?? []).some(claim => claim.status === "pending") ? <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">Edit invoice</CardTitle>
        </CardHeader>
        <CardContent>
          <InvoiceForm
            clients={clients}
            projects={projects}
            defaultValues={defaultValues}
            submitLabel="Save changes"
            action={saveInvoice}
          />
        </CardContent>
      </Card> : null}

      {invoice.issued_snapshot_id ? <Card className="max-w-3xl"><CardHeader><CardTitle>Credit notes</CardTitle></CardHeader><CardContent className="space-y-4">
        <p>Credited {formatTHB(credited)}</p>
        <CreditNotes orgId={ctx.orgId} invoiceId={id} />
        {canFinance && outstanding + paid > 0 ? <CreditNoteForm orgId={ctx.orgId} invoiceId={id} lines={creditLines.length ? creditLines : [{ id, description: "Historical invoice amount", headerOnly: true }]} /> : null}
      </CardContent></Card> : null}
      <RecordHistory recordType="invoice" recordId={id} />
    </div>
  )
}

async function CreditNotes({ orgId, invoiceId }: { orgId: string; invoiceId: string }) {
  const supabase = await createClient()
  const result = await readAll((from, to) => supabase.from("credit_notes").select("id, number, amount_satang, reason").eq("org_id", orgId).eq("invoice_id", invoiceId).order("created_at").order("id").range(from, to))
  if (result.error) throw new Error("Credit notes unavailable")
  return <ul>{(result.data ?? []).map(note => <li key={note.id}><a className="underline" href={`/finance/credit-notes/${note.id}/pdf`} target="_blank" rel="noreferrer">{note.number}</a> · {formatTHB(note.amount_satang)} · {note.reason}</li>)}</ul>
}
