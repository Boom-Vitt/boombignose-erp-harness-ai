"use client"

import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DEPOSIT_JOURNAL_LIMIT_EN, DEPOSIT_JOURNAL_LIMIT_TH } from "@/lib/finance/deposit-journal"
import { SALES_INVOICE_JOURNAL_LIMIT_EN, SALES_INVOICE_JOURNAL_LIMIT_TH } from "@/lib/finance/sales-invoice-journal"
import { postIssuedSalesInvoice } from "@/app/(app)/finance/journal/actions"

export function PostSalesInvoiceButton({ invoiceId, posted, deposit = false }: { invoiceId: string; posted: boolean; deposit?: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return <div className="space-y-2">
    <p className="text-sm">{deposit ? DEPOSIT_JOURNAL_LIMIT_TH : SALES_INVOICE_JOURNAL_LIMIT_TH}</p>
    <p className="text-sm text-muted-foreground">{deposit ? DEPOSIT_JOURNAL_LIMIT_EN : SALES_INVOICE_JOURNAL_LIMIT_EN}</p>
    {posted ? <p className="text-sm"><Link className="underline" href="/finance/journal">เปิดบันทึกรายวันฉบับร่าง / Open the draft journal</Link></p> : <form onSubmit={event => {
      event.preventDefault()
      start(async () => {
        const result = await postIssuedSalesInvoice(invoiceId)
        if (result.error) { toast.error(result.error); return }
        toast.success("Issued sales invoice posted to the draft journal. It is not signed statutory books.")
        router.refresh()
      })
    }}>
      <Button type="submit" disabled={pending}>{pending ? "กำลังบันทึก…" : "ลงบันทึกรายวันฉบับร่าง / Post to draft journal"}</Button>
    </form>}
  </div>
}
