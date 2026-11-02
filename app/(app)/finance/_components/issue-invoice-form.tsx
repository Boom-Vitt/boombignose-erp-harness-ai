"use client"
import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { useRecordGuard } from "@/components/record/record-guard"
import { paymentCommandKey } from "@/lib/payments/retry-command"
import { issueInvoice, issueTaxInvoice } from "../actions"

type Mode = "INV" | "TX" | "ABB"
const MODES: { value: Mode; label: string }[] = [
  { value: "INV", label: "ใบแจ้งหนี้เพื่อการดำเนินงาน / Operational invoice (INV)" },
  { value: "TX", label: "ใบกำกับภาษี / Tax invoice (TX) — needs buyer address, seller VAT registration and branch code" },
  { value: "ABB", label: "ใบกำกับภาษีอย่างย่อ / Abbreviated tax invoice (ABB) — no buyer tax ID or address printed" },
]

export function IssueInvoiceForm({ orgId, invoiceId, version }: { orgId: string; invoiceId: string; version: number }) {
  const [confirmed, setConfirmed] = useState(false)
  const [mode, setMode] = useState<Mode>("INV")
  // A guarded action: record fields freeze while it runs, so nothing typed then is lost.
  const { pending, run } = useRecordGuard()
  const request = useRef<string | null>(null)
  const router = useRouter()
  return <div className="space-y-3"><p className="text-sm text-muted-foreground">ออกใบแจ้งหนี้เพื่อการดำเนินงาน / Issuance freezes this version’s issuer, buyer, priced lines, discount and dates. It freezes document VAT and withholding calculations. TX and ABB take a gap-free number from their own series. None of this is a filing service or e-Tax Invoice, and the Revenue Department is not contacted.</p><fieldset className="space-y-1 text-sm" disabled={pending}>{MODES.map(m => <label key={m.value} className="flex items-start gap-2"><input type="radio" name="issue-mode" checked={mode === m.value} onChange={() => { request.current = null; setMode(m.value) }} />{m.label}</label>)}</fieldset><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={pending} onChange={event => setConfirmed(event.target.checked)} />I checked the business profile, buyer, lines, discount and dates.</label><Button disabled={!confirmed || pending} onClick={() => {
    if (!request.current) {
      try { request.current = paymentCommandKey(sessionStorage, `${orgId}/${invoiceId}/issue/${mode}`, [String(version)], () => crypto.randomUUID()) }
      catch { request.current = crypto.randomUUID() }
    }
    const key = request.current
    run(async () => {
      try {
        const result = mode === "INV" ? await issueInvoice({ invoiceId, expectedVersion: version, key }) : await issueTaxInvoice({ invoiceId, expectedVersion: version, key, docType: mode })
        if (result.error) { toast.error(result.error); return }
        toast.success(mode === "INV" ? "ออกเอกสารแล้ว / Operational invoice issued" : `ออกเอกสารแล้ว / Tax invoice (${mode}) issued`)
        router.refresh()
      } catch { toast.error("Could not confirm the issue response. Retry unchanged details to recover the original result.") }
    })
  }}>{mode === "INV" ? "Issue operational invoice" : `Issue tax invoice (${mode})`}</Button></div>
}
