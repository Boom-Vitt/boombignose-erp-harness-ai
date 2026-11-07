import { getVerifiedApiContext } from "@/lib/auth"
import { listDevices } from "@/lib/mobile/pairing"
import { createAdminClient } from "@/lib/supabase/admin"
import { isTrustedBrowserRequest } from "@/lib/supabase/trusted-origin"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  if (!isTrustedBrowserRequest(request)) return Response.json({ error: "Untrusted request origin." }, { status: 403 })
  const verified = await getVerifiedApiContext(request, { roles: ["owner", "admin"] })
  if (verified.response) return verified.response
  return Response.json({ devices: await listDevices(createAdminClient(), verified.ctx.orgId) }, { headers: { "cache-control": "no-store" } })
}
