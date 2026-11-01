import Link from "next/link"
import { ScrollText } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { auditSentence, relativeTime } from "@/lib/audit/format"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export const dynamic = "force-dynamic"

/** Short label per entity for the row badge. */
function entityLabel(entity: string): string {
  return entity.charAt(0).toUpperCase() + entity.slice(1)
}

export default async function AuditPage() {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "audit:view")) {
    return (
      <div className="space-y-6">
        <PageHeader
          title="ไม่มีสิทธิ์เข้าถึง"
          description="หน้านี้สำหรับเจ้าขององค์กร ผู้ดูแลระบบ และนักบัญชี"
        >
          <Button render={<Link href="/dashboard" />}>กลับ Dashboard</Button>
        </PageHeader>
      </div>
    )
  }

  const supabase = await createClient()
  const { data: rows } = await supabase
    .from("audit_log")
    .select("id, actor_email, entity, entity_id, action, summary, created_at")
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .limit(100)

  const entries = rows ?? []
  const now = new Date()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity"
        description="A running history of changes across your workspace."
      />

      {entries.length === 0 ? (
        <EmptyState
          icon={ScrollText}
          title="No activity yet"
          description="Changes to deals, invoices, payments, and settings will appear here."
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <ul className="divide-y">
              {entries.map((row) => (
                <li
                  key={row.id}
                  className="flex items-start justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm leading-snug">
                      {auditSentence({
                        actorEmail: row.actor_email,
                        action: row.action,
                        entity: row.entity,
                        summary: row.summary,
                      })}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {relativeTime(row.created_at, now)}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 capitalize">
                    {entityLabel(row.entity)}
                  </Badge>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
