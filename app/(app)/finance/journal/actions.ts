"use server"

import { revalidatePath } from "next/cache"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { draftJournalLines, journalDateInClosedPeriod, journalMemo, type DraftJournalLine } from "@/lib/finance/draft-journal"
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
