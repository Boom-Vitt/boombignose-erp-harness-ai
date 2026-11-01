import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { todayISO } from "@/lib/dates"
import { CLOSE_AUDIT_ACTIONS, closeActivityCsv, type CloseActivityRow } from "@/lib/finance/close-activity"
import { supportExportHeaders } from "@/lib/finance/export-integrity"
import { commitSupportExport } from "@/lib/finance/support-export"
import { createClient } from "@/lib/supabase/server"
import { readAll } from "@/lib/supabase/read-all"

/** GET /audit/close/export — the close activity rows that exist now, with a stored checksum. */
export async function GET() {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "audit:view")) {
    return new Response("Only owners, admins, and accountants can export close activity.", { status: 403 })
  }
  const supabase = await createClient()
  const loaded = await readAll((from, to) => supabase
    .from("audit_log")
    .select("id, actor_email, action, summary, meta, created_at")
    .eq("org_id", ctx.orgId)
    .in("action", [...CLOSE_AUDIT_ACTIONS])
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to))
  if (loaded.error || !loaded.data) {
    return new Response("Close activity export unavailable. Reload before relying on this file.", { status: 503 })
  }
  const exportedOn = todayISO()
  const rows: CloseActivityRow[] = loaded.data.map(row => ({
    id: row.id,
    createdAt: row.created_at,
    actorEmail: row.actor_email,
    action: row.action,
    summary: row.summary,
    meta: row.meta,
  }))
  const body = closeActivityCsv(rows, exportedOn)
  const recorded = await commitSupportExport(ctx.orgId, "close_activity_csv", exportedOn, body)
  if (!recorded.ok) return new Response(recorded.error, { status: 503 })
  return new Response(body, {
    headers: supportExportHeaders(`close-activity-${exportedOn}.csv`, "text/csv; charset=utf-8", recorded.sha256, "attachment"),
  })
}
