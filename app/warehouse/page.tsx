import type { Metadata } from "next"

import { CampusApp } from "@/components/warehouse/campus-app"
import { organizationSnapshot } from "@/components/warehouse/data"
import { LangShell } from "@/components/lang-scope"
import { readLang } from "@/lib/lang"

export const metadata: Metadata = { title: "Organization · BoomBigNose" }
export const dynamic = "force-dynamic"

export default async function CampusPage() {
  // The data loader requires the same organization + MFA context as authenticated app pages.
  const snapshot = await organizationSnapshot()
  const lang = await readLang()
  return <LangShell initial={lang}><CampusApp snapshot={snapshot} /></LangShell>
}
