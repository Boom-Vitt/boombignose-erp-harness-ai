"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { closeCompletedMonth, updateFinanceLockDate } from "@/app/(app)/finance/actions"
import { closeDateLabel } from "@/lib/finance/close-copy"
import { closeAccountingPeriod, financeLockChange } from "@/lib/finance/period-close"

export function FinanceLockForm({ orgId, lockDate, today }: { orgId: string; lockDate: string; today: string }) {
  const [value, setValue] = useState(lockDate)
  const [month, setMonth] = useState("")
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  function saveLock(lock: string, success: string) {
    const decision = financeLockChange(lock, today)
    if (!decision.ok) { toast.error(decision.error); return }
    startTransition(async () => {
      try {
        const result = await updateFinanceLockDate({ expectedOrgId: orgId, lockDate: lock })
        if (result.error) { toast.error(result.error); return }
        toast.success(success)
        router.refresh()
      } catch { toast.error("ยืนยันล็อกงวดไม่ได้ โหลดหน้าใหม่ก่อนลองอีกครั้ง / Could not confirm the finance lock. Reload before retrying.") }
    })
  }
  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault()
    saveLock(value, "Finance lock date saved")
  }}>
    <label htmlFor="finance-lock-date" className="block text-sm font-medium"><span aria-hidden="true">ล็อกเอกสารถึงวันที่ / </span>Lock transactions through</label>
    <Input id="finance-lock-date" type="date" value={value} disabled={pending} aria-describedby="finance-lock-help" onChange={event => setValue(event.target.value)} />
    {/^\d{4}-\d{2}-\d{2}$/.test(value) ? <p className="text-sm text-muted-foreground">{closeDateLabel(value)}</p> : null}
    <p id="finance-lock-help" className="text-sm text-muted-foreground">การออกใบแจ้งหนี้ ใบเสร็จ และการแก้ไขที่มีวันที่ในวันนี้หรือก่อนหน้านั้นถูกบล็อก เว้นว่างไว้เพื่อเปิดทุกวัน วันที่ในอนาคตถูกปฏิเสธ การล้างวันที่หรือเลื่อนวันที่ให้เร็วขึ้นถูกบันทึกในบันทึกกิจกรรมว่าเป็นการเปิดงวดใหม่ ล็อกนี้เป็นการดำเนินงาน ไม่ใช่การปิดงบตามกฎหมาย / Invoice issues, receipts and corrections dated on or before this date are blocked. Leave blank to reopen every day. A future date is refused. Clearing the date, or moving it earlier, is written to the activity log as a reopen. This lock is operational. It is not a statutory close.</p>
    <Button type="submit" disabled={pending}><span aria-hidden="true">บันทึกล็อกงวด / </span>Save finance lock</Button>
    <div className="space-y-3 border-t pt-4">
      <h2 className="text-sm font-medium">ปิดเดือนที่จบแล้ว / Close a completed month</h2>
      <p className="text-sm text-muted-foreground">ตั้งล็อกเป็นวันสุดท้ายของเดือนนั้นหลังเดือนจบแล้ว ฐานข้อมูลปฏิเสธเดือนปัจจุบันและเดือนที่ล็อกครอบคลุมแล้ว เจ้าของหรือผู้ดูแลถูกบันทึกในบันทึกกิจกรรม ไม่ใช่การปิดบัญชีแยกประเภทและไม่ใช่การยื่นภาษี / Sets the lock to the last day of that month after the month has ended. The database refuses the current month and a month the lock already covers. An owner or admin is recorded on the activity log. It is not a general-ledger close or a tax filing.</p>
      <label htmlFor="finance-close-month" className="block text-sm font-medium">เดือน / Month</label>
      <Input id="finance-close-month" type="month" value={month} disabled={pending} onChange={event => setMonth(event.target.value)} />
      <Button type="button" disabled={pending} onClick={() => {
        const decision = closeAccountingPeriod(month, today, lockDate)
        if (!decision.ok) { toast.error(decision.error); return }
        startTransition(async () => {
          try {
            const result = await closeCompletedMonth({ expectedOrgId: orgId, month })
            if (result.error) { toast.error(result.error); return }
            const closedThrough = result.lockDate ?? decision.lockDate
            setValue(closedThrough)
            const label = closeDateLabel(closedThrough)
            toast.success(`ปิดถึง ${label} / Closed through ${label}. Documents and receipts through that day are locked.`)
            router.refresh()
          } catch { toast.error("ยืนยันล็อกงวดไม่ได้ โหลดหน้าใหม่ก่อนลองอีกครั้ง / Could not confirm the finance lock. Reload before retrying.") }
        })
      }}>ปิดเดือนที่จบแล้ว / Close completed month</Button>
    </div>
  </form>
}
