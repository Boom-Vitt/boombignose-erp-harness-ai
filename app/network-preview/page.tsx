import type { Metadata } from "next"
import { connection } from "next/server"
import { notFound } from "next/navigation"
import { NetworkExplorer } from "@/components/network/network-explorer"

export const metadata: Metadata = { title: "SSH Sample Preview · BoomBigNose ERP" }

export default async function NetworkPreviewPage() {
  await connection()
  if (process.env.ERP_NETWORK_PREVIEW !== "1") notFound()
  return <main className="mx-auto min-h-svh max-w-[1480px] p-4 sm:p-6"><NetworkExplorer previewOnly /></main>
}
