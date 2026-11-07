"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { todayISO } from "@/lib/dates"
import { formatTHB } from "@/lib/money"
import { serviceAmountSatang, serviceAmountBaht } from "@/lib/workflows/service"
import { billDueDate, defaultBillLines, matchBill } from "@/lib/purchasing/bill-matching"
import type { PurchaseLine } from "@/lib/purchasing/quantities"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { OcrWorkbench } from "@/components/ocr/ocr-workbench"
import { createPurchaseBill } from "../actions"

export function BillForm({ orderId, lines, terms, toleranceBps }: { orderId: string; lines: (PurchaseLine & { description: string })[]; terms: number; toleranceBps: number }) {
  const initial = defaultBillLines(lines)
  const [entered, setEntered] = useState(initial.map(line => ({ ...line, quantityText: String(line.quantity), priceText: serviceAmountBaht(line.unit_cost_satang) })))
  const [date, setDate] = useState(todayISO())
  const [due, setDue] = useState(billDueDate(todayISO(), terms))
  const [rate, setRate] = useState("0")
  const [vat, setVat] = useState("")
  const [total, setTotal] = useState("")
  const [reference, setReference] = useState("")
  const [ocrNotice, setOcrNotice] = useState("")
  const [pending, start] = useTransition()
  const router = useRouter()
  let preview: ReturnType<typeof matchBill> | undefined
  let inputLines = initial
  let previewError = ""
  try {
    if (rate.trim() === "") throw new Error("Enter the input VAT rate")
    inputLines = entered.map(line => ({ id: line.id, quantity: Number(line.quantityText), expected_quantity: line.expected_quantity, unit_cost_satang: serviceAmountSatang(line.priceText) }))
    preview = matchBill(lines, inputLines, { vatRate: Number(rate), toleranceBps, ...(vat ? { vat: serviceAmountSatang(vat) } : {}), ...(total ? { total: serviceAmountSatang(total) } : {}) })
  } catch (error) { previewError = error instanceof Error ? error.message : "Invalid bill" }
  return <section id="match-bill" aria-label="Match vendor invoice" className="space-y-3 rounded-xl border p-4">
    <h2 className="font-semibold">Match vendor invoice</h2>
    <p className="text-sm text-muted-foreground">Defaults use unbilled received quantities at PO cost. Quantity and unit price differences over {toleranceBps / 100}% require a reason. Enter the amounts on the vendor invoice in THB.</p>
    <details className="rounded-lg border p-3"><summary className="cursor-pointer font-medium">Read vendor bill / อ่านใบแจ้งหนี้ (review only)</summary>
      <div className="mt-3"><OcrWorkbench onUseReviewedFields={fields => {
        if (fields.documentNumber) setReference(fields.documentNumber)
        if (fields.date) { setDate(fields.date); setDue(billDueDate(fields.date, terms)) }
        if (fields.vatSatang !== null) setVat(serviceAmountBaht(fields.vatSatang))
        if (fields.totalSatang !== null) setTotal(serviceAmountBaht(fields.totalSatang))
        setOcrNotice("Reviewed reference/date/printed VAT/total copied where known. PO identity, quantities, unit costs and VAT rate are unchanged. Review matching and press Create bill separately.")
      }} /></div>
    </details>
    {ocrNotice && <p role="status" className="text-sm text-muted-foreground">{ocrNotice}</p>}
    <form className="space-y-4" onSubmit={event => {
      event.preventDefault()
      if (!preview) { toast.error(previewError); return }
      const data = new FormData(event.currentTarget)
      const bill = { vendor_reference: String(data.get("reference")), bill_date: date, due_date: due, input_vat_rate: Number(rate), input_vat_satang: preview.vat, vendor_total_satang: preview.total, variance_reason: String(data.get("reason") ?? ""), lines: inputLines }
      start(async () => {
        try {
          const result = await createPurchaseBill(orderId, bill)
          if (result.error) { toast.error(result.error); return }
          toast.success("Vendor invoice matched")
          router.refresh()
        } catch { toast.error("Could not confirm the bill. Reload before retrying.") }
      })
    }}>
      <fieldset disabled={pending} className="space-y-4">
        <label className="block space-y-1">Vendor invoice reference<Input name="reference" required maxLength={200} value={reference} onChange={event => setReference(event.target.value)} /></label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">Bill date<Input type="date" required value={date} onChange={event => { setDate(event.target.value); if (event.target.value) setDue(billDueDate(event.target.value, terms)) }} /></label>
          <label className="space-y-1">Bill due date<Input type="date" required min={date} value={due} onChange={event => setDue(event.target.value)} /></label>
        </div>
        {entered.map((line, index) => <div key={line.id} className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1">Invoice quantity for {lines.find(item => item.id === line.id)?.description}<Input type="number" min="0.001" step="0.001" required value={line.quantityText} onChange={event => setEntered(rows => rows.map((row, i) => i === index ? { ...row, quantityText: event.target.value } : row))} /></label>
          <label className="space-y-1">Invoice unit cost for {lines.find(item => item.id === line.id)?.description}<Input type="number" min="0" step="0.01" required value={line.priceText} onChange={event => setEntered(rows => rows.map((row, i) => i === index ? { ...row, priceText: event.target.value } : row))} /></label>
        </div>)}
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1">Input VAT rate (%)<Input type="number" min="0" max="100" step="0.01" required value={rate} onChange={event => setRate(event.target.value)} /></label>
          <label className="space-y-1">Input VAT (THB)<Input type="number" min="0" step="0.01" placeholder={preview ? serviceAmountBaht(preview.vat) : ""} value={vat} onChange={event => setVat(event.target.value)} /></label>
          <label className="space-y-1">Vendor total (THB)<Input type="number" min="0" step="0.01" placeholder={preview ? serviceAmountBaht(preview.total) : ""} value={total} onChange={event => setTotal(event.target.value)} /></label>
        </div>
        {preview ? <p role="status">Matched base {formatTHB(preview.subtotal)} · Input VAT {formatTHB(preview.vat)} · Vendor total {formatTHB(preview.total)}</p> : <p role="alert">{previewError}</p>}
        {!!preview?.variances.length && <div role="alert" className="text-sm text-destructive"><p>Variance reason required</p><ul>{preview.variances.map(item => <li key={item}>{item.replace(/: .*/, ": above tolerance")}</li>)}</ul></div>}
        <label className="block space-y-1">Variance reason<Input name="reason" maxLength={2000} required={!!preview?.variances.length} /></label>
        <Button type="submit" disabled={pending || !preview}>Create bill</Button>
      </fieldset>
    </form>
  </section>
}
