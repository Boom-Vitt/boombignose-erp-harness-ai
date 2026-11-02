import { SearchFacets } from "@/components/search/search-facets"
import { GroupedTableRows } from "@/components/search/grouped-table-rows"
import { parseFacets, matchesFacets, facetLabel, type SearchParams } from "@/lib/search-facets"
import { getFacetSavedViews } from "@/lib/queries/saved-views"
import { monthKey } from "@/lib/dates"
import Link from "next/link"
import { FileText, FilePlus2 } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { readAll } from "@/lib/supabase/read-all"
import { requireOrgContext } from "@/lib/auth"
import { formatTHB } from "@/lib/money"

import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

import { SalesChainBar } from "@/components/documents/sales-chain-bar"
import { salesChain } from "@/lib/documents/sales-chain"
import { quoteInvoices } from "@/lib/documents/sales-chain-query"
import { can } from "@/lib/permissions"

import { ConvertQuoteButton } from "./_components/convert-quote-button"
import { QuoteStatusBadge } from "./_components/quote-status-badge"

export const dynamic = "force-dynamic"

export default async function QuotesPage({ searchParams }: { searchParams: Promise<SearchParams> } = { searchParams: Promise.resolve({}) }) {
  const config = parseFacets(await searchParams, "quotes")
  const now = new Date()
  const savedViews = await getFacetSavedViews("quotes")
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const { data, error } = await readAll((from, to) => supabase
    .from("quotes")
    .select(
      "id, number, status, total_satang, valid_until, issue_date, client_id, owner, clients(name)"
    ).eq("org_id", ctx.orgId)
    .order("issue_date", { ascending: false }).order("id").range(from, to))

  if (error) throw new Error("Quotes unavailable. Please reload.")
  const [invoiceByQuote, settings] = await Promise.all([
    quoteInvoices(supabase, ctx.orgId),
    supabase.from("org_settings").select("vat_registered").eq("org_id", ctx.orgId).maybeSingle(),
  ])
  if (settings.error) throw new Error("Quotes unavailable. Please reload.")
  const canConvert = can(ctx.role, "quote:convert")
  const quotes = (data ?? []).filter((q) => matchesFacets(config, {
    text: `${q.number} ${q.clients?.name ?? ""}`, status: q.status, date: q.issue_date, owner: q.owner,
  }, ctx.userId, now))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Quotes"
        description="Draft proposals, track acceptance, and convert to invoices."
      >
        <Button render={<Link href="/quotes/new" />}>
          <FilePlus2 /> New quote
        </Button>
      </PageHeader>

      <SearchFacets list="quotes" config={config} savedViews={savedViews} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Quotes</CardTitle>
        </CardHeader>
        <CardContent>
          {quotes.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={Object.keys(config).length ? "No matching quotes" : "No quotes yet"}
              description={Object.keys(config).length ? "No quotes match the selected filters." : "Create your first quote to send a proposal to a client."}
              action={
                <Button render={<Link href="/quotes/new" />}>
                  <FilePlus2 /> New quote
                </Button>
              }
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Number</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Valid until</TableHead>
                  <TableHead>Chain / ลำดับเอกสาร</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <GroupedTableRows rows={quotes} colSpan={6} amount={(q) => q.total_satang}
                  group={config.groupBy ? (q) => config.groupBy === "client"
                    ? { key: q.client_id, label: q.clients?.name ?? "Unassigned" }
                    : config.groupBy === "month" ? { key: monthKey(q.issue_date), label: monthKey(q.issue_date) }
                    : { key: q.status, label: facetLabel(q.status) } : undefined}>
                {(q) => {
                  const invoice = invoiceByQuote.get(q.id)
                  const chain = salesChain({ quoteStatus: q.status, invoice, vatRegistered: !!settings.data?.vat_registered })
                  return (
                  <TableRow key={q.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/quotes/${q.id}`}
                        className="hover:underline"
                      >
                        {q.number}
                      </Link>
                    </TableCell>
                    <TableCell>{q.clients?.name ?? "—"}</TableCell>
                    <TableCell>
                      <QuoteStatusBadge status={q.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTHB(q.total_satang)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {q.valid_until ?? "—"}
                    </TableCell>
                    <TableCell className="space-y-1">
                      <SalesChainBar chain={chain} compact />
                      {chain.next?.command === "convert" && canConvert ? (
                        <ConvertQuoteButton quoteId={q.id} orgId={ctx.orgId} label={`${chain.next.th} / ${chain.next.en}`} variant="outline" />
                      ) : invoice ? (
                        <Link className="text-xs underline" href={`/finance/invoices/${invoice.id}`}>{invoice.number}{chain.next ? ` → ${chain.next.th}` : ""}</Link>
                      ) : chain.next ? <Link className="text-xs underline" href={`/quotes/${q.id}`}>{chain.next.th}</Link> : null}
                    </TableCell>
                  </TableRow>
                  )
                }}</GroupedTableRows>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
