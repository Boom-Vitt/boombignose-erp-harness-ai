"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { closeCompletedMonth, updateFinanceLockDate } from "@/app/(app)/finance/actions"
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
      } catch { toast.error("Could not confirm the finance lock. Reload before retrying.") }
    })
  }
  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault()
    saveLock(value, "Finance lock date saved")
  }}>
    <label htmlFor="finance-lock-date" className="block text-sm font-medium">Lock transactions through</label>
    <Input id="finance-lock-date" type="date" value={value} disabled={pending} aria-describedby="finance-lock-help" onChange={event => setValue(event.target.value)} />
    <p id="finance-lock-help" className="text-sm text-muted-foreground">Invoice issues, receipts and corrections dated on or before this date are blocked. Leave blank to reopen every day. A future date is refused. Clearing the date, or moving it earlier, is written to the activity log as a reopen. This lock is operational. It is not a statutory close.</p>
    <Button type="submit" disabled={pending}>Save finance lock</Button>
    <div className="space-y-3 border-t pt-4">
      <h2 className="text-sm font-medium">Close a completed month</h2>
      <p className="text-sm text-muted-foreground">Sets the lock to the last day of that month after the month has ended. The database refuses the current month and a month the lock already covers. An owner or admin is recorded on the activity log. It is not a general-ledger close or a tax filing.</p>
      <label htmlFor="finance-close-month" className="block text-sm font-medium">Month</label>
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
            toast.success(`Closed through ${closedThrough}. Documents and receipts through that day are locked.`)
            router.refresh()
          } catch { toast.error("Could not confirm the finance lock. Reload before retrying.") }
        })
      }}>Close completed month</Button>
    </div>
  </form>
}
