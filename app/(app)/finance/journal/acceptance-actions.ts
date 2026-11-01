"use server"

import { revalidatePath } from "next/cache"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

async function financeActor(): Promise<{ orgId: string } | { error: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "profit:view") }
  catch { return { error: "Only owners, admins, and accountants can accept a draft close." } }
  return { orgId: ctx.orgId }
}

function refresh() {
  revalidatePath("/finance/journal/trial-balance")
  revalidatePath("/audit/close")
}

export async function proposeDraftCloseAcceptance(through: string): Promise<{ error?: string; pending?: boolean }> {
  const actor = await financeActor()
  if ("error" in actor) return { error: actor.error }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("propose_draft_close_acceptance", { p_org_id: actor.orgId, p_through: through })
  if (error) return { error: error.message }
  refresh()
  const pending = Boolean(data && typeof data === "object" && !Array.isArray(data) && (data as { pending?: unknown }).pending === true)
  return { pending }
}

export async function confirmDraftCloseAcceptance(requestId: string): Promise<{ error?: string; pending?: boolean }> {
  const actor = await financeActor()
  if ("error" in actor) return { error: actor.error }
  const supabase = await createClient()
  const { error } = await supabase.rpc("confirm_draft_close_acceptance", { p_org_id: actor.orgId, p_request_id: requestId })
  if (error) return { error: error.message }
  refresh()
  return {}
}

export async function cancelDraftCloseAcceptance(requestId: string): Promise<{ error?: string }> {
  const actor = await financeActor()
  if ("error" in actor) return { error: actor.error }
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancel_draft_close_acceptance", { p_org_id: actor.orgId, p_request_id: requestId })
  if (error) return { error: error.message }
  refresh()
  return {}
}
