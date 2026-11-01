import Link from "next/link"
import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { todayISO } from "@/lib/dates"
import { formatTHB } from "@/lib/money"
import { canReviewFinanceClose } from "@/lib/finance/close-access"
import { closeDateLabel } from "@/lib/finance/close-copy"
import { BANK_LINE_STATUS_LABEL, bankLineInQueue, bankLineStatusHelp, bankQueueSummaryText, bankWindowLabel, classifyBankLines, parseBankQueue, summarizeBankClose, type BankQueue } from "@/lib/finance/bank-review"
import { resolveCloseThrough } from "@/lib/finance/close-window"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { AddBankLineForm, ExplainBankLineForm, MatchBankLineButton } from "./bank-forms"

export const dynamic = "force-dynamic"

const QUEUES: { id: BankQueue; label: string }[] = [
  { id: "open", label: "ยังเปิดอยู่ / Still open" },
  { id: "explained", label: "บันทึกเหตุผลแล้ว / Explained" },
  { id: "matched", label: "จับคู่แล้ว / Matched" },
  { id: "all", label: "ทั้งหมด / All in this window" },
]

function bankHref(through: string, queue: BankQueue): string {
  const params = new URLSearchParams({ through })
  if (queue !== "open") params.set("queue", queue)
  return `/finance/bank?${params.toString()}`
}

export default async function BankPage({ searchParams }: { searchParams: Promise<{ through?: string; queue?: string }> }) {
  const ctx = await requireOrgContext()
  if (!canReviewFinanceClose(ctx.role)) return <p>เฉพาะเจ้าของ ผู้ดูแล และนักบัญชี / Only owners, admins, and accountants can reconcile bank lines.</p>
  const params = await searchParams
  const today = todayISO()
  const through = resolveCloseThrough(today, params.through)
  if (!through.ok) return <p>{through.error}</p>
  const queue = parseBankQueue(params.queue)
  const throughParam = through.scope === "all" ? "all" : through.month
  const supabase = await createClient()
  const [lines, payments] = await Promise.all([
    readAllOrThrow((from, to) => supabase.from("bank_lines").select("id, booked_on, amount_satang, reference, matched_payment_id, close_note").eq("org_id", ctx.orgId).order("booked_on", { ascending: false }).order("id").range(from, to)),
    readAllOrThrow((from, to) => supabase.from("payments").select("id, amount_satang, verification_reference, verification_state, reversal_of").eq("org_id", ctx.orgId).order("id").range(from, to)),
  ])
  const candidates = payments.map(payment => ({
    id: payment.id,
    amountSatang: payment.amount_satang,
    reference: payment.verification_reference,
    verified: payment.verification_state === "verified",
    reversal: payment.reversal_of !== null,
  }))
  const classified = classifyBankLines(lines.map(line => ({
    id: line.id,
    bookedOn: line.booked_on,
    amountSatang: line.amount_satang,
    reference: line.reference,
    matchedPaymentId: line.matched_payment_id,
    closeNote: line.close_note,
  })), candidates, through.periodEnd)
  const summary = summarizeBankClose(classified, through.periodEnd)
  const visible = classified.filter(line => bankLineInQueue(line, queue, through.periodEnd))
  const windowLabel = bankWindowLabel(through.periodEnd)

  return <div className="space-y-6">
    <PageHeader title="รายการธนาคาร / Bank lines" description="จับคู่รายการเดินบัญชีกับใบเสร็จที่ยืนยันแล้วหนึ่งใบ หรือบันทึกว่าทำไมรายการนี้ไม่ใช่ใบเสร็จลูกค้า การจับคู่ไม่ได้แก้ใบเสร็จ การบันทึกไม่ได้ลงบัญชี / Match a statement line to one verified receipt, or note why it is not a customer receipt. A match does not change the receipt. A note does not post a journal." breadcrumbs={[{ label: "Finance", href: "/finance" }]} />
    <div className="flex flex-wrap items-end gap-3">
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">ถึงเดือน / Through month
          <input className="mt-1 block h-9 rounded-md border bg-background px-2" type="month" name="through" defaultValue={through.month ?? ""} />
        </label>
        <Button type="submit" variant="outline">แสดง / Show</Button>
      </form>
      <Button variant="ghost" render={<Link href="/finance/bank?through=all" />}>ทุกวัน / All dates</Button>
    </div>
    <p className="text-sm text-muted-foreground">{windowLabel} ใบเสร็จสองใบที่มียอดและเลขอ้างอิงเดียวกันจะยังไม่ถูกจับคู่ รายการที่บันทึกหลังเดือนนี้ไปกับงวดถัดไป / Two receipts with the same amount and reference stay unmatched. Lines booked after this month stay with the next close.</p>
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatCard label="ยังต้องจัดการ / Still open" value={String(summary.openCount)} tone={summary.openCount > 0 ? "warning" : "positive"} hint={formatTHB(summary.openNetSatang)} />
      <StatCard label="พร้อมจับคู่ / Ready to match" value={String(summary.readyCount)} />
      <StatCard label="บันทึกเหตุผลแล้ว / Explained" value={String(summary.explainedCount)} hint={formatTHB(summary.explainedNetSatang)} />
      <StatCard label="จับคู่แล้ว / Matched" value={String(summary.matchedCount)} hint={formatTHB(summary.matchedNetSatang)} />
    </div>
    <p className="text-sm text-muted-foreground">
      {bankQueueSummaryText(summary)}
    </p>
    <nav aria-label="Bank line queue" className="flex flex-wrap gap-2">
      {QUEUES.map(item => <Button key={item.id} variant={queue === item.id ? "secondary" : "outline"} render={<Link href={bankHref(throughParam, item.id)} />} aria-current={queue === item.id ? "page" : undefined}>{item.label}</Button>)}
    </nav>
    <Card className="max-w-3xl"><CardContent className="space-y-4">
      <AddBankLineForm today={today} />
    </CardContent></Card>
    {visible.length === 0 ? <p className="text-sm text-muted-foreground">ไม่มีรายการในมุมนี้ / Nothing in this queue.</p> : null}
    <ul className="max-w-3xl space-y-3">{visible.map(line => {
      const help = bankLineStatusHelp(line.status)
      return <li key={line.id} className="space-y-2 rounded-lg border p-3 text-sm">
        <p>{closeDateLabel(line.bookedOn)} · {formatTHB(line.amountSatang)} · {line.reference}</p>
        <p className="font-medium">{BANK_LINE_STATUS_LABEL[line.status]}</p>
        {help ? <p className="text-muted-foreground">{help}</p> : null}
        {line.status === "ready" && line.suggestedPaymentId ? <MatchBankLineButton lineId={line.id} paymentId={line.suggestedPaymentId} /> : null}
        {line.status === "explained" && line.closeNote ? <p>เหตุผล / Note: {line.closeNote}</p> : null}
        {line.status !== "matched" ? <ExplainBankLineForm lineId={line.id} note={line.closeNote} /> : null}
      </li>
    })}</ul>
    <p className="flex flex-wrap gap-4 text-sm">
      <Link className="underline" href={through.scope === "month" ? `/finance/cash?month=${through.month}` : "/finance/cash"}>เงินสดตอนปิดงวด / Cash at close</Link>
      <Link className="underline" href="/finance/receipts">ใบเสร็จลูกค้า / Customer receipts</Link>
      <Link className="underline" href="/finance?status=overdue">ลูกหนี้เกินกำหนด / Overdue receivables</Link>
    </p>
  </div>
}
