import type { Metadata } from "next"

import { CampusApp } from "@/components/warehouse/campus-app"

export const metadata: Metadata = { title: "Campus 3D · BoomBigNose" }

export default function CampusPage() {
  return <CampusApp />
}
