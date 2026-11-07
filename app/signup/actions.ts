"use server"

import { z } from "zod"
import { headers } from "next/headers"

import { createClient } from "@/lib/supabase/server"
import { validatePassword } from "@/lib/auth/password"
import { configuredOrigins } from "@/lib/supabase/trusted-origin"
import { createAdminClient } from "@/lib/supabase/admin"
import { isTrustedRequestOrigin } from "@/lib/supabase/trusted-origin"
import { safeReturnPath } from "@/lib/supabase/redirect"

const SignupSchema = z.object({
  email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
  inviteToken: z.string().regex(/^[a-f0-9]{32}$/i, "Invalid invitation.").optional(),
  redirectTo: z.string().max(600).optional(),
})

export type SignupResult =
  | { ok: true; requiresConfirmation: boolean; requiresLogin?: boolean }
  | { ok: false; error: string }

/**
 * Real (non-demo) signup. Never trusts client input: validates the email with
 * Zod and the password against the shared policy before touching Supabase.
 * On success Supabase sends a confirmation email; the user is created in an
 * unconfirmed state until they click the link, which lands on /auth/confirm.
 */
export async function signUp(input: {
  email: string
  password: string
  inviteToken?: string
  redirectTo?: string
}): Promise<SignupResult> {
  const requestHeaders = await headers()
  if (!isTrustedRequestOrigin(new Request("http://internal.invalid/signup", { method: "POST", headers: requestHeaders }))) {
    return { ok: false, error: "Untrusted request origin." }
  }
  const parsed = SignupSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const { email, password } = parsed.data

  const policy = validatePassword(password)
  if (!policy.ok) {
    return { ok: false, error: policy.issues.join(" ") }
  }

  const env = process.env
  if (env.BOOMBIGNOSE_NATIVE === "1" && env.BOOMBIGNOSE_ALLOW_SIGNUP !== "1") {
    const token = parsed.data.inviteToken
    if (!token) return { ok: false, error: "This server requires a workspace invitation. Ask an owner for your invitation link." }
    const admin = createAdminClient()
    const { data: invite, error: lookupError } = await admin.from("invitations")
      .select("email, status, expires_at, accepted_by")
      .eq("token", token).maybeSingle()
    if (lookupError || !invite || invite.status !== "pending" || invite.accepted_by ||
        invite.email.toLowerCase() !== email.toLowerCase() ||
        (invite.expires_at !== null && (!Number.isFinite(Date.parse(invite.expires_at)) || Date.parse(invite.expires_at) <= Date.now()))) {
      return { ok: false, error: "Invitation unavailable for this email, expired, or revoked." }
    }
    // Targeted invitation possession authorizes only a new account, never a
    // session, membership, existing-account password change or issuer identity.
    // Recipient acceptance rechecks the live invitation atomically after login.
    const { error } = await admin.auth.admin.createUser({
      email: invite.email.toLowerCase(), password, email_confirm: true,
    })
    if (error) return { ok: false, error: "Could not register this invitation. If you already have an account, sign in instead." }
    return { ok: true, requiresConfirmation: false, requiresLogin: true }
  }

  const supabase = await createClient()
  const appUrl = configuredOrigins()[0]
  if (!appUrl) return { ok: false, error: "Application origin is not configured." }
  const confirmation = new URL("/auth/confirm", appUrl)
  if (parsed.data.redirectTo) confirmation.searchParams.set("redirect", safeReturnPath(parsed.data.redirectTo))
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: confirmation.href,
    },
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, requiresConfirmation: !data.session }
}
