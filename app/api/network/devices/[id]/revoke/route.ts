import { networkRoute, revokeResponse } from "@/lib/network/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return networkRoute(async () => revokeResponse(request, (await params).id))
}
