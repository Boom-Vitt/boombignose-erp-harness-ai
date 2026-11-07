import { redeemPairing } from "@/lib/mobile/pairing"
import { createAdminClient } from "@/lib/supabase/admin"
import { readBoundedBody } from "@/lib/supabase/native-auth-proxy"
import { isTrustedRequestOrigin } from "@/lib/supabase/trusted-origin"

export const dynamic = "force-dynamic"

/** Public: the phone trades the QR's one-time token for a device credential. */
export async function POST(request: Request) {
  if (request.headers.has("origin") && !isTrustedRequestOrigin(request)) return Response.json({ error: "Untrusted request origin." }, { status: 403 })
  let body: { token?: unknown; deviceName?: unknown } | null
  try { body = JSON.parse(new TextDecoder().decode(await readBoundedBody(request, 2048))) }
  catch { return Response.json({ error: "Invalid pairing request." }, { status: 400 }) }
  if (typeof body?.token !== "string" || body.token.length < 20 || body.token.length > 200) {
    return Response.json({ error: "Invalid or expired pairing code." }, { status: 400 })
  }
  const deviceName = typeof body.deviceName === "string" ? body.deviceName : ""
  const db = createAdminClient()
  const paired = await redeemPairing(db, { token: body.token, deviceName })
  if (!paired) return Response.json({ error: "Invalid or expired pairing code." }, { status: 400 })

  const { data: org } = await db.from("organizations").select("name").eq("id", paired.orgId).maybeSingle()
  return Response.json({ deviceToken: paired.deviceToken, deviceId: paired.deviceId, orgName: org?.name ?? "", connectionOnly: true }, { headers: { "cache-control": "no-store" } })
}
