import type { Metadata } from "next"
import { requireOrgContext, requireRole } from "@/lib/auth"
import { getNetworkSnapshot } from "@/lib/network/server"
import { NetworkExplorer } from "@/components/network/network-explorer"

export const metadata: Metadata = { title: "Network Explorer 3D · BoomBigNose ERP" }
export const dynamic = "force-dynamic"

export default async function NetworkPage() {
  const context = await requireOrgContext()
  requireRole(context, ["owner", "admin"])
  const snapshot = await getNetworkSnapshot(context)
  return <NetworkExplorer initial={snapshot} appOrigin={process.env.NEXT_PUBLIC_APP_URL ?? ""} />
}
