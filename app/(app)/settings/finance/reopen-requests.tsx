"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { cancelFinanceLockReopen, confirmFinanceLockReopen } from "@/app/(app)/finance/actions"
import { closeDateLabel } from "@/lib/finance/close-copy"
import type { ReopenRequest } from "@/lib/finance/reopen-request"

function lockLabel(value: string | null): string {
  if (!value) return "เปิดทุกวัน / every day open"
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? closeDateLabel(value) : value
}

export function ReopenRequests({ orgId, viewerId, requests }: { orgId: string; viewerId: string; requests: readonly ReopenRequest[] }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  if (requests.length === 0) return null
  function run(requestId: string, confirm: boolean) {
    startTransition(async () => {
      const result = confirm
        ? await confirmFinanceLockReopen({ expectedOrgId: orgId, requestId })
        : await cancelFinanceLockReopen({ expectedOrgId: orgId, requestId })
      if (result.error) { toast.error(result.error); return }
      toast.success(confirm ? "เปิดงวดแล้ว / Finance lock reopened." : "ยกเลิกคำขอแล้ว / Reopen request cancelled.")
      router.refresh()
    })
  }
  return <div className="space-y-3 rounded-lg border p-4 text-sm">
    <h2 className="font-medium">คำขอเปิดงวด / Reopen requests</h2>
    <ul className="space-y-3">
      {requests.map(request => {
        const mine = request.requestedBy === viewerId
        return <li key={request.id} className="space-y-2">
          <p>{request.requesterEmail ?? "Owner or admin"} asked to move the lock to {lockLabel(request.lockDate)}.</p>
          <p>เหตุผล / Reason: {request.reason}</p>
          <div className="flex flex-wrap gap-2">
            {mine ? <p className="text-muted-foreground">รอเจ้าของหรือผู้ดูแลอีกคน / Waiting for the other owner or admin.</p> : <Button type="button" disabled={pending} onClick={() => run(request.id, true)}>ยืนยันการเปิดงวด / Confirm reopen</Button>}
            <Button type="button" variant="outline" disabled={pending} onClick={() => run(request.id, false)}>ยกเลิกคำขอ / Cancel request</Button>
          </div>
        </li>
      })}
    </ul>
  </div>
}
