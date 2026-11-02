import { getOrgContext } from "@/lib/auth"
import { revokeDevice } from "@/lib/mobile/pairing"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getOrgContext()
  if (!ctx) return Response.json({ error: "Sign in required." }, { status: 401 })
  if (ctx.role !== "owner" && ctx.role !== "admin") return Response.json({ error: "Forbidden." }, { status: 403 })
  const { id } = await params
  const ok = await revokeDevice(createAdminClient(), ctx.orgId, id)
  return ok ? Response.json({ ok: true }) : Response.json({ error: "Device not found." }, { status: 404 })
}
