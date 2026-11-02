"use client"

import { useRef, useState, useTransition, type ChangeEvent, type FormEvent } from "react"
import { Constants } from "@/lib/types/database"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { addExpenseLine } from "../actions"
import type { ReceiptDraft } from "@/lib/expenses/receipt-scan"

const SELECT = "h-9 w-full rounded-md border bg-background px-3 text-sm"

/** Shrinks a phone photo to a JPEG the vision route accepts (< 2M base64 chars). The image never leaves this computer. */
async function receiptJpegBase64(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1]
}

export function ExpenseLineForm({ claimId, today, projects }: { claimId: string; today: string; projects: { id: string; name: string }[] }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  const [scanning, setScanning] = useState(false)
  const [notice, setNotice] = useState("")
  const formRef = useRef<HTMLFormElement>(null)
  async function scan(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (!file) return
    setScanning(true); setError(""); setNotice("")
    try {
      const response = await fetch("/api/local-models/vision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mediaType: "image/jpeg", imageBase64: await receiptJpegBase64(file), purpose: "receipt" }),
      })
      const data = (await response.json().catch(() => null)) as { error?: string; draft?: ReceiptDraft | null } | null
      if (!response.ok) setError(`${data?.error || "The receipt could not be read."} Enter the line by hand.`)
      else if (!data?.draft) setError("The model could not read a vendor, date and total. Enter the line by hand.")
      else {
        const f = formRef.current!.elements
        ;(f.namedItem("spent_on") as HTMLInputElement).value = data.draft.spent_on
        ;(f.namedItem("amountBaht") as HTMLInputElement).value = data.draft.amountBaht
        ;(f.namedItem("description") as HTMLInputElement).value = data.draft.description
        setNotice(`Suggested by the on-device model${data.draft.vatBaht ? ` (VAT ${data.draft.vatBaht})` : ""}. Check every field, then press Add line. Nothing is saved yet.`)
      }
    } catch {
      setError("The receipt could not be read. Enter the line by hand.")
    } finally {
      setScanning(false); input.value = ""
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const values = Object.fromEntries(new FormData(form))
    start(async () => {
      const result = await addExpenseLine({ ...values, claim_id: claimId })
      setError(result.error ?? "")
      if (!result.error) form.reset()
    })
  }
  return <form ref={formRef} onSubmit={submit} className="space-y-4 rounded-xl border p-4">
    <h2 className="font-semibold">Add expense line</h2>
    <div className="space-y-2"><Label htmlFor="receipt">Scan receipt (optional, read on this computer)</Label><Input id="receipt" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" disabled={scanning} onChange={scan} />
      {scanning && <p role="status" className="text-sm text-muted-foreground">Reading receipt…</p>}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}</div>
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
}
