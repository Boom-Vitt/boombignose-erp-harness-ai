import Link from "next/link"

import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { CLOSE_AUDIT_ACTIONS, closeActivityView } from "@/lib/finance/close-activity"
import { readChainStatus } from "@/lib/finance/close-chain"
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
    .select("id, actor_email, action, summary, meta, created_at, close_chain_seq, close_chain_prev, close_chain_sha256")
    .eq("org_id", ctx.orgId)
    .in("action", [...CLOSE_AUDIT_ACTIONS])
    .order("created_at", { ascending: false })
    .limit(100)
  const chainResult = await supabase.rpc("verify_close_activity_chain", { p_org_id: ctx.orgId })
  const chain = chainResult.error ? null : readChainStatus(chainResult.data)
  const entries = rows ?? []
  const now = new Date()
  return <div className="space-y-6">
    <PageHeader
      title="กิจกรรมปิดงวด / Close activity"
      description="เฉพาะการล็อก การเปิดงวด การปิดเดือนที่จบแล้ว และไฟล์ประกอบ ไม่ใช่การยื่นต่อกรมสรรพากร และไม่ใช่ตราเวลาจากภายนอก / Lock changes, reopens, completed-month closes, and support files only. Not a Revenue Department filing and not an external timestamp."
      breadcrumbs={[{ label: "Activity", href: "/audit" }]}
    />
    <p className="text-sm"><Link className="underline" href="/audit">บันทึกกิจกรรมทั้งหมด / All activity</Link></p>
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" render={<Link href="/audit/close/export" />}>ดาวน์โหลด CSV / Download CSV</Button>
      <p className="text-sm text-muted-foreground">ไฟล์คือรายการปิดงวดทั้งหมด ไม่ใช่แค่ 100 แถวล่าสุดบนหน้านี้ แถวเช็คซัมของไฟล์นี้ถูกเขียนหลังส่งออก / The file is every close-activity row, not only the latest 100 on this page. Its checksum row is written after the download.</p>
    </div>
    {chainResult.error ? <p className="text-sm">ตรวจโซ่ไม่ได้ โหลดหน้าใหม่ก่อนเชื่อผล / Chain check unavailable. Reload before relying on it.</p> : chain?.ok ? (
      <p className="text-sm">โซ่บันทึกปิดงวดครบ {chain.checked} แถว แถวที่หายหรือถูกแก้จะทำให้โซ่ขาด นี่ไม่ใช่ตราเวลาจากภายนอก และไม่ใช่การยื่นแบบ / The close-activity chain links {chain.checked} rows. A missing or edited row breaks it. This is not an external timestamp and not a filing.</p>
    ) : chain ? (
      <p className="text-sm">{chain.reason}{chain.brokenAt ? ` (${chain.brokenAt})` : ""}</p>
    ) : null}
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
                <Field label="การควบคุม / Control" value={view.control} />
                <Field label="ชนิดไฟล์ / File" value={view.kind} />
                <Field label="งวด / Period" value={view.period} />
                <Field label="SHA-256 ของไฟล์ / File SHA-256" value={view.sha256} />
                <Field label="ไบต์ / Bytes" value={view.bytes} />
                <Field label="ลำดับโซ่ / Chain" value={row.close_chain_seq} />
                <Field label="SHA-256 ของโซ่ / Chain SHA-256" value={row.close_chain_sha256} />
              </li>
            })}
          </ul>
        </CardContent>
      </Card>
    )}
  </div>
}
