import { getOrgContext } from "@/lib/auth"
import { listDevices } from "@/lib/mobile/pairing"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

export async function GET() {
  const ctx = await getOrgContext()
  if (!ctx) return Response.json({ error: "Sign in required." }, { status: 401 })
  if (ctx.role !== "owner" && ctx.role !== "admin") return Response.json({ error: "Forbidden." }, { status: 403 })
  return Response.json({ devices: await listDevices(createAdminClient(), ctx.orgId) })
}
