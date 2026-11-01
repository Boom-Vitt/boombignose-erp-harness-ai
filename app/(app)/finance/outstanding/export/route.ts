import { invoiceBalances } from "@/lib/payments/balances"
import { readAll } from "@/lib/supabase/read-all"
import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import { deriveInvoiceStatus } from "@/lib/metrics/invoice-status"
import { canReviewFinanceClose } from "@/lib/finance/close-access"
import { bangkokCalendarDate, isCalendarDate, resolveCloseMonth } from "@/lib/finance/close-window"
import { outstandingPack, outstandingPackCsv, type OutstandingBill } from "@/lib/finance/outstanding-pack"

/**
 * Open invoices and unpaid vendor bills for an external accountant.
 * Grouped aging totals stay on /reports/statements. This file is the line list.
 */
export async function GET(request: Request) {
  const ctx = await requireOrgContext()
  if (!canReviewFinanceClose(ctx.role)) return new Response("Only owners, admins, and accountants can export the outstanding pack.", { status: 403 })
  const requested = new URL(request.url).searchParams.get("asOf") ?? undefined
  const today = todayISO()
  let asOf: string
  if (requested) {
    if (!isCalendarDate(requested)) return new Response("Enter the close date as YYYY-MM-DD.", { status: 400 })
    asOf = requested
  } else {
    const window = resolveCloseMonth(today, undefined)
    if (!window.ok) return new Response(window.error, { status: 400 })
    asOf = window.periodEnd
  }
  const supabase = await createClient()
  const [invoicesRes, costsRes] = await Promise.all([
    readAll((from, to) => supabase.from("invoices").select("id, number, amount_satang, status, due_date, issue_date, clients(name)").eq("org_id", ctx.orgId).order("id").range(from, to)),
    readAll((from, to) => supabase.from("costs").select("id, amount_satang, incurred_on, due_date, paid_at, vendor, vendor_id, expense_claim_id, purchase_cost_kind, bill_number").eq("org_id", ctx.orgId).order("id").range(from, to)),
  ])
  if (invoicesRes.error || costsRes.error) return new Response("Outstanding pack unavailable", { status: 503 })
  const balances = await invoiceBalances(supabase, ctx.orgId)
  const invoices = (invoicesRes.data ?? []).map(invoice => {
    const balance = balances.get(invoice.id)
    const paid = balance?.paid_satang ?? 0
    const credited = balance?.credited_satang ?? 0
    return {
      id: invoice.id,
      number: invoice.number,
      party: invoice.clients?.name ?? "",
      status: deriveInvoiceStatus({ status: invoice.status, amount_satang: invoice.amount_satang, due_date: invoice.due_date, credited_satang: credited }, paid, asOf),
      issueDate: invoice.issue_date,
      dueDate: invoice.due_date,
      outstandingSatang: balance?.outstanding_satang ?? Math.max(0, invoice.amount_satang - paid - credited),
    }
  })
  const bills: OutstandingBill[] = (costsRes.data ?? []).map(cost => ({
    id: cost.id,
    number: cost.bill_number ?? "",
    party: cost.vendor ?? "",
    incurredOn: cost.incurred_on,
    dueDate: cost.due_date,
    amountSatang: cost.amount_satang,
    paidOn: cost.paid_at ? bangkokCalendarDate(cost.paid_at) : null,
    vendorId: cost.vendor_id,
    expenseClaimId: cost.expense_claim_id,
    kind: cost.purchase_cost_kind,
  }))
  const csv = outstandingPackCsv(outstandingPack(asOf, invoices, bills))
  return new Response(csv, { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="outstanding-pack-${asOf}.csv"`,
  } })
}
