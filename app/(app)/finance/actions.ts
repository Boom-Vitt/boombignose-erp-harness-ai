"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { TaxInvoiceTemplate } from "@/lib/tax/invoice-checklist"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { formatTHBWhole } from "@/lib/money"
import { writeAudit } from "@/lib/audit"
import { todayISO } from "@/lib/dates"
import { paymentAmount, moneyInput } from "@/lib/payments/input"
import { isIssuedInvoiceNumber } from "@/lib/documents/numbering"

const RECURRING_INTERVALS = ["weekly", "monthly", "quarterly", "yearly"] as const

const COST_CATEGORIES = [
  "software",
  "contractor",
  "infra",
  "marketing",
  "salary",
  "other",
] as const

/** Empty string from an optional <input> → undefined (so zod .optional() applies). */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

/** Optional id select: "" (none) → null. */
const optionalId = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))

/** Optional date (YYYY-MM-DD) from a date input: "" → null. */
const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

const CreateInvoice = z.object({
  client_id: z.string().min(1, "Client is required"),
  project_id: optionalId,
  number: optionalString.refine(value => !value || !isIssuedInvoiceNumber(value), "Invoice series numbers are assigned only when issuing"),
  issue_date: optionalDate,
  due_date: optionalDate,
  amountBaht: z.string().refine(v => { try { moneyInput(v); return true } catch { return false } }, "Enter a nonnegative THB amount with up to two decimals"),
  is_recurring: z.coerce.boolean().default(false),
  recurring_interval: z.enum(RECURRING_INTERVALS).nullish(),
  notes: optionalString,
})

export async function createInvoice(
  input: z.input<typeof CreateInvoice>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners, admins, and accountants can manage invoices." } }
  const parsed = CreateInvoice.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()

  const id = crypto.randomUUID()
  const number = d.number ?? `DRAFT-${id}`

  const { data, error } = await supabase
    .from("invoices")
    .insert({
      id,
      org_id: ctx.orgId,
      client_id: d.client_id,
      project_id: d.project_id,
      number,
      status: "draft",
      issue_date: d.issue_date ?? undefined,
      due_date: d.due_date,
      amount_satang: moneyInput(d.amountBaht),
      is_recurring: d.is_recurring,
      recurring_interval: d.is_recurring ? (d.recurring_interval ?? null) : null,
      notes: d.notes,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "invoice",
    entityId: data.id,
    action: "created",
    summary: `Created invoice ${number} for ${formatTHBWhole(moneyInput(d.amountBaht))}`,
  })

  revalidatePath("/finance")
  redirect(`/finance/invoices/${data.id}`)
}

const UpdateInvoice = z.object({
  id: z.string().min(1),
  client_id: z.string().min(1, "Client is required"),
  project_id: optionalId,
  number: optionalString.refine(value => !value || !isIssuedInvoiceNumber(value), "Invoice series numbers are assigned only when issuing"),
  issue_date: optionalDate,
  due_date: optionalDate,
  amountBaht: z.string().refine(v => { try { moneyInput(v); return true } catch { return false } }, "Enter a nonnegative THB amount with up to two decimals"),
  is_recurring: z.coerce.boolean(),
  recurring_interval: z.enum(RECURRING_INTERVALS).nullish(),
  notes: optionalString,
})

export async function updateInvoice(
  input: z.input<typeof UpdateInvoice>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners, admins, and accountants can manage invoices." } }
  const parsed = UpdateInvoice.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from("invoices")
    .update({
      client_id: d.client_id,
      project_id: d.project_id,
      ...(d.number ? { number: d.number } : {}),
      issue_date: d.issue_date ?? undefined,
      due_date: d.due_date,
      amount_satang: moneyInput(d.amountBaht),
      is_recurring: d.is_recurring,
      recurring_interval: d.is_recurring ? (d.recurring_interval ?? null) : null,
      notes: d.notes,
    })
    .eq("id", d.id)
    .eq("org_id", ctx.orgId)
    .eq("status", "draft")
    .is("issued_snapshot_id", null)
    .select("id")
    .maybeSingle()

  if (error) return { error: error.message }
  if (!data) return { error: "Draft invoice unavailable" }
  await writeAudit(ctx, { entity: "invoice", entityId: d.id, action: "updated", summary: "Updated invoice draft" })

  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${d.id}`)
  return {}
}

// ---------------------------------------------------------------------------
// Payments (with invoice status recompute)
// ---------------------------------------------------------------------------

const StaffClaim = z.object({
  invoiceId: z.guid(), key: z.uuid(), amountBaht: z.string(),
  reference: z.string().trim().min(3).max(500),
})

/** Compatibility name: reporting a payment creates a pending claim, never cash. */
export async function recordPayment(input: z.input<typeof StaffClaim>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners and admins can report staff payment claims." } }
  const parsed = StaffClaim.safeParse(input)
  if (!parsed.success) return { error: "Invalid payment report" }
  const d = parsed.data
  let amount: number
  try { amount = paymentAmount(d.amountBaht) }
  catch { return { error: "Enter a valid positive THB amount with up to two decimals" } }
  const supabase = await createSupabaseClient()
  const { error } = await supabase.rpc("submit_internal_payment_claim", {
    p_org_id: ctx.orgId, p_invoice_id: d.invoiceId, p_amount_satang: amount,
    p_reference: d.reference, p_key: d.key,
  })
  if (error) return { error: error.message }
  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${d.invoiceId}`)
  return {}
}

const EvidenceFields = {
  paidOn: z.iso.date().refine(value => value <= todayISO(), "Bank date cannot be in the future"),
  method: z.enum(["transfer", "cash", "card", "promptpay", "cheque", "other"]),
}
const ReconcileLegacy = StaffClaim.extend({ legacyPaymentId: z.guid(), ...EvidenceFields })

export async function reconcileLegacyPayment(input: z.input<typeof ReconcileLegacy>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners and admins can reconcile legacy receipts." } }
  const parsed = ReconcileLegacy.safeParse(input)
  if (!parsed.success) return { error: "Invalid reconciliation details" }
  const d = parsed.data
  let amount: number
  try { amount = paymentAmount(d.amountBaht) }
  catch { return { error: "Enter a valid positive THB amount with up to two decimals" } }
  const supabase = await createSupabaseClient()
  const args = { p_org_id: ctx.orgId, p_legacy_payment_id: d.legacyPaymentId, p_amount_satang: amount, p_reference: d.reference, p_key: d.key }
  const { error } = await supabase.rpc("reconcile_legacy_payment_with_evidence", { ...args, p_paid_on: d.paidOn, p_method: d.method })
  if (error) return { error: error.message }
  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${d.invoiceId}`)
  return {}
}

const ReviewClaimFields = {
  claimId: z.guid(), invoiceId: z.guid().optional(), key: z.uuid(),
  amountBaht: z.string(), reference: z.string().trim().min(3).max(500),
}
const ReviewClaim = z.discriminatedUnion("decision", [
  z.object({ ...ReviewClaimFields, decision: z.literal("verified"), ...EvidenceFields }),
  z.object({ ...ReviewClaimFields, decision: z.literal("rejected") }),
])

export async function reviewPaymentClaim(input: z.input<typeof ReviewClaim>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners and admins can verify receipts." } }
  const parsed = ReviewClaim.safeParse(input)
  if (!parsed.success) return { error: "Invalid verification details" }
  const d = parsed.data
  let amount = 0
  try { if (d.decision === "verified") amount = paymentAmount(d.amountBaht) }
  catch { return { error: "Enter a valid positive THB amount" } }
  const supabase = await createSupabaseClient()
  // invoiceId is only used for revalidation; the DB resolves the actual claim's invoice.
  const args = { p_org_id: ctx.orgId, p_claim_id: d.claimId, p_key: d.key, p_amount_satang: amount, p_reference: d.reference, p_decision: d.decision }
  const { error } = await supabase.rpc("review_payment_claim_with_evidence", { ...args, p_paid_on: d.decision === "verified" ? d.paidOn : null, p_method: d.decision === "verified" ? d.method : null })
  if (error) return { error: error.message }
  revalidatePath("/finance")
  if (d.invoiceId) revalidatePath(`/finance/invoices/${d.invoiceId}`)
  revalidatePath("/finance/receipts")
  return {}
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

const CreateCost = z.object({
  category: z.enum(COST_CATEGORIES).default("other"),
  amountBaht: z.string().refine(v => { try { moneyInput(v); return true } catch { return false } }, "Enter a nonnegative THB amount with up to two decimals"),
  incurred_on: optionalDate,
  vendor: optionalString,
  project_id: optionalId,
  notes: optionalString,
})

export async function createCost(
  input: z.input<typeof CreateCost>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = CreateCost.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  const { data: cost, error } = await supabase
    .from("costs")
    .insert({
      org_id: ctx.orgId,
      category: d.category,
      amount_satang: moneyInput(d.amountBaht),
      incurred_on: d.incurred_on ?? undefined,
      vendor: d.vendor,
      project_id: d.project_id,
      notes: d.notes,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "cost",
    entityId: cost.id,
    action: "created",
    summary: `Recorded ${formatTHBWhole(moneyInput(d.amountBaht))} ${d.category} cost`,
    meta: { category: d.category, vendor: d.vendor ?? null },
  })

  revalidatePath("/finance")
  redirect("/finance")
}

const DeleteCost = z.object({ id: z.string().min(1) })

export async function deleteCost(
  input: z.input<typeof DeleteCost>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "cost:delete")
  } catch {
    return { error: "Only owners and admins can delete costs." }
  }
  const parsed = DeleteCost.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("costs")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath("/finance")
  return {}
}

const IssueInvoice = z.object({ invoiceId: z.guid(), expectedVersion: z.number().int().min(1).max(2147483647), key: z.uuid() })
export async function issueInvoice(input: z.input<typeof IssueInvoice>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners and admins can issue invoices." } }
  const parsed = IssueInvoice.safeParse(input)
  if (!parsed.success) return { error: "Invalid issue request" }
  const d = parsed.data
  const supabase = await createSupabaseClient()
  const { error } = await supabase.rpc("issue_invoice", { p_org_id: ctx.orgId, p_invoice_id: d.invoiceId, p_expected_version: d.expectedVersion, p_key: d.key })
  if (error) return { error: error.message }
  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${d.invoiceId}`)
  return {}
}

const AdoptLegacyInvoice = IssueInvoice.extend({ reason: z.string().trim().min(1).max(1000) })
export async function adoptLegacyInvoice(input: z.input<typeof AdoptLegacyInvoice>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners and admins can adopt legacy invoices." } }
  const parsed = AdoptLegacyInvoice.safeParse(input)
  if (!parsed.success) return { error: "Enter a reason of 1 to 1000 characters and a valid invoice version and retry key." }
  const d = parsed.data
  const supabase = await createSupabaseClient()
  const { error } = await supabase.rpc("adopt_legacy_invoice", { p_org_id: ctx.orgId, p_invoice_id: d.invoiceId, p_expected_version: d.expectedVersion, p_key: d.key, p_reason: d.reason })
  if (error) return { error: error.message }
  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${d.invoiceId}`)
  return {}
}

const BusinessProfile = z.object({
  expectedOrgId: z.guid(),
  legalName: z.string().trim().min(1).max(200), address: z.string().trim().min(1).max(1000),
  vatRegistered: z.boolean().optional(), vatRateBps: z.number().int().min(0).max(10000).default(700), pricesIncludeVat: z.boolean().default(false), branchLabel: z.string().trim().max(200).default(""),
  taxId: z.string().trim().refine(value => value === "" || /^[0-9]{13}$/.test(value), "Enter a 13-digit tax ID or leave it blank"), taxStatus: z.enum(["unknown", "not_registered", "registered"]),
}).refine(value => value.taxStatus !== "registered" || value.taxId.length === 13, "Registered VAT profile needs a tax ID")
export async function updateBusinessProfile(input: z.input<typeof BusinessProfile>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "settings:manage") }
  catch { return { error: "Only owners and admins can update the business profile." } }
  const parsed = BusinessProfile.safeParse(input)
  if (!parsed.success) return { error: "Enter the legal business name, address and explicit tax status." }
  const d = parsed.data
  if (d.expectedOrgId !== ctx.orgId) return { error: "Workspace changed. Reload this form before saving the business profile." }
  const supabase = await createSupabaseClient()
  const { error } = await supabase.rpc("update_tax_business_profile", {
    p_org_id: ctx.orgId, p_legal_name: d.legalName, p_business_address: d.address,
    p_tax_id: d.taxId, p_tax_status: d.taxStatus, p_vat_rate_bps: d.vatRateBps, p_prices_include_vat: d.pricesIncludeVat, p_branch_label: d.branchLabel,
  })
  if (error) return { error: error.message }
  revalidatePath("/finance/business-profile")
  return {}
}

const TaxTemplate = TaxInvoiceTemplate.extend({ expectedOrgId: z.guid() })
export async function saveTaxInvoiceTemplate(input: z.input<typeof TaxTemplate>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "settings:manage") }
  catch { return { error: "Only owners and admins can update the business profile." } }
  const parsed = TaxTemplate.safeParse(input)
  if (!parsed.success) return { error: "Phone and the copy label can be 40 characters. Branch code is blank or 5 digits." }
  if (parsed.data.expectedOrgId !== ctx.orgId) return { error: "Workspace changed. Reload this form before saving." }
  const supabase = await createSupabaseClient()
  const { error } = await supabase.rpc("save_tax_invoice_template", {
    p_org_id: ctx.orgId,
    p_template: { seller_phone: parsed.data.seller_phone, branch_code: parsed.data.branch_code, copy_label: parsed.data.copy_label },
  })
  if (error) return { error: error.message }
  revalidatePath("/finance/business-profile")
  return {}
}

const Withholding = z.object({ invoiceId: z.guid(), rateBps: z.number().refine(value => [0, 100, 200, 300, 500].includes(value)) })
export async function updateInvoiceWithholding(input: z.input<typeof Withholding>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") } catch { return { error: "Only owners and admins can edit withholding." } }
  const parsed = Withholding.safeParse(input)
  if (!parsed.success) return { error: "Invalid withholding rate" }
  const supabase = await createSupabaseClient()
  const { data, error } = await supabase.from("invoices").update({ wht_rate_bps: parsed.data.rateBps }).eq("org_id", ctx.orgId).eq("id", parsed.data.invoiceId).eq("status", "draft").is("issued_snapshot_id", null).select("id").maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: "Draft invoice unavailable" }
  await writeAudit(ctx, { entity: "invoice", entityId: data.id, action: "withholding_updated", summary: "Updated invoice withholding", meta: { rateBps: parsed.data.rateBps } })
  revalidatePath(`/finance/invoices/${data.id}`)
  revalidatePath("/finance")
  return {}
}

const CancelDraft = z.object({ invoiceId: z.guid() })
export async function cancelDraftInvoice(input: z.input<typeof CancelDraft>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "invoice:delete") }
  catch { return { error: "Only owners and admins can cancel drafts." } }
  const parsed = CancelDraft.safeParse(input)
  if (!parsed.success) return { error: "Invalid invoice" }
  const supabase = await createSupabaseClient()
  const { error } = await supabase.rpc("cancel_draft_invoice", { p_org_id: ctx.orgId, p_invoice_id: parsed.data.invoiceId })
  if (error) return { error: error.message }
  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${parsed.data.invoiceId}`)
  return {}
}

const FinanceLock = z.object({ expectedOrgId: z.guid(), lockDate: z.union([z.iso.date(), z.literal("")]) })
export async function updateFinanceLockDate(input: z.input<typeof FinanceLock>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "settings:manage") }
  catch { return { error: "Only owners and admins can change the finance lock date." } }
  const parsed = FinanceLock.safeParse(input)
  if (!parsed.success) return { error: "Enter a valid lock date or leave it blank." }
  if (parsed.data.expectedOrgId !== ctx.orgId) return { error: "Workspace changed. Reload before saving." }
  const supabase = await createSupabaseClient()
  const { error } = await supabase.rpc("update_finance_lock_date", { p_org_id: ctx.orgId, p_lock_date: parsed.data.lockDate || null })
  if (error) return { error: error.message }
  revalidatePath("/settings")
  revalidatePath("/settings/finance")
  return {}
}
