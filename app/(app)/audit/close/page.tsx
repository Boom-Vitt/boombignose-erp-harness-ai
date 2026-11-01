import Link from "next/link"

import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { CLOSE_AUDIT_ACTIONS, closeActivityView } from "@/lib/finance/close-activity"
import { relativeTime } from "@/lib/audit/format"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ChecksumCheck } from "./checksum-check"

export const dynamic = "force-dynamic"

function Field({ label, value }: { label: string; value: string | number | null }) {
  if (value === null || value === "") return null
  return <p><span className="text-muted-foreground">{label}</span> <span className="break-all">{value}</span></p>
}

export default async function CloseActivityPage() {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "audit:view")) {
    return <div className="space-y-6">
      <PageHeader title="ไม่มีสิทธิ์เข้าถึง" description="หน้านี้สำหรับเจ้าขององค์กร ผู้ดูแลระบบ และนักบัญชี" />
      <Button render={<Link href="/dashboard" />}>กลับ Dashboard</Button>
    </div>
  }
  const supabase = await createClient()
  const { data: rows } = await supabase
    .from("audit_log")
    .select("id, actor_email, action, summary, meta, created_at")
    .eq("org_id", ctx.orgId)
    .in("action", [...CLOSE_AUDIT_ACTIONS])
    .order("created_at", { ascending: false })
    .limit(100)
  const entries = rows ?? []
  const now = new Date()
  return <div className="space-y-6">
    <PageHeader
      title="กิจกรรมปิดงวด / Close activity"
      description="เฉพาะการล็อก การเปิดงวด การปิดเดือนที่จบแล้ว และไฟล์ประกอบ ไม่ใช่การยื่นต่อกรมสรรพากร และไม่ใช่ตราเวลาจากภายนอก / Lock changes, reopens, completed-month closes, and support files only. Not a Revenue Department filing and not an external timestamp."
      breadcrumbs={[{ label: "Activity", href: "/audit" }]}
    />
    <p className="text-sm"><Link className="underline" href="/audit">บันทึกกิจกรรมทั้งหมด / All activity</Link></p>
    <ChecksumCheck />
    {entries.length === 0 ? <p className="text-sm text-muted-foreground">ยังไม่มีการล็อกหรือการส่งไฟล์ประกอบ / No lock changes or support exports yet.</p> : (
      <Card>
        <CardContent className="p-0">
          <ul className="divide-y">
            {entries.map(row => {
              const view = closeActivityView(row.action, row.meta)
              return <li key={row.id} className="space-y-1 px-4 py-3 text-sm">
                <p className="font-medium">{view.actionLabel}</p>
                <p>{row.actor_email ?? "System"} · {relativeTime(row.created_at, now)}</p>
                <p className="text-muted-foreground">{row.summary}</p>
                <Field label="ล็อกเดิม / Previous lock" value={view.previousLockDate} />
                <Field label="ล็อกใหม่ / Lock date" value={view.lockDate} />
                <Field label="เดือน / Month" value={view.month} />
                <Field label="เหตุผล / Reason" value={view.reason} />
                <Field label="ชนิดไฟล์ / File" value={view.kind} />
                <Field label="งวด / Period" value={view.period} />
                <Field label="SHA-256" value={view.sha256} />
                <Field label="ไบต์ / Bytes" value={view.bytes} />
              </li>
            })}
          </ul>
        </CardContent>
      </Card>
    )}
  </div>
}
