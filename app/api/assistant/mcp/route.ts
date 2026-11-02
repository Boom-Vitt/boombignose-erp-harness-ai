import { getOrgContext } from "@/lib/auth"
import { probeErpMcp } from "@/lib/mcp/probe"

export const dynamic = "force-dynamic"

export async function GET() {
  const ctx = await getOrgContext()
  if (!ctx) return Response.json({ error: "Sign in required." }, { status: 401 })
  const status = await probeErpMcp()
  if ("error" in status) return Response.json(status, { status: 502 })
  return Response.json(status)
}
