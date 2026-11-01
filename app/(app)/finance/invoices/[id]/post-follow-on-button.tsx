"use client"

import { useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { postCashReceipt, postIssuedCreditNote } from "@/app/(app)/finance/journal/actions"
import { FOLLOW_ON_JOURNAL_LIMIT_EN, FOLLOW_ON_JOURNAL_LIMIT_TH } from "@/lib/finance/follow-on-journal"

function PostControl({ posted, pending, label, onSubmit }: { posted: boolean; pending: boolean; label: string; onSubmit: () => void }) {
  if (posted) return <p className="text-sm"><Link className="underline" href="/finance/journal">เปิดบันทึกรายวันฉบับร่าง / Open the draft journal</Link></p>
  return <form onSubmit={event => { event.preventDefault(); onSubmit() }}>
    <Button type="submit" disabled={pending}>{pending ? "กำลังบันทึก…" : label}</Button>
  </form>
}

export function PostCreditNoteButton({ creditNoteId, posted }: { creditNoteId: string; posted: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return <PostControl posted={posted} pending={pending} label="ลงใบลดหนี้ / Post credit note" onSubmit={() => start(async () => {
    const result = await postIssuedCreditNote(creditNoteId)
    if (result.error) { toast.error(result.error); return }
    toast.success("Credit note posted to the draft journal. It is not signed statutory books.")
    router.refresh()
  })} />
}

export function PostCashReceiptButton({ paymentId, posted }: { paymentId: string; posted: boolean }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  return <PostControl posted={posted} pending={pending} label="ลงใบเสร็จเงินสด / Post cash receipt" onSubmit={() => start(async () => {
    const result = await postCashReceipt(paymentId)
    if (result.error) { toast.error(result.error); return }
    toast.success("Cash receipt posted to the draft journal. It is not signed statutory books.")
    router.refresh()
  })} />
}

export function FollowOnJournalNote() {
  return <div className="space-y-1">
    <p className="text-sm">{FOLLOW_ON_JOURNAL_LIMIT_TH}</p>
    <p className="text-sm text-muted-foreground">{FOLLOW_ON_JOURNAL_LIMIT_EN}</p>
  </div>
}
