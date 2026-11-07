import { creditNoteRevenue } from "@/lib/payments/balances"
import { readAll } from "@/lib/supabase/read-all"
import { DocumentTotals } from "@/components/document-totals"
import { RecordHistory } from "@/components/record/record-history"
import Link from "next/link"
import { notFound } from "next/navigation"
import { z } from "zod"
import { Download, FolderKanban, ReceiptText } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { formatTHB, sumSatang } from "@/lib/money"
import { quoteIsEditable, serviceAmountBaht } from "@/lib/workflows/service"
import { activeProductOptions } from "@/lib/products/queries"
import { can } from "@/lib/permissions"
import { QUOTE_FLOW } from "@/lib/record/status"
import type { Enums } from "@/lib/types/database"

import { PageHeader } from "@/components/page-header"
import { PublicReferenceSlot } from "@/components/documents/public-reference-slot"
import { SalesChainBar } from "@/components/documents/sales-chain-bar"
import { salesChain } from "@/lib/documents/sales-chain"
import { QuoteStatusBadge } from "@/components/status-badge"
import { StatusBar } from "@/components/record/status-bar"
import { SmartButtons, recordHref } from "@/components/record/smart-buttons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { LineGrid } from "@/components/line-grid/line-grid"
import { gridRows } from "@/lib/line-grid/queries"

import { setQuoteStatus, updateQuote } from "../actions"
import {
  QuoteForm,
  type QuoteFormValues,
  type QuoteFormSubmitValues,
} from "../_components/quote-form"
import { QuoteInvoiceForm } from "../_components/quote-invoice-form"
import { CancelQuoteInvoiceButton } from "../_components/cancel-quote-invoice-button"
import { EmailQuoteButton } from "../_components/email-quote-button"
import type { Option } from "../_components/form-fields"
import { dealOptions } from "@/app/(app)/deals/_lib/deal-options"
import { DealWonOffer } from "@/app/(app)/deals/_components/deal-won-offer"

export const dynamic = "force-dynamic"

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

export default async function QuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const [quoteRes, itemsRes, clientsRes, projectsRes, invoicesRes, settingsRes, lineRows] = await Promise.all([
    supabase
      .from("quotes")
      .select(
        "id, number, status, issue_date, valid_until, accepted_at, subtotal_satang, discount_satang, total_satang, vat_satang, tax_breakdown, prices_include_vat, notes, client_id, project_id, deal_id, clients(name)"
      ).eq("org_id", ctx.orgId)
      .eq("id", id)
      .maybeSingle(),
    readAll((from, to) => supabase
      .from("quote_items")
      .select("id, description, quantity, invoiced_quantity")
      .eq("org_id", ctx.orgId)
      .eq("quote_id", id)
      .order("position", { ascending: true }).order("id").range(from, to)),
    readAll((from, to) => supabase.from("clients").select("id, name").eq("org_id", ctx.orgId).order("name").order("id").range(from, to)),
    readAll((from, to) => supabase.from("projects").select("id, name").eq("org_id", ctx.orgId).order("name").order("id").range(from, to)),
    readAll((from, to) => supabase.from("invoices")
      .select("id, number, status, quote_invoice_kind, quote_deposit_satang, total_satang, issued_snapshot_id")
      .eq("org_id", ctx.orgId).eq("source_quote_id", id)
      .order("created_at").order("id").range(from, to)),
    supabase.from("org_settings").select("vat_registered, vat_rate_bps").eq("org_id", ctx.orgId).maybeSingle(),
    gridRows(supabase, ctx.orgId, "quote", id),
  ])

  const quote = quoteRes.data
  if (!quote) notFound()

  const { data: deliveryMilestones, error: milestoneError } = await readAll((from, to) => supabase
    .from("milestones")
    .select("id, title, done, project_id")
    .eq("org_id", ctx.orgId)
    .eq("source_quote_id", quote.id)
    .order("created_at", { ascending: true }).order("id").range(from, to))
  if (milestoneError) throw new Error(milestoneError.message)

  if (itemsRes.error || clientsRes.error || projectsRes.error || invoicesRes.error || settingsRes.error) throw new Error("Quote details unavailable")
  const items = itemsRes.data ?? []
  const invoices = invoicesRes.data ?? []
  const credits = await creditNoteRevenue(supabase, ctx.orgId)
  const linkedCredits = credits.filter(credit => invoices.some(invoice => invoice.id === credit.invoice_id))
  const invoicedTotal = sumSatang(invoices.filter(invoice => invoice.status !== "cancelled").map(invoice => invoice.total_satang)) - sumSatang(linkedCredits.map(credit => credit.total_satang))
  const canAccept = can(ctx.role, "quote:convert")
  const canConvert = canAccept && ["accepted", "converted"].includes(quote.status)
  const flow = {
    ...QUOTE_FLOW,
    next: {
      ...QUOTE_FLOW.next,
      sent: { ...QUOTE_FLOW.next.sent, primary: canAccept ? QUOTE_FLOW.next.sent.primary : undefined },
      accepted: { primary: { label: "Create draft invoice", command: "convert" as const } },
      converted: { primary: { label: "Create draft invoice", command: "convert" as const } },
    },
  }
  const latest = invoices.filter((invoice) => invoice.status !== "cancelled").at(-1)
  const balance = latest?.issued_snapshot_id
    ? (await supabase.from("invoice_balances").select("outstanding_satang").eq("org_id", ctx.orgId).eq("invoice_id", latest.id).maybeSingle()).data
    : null
  // A missing balance row reads as fully outstanding, so the next step stays "record payment".
  const liveInvoice = latest && { id: latest.id, status: latest.status, issued: !!latest.issued_snapshot_id, outstandingSatang: balance?.outstanding_satang ?? latest.total_satang }
  const chain = salesChain({ quoteStatus: quote.status, invoice: liveInvoice, vatRegistered: !!settingsRes.data?.vat_registered })
  const nextAnchor = chain.next?.command === "pay" ? "#payment-claims" : chain.next?.command === "issue" ? "#issue-invoice" : null
  const editable = quoteIsEditable(quote.status)
  const vatRate = settingsRes.data?.vat_registered ? settingsRes.data.vat_rate_bps : 0
  const linkedProject = (projectsRes.data ?? []).find((p) => p.id === quote.project_id)

  const clients: Option[] = (clientsRes.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }))
  const projects: Option[] = (projectsRes.data ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }))

  const defaultValues: QuoteFormValues = {
    client_id: quote.client_id,
    project_id: quote.project_id ?? "",
    deal_id: quote.deal_id ?? "",
    number: quote.number,
    issue_date: quote.issue_date ?? "",
    valid_until: quote.valid_until ?? "",
    discountBaht: serviceAmountBaht(quote.discount_satang),
    notes: quote.notes ?? "",
  }

  // Bind the quote id into a real server action (see invoices/[id] for why a
  // plain closure can't cross the RSC boundary to a "use client" form).
  const quoteId = quote.id
  async function saveQuote(values: QuoteFormSubmitValues) {
    "use server"
    return updateQuote({ id: quoteId, ...values })
  }
  async function transitionQuote(to: Enums<"quote_status">) {
    "use server"
    if (to === "converted") return { error: "Use quote conversion to create the linked records." }
    return setQuoteStatus({ id: quoteId, status: to })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={quote.number}
        description={quote.clients?.name ?? "Quote"}
        breadcrumbs={[{ label: "Quotes", href: "/quotes" }]}
      >
        <Button
          variant="outline"
          render={<a href={`/quotes/${quote.id}/pdf`} target="_blank" rel="noreferrer" />}
        >
          <Download /> Download PDF
        </Button>
        <EmailQuoteButton quoteId={quote.id} />
      </PageHeader>
      <PublicReferenceSlot kind="quote" recordId={quote.id} />

      <SmartButtons
        buttons={[
          {
            label: "Invoices",
            icon: ReceiptText,
            count: invoices.length,
            href: recordHref(
              { data: invoices, count: invoices.length },
              (invoiceId) => `/finance/invoices/${invoiceId}`,
              "#invoices"
            ),
          },
          {
            label: "Project",
            icon: FolderKanban,
            count: quote.project_id ? 1 : 0,
            href: `/projects/${quote.project_id}`,
          },
        ]}
      />
      <StatusBar
        label="Quote status"
        flow={flow}
        status={quote.status}
        transition={transitionQuote}
        record={{ recordType: "quote", recordId: quote.id }}
        commands={
          canConvert
            ? { convert: (props) => <QuoteInvoiceForm quoteId={quote.id} orgId={ctx.orgId} lines={items} {...props} /> }
            : {}
        }
      />
      <Card><CardContent className="pt-4"><SalesChainBar chain={chain} nextHref={liveInvoice && nextAnchor && canAccept ? `/finance/invoices/${liveInvoice.id}${nextAnchor}` : undefined} /></CardContent></Card>
      <DealWonOffer quoteId={quote.id} />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Overview</CardTitle>
          <QuoteStatusBadge status={quote.status} />
        </CardHeader>
        <CardContent className="space-y-4">
          <DocumentTotals subtotal={quote.subtotal_satang} discount={quote.discount_satang} vat={quote.vat_satang} total={quote.total_satang} breakdown={quote.tax_breakdown} inclusive={quote.prices_include_vat} />
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Issue date" value={quote.issue_date ?? "—"} />
            <Field label="Valid until" value={quote.valid_until ?? "—"} />
            {quote.accepted_at ? <Field label="Accepted at" value={new Date(quote.accepted_at).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })} /> : null}
            <Field label="Client" value={quote.clients?.name ?? "—"} />
            <Field label="Project" value={linkedProject ? (
              <Link href={`/projects/${linkedProject.id}`} className="hover:underline">{linkedProject.name}</Link>
            ) : "—"} />
          </dl>

          {invoices.length ? <dl id="invoices"><Field label="Invoices" value={
            <ul className="space-y-1">
              {invoices.map((invoice) => <li key={invoice.id} className="flex items-center gap-2">
                <Link href={`/finance/invoices/${invoice.id}`} className="hover:underline">{invoice.number} · {invoice.status}{invoice.quote_invoice_kind === "deposit" ? ` · Deposit ${formatTHB(invoice.quote_deposit_satang)}` : ""}</Link>
                {canAccept && invoice.status === "draft" ? <CancelQuoteInvoiceButton quoteId={quote.id} invoiceId={invoice.id} number={invoice.number} /> : null}
              </li>)}
            </ul>
          } /></dl> : null}
          {invoices.length ? <Field label="Invoiced vs quote" value={<div>
            {linkedCredits.length ? <p>Includes credit notes of {formatTHB(sumSatang(linkedCredits.map(credit => credit.total_satang)))}</p> : null}
            <p>{formatTHB(invoicedTotal)} / {formatTHB(quote.total_satang)}</p>
            <p className="text-muted-foreground text-sm">Difference: {formatTHB(invoicedTotal - quote.total_satang)}. Each invoice rounds VAT independently; a few satang may differ after the full scope is invoiced.</p>
          </div>} /> : null}

          {deliveryMilestones?.length ? (
            <Field label="Delivery milestones" value={
              <ul className="space-y-1">
                {deliveryMilestones.map((milestone) => (
                  <li key={milestone.id}>
                    <Link href={`/projects/${milestone.project_id}#milestone-${milestone.id}`} className="hover:underline">
                      {milestone.title} · {milestone.done ? "Done" : "Pending"}
                    </Link>
                  </li>
                ))}
              </ul>
            } />
          ) : null}

          {quote.notes ? (
            <>
              <Separator />
              <Field label="Notes" value={quote.notes} />
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
            document="quote"
            documentId={quote.id}
            rows={lineRows}
            editable={editable && can(ctx.role, "record:write")}
            lockedMessage={quote.status === "accepted" ? "Accepted scope is locked." : editable ? undefined : "This quote is locked."}
            products={editable ? await activeProductOptions() : []}
            canManageProducts={can(ctx.role, "product:manage")}
            taxRates={vatRate ? [0, vatRate] : [0]}
            defaultTaxRateBps={vatRate}
            basis={{ discountSatang: quote.discount_satang, pricesIncludeVat: quote.prices_include_vat, whtRateBps: 0 }}
          />
        </CardContent>
      </Card>

      {editable ? (
        <Card className="max-w-3xl">
          <CardHeader>
            <CardTitle className="text-base">Edit quote</CardTitle>
          </CardHeader>
          <CardContent>
            <QuoteForm
              clients={clients}
              projects={projects}
              deals={await dealOptions(supabase, ctx.orgId, quote.deal_id)}
              defaultValues={defaultValues}
              submitLabel="Save changes"
              action={saveQuote}
            />
          </CardContent>
        </Card>
      ) : null}
      <RecordHistory recordType="quote" recordId={id} />
    </div>
  )
}
