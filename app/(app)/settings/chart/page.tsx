import Link from "next/link"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { InstallChartButton } from "./install-button"

export const dynamic = "force-dynamic"

export default async function ChartPage() {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "profit:view")) return <p>Only owners, admins, and accountants can view the chart of accounts.</p>
  const supabase = await createClient()
  const { data, error } = await supabase.from("gl_accounts").select("code, name_th, name_en, kind").eq("org_id", ctx.orgId).order("code")
  if (error) throw new Error("Chart of accounts unavailable")
  const accounts = data ?? []
  return <div className="space-y-6">
    <PageHeader title="ผังบัญชี / Chart of accounts" description="ผังบัญชีอ้างอิงสำหรับ SME ไทย" breadcrumbs={[{ label: "Settings", href: "/settings" }]} />
    <Card className="max-w-3xl"><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">Adding the list inserts codes that are missing. It does not rename or delete a code you already saved. A balanced draft journal can use these codes. Those lines are not signed statutory books and not a tax filing.</p>
      {can(ctx.role, "settings:manage") ? <InstallChartButton /> : <p className="text-sm">Owners and admins can add the missing codes.</p>}
      {accounts.length === 0 ? <p className="text-sm">No accounts yet.</p> : <ul className="space-y-1 text-sm">{accounts.map(account => <li key={account.code}>{account.code} · {account.name_th} / {account.name_en} · {account.kind}</li>)}</ul>}
    </CardContent></Card>
    <p className="flex flex-wrap gap-4 text-sm">
      <Link href="/finance/journal" className="underline">บันทึกรายวันฉบับร่าง / Draft journal</Link>
      <Link href="/finance/journal/trial-balance" className="underline">งบทดลองฉบับร่าง / Draft trial balance</Link>
      <Link href="/settings/finance" className="underline">Finance settings</Link>
    </p>
  </div>
}
