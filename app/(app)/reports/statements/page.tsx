import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { readAll } from "@/lib/supabase/read-all"
import { currentMonthKey } from "@/lib/dates"
import { aging, balanceSupport, monthBounds, profitAndLoss, vatSupport, type StatementCost, type StatementInvoice } from "@/lib/reports/statements"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { SupportFigures } from "./support-figures"

export const dynamic = "force-dynamic"

export default async function StatementsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "profit:view")) return <p>คุณไม่มีสิทธิ์ดูรายงานนี้ / You do not have access to these reports.</p>
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
    <PageHeader title="งบการเงินประกอบ / Support reports" description="ตัวเลขปฏิบัติการของหนึ่งเดือน ไม่ใช่งบการเงินตามมาตรฐานการบัญชี ไม่ใช่งบที่ปิดแล้ว และไม่ใช่การยื่นต่อกรมสรรพากร / Operational figures for one month. Not a TAS statement, a closed ledger, or a Revenue Department filing." breadcrumbs={[{ label: "Reports", href: "/reports" }]} />
    <form className="flex items-end gap-3">
      <label className="text-sm">เดือน / Month <input className="mt-1 block h-9 rounded-md border bg-background px-2" type="month" name="month" defaultValue={month} /></label>
      <Button type="submit" variant="outline">แสดง / Show</Button>
    </form>
    <SupportFigures month={month} asOf={bounds.to} profit={profit} balance={balance} vat={vat} receivableAging={receivableAging} payableAging={payableAging} />
  </div>
}
