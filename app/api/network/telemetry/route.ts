import { networkRoute, telemetryResponse } from "@/lib/network/server"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"

export async function POST(request: Request) {
  return networkRoute(() => telemetryResponse(request))
}
