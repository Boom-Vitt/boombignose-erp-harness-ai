import type { Metadata } from "next"

import { CampusApp } from "@/components/warehouse/campus-app"

export const metadata: Metadata = { title: "Organization · BoomBigNose" }

export default function CampusPage() {
  return <CampusApp />
}
