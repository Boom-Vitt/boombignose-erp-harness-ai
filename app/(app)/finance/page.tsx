import { invoiceBalances, creditNoteRevenue } from "@/lib/payments/balances"
import { invoiceDisplayNumber } from "@/lib/documents/numbering"
import { readAll } from "@/lib/supabase/read-all"
import { can } from "@/lib/permissions"
import { markBillPaid } from "@/app/(app)/purchases/actions"
import { PurchaseAction } from "@/app/(app)/purchases/_components/action-button"
import { SearchFacets } from "@/components/search/search-facets"
import { GroupedTableRows } from "@/components/search/grouped-table-rows"
import { parseFacets, matchesFacets, facetLabel, type SearchParams } from "@/lib/search-facets"
import { getFacetSavedViews } from "@/lib/queries/saved-views"
import { monthKey } from "@/lib/dates"
import Link from "next/link"
import {
  FileWarning,
  TrendingUp,
  Flame,
  Repeat,
  FilePlus2,
  ReceiptText,
  Receipt,
  Coins,
} from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { canDownloadAccountantPack } from "@/lib/finance/accountant-pack"
import { currentMonthKey, todayISO } from "@/lib/dates"
import { formatTHB, sumSatang } from "@/lib/money"
import { canReviewMonthEndClose } from "@/lib/finance/close-checklist"
import {
  revenueForMonth,
  costsForMonth,
  subscriptionMrr,
  unpaidTotal,
  unpaidCount,
} from "@/lib/metrics/finance"
import {
  deriveInvoiceStatus,
  outstandingSatang,
} from "@/lib/metrics/invoice-status"
import type { Enums } from "@/lib/types/database"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { EmptyState } from "@/components/empty-state"
import { InvoiceStatusBadge } from "@/components/status-badge"
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"

import { DeleteCostButton } from "./_components/delete-cost-button"

export const dynamic = "force-dynamic"

const COST_CATEGORY_LABEL: Record<Enums<"cost_category">, string> = {
  software: "Software",
  contractor: "Contractor",
  infra: "Infrastructure",
  marketing: "Marketing",
  salary: "Salary",
  inventory: "Inventory",
  other: "Other",
}

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const month = currentMonthKey()
  const today = todayISO()

  const params = await searchParams
  const config = parseFacets(params, "finance")
  const now = new Date()

  const [invoicesRes, paymentsRes, costsRes, savedViews, subscriptionsRes, settingsRes] =
    await Promise.all([
      readAll((from, to) => supabase
        .from("invoices")
        .select(
          "id, number, issued_snapshot_id, amount_satang, total_satang, vat_satang, status, due_date, issue_date, is_recurring, recurring_interval, client_id, clients(name, owner)"
        )
        .eq("org_id", ctx.orgId)
        .order("issue_date", { ascending: false }).order("id").range(from, to)),
      readAll((from, to) => supabase.from("payments").select("invoice_id, amount_satang, paid_at").eq("verification_state", "verified").eq("org_id", ctx.orgId).order("id").range(from, to)),
      readAll((from, to) => supabase
        .from("costs")
        .select(
          "id, category, amount_satang, incurred_on, vendor, project_id, projects(name), vendor_id, purchase_order_id, expense_claim_id, bill_number, bill_date, due_date, paid_at, vendor_invoice_reference, input_vat_rate, input_vat_satang"
        )
        .eq("org_id", ctx.orgId)
        .order("incurred_on", { ascending: false }).order("id").range(from, to)),
      getFacetSavedViews("finance"),
      readAll((from, to) => supabase
        .from("subscriptions")
        .select("status, amount_satang, interval")
        .eq("org_id", ctx.orgId)
        .eq("status", "active").order("id").range(from, to)),
      supabase.from("org_settings").select("vat_registered").eq("org_id", ctx.orgId).maybeSingle(),
    ])

  if (invoicesRes.error || paymentsRes.error || costsRes.error || subscriptionsRes.error || settingsRes.error) throw new Error("Finance data unavailable. Reload before relying on totals.")
  const invoices = invoicesRes.data ?? []
  const payments = paymentsRes.data ?? []
  const costs = costsRes.data ?? []
  const activeSubscriptions = subscriptionsRes.data ?? []

  // Sum payments per invoice.
  const [balances, credits] = await Promise.all([invoiceBalances(supabase, ctx.orgId), creditNoteRevenue(supabase, ctx.orgId)])

  const invoiceRows = invoices.map((inv) => {
    const paid = balances.get(inv.id)?.paid_satang ?? 0
    return {
      ...inv,
      displayNumber: invoiceDisplayNumber(inv),
      paid_satang: paid,
      outstanding: outstandingSatang(inv.amount_satang, paid, balances.get(inv.id)?.credited_satang ?? 0),
      effectiveStatus: deriveInvoiceStatus({ ...inv, credited_satang: balances.get(inv.id)?.credited_satang ?? 0 }, paid, today),
    }
  })

  // Status filter uses the same verified-receipt effective status as the export.
  const filteredInvoiceRows = invoiceRows.filter((inv) => matchesFacets(config, {
    text: `${inv.number} ${inv.displayNumber} ${inv.clients?.name ?? ""}`, status: inv.effectiveStatus, date: inv.issue_date, owner: inv.clients?.owner ?? null,
  }, ctx.userId, now))

  // Metrics.
  const invoicesWithPaid = invoices.map((inv) => ({
    status: inv.status,
    amount_satang: inv.amount_satang - (balances.get(inv.id)?.credited_satang ?? 0),
    paid_satang: balances.get(inv.id)?.paid_satang ?? 0,
  }))
  const unpaidSatang = unpaidTotal(invoicesWithPaid)
  const openCount = unpaidCount(invoicesWithPaid)
  const revenueSatang = revenueForMonth(invoices, month) - sumSatang(credits.filter(credit => monthKey(credit.issue_date) === month).map(credit => credit.base_satang))
  const cashReceivedSatang = sumSatang(payments.filter(payment => monthKey(payment.paid_at) === month).map(payment => payment.amount_satang))
  const costsSatang = costsForMonth(costs, month, undefined, settingsRes.data?.vat_registered ?? false)
  // MRR is derived from active subscriptions (source of truth) for consistency
  // with the dashboard.
  const mrrSatang = subscriptionMrr(activeSubscriptions)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Finance"
        description="การเงิน / Verified receipts, receivables, and recorded operating costs."
      >
        {canReviewMonthEndClose(ctx.role) ? <Button variant="outline" render={<Link href="/reports#month-end-close" />}>Month-end close</Button> : null}
        <Button variant="outline" render={<Link href="/finance/receipts" />}>Customer receipts</Button>
        <Button variant="outline" render={<Link href="/finance/business-profile" />}>Business profile</Button>
        <Button variant="outline" render={<Link href="/finance/subscriptions" />}>
          <Repeat /> Subscriptions
        </Button>
        <Button variant="outline" render={<Link href="/finance/payments/export" />}>Receipt evidence CSV</Button>
        {canDownloadAccountantPack(ctx.role) ? <Button variant="outline" render={<Link href="/reports/accountant-pack" />}>Accountant pack</Button> : null}
        <Button variant="outline" render={<Link href="/finance/costs/new" />}>
          <Coins /> New cost
        </Button>
        <Button render={<Link href="/finance/invoices/new" />}>
          <FilePlus2 /> New invoice
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Unpaid total"
          value={formatTHB(unpaidSatang)}
          icon={FileWarning}
          tone={openCount > 0 ? "warning" : "default"}
          hint={`${openCount} open invoice${openCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="Revenue this month"
          value={formatTHB(revenueSatang)}
          icon={TrendingUp}
          tone="positive"
          hint="Pre-VAT · Issued invoices"
        />
        <StatCard
          label="Verified cash this month"
          value={formatTHB(cashReceivedSatang)}
          icon={TrendingUp}
          hint="Verified receipts received this month"
        />
        <StatCard
          label="Operating costs this month"
          value={formatTHB(costsSatang)}
          icon={Flame}
          tone="negative"
          hint="Excludes inventory asset bills"
        />
        <StatCard
          label="Monthly recurring forecast"
          value={formatTHB(mrrSatang)}
          icon={Repeat}
          hint="Recurring revenue / month"
        />
      </div>

      <SearchFacets list="finance" config={config} savedViews={savedViews} />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" render={<Link href={config.status ? `/finance/invoices/export?status=${config.status}` : "/finance/invoices/export"} />}>Export invoices CSV</Button>
        <Button variant="outline" size="sm" render={<Link href="/finance/costs/export" />}>Export costs CSV</Button>
        <span className="text-xs text-muted-foreground self-center">Invoice export uses the status filter.</span>
      </div>

      <Tabs defaultValue={params.tab === "costs" ? "costs" : "invoices"} className="gap-4">
        <TabsList>
          <TabsTrigger value="invoices">
            <ReceiptText /> Invoices
          </TabsTrigger>
          <TabsTrigger value="costs">
            <Receipt /> Costs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="invoices">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Invoices</CardTitle>
            </CardHeader>
            <CardContent>
              {invoiceRows.length === 0 ? (
                <EmptyState
                  icon={ReceiptText}
                  title="No invoices yet"
                  description="Create your first invoice to start tracking what clients owe."
                  action={
                    <Button render={<Link href="/finance/invoices/new" />}>
                      <FilePlus2 /> New invoice
                    </Button>
                  }
                  className="border-0"
                />
              ) : filteredInvoiceRows.length === 0 ? (
                <EmptyState
                  icon={ReceiptText}
                  title="No matching invoices"
                  description="No invoices match the selected filters."
                  className="border-0"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Number</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead className="text-right">Outstanding</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <GroupedTableRows rows={filteredInvoiceRows} colSpan={6} amount={(inv) => inv.amount_satang}
                    group={config.groupBy ? (inv) => config.groupBy === "client"
                      ? { key: inv.client_id, label: inv.clients?.name ?? "Unassigned" }
                      : config.groupBy === "month" ? { key: monthKey(inv.issue_date), label: monthKey(inv.issue_date) }
                      : { key: inv.effectiveStatus, label: facetLabel(inv.effectiveStatus) } : undefined}>
                    {(inv) => (
                      <TableRow key={inv.id}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/finance/invoices/${inv.id}`}
                            className="hover:underline"
                          >
                            {inv.displayNumber}
                          </Link>
                          {inv.is_recurring ? (
                            <Repeat
                              className="text-muted-foreground ml-1.5 inline size-3.5 align-text-bottom"
                              aria-label="Recurring"
                            />
                          ) : null}
                        </TableCell>
                        <TableCell>{inv.clients?.name ?? "—"}</TableCell>
                        <TableCell>
                          <InvoiceStatusBadge status={inv.effectiveStatus} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTHB(inv.amount_satang)}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {inv.due_date ?? "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {inv.outstanding > 0
                            ? formatTHB(inv.outstanding)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    )}</GroupedTableRows>
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="costs" id="bills">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Costs</CardTitle>
            </CardHeader>
            <CardContent>
              {costs.length === 0 ? (
                <EmptyState
                  icon={Receipt}
                  title="No costs logged"
                  description="Track software, contractors, and other operating costs here."
                  action={
                    <Button render={<Link href="/finance/costs/new" />}>
                      <Coins /> New cost
                    </Button>
                  }
                  className="border-0"
                />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Input VAT</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Vendor</TableHead>
                      <TableHead>Bill</TableHead>
                      <TableHead>Due date</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead className="w-10" aria-label="Actions" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {costs.map((c) => (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          {COST_CATEGORY_LABEL[c.category]}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTHB(c.amount_satang)}
                        </TableCell>
                        <TableCell>{formatTHB(c.input_vat_satang)} ({c.input_vat_rate}%)</TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.incurred_on}
                        </TableCell>
                        <TableCell>{c.vendor_id ? <Link className="underline" href={`/vendors/${c.vendor_id}`}>{c.vendor ?? "Vendor"}</Link> : c.vendor ?? "—"}</TableCell>
                        <TableCell>{c.expense_claim_id ? <Link className="underline" href={`/expenses/${c.expense_claim_id}`}>{c.bill_number}</Link> : c.purchase_order_id ? <Link className="underline" href={`/purchases/${c.purchase_order_id}`}>{c.vendor_invoice_reference ? `${c.vendor_invoice_reference} · ${c.bill_number}` : c.bill_number}</Link> : c.bill_number ?? "—"}</TableCell>
                        <TableCell className={c.vendor_id && !c.paid_at && c.due_date && c.due_date < today ? "text-destructive" : ""}>{c.due_date ?? "—"}</TableCell>
                        <TableCell>{c.expense_claim_id ? c.paid_at ? `Reimbursed ${todayISO(new Date(c.paid_at))}` : "Awaiting reimbursement" : c.vendor_id ? c.paid_at ? `Paid ${todayISO(new Date(c.paid_at))}` : <div className="space-y-1"><span>Unpaid</span>{can(ctx.role, "purchase:manage") && <PurchaseAction action={markBillPaid.bind(null, c.id)} label="Mark paid" />}</div> : "—"}</TableCell>
                        <TableCell>{c.projects?.name ?? "—"}</TableCell>
                        <TableCell className="text-right">
                          {!c.vendor_id && !c.purchase_order_id && !c.expense_claim_id && <DeleteCostButton
                            id={c.id}
                            label={`${COST_CATEGORY_LABEL[c.category]} cost`}
                          />}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
