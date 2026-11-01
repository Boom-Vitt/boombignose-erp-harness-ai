import Link from "next/link"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { draftCloseAcceptance } from "@/lib/finance/draft-close-acceptance"
import { TRIAL_BALANCE_LIMIT_EN, TRIAL_BALANCE_LIMIT_TH, trialBalance, trialBalanceThrough, type TrialBalanceLine } from "@/lib/finance/trial-balance"
import { DraftCloseAcceptance } from "../draft-close-acceptance"
import { TrialBalanceView } from "../trial-balance-view"

export const dynamic = "force-dynamic"

export default async function TrialBalancePage({ searchParams }: { searchParams: Promise<{ through?: string }> }) {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "profit:view")) return <p>Only owners, admins, and accountants can view the trial balance.</p>
  const requested = (await searchParams).through
  const supabase = await createClient()
  const [{ data: accounts, error: accountsError }, { data: settings, error: settingsError }, { data: entries, error: entriesError }, { data: lines, error: linesError }] = await Promise.all([
    supabase.from("gl_accounts").select("code, name_th, name_en, kind").eq("org_id", ctx.orgId),
    supabase.from("org_settings").select("lock_date").eq("org_id", ctx.orgId).maybeSingle(),
    supabase.from("journal_entries").select("id, entry_date").eq("org_id", ctx.orgId),
    supabase.from("journal_lines").select("entry_id, account_code, debit_satang, credit_satang").eq("org_id", ctx.orgId),
  ])
  if (accountsError || settingsError || entriesError || linesError) throw new Error("Trial balance unavailable")
  const chosen = trialBalanceThrough(requested, settings?.lock_date ?? null)
  const dates = new Map((entries ?? []).map(entry => [entry.id, entry.entry_date]))
  const posted: TrialBalanceLine[] = (lines ?? []).map(line => ({
    entryDate: dates.get(line.entry_id) ?? "",
    accountCode: line.account_code,
    debitSatang: line.debit_satang,
    creditSatang: line.credit_satang,
  }))
  const result = chosen.ok ? trialBalance(posted, (accounts ?? []).map(account => ({
    code: account.code,
    nameTh: account.name_th,
    nameEn: account.name_en,
    kind: account.kind,
  })), chosen.through) : chosen
  const throughValue = chosen.ok ? chosen.through ?? "" : ""
  const acceptance = result.ok && chosen.ok ? draftCloseAcceptance(settings?.lock_date ?? null, chosen.through, result.balance) : null
  const requests = acceptance?.ok
    ? await supabase.from("draft_close_acceptance_requests").select("id, requested_by, figures_sha256, status").eq("org_id", ctx.orgId).eq("through_date", acceptance.figures.through).in("status", ["pending", "confirmed"])
    : { data: [], error: null }
  if (requests.error) throw new Error("Trial balance unavailable")
  const pending = (requests.data ?? []).find(row => row.status === "pending") ?? null
  const confirmed = (requests.data ?? []).find(row => row.status === "confirmed") ?? null
  return <div className="space-y-6">
    <PageHeader title="งบทดลองฉบับร่าง / Draft trial balance" description={`${TRIAL_BALANCE_LIMIT_TH} ${TRIAL_BALANCE_LIMIT_EN}`} breadcrumbs={[{ label: "Finance", href: "/finance" }, { label: "Draft journal", href: "/finance/journal" }]} />
    <form method="get" className="flex flex-wrap items-end gap-3">
      <label className="text-sm">ถึงวันที่ / Through
        <input className="mt-1 block h-9 rounded-md border bg-background px-2" type="date" name="through" defaultValue={throughValue} />
      </label>
      <Button type="submit" variant="outline">แสดง / Show</Button>
    </form>
    <Button variant="outline" render={<Link href="/finance/journal/trial-balance?through=all" />}>ทุกวันที่บันทึกแล้ว / All posted dates</Button>
    {result.ok ? <TrialBalanceView balance={result.balance} through={chosen.ok ? chosen.through : null} lockDate={settings?.lock_date ?? null} /> : <p className="text-sm">{result.error}</p>}
    {acceptance?.ok ? <DraftCloseAcceptance through={acceptance.figures.through} viewerId={ctx.userId} pending={pending ? { id: pending.id, requestedBy: pending.requested_by, sha256: pending.figures_sha256 } : null} acceptedSha={confirmed?.figures_sha256 ?? null} currentSha={acceptance.figures.sha256} /> : acceptance ? <p className="text-sm">{acceptance.error}</p> : null}
    <p className="text-sm"><Link className="underline" href="/finance/journal">บันทึกรายวันฉบับร่าง / Draft journal</Link></p>
  </div>
}
