"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { updateFinanceLockDate } from "@/app/(app)/finance/actions"
import { closeDateLabel } from "@/lib/finance/close-copy"
import { closeAccountingPeriod } from "@/lib/finance/period-close"

export function FinanceLockForm({ orgId, lockDate, today }: { orgId: string; lockDate: string; today: string }) {
  const [value, setValue] = useState(lockDate)
  const [month, setMonth] = useState("")
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  function saveLock(lock: string, success: string) {
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
    <p id="finance-lock-help" className="text-sm text-muted-foreground">การออกใบแจ้งหนี้ ใบเสร็จ และการแก้ไขที่มีวันที่ในวันนี้หรือก่อนหน้านั้นถูกบล็อก เว้นว่างไว้ถ้าต้องการเปิดทุกงวด / Invoice issues, receipts and corrections dated on or before this date are blocked. Leave blank to keep all periods open.</p>
    <Button type="submit" disabled={pending}><span aria-hidden="true">บันทึกล็อกงวด / </span>Save finance lock</Button>
    <div className="space-y-3 border-t pt-4">
      <h2 className="text-sm font-medium">ปิดเดือนที่จบแล้ว / Close a completed month</h2>
      <p className="text-sm text-muted-foreground">ตั้งล็อกเป็นวันสุดท้ายของเดือนนั้น บล็อกเอกสารและใบเสร็จถึงวันนั้น ไม่ใช่การปิดบัญชีแยกประเภทและไม่ใช่การยื่นภาษี / Sets the lock to the last day of that month. It blocks documents and receipts through that day. It is not a general-ledger close or a tax filing.</p>
      <label htmlFor="finance-close-month" className="block text-sm font-medium">เดือน / Month</label>
      <Input id="finance-close-month" type="month" value={month} disabled={pending} onChange={event => setMonth(event.target.value)} />
      <Button type="button" disabled={pending} onClick={() => {
        const decision = closeAccountingPeriod(month, today, lockDate)
        if (!decision.ok) { toast.error(decision.error); return }
        saveLock(decision.lockDate, `ปิดถึง ${closeDateLabel(decision.lockDate)} / Closed through ${closeDateLabel(decision.lockDate)}. Documents and receipts through that day are locked.`)
      }}>ปิดเดือนที่จบแล้ว / Close completed month</Button>
    </div>
  </form>
}
