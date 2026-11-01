"use server"

import { revalidatePath } from "next/cache"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { draftJournalLines, journalDateInClosedPeriod, journalMemo, type DraftJournalLine } from "@/lib/finance/draft-journal"
import { bangkokCalendarDate } from "@/lib/finance/close-window"
import { cashReceiptJournal, creditNoteJournal } from "@/lib/finance/follow-on-journal"
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
  const [{ data: invoice, error: invoiceError }, { data: settings, error: settingsError }, { data: accounts, error: accountsError }] = await Promise.all([
    supabase.from("invoices").select("status, quote_invoice_kind, quote_deposit_satang, quote_deposit_deduction_satang, issue_date, number, prices_include_vat, subtotal_satang, discount_satang, vat_satang, total_satang, wht_satang, wht_rate_bps, amount_satang, tax_breakdown, issued_snapshot_id").eq("org_id", ctx.orgId).eq("id", invoiceId).maybeSingle(),
    supabase.from("org_settings").select("lock_date").eq("org_id", ctx.orgId).maybeSingle(),
    supabase.from("gl_accounts").select("code").eq("org_id", ctx.orgId),
  ])
  if (invoiceError || settingsError || accountsError || !invoice) return { error: "Only an issued operational sales invoice can post." }
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

function documentMoney(snapshot: unknown, key: string): number {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return 0
  const document = (snapshot as { document?: unknown }).document
  if (!document || typeof document !== "object") return 0
  const value = (document as Record<string, unknown>)[key]
  return typeof value === "number" && Number.isSafeInteger(value) ? value : 0
}

export async function postIssuedCreditNote(creditNoteId: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "profit:view") }
  catch { return { error: "Only owners, admins, and accountants can post a draft journal." } }
  const supabase = await createClient()
  const noteRes = await supabase.from("credit_notes").select("id, invoice_id, number, issue_date, amount_satang, snapshot").eq("org_id", ctx.orgId).eq("id", creditNoteId).maybeSingle()
  if (noteRes.error || !noteRes.data) return { error: "Only an issued credit note can post." }
  const note = noteRes.data
  const [invoiceRes, settingsRes, accountsRes, siblingsRes, invoicePostRes, allocationsRes] = await Promise.all([
    supabase.from("invoices").select("prices_include_vat, vat_satang, total_satang").eq("org_id", ctx.orgId).eq("id", note.invoice_id).maybeSingle(),
    supabase.from("org_settings").select("lock_date").eq("org_id", ctx.orgId).maybeSingle(),
    supabase.from("gl_accounts").select("code").eq("org_id", ctx.orgId),
    supabase.from("credit_notes").select("id, snapshot").eq("org_id", ctx.orgId).eq("invoice_id", note.invoice_id),
    supabase.from("journal_entries").select("id").eq("org_id", ctx.orgId).eq("source_invoice_id", note.invoice_id).maybeSingle(),
    supabase.from("payment_allocations").select("payment_id, amount_satang").eq("org_id", ctx.orgId).eq("invoice_id", note.invoice_id),
  ])
  if (invoiceRes.error || settingsRes.error || accountsRes.error || siblingsRes.error || invoicePostRes.error || allocationsRes.error || !invoiceRes.data) {
    return { error: "Only an issued credit note can post." }
  }
  const siblingIds = (siblingsRes.data ?? []).map(row => row.id)
  const paymentIds = [...new Set((allocationsRes.data ?? []).map(row => row.payment_id))]
  const [postedCredits, postedPayments] = await Promise.all([
    siblingIds.length === 0 ? Promise.resolve({ data: [] as { source_credit_note_id: string | null }[], error: null }) : supabase.from("journal_entries").select("source_credit_note_id").eq("org_id", ctx.orgId).in("source_credit_note_id", siblingIds),
    paymentIds.length === 0 ? Promise.resolve({ data: [] as { source_payment_id: string | null }[], error: null }) : supabase.from("journal_entries").select("source_payment_id").eq("org_id", ctx.orgId).in("source_payment_id", paymentIds),
  ])
  if (postedCredits.error || postedPayments.error) return { error: "Only an issued credit note can post." }
  const postedCreditIds = new Set((postedCredits.data ?? []).map(row => row.source_credit_note_id))
  const postedPaymentIds = new Set((postedPayments.data ?? []).map(row => row.source_payment_id))
  const postedNotes = (siblingsRes.data ?? []).filter(row => postedCreditIds.has(row.id))
  const check = creditNoteJournal({
    snapshot: note.snapshot,
    rowAmountSatang: note.amount_satang,
    rowNumber: note.number,
    rowIssueDate: note.issue_date,
    invoicePosted: Boolean(invoicePostRes.data),
    invoicePricesIncludeVat: invoiceRes.data.prices_include_vat,
    invoiceBaseSatang: invoiceRes.data.total_satang - invoiceRes.data.vat_satang,
    invoiceVatSatang: invoiceRes.data.vat_satang,
    invoiceTotalSatang: invoiceRes.data.total_satang,
    postedCreditBaseSatang: postedNotes.reduce((sum, row) => sum + documentMoney(row.snapshot, "baseSatang"), 0),
    postedCreditVatSatang: postedNotes.reduce((sum, row) => sum + documentMoney(row.snapshot, "vatSatang"), 0),
    postedCreditTotalSatang: postedNotes.reduce((sum, row) => sum + documentMoney(row.snapshot, "totalSatang"), 0),
    postedReceiptSatang: (allocationsRes.data ?? []).filter(row => row.amount_satang > 0 && postedPaymentIds.has(row.payment_id)).reduce((sum, row) => sum + row.amount_satang, 0),
    lockDate: settingsRes.data?.lock_date ?? null,
    accounts: (accountsRes.data ?? []).map(account => account.code),
  })
  if (!check.ok) return { error: check.error }
  const { error } = await supabase.rpc("post_issued_credit_note", { p_org_id: ctx.orgId, p_credit_note_id: creditNoteId })
  if (error) return { error: error.message }
  revalidatePath(`/finance/invoices/${note.invoice_id}`)
  revalidatePath("/finance/journal")
  revalidatePath("/finance/journal/trial-balance")
  revalidatePath("/audit/close")
  return {}
}

export async function postCashReceipt(paymentId: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "profit:view") }
  catch { return { error: "Only owners, admins, and accountants can post a draft journal." } }
  const supabase = await createClient()
  const paymentRes = await supabase.from("payments").select("id, amount_satang, paid_at, method, verification_state, reversal_of, refund_of, notes, verification_reference").eq("org_id", ctx.orgId).eq("id", paymentId).maybeSingle()
  if (paymentRes.error || !paymentRes.data) return { error: "Only a verified receipt can post." }
  const payment = paymentRes.data
  const [settingsRes, accountsRes, allocationsRes] = await Promise.all([
    supabase.from("org_settings").select("lock_date").eq("org_id", ctx.orgId).maybeSingle(),
    supabase.from("gl_accounts").select("code").eq("org_id", ctx.orgId),
    supabase.from("payment_allocations").select("invoice_id, amount_satang").eq("org_id", ctx.orgId).eq("payment_id", paymentId),
  ])
  if (settingsRes.error || accountsRes.error || allocationsRes.error) return { error: "Only a verified receipt can post." }
  const invoiceIds = [...new Set((allocationsRes.data ?? []).map(row => row.invoice_id))]
  const invoicesRes = invoiceIds.length === 0 ? { data: [] as { id: string; wht_satang: number; total_satang: number }[], error: null } : await supabase.from("invoices").select("id, wht_satang, total_satang").eq("org_id", ctx.orgId).in("id", invoiceIds)
  if (invoicesRes.error) return { error: "Only a verified receipt can post." }
  const postedInvoices = invoiceIds.length === 0 ? { data: [] as { source_invoice_id: string | null }[], error: null } : await supabase.from("journal_entries").select("source_invoice_id").eq("org_id", ctx.orgId).in("source_invoice_id", invoiceIds)
  if (postedInvoices.error) return { error: "Only a verified receipt can post." }
  const postedInvoiceIds = new Set((postedInvoices.data ?? []).map(row => row.source_invoice_id))
  const relatedAllocationsRes = invoiceIds.length === 0 ? { data: [] as { invoice_id: string; payment_id: string; amount_satang: number }[], error: null } : await supabase.from("payment_allocations").select("invoice_id, payment_id, amount_satang").eq("org_id", ctx.orgId).in("invoice_id", invoiceIds)
  const relatedNotesRes = invoiceIds.length === 0 ? { data: [] as { id: string; invoice_id: string; snapshot: unknown }[], error: null } : await supabase.from("credit_notes").select("id, invoice_id, snapshot").eq("org_id", ctx.orgId).in("invoice_id", invoiceIds)
  if (relatedAllocationsRes.error || relatedNotesRes.error) return { error: "Only a verified receipt can post." }
  const relatedAllocations = relatedAllocationsRes.data ?? []
  const relatedNotes = relatedNotesRes.data ?? []
  const relatedPaymentIds = [...new Set(relatedAllocations.map(row => row.payment_id))]
  const relatedNoteIds = relatedNotes.map(row => row.id)
  const [postedPayments, postedNotes] = await Promise.all([
    relatedPaymentIds.length === 0 ? Promise.resolve({ data: [] as { source_payment_id: string | null }[], error: null }) : supabase.from("journal_entries").select("source_payment_id").eq("org_id", ctx.orgId).in("source_payment_id", relatedPaymentIds),
    relatedNoteIds.length === 0 ? Promise.resolve({ data: [] as { source_credit_note_id: string | null }[], error: null }) : supabase.from("journal_entries").select("source_credit_note_id").eq("org_id", ctx.orgId).in("source_credit_note_id", relatedNoteIds),
  ])
  if (postedPayments.error || postedNotes.error) return { error: "Only a verified receipt can post." }
  const postedPaymentIds = new Set((postedPayments.data ?? []).map(row => row.source_payment_id))
  const postedNoteIds = new Set((postedNotes.data ?? []).map(row => row.source_credit_note_id))
  const check = cashReceiptJournal({
    verificationState: payment.verification_state,
    method: payment.method,
    reversal: Boolean(payment.reversal_of),
    refund: Boolean(payment.refund_of),
    amountSatang: payment.amount_satang,
    paidOn: bangkokCalendarDate(payment.paid_at),
    reference: payment.notes?.trim() || payment.verification_reference?.trim() || "",
    allocations: (allocationsRes.data ?? []).map(row => ({ invoiceId: row.invoice_id, amountSatang: row.amount_satang })),
    invoices: (invoicesRes.data ?? []).map(invoice => ({
      invoiceId: invoice.id,
      posted: postedInvoiceIds.has(invoice.id),
      whtSatang: invoice.wht_satang,
      totalSatang: invoice.total_satang,
      postedCreditSatang: relatedNotes.filter(row => row.invoice_id === invoice.id && postedNoteIds.has(row.id)).reduce((sum, row) => sum + documentMoney(row.snapshot, "totalSatang"), 0),
      postedReceiptSatang: relatedAllocations.filter(row => row.invoice_id === invoice.id && row.amount_satang > 0 && postedPaymentIds.has(row.payment_id)).reduce((sum, row) => sum + row.amount_satang, 0),
    })),
    lockDate: settingsRes.data?.lock_date ?? null,
    accounts: (accountsRes.data ?? []).map(account => account.code),
  })
  if (!check.ok) return { error: check.error }
  const { error } = await supabase.rpc("post_cash_receipt", { p_org_id: ctx.orgId, p_payment_id: paymentId })
  if (error) return { error: error.message }
  revalidatePath("/finance/journal")
  revalidatePath("/finance/journal/trial-balance")
  revalidatePath("/audit/close")
  for (const invoiceId of invoiceIds) revalidatePath(`/finance/invoices/${invoiceId}`)
  return {}
}
