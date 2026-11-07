import QRCode from "qrcode"

import { getVerifiedApiContext } from "@/lib/auth"
import { buildPairUri, normalizeBaseUrl, startPairing } from "@/lib/mobile/pairing"
import { detectTailscaleBaseUrl } from "@/lib/mobile/tailscale"
import { createAdminClient } from "@/lib/supabase/admin"
import { readBoundedBody } from "@/lib/supabase/native-auth-proxy"
import { configuredOrigins } from "@/lib/supabase/trusted-origin"

export const dynamic = "force-dynamic"

/** Owner/admin session and MFA issue a connection-only, one-use pairing code. */
export async function POST(request: Request) {
  const verified = await getVerifiedApiContext(request, { roles: ["owner", "admin"], mutation: true })
  if (verified.response) return verified.response
  const { ctx } = verified
  let body: { baseUrl?: unknown }
  try { body = JSON.parse(new TextDecoder().decode(await readBoundedBody(request, 2048))) }
  catch { return Response.json({ error: "Invalid pairing request." }, { status: 400 }) }
  const detected = await detectTailscaleBaseUrl()
  const manual = typeof body?.baseUrl === "string" && body.baseUrl.trim() ? normalizeBaseUrl(body.baseUrl) : null
  if (!detected || (body?.baseUrl && manual !== detected) || !configuredOrigins().includes(detected)) {
    return Response.json({ error: "Configure this ERP's public HTTPS .ts.net origin and private Tailscale Serve mapping to its actual loopback backend. DNS alone is not a ready connection." }, { status: 400 })
  }
  const { token, expiresAt } = await startPairing(createAdminClient(), { orgId: ctx.orgId, userId: ctx.userId })
  const uri = buildPairUri({ baseUrl: detected, token, orgName: ctx.orgName, expiresAt })
  const qr = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 320 })
  return Response.json({ baseUrl: detected, qr, expiresAt: expiresAt.toISOString() }, { headers: { "cache-control": "no-store" } })
}
