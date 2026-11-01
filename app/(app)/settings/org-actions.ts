"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"
import { activateWorkspace } from "@/lib/supabase/workspace-session"

const ONE_YEAR = 60 * 60 * 24 * 365

// ── Invite a teammate ───────────────────────────────────────────────────────
const InviteMember = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: z.enum(["admin", "accountant", "member"]).default("member"),
})

export async function inviteMember(
  input: z.input<typeof InviteMember>
): Promise<{ error?: string; token?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "team:manage")

  const parsed = InviteMember.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }
  const { email, role } = parsed.data

  const token = crypto.randomUUID().replace(/-/g, "")
  const expiresAt = new Date(Date.now() + 1000 * ONE_YEAR / 12).toISOString() // ~30 days

  const supabase = await createClient()
  // Re-inviting the same email refreshes the row (new token, pending again).
  const { error } = await supabase
    .from("invitations")
    .upsert(
      {
        org_id: ctx.orgId,
        email,
        role,
        token,
        status: "pending",
        invited_by: ctx.userId,
        accepted_by: null,
        expires_at: expiresAt,
      },
      { onConflict: "org_id,email" }
    )

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "invitation",
    action: "invited",
    summary: `Invited ${email} as ${role}`,
  })

  revalidatePath("/settings")
  return { token }
}

// ── Revoke a pending invitation ─────────────────────────────────────────────
const RevokeInvitation = z.object({ id: z.string().min(1) })

export async function revokeInvitation(
  input: z.input<typeof RevokeInvitation>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "team:manage")

  const parsed = RevokeInvitation.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createClient()
  const { error } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)
    .eq("status", "pending")

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "invitation",
    entityId: parsed.data.id,
    action: "revoked",
    summary: "Revoked a pending invitation",
  })

  revalidatePath("/settings")
  return {}
}

// ── Accept an invitation (invitee side) ─────────────────────────────────────
const AcceptInvitation = z.object({ token: z.string().trim().min(1).max(256) })

export async function acceptInvitation(
  input: z.input<typeof AcceptInvitation>
): Promise<{ error?: string }> {
  const parsed = AcceptInvitation.safeParse(input)
  if (!parsed.success) return { error: "Invalid invitation" }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?redirect=${encodeURIComponent(`/invite/${encodeURIComponent(parsed.data.token)}`)}`)

  const { data: orgId, error } = await supabase.rpc("accept_workspace_invitation", {
    p_token: parsed.data.token,
  })
  if (error) return { error: error.message }
  if (!orgId) return { error: "Unable to accept this invitation. Please try again." }

  await activateWorkspace(orgId)
  revalidatePath("/", "layout")
  redirect("/dashboard")
}
