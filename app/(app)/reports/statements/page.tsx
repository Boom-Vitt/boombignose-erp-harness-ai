import Link from "next/link"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { readAll } from "@/lib/supabase/read-all"
import { formatTHB } from "@/lib/money"
import { currentMonthKey } from "@/lib/dates"
import { aging, balanceSupport, monthBounds, profitAndLoss, vatSupport, type StatementCost, type StatementInvoice } from "@/lib/reports/statements"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"

export const dynamic = "force-dynamic"

export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "profit:view")) return <p>You do not have access to these reports.</p>
  const requested = (await searchParams).month
  const month = monthBounds(requested ?? "") ? requested! : currentMonthKey()
  const bounds = monthBounds(month)!
  const supabase = await createClient()
  const [invoices, balances, costs, settings, cogs] = await Promise.all([
    readAll((from, to) => supabase.from("invoices").select("id, status, issue_date, due_date, total_satang, vat_satang").eq("org_id", ctx.orgId).order("id").range(from, to)),
    readAll((from, to) => supabase.from("invoice_balances").select("invoice_id, outstanding_satang").eq("org_id", ctx.orgId).order("invoice_id").range(from, to)),
    readAll((from, to) => supabase.from("costs").select("incurred_on, due_date, paid_at, amount_satang, input_vat_satang").eq("org_id", ctx.orgId).order("id").range(from, to)),
    supabase.from("org_settings").select("cash_balance_satang").eq("org_id", ctx.orgId).maybeSingle(),
    supabase.from("monthly_inventory_cogs").select("amount_satang").eq("org_id", ctx.orgId).gte("month", bounds.from).lte("month", bounds.to),
  ])
  if (invoices.error || balances.error || costs.error || settings.error || cogs.error) throw new Error("Support reports unavailable. Reload before relying on totals.")
  const outstanding = new Map((balances.data ?? []).map((row) => [row.invoice_id, row.outstanding_satang]))
  const statementInvoices: StatementInvoice[] = (invoices.data ?? []).map((row) => ({
    issueDate: row.issue_date,
    dueDate: row.due_date,
    status: row.status,
    netSatang: row.total_satang - row.vat_satang,
    vatSatang: row.vat_satang,
    outstandingSatang: outstanding.get(row.id) ?? 0,
  }))
  const statementCosts: StatementCost[] = (costs.data ?? []).map((row) => ({
    incurredOn: row.incurred_on ?? bounds.from,
    dueDate: row.due_date,
    paidAt: row.paid_at,
    netSatang: row.amount_satang - row.input_vat_satang,
    inputVatSatang: row.input_vat_satang,
    payableSatang: row.paid_at ? 0 : row.amount_satang,
  }))
  const cogsSatang = (cogs.data ?? []).reduce((total, row) => total + row.amount_satang, 0)
  const profit = profitAndLoss({ ...bounds, invoices: statementInvoices, costs: statementCosts, cogsSatang })
  const balance = balanceSupport({ asOf: bounds.to, cashSatang: settings.data?.cash_balance_satang ?? 0, invoices: statementInvoices, costs: statementCosts })
  const vat = vatSupport({ ...bounds, invoices: statementInvoices, costs: statementCosts })
  const receivableAging = aging(bounds.to, statementInvoices.filter((row) => row.status !== "draft" && row.status !== "cancelled" && row.issueDate <= bounds.to).map((row) => ({ dueDate: row.dueDate, amountSatang: row.outstandingSatang })))
  const payableAging = aging(bounds.to, statementCosts.filter((row) => row.incurredOn <= bounds.to).map((row) => ({ dueDate: row.dueDate, amountSatang: row.payableSatang })))

  return <div className="space-y-6">
    <PageHeader title="งบการเงินประกอบ / Support reports" description="Operational figures for one month. Not a TAS statement, a closed ledger, or a Revenue Department filing." breadcrumbs={[{ label: "Reports", href: "/reports" }]} />
    <form className="flex items-end gap-3">
      <label className="text-sm">Month <input className="mt-1 block h-9 rounded-md border bg-background px-2" type="month" name="month" defaultValue={month} /></label>
      <button className="h-9 rounded-md border px-3 text-sm" type="submit">Show</button>
    </form>
    <section className="space-y-2">
      <h2 className="font-semibold">กำไรขาดทุน / Profit and loss</h2>
      <Card><CardContent className="grid gap-2 py-4 text-sm sm:grid-cols-2">
        <p>Revenue before VAT {formatTHB(profit.revenueSatang)}</p>
        <p>Cost of goods sold {formatTHB(profit.cogsSatang)}</p>
        <p>Other costs before VAT {formatTHB(profit.expenseSatang)}</p>
        <p>Profit {formatTHB(profit.profitSatang)}</p>
      </CardContent></Card>
    </section>
    <section className="space-y-2">
      <h2 className="font-semibold">ฐานะการเงินเบื้องต้น / Balance support</h2>
      <p className="text-sm text-muted-foreground">Cash is the figure saved in settings. Receivables are unpaid issued invoices. Payables are unpaid costs. These amounts do not balance.</p>
      <Card><CardContent className="grid gap-2 py-4 text-sm sm:grid-cols-3">
        <p>Cash {formatTHB(balance.cashSatang)}</p>
        <p>Receivables {formatTHB(balance.receivablesSatang)}</p>
        <p>Payables {formatTHB(balance.payablesSatang)}</p>
      </CardContent></Card>
    </section>
    <section className="space-y-2">
      <h2 className="font-semibold">ข้อมูลประกอบ ภ.พ.30 / VAT support</h2>
      <p className="text-sm text-muted-foreground">Output VAT is from issued invoices. Input VAT is from recorded costs. This is not a ภ.พ.30 filing.</p>
      <Card><CardContent className="grid gap-2 py-4 text-sm sm:grid-cols-3">
        <p>Output VAT {formatTHB(vat.outputVatSatang)}</p>
        <p>Input VAT {formatTHB(vat.inputVatSatang)}</p>
        <p>Output minus input {formatTHB(vat.netVatSatang)}</p>
      </CardContent></Card>
    </section>
    <section className="space-y-2">
      <h2 className="font-semibold">อายุลูกหนี้และเจ้าหนี้ / AR and AP aging</h2>
      <AgingTable title="Receivables" buckets={receivableAging} />
      <AgingTable title="Payables" buckets={payableAging} />
    </section>
    <Link className="text-sm underline" href="/reports">Back to reports</Link>
  </div>
}

function AgingTable({ title, buckets }: { title: string; buckets: { current: number; days1to30: number; days31to60: number; days61to90: number; days91plus: number } }) {
  return <Card><CardContent className="space-y-2 py-4 text-sm">
    <h3 className="font-medium">{title}</h3>
    <p>Not yet due {formatTHB(buckets.current)}</p>
    <p>1–30 days {formatTHB(buckets.days1to30)}</p>
    <p>31–60 days {formatTHB(buckets.days31to60)}</p>
    <p>61–90 days {formatTHB(buckets.days61to90)}</p>
    <p>91 days or more {formatTHB(buckets.days91plus)}</p>
  </CardContent></Card>
}
