"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"

const ConnectAccounting = z.object({
  transport: z.enum(["fixture", "sandbox"]),
})

export type ConnectAccountingInput = z.infer<typeof ConnectAccounting>

/**
 * Connect FlowAccount for this workspace. The row stores the transport only.
 * A sandbox token stays in FLOWACCOUNT_ACCESS_TOKEN and is never written here.
 * PEAK and Xero are not connected by this action.
 */
export async function connectAccounting(
  input: ConnectAccountingInput
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()

  try {
    requireCapability(ctx, "accounting:manage")
  } catch {
    return { error: "Only an owner or admin can change the accounting connection." }
  }

  const parsed = ConnectAccounting.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }

  const supabase = await createClient()
  const { error } = await supabase.from("accounting_connections").upsert(
    {
      org_id: ctx.orgId,
      provider: "flowaccount",
      status: "connected",
      config: { transport: parsed.data.transport },
    },
    { onConflict: "org_id" }
  )
  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "settings",
    entityId: ctx.orgId,
    action: "updated",
    summary: `Connected FlowAccount (${parsed.data.transport})`,
    meta: { provider: "flowaccount", transport: parsed.data.transport },
  })

  revalidatePath("/settings/accounting")
  return {}
}

/**
 * Disconnect the org's accounting provider. Uses UPDATE (not upsert) because
 * disconnect has no provider input and the Insert type requires one — and you
 * can only disconnect a row that already exists. Leaves the provider on record.
 */
export async function disconnectAccounting(): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()

  try {
    requireCapability(ctx, "accounting:manage")
  } catch {
    return { error: "Only an owner or admin can change the accounting connection." }
  }

  const supabase = await createClient()
  const { error } = await supabase
    .from("accounting_connections")
    .update({ status: "disconnected" })
    .eq("org_id", ctx.orgId)
  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "settings",
    entityId: ctx.orgId,
    action: "updated",
    summary: "Disconnected accounting provider",
  })

  revalidatePath("/settings/accounting")
  return {}
}
