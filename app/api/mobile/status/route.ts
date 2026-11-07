import { authDevice, bearerToken } from "@/lib/mobile/pairing"
import { createAdminClient } from "@/lib/supabase/admin"

export const dynamic = "force-dynamic"

/** Bearer device token → connection status for the app's Home screen. */
export async function GET(request: Request) {
  const db = createAdminClient()
  const device = await authDevice(db, bearerToken(request))
  if (!device) return Response.json({ error: "Device not linked." }, { status: 401 })
  return Response.json({ ok: true, deviceName: device.name, connectionOnly: true }, { headers: { "cache-control": "no-store" } })
}
