import { getVerifiedApiContext } from "@/lib/auth"
import { revokeDevice } from "@/lib/mobile/pairing"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const verified = await getVerifiedApiContext(request, { roles: ["owner", "admin"], mutation: true })
  if (verified.response) return verified.response
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "Device not found." }, { status: 404 })
  const ok = await revokeDevice(createAdminClient(), verified.ctx.orgId, id)
  return ok ? Response.json({ ok: true, browserSessionsSignedOut: false }, { headers: { "cache-control": "no-store" } }) : Response.json({ error: "Device not found." }, { status: 404 })
}
