"use client"

import { useRef, useState, useTransition, type FormEvent } from "react"
import { Constants } from "@/lib/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { addExpenseLine } from "../actions"
import { reviewedReceiptDraft } from "@/lib/expenses/receipt-scan"
import { OcrWorkbench } from "@/components/ocr/ocr-workbench"

const SELECT = "h-9 w-full rounded-md border bg-background px-3 text-sm"


export function ExpenseLineForm({ claimId, today, projects }: { claimId: string; today: string; projects: { id: string; name: string }[] }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const formRef = useRef<HTMLFormElement>(null)
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    start(async () => {
      const result = await addExpenseLine({ ...values, claim_id: claimId })
      setError(result.error ?? "")
      if (!result.error) {
        form.reset()
        setNotice("")
      }
    })
  }
  return <div className="space-y-4">
    <details className="rounded-xl border p-4"><summary className="cursor-pointer font-medium">Scan receipt / อ่านใบเสร็จ (review only)</summary>
      <div className="mt-4"><OcrWorkbench onUseReviewedFields={fields => {
        const draft = reviewedReceiptDraft(fields)
        if (!draft) { setError("Review a readable vendor, date and positive total before prefilling an expense line."); return false }
        const elements = formRef.current?.elements
        if (!elements) return false
        ;(elements.namedItem("spent_on") as HTMLInputElement).value = draft.spent_on
        ;(elements.namedItem("amountBaht") as HTMLInputElement).value = draft.amountBaht
        ;(elements.namedItem("description") as HTMLInputElement).value = draft.description
        setError("")
        setNotice(`Reviewed receipt suggestions${draft.vatBaht ? ` (printed VAT ${draft.vatBaht})` : ""} copied below. Press Add line separately. Claim approval remains separate.`)
      }} /></div>
    </details>
    <form ref={formRef} onSubmit={submit} className="space-y-4 rounded-xl border p-4">
      <h2 className="font-semibold">Add expense line</h2>
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
      <div className="grid gap-3 sm:grid-cols-6">
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="spent_on">Date</Label><Input id="spent_on" name="spent_on" type="date" required defaultValue={today} /></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="category">Category</Label><select id="category" name="category" defaultValue="other" className={SELECT}>{Constants.public.Enums.cost_category.map(c => <option key={c} value={c}>{c[0].toUpperCase() + c.slice(1)}</option>)}</select></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="amountBaht">Amount (THB)</Label><Input id="amountBaht" name="amountBaht" inputMode="decimal" required placeholder="0.00" /></div>
        <div className="space-y-2 sm:col-span-4"><Label htmlFor="description">Description</Label><Input id="description" name="description" maxLength={1000} required /></div>
        <div className="space-y-2 sm:col-span-2"><Label htmlFor="project_id">Project to re-bill (optional)</Label><select id="project_id" name="project_id" defaultValue="" className={SELECT}><option value="">No project</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending}>{pending ? "Adding…" : "Add line"}</Button>
    </form>
  </div>
}
