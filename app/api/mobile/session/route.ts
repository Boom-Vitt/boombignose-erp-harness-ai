import { authDevice, bearerToken } from "@/lib/mobile/pairing"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

/**
 * Bearer device token → a one-time sign-in path for the app's WebView. It reuses the existing
 * /auth/confirm route, so the web session is the normal Supabase cookie session. A revoked device,
 * or a user no longer in the org, gets nothing.
 */
export async function POST(request: Request) {
  const db = createAdminClient()
  const device = await authDevice(db, bearerToken(request))
  if (!device) return Response.json({ error: "Device not linked." }, { status: 401 })

  const { data: member } = await db
    .from("memberships")
    .select("user_id")
    .eq("org_id", device.org_id)
    .eq("user_id", device.user_id)
    .maybeSingle()
  if (!member) return Response.json({ error: "Device not linked." }, { status: 401 })

  const { data: user } = await db.auth.admin.getUserById(device.user_id)
  const email = user.user?.email
  if (!email) return Response.json({ error: "Device not linked." }, { status: 401 })

  const { data: link, error } = await db.auth.admin.generateLink({ type: "magiclink", email })
  const tokenHash = link?.properties?.hashed_token
  if (error || !tokenHash) return Response.json({ error: "Could not start a session." }, { status: 502 })

  const q = new URLSearchParams({ token_hash: tokenHash, type: "magiclink" })
  return Response.json({ path: `/auth/confirm?${q}` })
}
