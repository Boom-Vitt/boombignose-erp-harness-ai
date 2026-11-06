import { networkRoute, snapshotResponse } from "@/lib/network/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function GET() {
  return networkRoute(snapshotResponse)
}
