"use server"

import { AINotConfiguredError, generateText, isAIConfigured } from "@/lib/ai/client"
import { closeSummaryPrompt } from "@/lib/ai/prompts"
import { openItemCounts, type CloseOpenItems } from "@/lib/finance/close-summary"
import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import { invoiceBalances } from "@/lib/payments/balances"
import { createClient } from "@/lib/supabase/server"
import { readAll } from "@/lib/supabase/read-all"

export type CloseSummaryResult =
  | { counts: CloseOpenItems; content: string }
  | { counts: CloseOpenItems; notConfigured: true }
  | { counts: CloseOpenItems; error: string }
  | { error: string }

/**
 * Read this workspace's open items and ask local Ollama for a short note.
 * A refused connection returns the counts and `notConfigured`. No cloud model
 * is called.
 */
export async function summarizeMonthEnd(): Promise<CloseSummaryResult> {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const today = todayISO()

  const [invoicesRes, costsRes, bankRes] = await Promise.all([
    readAll((from, to) => supabase
      .from("invoices")
      .select("id, status, amount_satang, due_date")
      .eq("org_id", ctx.orgId)
      .order("id")
      .range(from, to)),
    readAll((from, to) => supabase
      .from("costs")
      .select("id, vendor_id, paid_at, amount_satang")
      .eq("org_id", ctx.orgId)
      .order("id")
      .range(from, to)),
    readAll((from, to) => supabase
      .from("bank_lines")
      .select("id, matched_payment_id")
      .eq("org_id", ctx.orgId)
      .order("id")
      .range(from, to)),
  ])

  if (invoicesRes.error || costsRes.error) return { error: "Could not read open items." }

  let balances: Awaited<ReturnType<typeof invoiceBalances>>
  try {
    balances = await invoiceBalances(supabase, ctx.orgId)
  } catch {
    return { error: "Could not read invoice balances." }
  }

  const counts = openItemCounts({
    today,
    invoices: (invoicesRes.data ?? []).map((invoice) => ({
      status: invoice.status,
      amount_satang: invoice.amount_satang,
      due_date: invoice.due_date,
      paid_satang: balances.get(invoice.id)?.paid_satang ?? 0,
      credited_satang: balances.get(invoice.id)?.credited_satang ?? 0,
    })),
    bills: (costsRes.data ?? []).map((bill) => ({
      vendor_id: bill.vendor_id,
      paid_at: bill.paid_at,
      amount_satang: bill.amount_satang,
    })),
    bankLines: bankRes.error || !bankRes.data
      ? null
      : bankRes.data.map((line) => ({ matched_payment_id: line.matched_payment_id })),
  })

  if (!isAIConfigured()) return { counts, notConfigured: true }

  try {
    const content = await generateText({ ...closeSummaryPrompt(counts), maxTokens: 400 })
    return { counts, content }
  } catch (error) {
    if (error instanceof AINotConfiguredError) return { counts, notConfigured: true }
    return { counts, error: "Ollama returned no note. The counts above are still from this workspace." }
  }
}
