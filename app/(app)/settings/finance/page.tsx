import { PaymentReviewForm } from "./payment-review-form"
import Link from "next/link"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { BillToleranceForm } from "./bill-tolerance-form"
import { todayISO } from "@/lib/dates"
import { FinanceLockForm } from "./finance-lock-form"

export const dynamic = "force-dynamic"

export default async function FinanceSettingsPage() {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "settings:manage") }
  catch { return <p>เฉพาะเจ้าของและผู้ดูแลที่เปลี่ยนการตั้งค่างวดบัญชีได้ / Only owners and admins can change finance settings.</p> }
  const supabase = await createClient()
  const { data, error } = await supabase.from("org_settings").select("lock_date, require_different_payment_reviewer, bill_variance_tolerance_bps").eq("org_id", ctx.orgId).maybeSingle()
  if (error) throw new Error("Finance settings unavailable")
  return <div className="space-y-6">
    <PageHeader title="ตั้งค่างวดบัญชี / Finance settings" description="ปิดงวดหลังตรวจเอกสารและใบเสร็จ ล็อกวันที่ ไม่ใช่การปิดบัญชีแยกประเภทและไม่ใช่การยื่นภาษี / Close a financial period after reviewing its documents and receipts. The lock is a date block, not a general-ledger close and not a tax filing." breadcrumbs={[{ label: "Settings", href: "/settings" }]} />
    <p className="text-sm"><Link href="/reports#month-end-close" className="underline">ปิดงบเดือน / Month-end checklist</Link> lists what to review before you lock a month.</p>
    <Card className="max-w-2xl"><CardContent><FinanceLockForm orgId={ctx.orgId} lockDate={data?.lock_date ?? ""} today={todayISO()} /></CardContent></Card>
    <Card className="max-w-2xl"><CardContent><PaymentReviewForm orgId={ctx.orgId} required={data?.require_different_payment_reviewer ?? false} /></CardContent></Card>
    <Card className="max-w-2xl"><CardContent><BillToleranceForm toleranceBps={data?.bill_variance_tolerance_bps ?? 100} /></CardContent></Card>
    <Link href="/finance/business-profile" className="text-sm underline">ข้อมูลกิจการและภาษีมูลค่าเพิ่ม / Business profile and VAT settings</Link>
    <Link href="/settings/chart" className="block text-sm underline">ผังบัญชี / Chart of accounts</Link>
  </div>
}
