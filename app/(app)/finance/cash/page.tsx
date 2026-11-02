import Link from "next/link"
import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { todayISO } from "@/lib/dates"
import { formatTHB } from "@/lib/money"
import { canReviewFinanceClose } from "@/lib/finance/close-access"
import { cashTruth } from "@/lib/finance/cash-truth"
import { BAHT_CAPTION_TH, closeDateLabel, closeMonthLabel } from "@/lib/finance/close-copy"
import { bangkokCalendarDate, resolveCloseMonth } from "@/lib/finance/close-window"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export const dynamic = "force-dynamic"

export default async function CashClosePage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireOrgContext()
  if (!canReviewFinanceClose(ctx.role)) return <p>เฉพาะเจ้าของ ผู้ดูแล และนักบัญชี / Only owners, admins, and accountants can review cash at close.</p>
  const requested = (await searchParams).month
  const today = todayISO()
  const window = resolveCloseMonth(today, requested)
  if (!window.ok) return <p>{window.error}</p>
  const supabase = await createClient()
  const [settings, receipts, costs, lines] = await Promise.all([
    supabase.from("org_settings").select("cash_balance_satang").eq("org_id", ctx.orgId).maybeSingle(),
    readAllOrThrow((from, to) => supabase.from("payments").select("id, amount_satang, paid_at, verification_state").eq("org_id", ctx.orgId).order("id").range(from, to)),
    readAllOrThrow((from, to) => supabase.from("costs").select("id, amount_satang, paid_at").eq("org_id", ctx.orgId).order("id").range(from, to)),
    readAllOrThrow((from, to) => supabase.from("bank_lines").select("id, booked_on, amount_satang, matched_payment_id, close_note").eq("org_id", ctx.orgId).order("id").range(from, to)),
  ])
  if (settings.error) throw new Error("Cash at close is unavailable. Reload before relying on totals.")
  const truth = cashTruth({
    asOf: window.periodEnd,
    recordedBalanceSatang: settings.data?.cash_balance_satang ?? 0,
    receipts: receipts.map(row => ({
      id: row.id,
      paidOn: bangkokCalendarDate(row.paid_at),
      amountSatang: row.amount_satang,
      verified: row.verification_state === "verified",
    })),
    costs: costs.map(row => ({
      paidOn: row.paid_at ? bangkokCalendarDate(row.paid_at) : null,
      amountSatang: row.amount_satang,
    })),
    statementLines: lines.map(row => ({
      bookedOn: row.booked_on,
      amountSatang: row.amount_satang,
      matchedPaymentId: row.matched_payment_id,
      closeNote: row.close_note,
    })),
  })
  if (!truth.ok) return <p>{truth.error}</p>
  const cash = truth.truth

  return <div className="space-y-6">
    <PageHeader
      title="เงินสดตอนปิดงวด / Cash at close"
      description={`ถึง ${closeDateLabel(cash.asOf)} · Not a bank balance and not a ledger. ${BAHT_CAPTION_TH}`}
      breadcrumbs={[{ label: "Finance", href: "/finance" }, { label: "Bank lines", href: "/finance/bank" }]}
    />
    <form method="get" className="flex flex-wrap items-end gap-3">
      <label className="text-sm">เดือน / Month
        <input className="mt-1 block h-9 rounded-md border bg-background px-2" type="month" name="month" defaultValue={window.month} />
      </label>
      <Button type="submit" variant="outline">แสดง / Show</Button>
    </form>
    <p className="text-sm text-muted-foreground">งวด {closeMonthLabel(window.month)} · ถึง {closeDateLabel(cash.asOf)}</p>
    <Card><CardContent className="space-y-2 py-4 text-sm text-muted-foreground">
      <p>ยอดที่บันทึกไว้คือตัวเลขเงินสดใน Settings ที่แดชบอร์ดใช้ เงินสดในระบบคือใบเสร็จที่ยืนยันแล้วถึงวันสิ้นเดือนนี้ ลบต้นทุนที่ทำเครื่องหมายว่าจ่ายแล้วถึงวันเดียวกัน ไม่ใช่ยอดตามสมุดบัญชีธนาคาร</p>
      <p>The recorded balance is the cash figure saved in Settings. Cash in the system is verified receipts through this date minus costs marked paid through this date. The difference is those two figures. It does not post a journal. The outstanding pack lists open invoices and unpaid vendor bills with the same aging cuts as Support reports. Balances are as they stand now, for documents dated on or before the close date.</p>
    </CardContent></Card>
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <StatCard label="ยอดที่บันทึกไว้ / Recorded balance" value={formatTHB(cash.recordedBalanceSatang)} hint="ตั้งค่า · เงินสดบนแดชบอร์ด / Settings · dashboard cash" />
      <StatCard label="เงินสดในระบบ / Cash in the system" value={formatTHB(cash.cashInSystemSatang)} hint={`${formatTHB(cash.verifiedReceiptsSatang)} ใบเสร็จ / receipts − ${formatTHB(cash.paidCostsSatang)} ต้นทุนที่จ่ายแล้ว / paid costs`} />
      <StatCard label="ผลต่าง / Recorded minus system" value={formatTHB(cash.differenceSatang)} tone={cash.differenceSatang === 0 ? "positive" : "warning"} hint="บวก หมายถึงยอดใน Settings สูงกว่า / Positive means Settings is higher" />
    </div>
    <section className="space-y-3">
      <h2 className="font-semibold">รายการธนาคารถึงวันนี้ / Statement lines through {closeDateLabel(cash.asOf)}</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="ยอดสุทธิที่กรอก / Statement net" value={formatTHB(cash.statementNetSatang)} />
        <StatCard label="จับคู่ใบเสร็จแล้ว / Matched" value={formatTHB(cash.matchedStatementSatang)} />
        <StatCard label="ยังไม่จับคู่ / Still open" value={String(cash.openStatementCount)} tone={cash.openStatementCount > 0 ? "warning" : "positive"} hint={formatTHB(cash.openStatementSatang)} />
        <StatCard label="บันทึกเหตุผลแล้ว / Explained" value={String(cash.explainedStatementCount)} hint={formatTHB(cash.explainedStatementSatang)} />
      </div>
      <p className="text-sm text-muted-foreground">ใบเสร็จที่ยืนยันแล้วแต่ยังไม่มีรายการธนาคารถึงวันนี้ / Verified receipts with no statement line through this date: {cash.receiptsWithoutStatementCount} · {formatTHB(cash.receiptsWithoutStatementSatang)}.</p>
    </section>
    <p className="flex flex-wrap gap-4 text-sm">
      <Link className="underline" href={`/finance/bank?through=${window.month}`}>เปิดรายการที่ยังไม่จับคู่ / Open unmatched bank lines</Link>
      <Link className="underline" href="/settings">แก้ยอดที่บันทึกไว้ / Edit recorded balance</Link>
      <Link className="underline" href={`/finance/outstanding/export?asOf=${cash.asOf}`}>ไฟล์ลูกหนี้เจ้าหนี้ / Outstanding pack CSV</Link>
      <Link className="underline" href="/finance?status=overdue">ลูกหนี้เกินกำหนด / Overdue receivables</Link>
      <Link className="underline" href="/finance?tab=costs">ต้นทุน / Costs</Link>
      <Link className="underline" href={`/reports/statements?month=${window.month}`}>งบประกอบ / Support reports</Link>
    </p>
  </div>
}
