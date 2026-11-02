import Link from "next/link"
import { z } from "zod"
import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { formatTHB, satangToBahtString } from "@/lib/money"
import { todayISO } from "@/lib/dates"
import { PageHeader } from "@/components/page-header"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CustomerReceiptForm } from "../_components/customer-receipt-form"
import { RefundCreditForm } from "../_components/refund-credit-form"
import { ReviewClaimForm } from "../_components/review-claim-form"
import { ReversePaymentForm } from "../_components/reverse-payment-form"

export default async function ReceiptsPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const clients = await readAllOrThrow((from, to) => supabase.from("clients").select("id, name").eq("org_id", ctx.orgId).order("name").order("id").range(from, to))
  const requested = (await searchParams).client
  const clientId = z.guid().safeParse(requested).success ? requested : undefined
  const client = clients.find(c => c.id === clientId)
  const manage = ctx.role !== "member"
  const today = todayISO()
  const [invoices, balances, claims, receipts, available, customer] = client ? await Promise.all([
    readAllOrThrow((from, to) => supabase.from("invoices").select("id, number").eq("org_id", ctx.orgId).eq("client_id", client.id).not("issued_snapshot_id", "is", null).neq("status", "cancelled").order("id").range(from, to)),
    readAllOrThrow((from, to) => supabase.from("invoice_balances").select("invoice_id, outstanding_satang").eq("org_id", ctx.orgId).eq("client_id", client.id).order("invoice_id").range(from, to)),
    readAllOrThrow((from, to) => supabase.from("payment_claims").select("id, amount_satang, reference, requested_allocations").eq("org_id", ctx.orgId).eq("client_id", client.id).is("invoice_id", null).eq("status", "pending").order("id").range(from, to)),
    readAllOrThrow((from, to) => supabase.from("payments").select("id, amount_satang, paid_at, verification_reference, reversal_of").eq("org_id", ctx.orgId).eq("client_id", client.id).eq("verification_state", "verified").order("created_at").order("id").range(from, to)),
    readAllOrThrow((from, to) => supabase.from("customer_receipt_balances").select("payment_id, available_satang").eq("org_id", ctx.orgId).eq("client_id", client.id).order("payment_id").range(from, to)),
    supabase.from("client_balances").select("credit_satang, outstanding_satang").eq("org_id", ctx.orgId).eq("client_id", client.id).maybeSingle().then(result => { if (result.error) throw new Error("Customer balance unavailable"); return result.data }),
  ]) : [[], [], [], [], [], null]
  const open = invoices.map(i => ({ ...i, outstanding: balances.find(b => b.invoice_id === i.id)?.outstanding_satang ?? 0 })).filter(i => i.outstanding > 0)
  const reversed = new Set(receipts.map(r => r.reversal_of))
  return <div className="space-y-6"><PageHeader title="Customer receipts" description="Verified receipts and allocations." /><p className="text-sm"><Link className="underline" href="/finance/bank">Bank lines</Link></p>
    <form className="flex gap-3 items-end" method="get"><label>Customer<select className="block rounded border bg-background p-2" name="client" defaultValue={client?.id ?? ""}><option value="" disabled>Select customer</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><Button type="submit">View customer receipts</Button></form>
    {client ? <><p><Link className="underline" href={`/clients/${client.id}`}>{client.name}</Link> · Open balance {formatTHB(customer?.outstanding_satang ?? 0)} · <strong>Customer credit {formatTHB(customer?.credit_satang ?? 0)}</strong></p>
      {manage ? <div className="grid gap-6 md:grid-cols-2"><Card><CardHeader><CardTitle>Report receipt</CardTitle></CardHeader><CardContent><CustomerReceiptForm orgId={ctx.orgId} clientId={client.id} invoices={open} mode="report" /></CardContent></Card>
        <Card><CardHeader><CardTitle>Apply existing credit</CardTitle></CardHeader><CardContent><CustomerReceiptForm orgId={ctx.orgId} clientId={client.id} invoices={open} mode="apply" /></CardContent></Card></div> : null}
      <Card><CardHeader><CardTitle>Pending customer receipts</CardTitle></CardHeader><CardContent className="space-y-4">{claims.map(claim => <div key={claim.id} className="rounded border p-3 space-y-2"><p>{formatTHB(claim.amount_satang)} · {claim.reference}</p><ul className="text-sm">{z.array(z.object({ invoice_id: z.guid(), amount_satang: z.number().int() })).parse(claim.requested_allocations).map(a => <li key={a.invoice_id}>{invoices.find(i => i.id === a.invoice_id)?.number ?? "Invoice"} · {formatTHB(a.amount_satang)}</li>)}</ul>{manage ? <ReviewClaimForm orgId={ctx.orgId} claimId={claim.id} suggestedBaht={satangToBahtString(claim.amount_satang)} today={today} /> : null}</div>)}</CardContent></Card>
      <Card><CardHeader><CardTitle>Verified customer cash</CardTitle></CardHeader><CardContent className="space-y-4">{receipts.map(receipt => {
        const credit = available.find(a => a.payment_id === receipt.id)?.available_satang ?? 0
        return <div key={receipt.id} className="rounded border p-3 space-y-2"><p>{formatTHB(receipt.amount_satang)} · {todayISO(new Date(receipt.paid_at))} · {receipt.verification_reference}</p><p>Available credit {formatTHB(credit)}</p>
          {manage && credit > 0 ? <RefundCreditForm orgId={ctx.orgId} paymentId={receipt.id} today={today} /> : null}
          {manage && !receipt.reversal_of && !reversed.has(receipt.id) ? <ReversePaymentForm orgId={ctx.orgId} paymentId={receipt.id} today={today} /> : null}
        </div>
      })}</CardContent></Card>
    </> : null}
  </div>
}
