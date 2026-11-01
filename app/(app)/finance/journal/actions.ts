"use server"

import { revalidatePath } from "next/cache"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { draftJournalLines, journalDateInClosedPeriod, journalMemo, type DraftJournalLine } from "@/lib/finance/draft-journal"
import { salesInvoiceJournal, salesSnapshotAgrees, type StoredSalesInvoice } from "@/lib/finance/sales-invoice-journal"
import { createClient } from "@/lib/supabase/server"

export async function postDraftJournal(input: {
  entryDate: string
  memo: string
  lines: DraftJournalLine[]
}): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "profit:view") }
  catch { return { error: "Only owners, admins, and accountants can post a draft journal." } }
  const supabase = await createClient()
  const [{ data: settings, error: settingsError }, { data: accounts, error: accountsError }] = await Promise.all([
    supabase.from("org_settings").select("lock_date").eq("org_id", ctx.orgId).maybeSingle(),
    supabase.from("gl_accounts").select("code").eq("org_id", ctx.orgId),
  ])
  if (settingsError || accountsError) return { error: "Draft journal unavailable." }
  const date = journalDateInClosedPeriod(input.entryDate, settings?.lock_date ?? null)
  if (!date.ok) return { error: date.error }
  const memo = journalMemo(input.memo)
  if (!memo.ok) return { error: memo.error }
  const lines = draftJournalLines(input.lines, (accounts ?? []).map(account => account.code))
  if (!lines.ok) return { error: lines.error }
  const { error } = await supabase.rpc("post_draft_journal", {
    p_org_id: ctx.orgId,
    p_entry_date: input.entryDate,
    p_memo: memo.memo,
    p_lines: input.lines,
  })
  if (error) return { error: error.message }
  revalidatePath("/finance/journal")
  revalidatePath("/audit/close")
  return {}
}

export async function postIssuedSalesInvoice(invoiceId: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "profit:view") }
  catch { return { error: "Only owners, admins, and accountants can post a draft journal." } }
  const supabase = await createClient()
  const [{ data: invoice, error: invoiceError }, { data: settings, error: settingsError }, { data: accounts, error: accountsError }, credits] = await Promise.all([
    supabase.from("invoices").select("status, quote_invoice_kind, quote_deposit_satang, quote_deposit_deduction_satang, issue_date, number, prices_include_vat, subtotal_satang, discount_satang, vat_satang, total_satang, wht_satang, wht_rate_bps, amount_satang, tax_breakdown, issued_snapshot_id").eq("org_id", ctx.orgId).eq("id", invoiceId).maybeSingle(),
    supabase.from("org_settings").select("lock_date").eq("org_id", ctx.orgId).maybeSingle(),
    supabase.from("gl_accounts").select("code").eq("org_id", ctx.orgId),
    supabase.from("credit_notes").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId).eq("invoice_id", invoiceId),
  ])
  if (invoiceError || settingsError || accountsError || credits.error || !invoice) return { error: "Only an issued operational sales invoice can post." }
  const stored: StoredSalesInvoice = {
    status: invoice.status,
    quoteInvoiceKind: invoice.quote_invoice_kind,
    quoteDepositSatang: invoice.quote_deposit_satang,
    quoteDepositDeductionSatang: invoice.quote_deposit_deduction_satang,
    issueDate: invoice.issue_date,
    number: invoice.number,
    pricesIncludeVat: invoice.prices_include_vat,
    subtotalSatang: invoice.subtotal_satang,
    discountSatang: invoice.discount_satang,
    vatSatang: invoice.vat_satang,
    totalSatang: invoice.total_satang,
    whtSatang: invoice.wht_satang,
    whtRateBps: invoice.wht_rate_bps,
    amountDueSatang: invoice.amount_satang,
    vatByRate: invoice.tax_breakdown,
  }
  let snapshotKind = ""
  let snapshotIssueDate = ""
  let snapshotNumber = ""
  let snapshotAgrees = false
  if (invoice.issued_snapshot_id) {
    const snap = await supabase.from("invoice_snapshots").select("snapshot").eq("org_id", ctx.orgId).eq("id", invoice.issued_snapshot_id).maybeSingle()
    if (snap.error) return { error: "Only an issued operational sales invoice can post." }
    const body = snap.data?.snapshot
    if (body && typeof body === "object" && !Array.isArray(body)) {
      const kind = (body as { kind?: unknown }).kind
      const document = (body as { document?: { issueDate?: unknown; number?: unknown } }).document
      snapshotKind = typeof kind === "string" ? kind : ""
      snapshotIssueDate = document && typeof document.issueDate === "string" ? document.issueDate : ""
      snapshotNumber = document && typeof document.number === "string" ? document.number : ""
      snapshotAgrees = salesSnapshotAgrees(body, stored)
    }
  }
  const check = salesInvoiceJournal({
    ...stored,
    snapshotKind,
    snapshotIssueDate,
    snapshotNumber,
    snapshotAgrees,
    hasCreditNote: (credits.count ?? 0) > 0,
    lockDate: settings?.lock_date ?? null,
    accounts: (accounts ?? []).map(account => account.code),
  })
  if (!check.ok) return { error: check.error }
  const { error } = await supabase.rpc("post_issued_sales_invoice", { p_org_id: ctx.orgId, p_invoice_id: invoiceId })
  if (error) return { error: error.message }
  revalidatePath(`/finance/invoices/${invoiceId}`)
  revalidatePath("/finance/journal")
  revalidatePath("/finance/journal/trial-balance")
  revalidatePath("/audit/close")
  return {}
}
