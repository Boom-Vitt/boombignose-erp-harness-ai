"use server"

import { createClient } from "@/lib/supabase/server"
import { headers } from "next/headers"
import { isTrustedRequestOrigin } from "@/lib/supabase/trusted-origin"

/** Browser Auth never gains a REST proxy, including the login language preference. */
export async function saveLoginLocale(locale: string): Promise<boolean> {
  if (!isTrustedRequestOrigin(new Request("http://internal.invalid/login", { method: "POST", headers: await headers() }))) return false
  if (locale !== "th" && locale !== "en") return false
  const db = await createClient()
  const { data: { user }, error } = await db.auth.getUser()
  if (error || !user) return false
  const session = await db.auth.getSession()
  if (session.error || !session.data.session?.access_token) return false
  const assurance = await db.auth.mfa.getAuthenticatorAssuranceLevel(session.data.session.access_token)
  if (assurance.error || !assurance.data || !["aal1", "aal2"].includes(assurance.data.currentLevel ?? "") ||
      !["aal1", "aal2"].includes(assurance.data.nextLevel ?? "") ||
      ((user.factors?.some((factor) => factor.status === "verified") || assurance.data.nextLevel === "aal2") && assurance.data.currentLevel !== "aal2")) return false
  const result = await db.from("profiles").update({ locale }).eq("id", user.id)
  return !result.error
}
