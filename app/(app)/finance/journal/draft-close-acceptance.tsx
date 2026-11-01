"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { DRAFT_CLOSE_ACCEPTANCE_EN, DRAFT_CLOSE_ACCEPTANCE_TH, DRAFT_CLOSE_DUAL_EN } from "@/lib/finance/draft-close-acceptance"
import { cancelDraftCloseAcceptance, confirmDraftCloseAcceptance, proposeDraftCloseAcceptance } from "./acceptance-actions"

export function DraftCloseAcceptance({
  through,
  viewerId,
  pending,
  acceptedSha,
  currentSha,
}: {
  through: string
  viewerId: string
  pending: { id: string; requestedBy: string; sha256: string } | null
  acceptedSha: string | null
  currentSha: string
}) {
  const router = useRouter()
  const [pendingClick, start] = useTransition()
  const mine = pending?.requestedBy === viewerId
  const stale = Boolean(pending && pending.sha256 !== currentSha)
  const matches = acceptedSha === currentSha
  const showForm = !matches && !stale && !(pending && mine)
  const label = pending && !mine ? "ยืนยันการรับ / Confirm acceptance" : "รับงบทดลองฉบับร่าง / Accept draft trial balance"
  return <div className="space-y-3">
    <p className="text-sm">{DRAFT_CLOSE_ACCEPTANCE_TH}</p>
    <p className="text-sm text-muted-foreground">{DRAFT_CLOSE_ACCEPTANCE_EN}</p>
    <p className="text-sm text-muted-foreground">{DRAFT_CLOSE_DUAL_EN}</p>
    {acceptedSha && matches ? <p className="text-sm">ยอดนี้ถูกรับแล้ว / These figures are already accepted.</p> : null}
    {(acceptedSha && !matches) || stale ? <p className="text-sm">งบทดลองเปลี่ยนหลังการรับครั้งก่อน / The draft trial balance changed after the last acceptance.</p> : null}
    {pending && mine ? <p className="text-sm">รอเจ้าของ ผู้ดูแล หรือนักบัญชีอีกคนยืนยัน / Waiting for a different owner, admin, or accountant.</p> : null}
    {showForm ? <form onSubmit={event => {
      event.preventDefault()
      start(async () => {
        const result = pending && !mine
          ? await confirmDraftCloseAcceptance(pending.id)
          : await proposeDraftCloseAcceptance(through)
        if (result.error) { toast.error(result.error); return }
        toast.success(result.pending ? "Acceptance is waiting for a second finance user." : "Draft trial balance accepted. It is not a statutory sign-off.")
        router.refresh()
      })
    }}>
      <Button type="submit" disabled={pendingClick}>{pendingClick ? "กำลังบันทึก…" : label}</Button>
    </form> : null}
    {pending && mine ? <Button type="button" variant="outline" disabled={pendingClick} onClick={() => start(async () => {
      const result = await cancelDraftCloseAcceptance(pending.id)
      if (result.error) { toast.error(result.error); return }
      toast.success("Draft acceptance request cancelled.")
      router.refresh()
    })}>ยกเลิกคำขอ / Cancel request</Button> : null}
  </div>
}
