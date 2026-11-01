import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import {
  canReviewMonthEndClose,
  monthEndCloseChecklist,
  previousCompletedMonth,
  type CloseChecklist,
  type CloseTaxProfile,
} from "@/lib/finance/close-checklist"
import { createClient } from "@/lib/supabase/server"
import { readAll } from "@/lib/supabase/read-all"

const UNAVAILABLE = "Month-end close data unavailable. Reload before relying on the list."

/**
 * Org-scoped reads for the month before today. RLS still limits rows to
 * memberships; every query also filters the active org. Returns null for
 * members, who do not review the close.
 */
export async function loadMonthEndCloseChecklist(): Promise<CloseChecklist | null> {
  const ctx = await requireOrgContext()
  if (!canReviewMonthEndClose(ctx.role)) return null
  const today = todayISO()
  const month = previousCompletedMonth(today)
  if (!month) throw new Error(UNAVAILABLE)

  const supabase = await createClient()
  const [invoicesRes, balancesRes, billsRes, bankRes, claimsRes, creditsRes, vatRes, settingsRes] = await Promise.all([
    readAll((from, to) => supabase.from("invoices").select("id, status, issue_date, due_date, amount_satang, vat_satang").eq("org_id", ctx.orgId).order("id").range(from, to)),
    readAll((from, to) => supabase.from("invoice_balances").select("invoice_id, paid_satang, credited_satang").eq("org_id", ctx.orgId).order("invoice_id").range(from, to)),
    readAll((from, to) => supabase.from("costs").select("id, vendor_id, expense_claim_id, paid_at, due_date, amount_satang, purchase_cost_kind").eq("org_id", ctx.orgId).order("id").range(from, to)),
    readAll((from, to) => supabase.from("bank_lines").select("id, booked_on, amount_satang, matched_payment_id").eq("org_id", ctx.orgId).order("id").range(from, to)),
    readAll((from, to) => supabase.from("expense_claims").select("id, status, employee").eq("org_id", ctx.orgId).order("id").range(from, to)),
    readAll((from, to) => supabase.from("credit_note_revenue").select("id, issue_date, base_satang, total_satang").eq("org_id", ctx.orgId).order("id").range(from, to)),
    readAll((from, to) => supabase.from("monthly_purchase_vat").select("month, input_vat_satang").eq("org_id", ctx.orgId).order("month").range(from, to)),
    supabase.from("org_settings").select("lock_date, legal_name, business_address, tax_id, branch_label, tax_status").eq("org_id", ctx.orgId).maybeSingle(),
  ])
  if (invoicesRes.error || balancesRes.error || billsRes.error || bankRes.error || claimsRes.error || creditsRes.error || vatRes.error || settingsRes.error) {
    throw new Error(UNAVAILABLE)
  }

  const paid = new Map<string, { paid: number; credited: number }>()
  for (const row of balancesRes.data ?? []) {
    if (!row.invoice_id || paid.has(row.invoice_id)) continue
    paid.set(row.invoice_id, { paid: row.paid_satang ?? 0, credited: row.credited_satang ?? 0 })
  }
  const settings = settingsRes.data
  const taxStatus: CloseTaxProfile["taxStatus"] = settings?.tax_status === "registered" || settings?.tax_status === "not_registered" ? settings.tax_status : "unknown"
  const result = monthEndCloseChecklist({
    month,
    today,
    lockDate: settings?.lock_date ?? null,
    viewerId: ctx.userId,
    invoices: (invoicesRes.data ?? []).map(row => ({
      status: row.status,
      issueDate: row.issue_date,
      dueDate: row.due_date,
      amountSatang: row.amount_satang,
      vatSatang: row.vat_satang,
      paidSatang: paid.get(row.id)?.paid ?? 0,
      creditedSatang: paid.get(row.id)?.credited ?? 0,
    })),
    bills: (billsRes.data ?? []).map(row => ({
      vendorId: row.vendor_id,
      expenseClaimId: row.expense_claim_id,
      paidAt: row.paid_at,
      dueDate: row.due_date,
      amountSatang: row.amount_satang,
      kind: row.purchase_cost_kind,
    })),
    bankLines: (bankRes.data ?? []).map(row => ({
      bookedOn: row.booked_on,
      amountSatang: row.amount_satang,
      matched: row.matched_payment_id !== null,
    })),
    claims: (claimsRes.data ?? []).map(row => ({ status: row.status, employeeId: row.employee })),
    credits: (creditsRes.data ?? []).map(row => ({ issueDate: row.issue_date, baseSatang: row.base_satang, totalSatang: row.total_satang })),
    purchaseVat: (vatRes.data ?? []).map(row => ({ month: row.month, inputVatSatang: row.input_vat_satang })),
    tax: {
      legalName: settings?.legal_name ?? "",
      address: settings?.business_address ?? "",
      taxId: settings?.tax_id ?? "",
      branchLabel: settings?.branch_label ?? "",
      taxStatus,
    },
  })
  if (!result.ok) throw new Error(result.error)
  return result.checklist
}
