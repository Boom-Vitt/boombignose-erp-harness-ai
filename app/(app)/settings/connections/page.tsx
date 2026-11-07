import { redirect } from "next/navigation"

import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { currentModelHost } from "@/lib/ai/local-model-access"
import { loadModelSettings } from "@/lib/ai/ollama-admin"
import { probeErpMcp } from "@/lib/mcp/probe"
import { parseLocale, type Probes } from "@/lib/connections/catalog"
import { ConnectionsCatalog } from "./connections-catalog"

export const dynamic = "force-dynamic"

export default async function ConnectionsPage() {
  const ctx = await requireOrgContext()
  if (ctx.role !== "owner" && ctx.role !== "admin") redirect("/settings")
  const supabase = await createClient()

  const [mcp, models, profile, accounting] = await Promise.all([
    probeErpMcp(ctx).catch(() => ({ error: "unreachable" })),
    loadModelSettings(currentModelHost()).catch(() => null),
    supabase.from("profiles").select("locale").eq("id", ctx.userId).maybeSingle(),
    // The accounting module only exists in the Pro edition; Community has no such route.
    process.env.BBN_EDITION === "pro"
      ? supabase.from("accounting_connections").select("status").eq("org_id", ctx.orgId).maybeSingle()
      : Promise.resolve(null),
  ])

  const probes: Probes = {
    erpMcp: !("error" in mcp),
    ollama: models?.daemonUp ?? false,
    flowaccount: process.env.BBN_EDITION !== "pro" ? "unavailable" : accounting?.data?.status === "connected" ? "connected" : "available",
  }
  return <ConnectionsCatalog probes={probes} profileLocale={parseLocale(profile.data?.locale) ?? "th"} />
}
