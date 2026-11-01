import Link from "next/link"
import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { todayISO } from "@/lib/dates"
import { formatTHB } from "@/lib/money"
import { suggestBankMatch } from "@/lib/finance/bank-match"
import { can } from "@/lib/permissions"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { AddBankLineForm, MatchBankLineButton } from "./bank-forms"

export const dynamic = "force-dynamic"

export default async function BankPage() {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "payment:verify")) return <p>Only owners, admins, and accountants can reconcile bank lines.</p>
  const supabase = await createClient()
  const [lines, payments] = await Promise.all([
    readAllOrThrow((from, to) => supabase.from("bank_lines").select("id, booked_on, amount_satang, reference, matched_payment_id").eq("org_id", ctx.orgId).order("booked_on", { ascending: false }).order("id").range(from, to)),
    readAllOrThrow((from, to) => supabase.from("payments").select("id, amount_satang, verification_reference, verification_state, reversal_of").eq("org_id", ctx.orgId).order("id").range(from, to)),
  ])
  const taken = new Set(lines.map(line => line.matched_payment_id).filter((id): id is string => !!id))
  const candidates = payments.map(payment => ({ id: payment.id, amountSatang: payment.amount_satang, reference: payment.verification_reference, verified: payment.verification_state === "verified", reversal: payment.reversal_of !== null }))
  return <div className="space-y-6">
    <PageHeader title="รายการธนาคาร / Bank lines" description="Match a statement line to one verified receipt with the same amount and reference." breadcrumbs={[{ label: "Finance", href: "/finance" }]} />
    <Card className="max-w-3xl"><CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">A match is a note on the statement line. It does not change the receipt, post a journal, or file anything. Two receipts with the same amount and reference are left unmatched.</p>
      <AddBankLineForm today={todayISO()} />
    </CardContent></Card>
    <ul className="max-w-3xl space-y-3">{lines.map(line => {
      const suggestion = line.matched_payment_id ? null : suggestBankMatch({ amountSatang: line.amount_satang, reference: line.reference }, candidates, taken)
      return <li key={line.id} className="rounded-lg border p-3 text-sm">
        <p>{line.booked_on} · {formatTHB(line.amount_satang)} · {line.reference}</p>
        {line.matched_payment_id ? <p>Matched to a verified receipt.</p> : suggestion ? <MatchBankLineButton lineId={line.id} paymentId={suggestion} /> : <p className="text-muted-foreground">No single verified receipt has this amount and reference.</p>}
      </li>
    })}</ul>
    <Link href="/finance/receipts" className="text-sm underline">Customer receipts</Link>
  </div>
}
