import QRCode from "qrcode"

import { getOrgContext } from "@/lib/auth"
import { buildPairUri, normalizeBaseUrl, startPairing } from "@/lib/mobile/pairing"
import { detectTailscaleBaseUrl } from "@/lib/mobile/tailscale"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

/** Owner/admin only: issue a one-time pairing QR for this org. */
export async function POST(request: Request) {
  const ctx = await getOrgContext()
  if (!ctx) return Response.json({ error: "Sign in required." }, { status: 401 })
  if (ctx.role !== "owner" && ctx.role !== "admin") {
    return Response.json({ error: "Only an owner or admin can link a phone." }, { status: 403 })
  }

  const body = (await request.json().catch(() => null)) as { baseUrl?: unknown } | null
  const manual = typeof body?.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl : null
  const candidate = manual ?? (await detectTailscaleBaseUrl())
  if (!candidate) {
    return Response.json(
      { error: "Tailscale was not detected. Enter the https://<name>.<tailnet>.ts.net address of this computer." },
      { status: 400 },
    )
  }
  const baseUrl = normalizeBaseUrl(candidate)
  if (!baseUrl) {
    return Response.json(
      { error: "The address must be an http(s) URL your phone can reach, not localhost." },
      { status: 400 },
    )
  }

  const { token, expiresAt } = await startPairing(createAdminClient(), { orgId: ctx.orgId, userId: ctx.userId })
  const uri = buildPairUri({ baseUrl, token, orgName: ctx.orgName, expiresAt })
  const qr = await QRCode.toDataURL(uri, { errorCorrectionLevel: "M", margin: 2, width: 320 })
  return Response.json({ baseUrl, qr, expiresAt: expiresAt.toISOString() })
}
