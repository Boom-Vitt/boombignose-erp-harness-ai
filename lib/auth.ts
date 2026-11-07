import { cache } from "react"
import { cookies } from "next/headers"
import { forbidden, redirect } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import type { Enums } from "@/lib/types/database"
import { can, type Capability } from "@/lib/permissions"
import { stepUpPath } from "@/lib/auth/totp"
import { isTrustedRequestOrigin } from "@/lib/supabase/trusted-origin"

export type Role = Enums<"role_enum">

/** Cookie holding the user's currently-active org id (multi-org switcher). */
export const ACTIVE_ORG_COOKIE = "active_org"

export type OrgContext = {
  userId: string
  email: string | null
  orgId: string
  orgName: string
  role: Role
}

/** Authenticated actor, independent of whether workspace onboarding is complete. */
export const getAuthenticatedUser = cache(async () => {
  const supabase = await createClient()
  const { data: { user }, error } = await supabase.auth.getUser()
  return error ? null : user
})

/**
 * Resolve the signed-in user's active organization context. The active org is
 * the one named by the `active_org` cookie when the user is a member of it,
 * otherwise their first membership (stable single-org default). Returns null
 * when not signed in or not a member of any org. `cache` dedupes within a
 * single request.
 */
export const getOrgContext = cache(async (): Promise<OrgContext | null> => {
  const supabase = await createClient()

  const user = await getAuthenticatedUser()
  if (!user) return null

  const { data: memberships, error: membershipError } = await supabase
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true })

  if (membershipError) throw new Error("Unable to load workspace memberships. Please try again.")
  if (!memberships || memberships.length === 0) return null

  const cookieStore = await cookies()
  const preferred = cookieStore.get(ACTIVE_ORG_COOKIE)?.value
  const active =
    (preferred && memberships.find((m) => m.org_id === preferred)) ||
    memberships[0]!

  const { data: org, error: orgError } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", active.org_id)
    .maybeSingle()

  if (orgError || !org) throw new Error("Unable to load the active workspace. Please try again.")

  return {
    userId: user.id,
    email: user.email ?? null,
    orgId: active.org_id,
    orgName: org.name,
    role: active.role,
  }
})

/** No network/unknown-assurance fallback: enrolled factors require AAL2. */
const assuranceState = cache(async (): Promise<"allowed" | "step-up" | "unavailable"> => {
  try {
    const supabase = await createClient()
    const user = await getAuthenticatedUser()
    if (!user) return "unavailable"
    const session = await supabase.auth.getSession()
    if (session.error || !session.data.session?.access_token) return "unavailable"
    // Passing the token makes auth-js verify it and read live factors with getUser,
    // rather than reading the untrusted cached session.user.
    const level = await supabase.auth.mfa.getAuthenticatorAssuranceLevel(session.data.session.access_token)
    if (level.error || !level.data || !["aal1", "aal2"].includes(level.data.currentLevel ?? "") ||
        !["aal1", "aal2"].includes(level.data.nextLevel ?? "")) return "unavailable"
    return stepUpPath({
      // auth-js may derive nextLevel from a stale cached session user.
      hasVerifiedTotp: user.factors?.some((factor) => factor.status === "verified") === true || level.data.nextLevel === "aal2",
      authenticatorAssuranceLevel: level.data.currentLevel,
    }) ? "step-up" : "allowed"
  } catch {
    return "unavailable"
  }
})

/** Login is for signed-out actors; signed-in actors without a workspace onboard. */
export async function requireOrgContext(): Promise<OrgContext> {
  if (!await getAuthenticatedUser()) redirect("/login")
  const assurance = await assuranceState()
  if (assurance === "step-up") redirect("/login/mfa")
  if (assurance === "unavailable") forbidden()
  const ctx = await getOrgContext()
  if (!ctx) {
    if (await getAuthenticatedUser()) redirect("/onboarding")
    redirect("/login")
  }
  return ctx
}

/** Throws when the context's role is not in the allowed set. Defense-in-depth on top of RLS. */
export function requireRole(ctx: OrgContext, allowed: Role[]): void {
  if (!allowed.includes(ctx.role)) {
    forbidden()
  }
}

/**
 * Capability-based gate (preferred over requireRole). Throws when the context's
 * role does not hold `capability` per the matrix in lib/permissions. Kept here
 * so every action can import a single auth surface.
 */
export function requireCapability(ctx: OrgContext, capability: Capability): void {
  if (!can(ctx.role, capability)) {
    forbidden()
  }
}

/** JSON API boundary: verified identity, live membership, MFA, and mutation CSRF. */
export async function getVerifiedApiContext(
  request: Request,
  options: { roles?: Role[]; mutation?: boolean } = {},
): Promise<{ ctx: OrgContext; response?: never } | { ctx?: never; response: Response }> {
  const deny = (error: string, status: number) => ({ response: Response.json({ error }, { status, headers: { "cache-control": "no-store" } }) })
  if (options.mutation && !isTrustedRequestOrigin(request)) return deny("Untrusted request origin.", 403)
  try {
    if (!await getAuthenticatedUser()) return deny("Sign in required.", 401)
    const assurance = await assuranceState()
    if (assurance === "unavailable") return deny("Unable to verify session assurance. Please try again.", 503)
    if (assurance === "step-up") return deny("Authenticator verification required.", 403)
    const ctx = await getOrgContext()
    if (!ctx) return deny("Workspace membership required.", 403)
    if (options.roles && !options.roles.includes(ctx.role)) return deny("Your role does not permit this action.", 403)
    return { ctx }
  } catch {
    return deny("Unable to verify workspace access. Please try again.", 503)
  }
}

/** Host resources are shared by every workspace; workspace ownership is insufficient. */
export function machineOperatorDenied(userId: string): Response | null {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
  const operators = (process.env.BOOMBIGNOSE_OPERATOR_USER_IDS ?? "").split(",")
  if (operators.every((id) => uuid.test(id)) && operators.includes(userId)) return null
  return Response.json({
    error: `Shared host changes and all-workspace backups require operating-system operator authorization. On the server, run boombignose configure-operators ${userId}, then restart it. Workspace ownership alone is insufficient.`,
  }, { status: 403, headers: { "cache-control": "no-store" } })
}
