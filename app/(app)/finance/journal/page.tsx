import Link from "next/link"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { DRAFT_JOURNAL_LIMIT_EN, DRAFT_JOURNAL_LIMIT_TH } from "@/lib/finance/draft-journal"
import { closeDateLabel } from "@/lib/finance/close-copy"
import { formatTHB } from "@/lib/money"
import { JournalForm } from "./journal-form"

export const dynamic = "force-dynamic"

type LineRow = { entry_id: string; line_no: number; account_code: string; debit_satang: number; credit_satang: number }

export default async function DraftJournalPage() {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "profit:view")) return <p>Only owners, admins, and accountants can post a draft journal.</p>
  const supabase = await createClient()
  const [{ data: accounts, error: accountsError }, { data: settings, error: settingsError }, { data: entries, error: entriesError }] = await Promise.all([
    supabase.from("gl_accounts").select("code, name_th, name_en").eq("org_id", ctx.orgId).order("code"),
    supabase.from("org_settings").select("lock_date").eq("org_id", ctx.orgId).maybeSingle(),
    supabase.from("journal_entries").select("id, entry_date, memo, created_at, source_invoice_id, source_credit_note_id, source_payment_id").eq("org_id", ctx.orgId).order("created_at", { ascending: false }).limit(20),
  ])
  if (accountsError || settingsError || entriesError) throw new Error("Draft journal unavailable")
  const rows = entries ?? []
  const ids = rows.map(entry => entry.id)
  const { data: lineData, error: linesError } = ids.length === 0
    ? { data: [] as LineRow[], error: null }
    : await supabase.from("journal_lines").select("entry_id, line_no, account_code, debit_satang, credit_satang").eq("org_id", ctx.orgId).in("entry_id", ids)
  if (linesError) throw new Error("Draft journal unavailable")
  const lines = lineData ?? []
  const names = new Map((accounts ?? []).map(account => [account.code, `${account.name_th} / ${account.name_en}`]))
  const chart = (accounts ?? []).map(account => ({ code: account.code, nameTh: account.name_th, nameEn: account.name_en }))
  return <div className="space-y-6">
    <PageHeader title="บันทึกรายวันฉบับร่าง / Draft journal" description={`${DRAFT_JOURNAL_LIMIT_TH} ${DRAFT_JOURNAL_LIMIT_EN}`} breadcrumbs={[{ label: "Finance", href: "/finance" }]} />
    <p className="flex flex-wrap gap-4 text-sm">
      <Link className="underline" href="/finance/journal/trial-balance">งบทดลองฉบับร่าง / Draft trial balance</Link>
      <Link className="underline" href="/settings/chart">ผังบัญชี / Chart of accounts</Link>
    </p>
    <Card className="max-w-4xl"><CardContent className="space-y-4">
      {chart.length === 0 ? <p className="text-sm">Add the chart of accounts before posting a journal.</p> : <JournalForm accounts={chart} lockDate={settings?.lock_date ?? null} />}
      {settings?.lock_date ? <p className="text-sm text-muted-foreground">Closed through {closeDateLabel(settings.lock_date)}. Issued invoices still do not post themselves.</p> : null}
    </CardContent></Card>
    {rows.length === 0 ? <p className="text-sm">No draft journals yet.</p> : <ul className="space-y-4 text-sm">{rows.map(entry => {
      const entryLines = lines.filter(line => line.entry_id === entry.id).sort((a, b) => a.line_no - b.line_no)
      return <li key={entry.id} className="space-y-1">
        <p className="font-medium">{closeDateLabel(entry.entry_date)} · {entry.memo}</p>
        {entry.source_invoice_id ? <p><Link className="underline" href={`/finance/invoices/${entry.source_invoice_id}`}>จากใบแจ้งหนี้ที่ออกแล้ว / From an issued invoice</Link></p> : null}
        {entry.source_credit_note_id ? <p>จากใบลดหนี้ที่ออกแล้ว / From an issued credit note</p> : null}
        {entry.source_payment_id ? <p>จากใบเสร็จเงินสดที่ยืนยันแล้ว / From a verified cash receipt</p> : null}
        <ul>{entryLines.map(line => <li key={`${entry.id}-${line.line_no}`}>{line.account_code} {names.get(line.account_code) ?? ""} · debit {formatTHB(line.debit_satang)} · credit {formatTHB(line.credit_satang)}</li>)}</ul>
      </li>
    })}</ul>}
  </div>
}
