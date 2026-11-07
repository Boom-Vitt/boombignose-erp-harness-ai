import { getVerifiedApiContext } from "@/lib/auth"
import { probeErpMcp } from "@/lib/mcp/probe"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const access = await getVerifiedApiContext(request)
  if ("response" in access) return access.response
  const status = await probeErpMcp(access.ctx)
  if ("error" in status) return Response.json(status, { status: 502 })
  return Response.json(status, { headers: { "Cache-Control": "private, no-store" } })
}
