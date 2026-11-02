import type { SupabaseClient } from "@supabase/supabase-js"

import { readAllOrThrow } from "@/lib/supabase/read-all"
import type { Database } from "@/lib/types/database"

import type { ChainInput } from "./sales-chain"

export type QuoteInvoice = NonNullable<ChainInput["invoice"]> & { id: string; number: string }

/** The newest non-cancelled invoice per quote (all quotes, or just `quoteId`). Stored status is enough: payments drive `outstanding`. */
export async function quoteInvoices(supabase: SupabaseClient<Database>, orgId: string, quoteId?: string): Promise<Map<string, QuoteInvoice>> {
  const invoices = await readAllOrThrow((from, to) => {
    const q = supabase.from("invoices").select("id, number, status, source_quote_id, issued_snapshot_id")
      .eq("org_id", orgId).not("source_quote_id", "is", null).neq("status", "cancelled")
    return (quoteId ? q.eq("source_quote_id", quoteId) : q).order("created_at").order("id").range(from, to)
  })
  const balances = new Map((await readAllOrThrow((from, to) => {
    const q = supabase.from("invoice_balances").select("invoice_id, outstanding_satang").eq("org_id", orgId)
    return (quoteId ? q.in("invoice_id", invoices.map((i) => i.id)) : q).order("invoice_id").range(from, to)
  })).map((b) => [b.invoice_id, b.outstanding_satang]))
  const out = new Map<string, QuoteInvoice>()
  for (const i of invoices) {
    if (!i.source_quote_id) continue
    out.set(i.source_quote_id, { id: i.id, number: i.number, status: i.status, issued: !!i.issued_snapshot_id, outstandingSatang: balances.get(i.id) ?? 0 })
  }
  return out
}
