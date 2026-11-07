"use client"

import { useEffect, useRef, useState, type ChangeEvent } from "react"
import Image from "next/image"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { processOcrFile } from "@/lib/ocr/browser"
import { REVIEW_WARNING, type OcrFields, type OcrPage, type OcrProgress } from "@/lib/ocr/contracts"
import { reviewOcrFields } from "@/lib/ocr/fields"
import { serviceAmountBaht } from "@/lib/workflows/service"

function PageReview({ page, preview, onUseReviewedFields }: { page: OcrPage; preview?: string; onUseReviewedFields?: (fields: OcrFields, page: OcrPage) => boolean | void }) {
  const [values, setValues] = useState({
    vendor: page.fields.vendor ?? "", date: page.fields.date ?? "", documentNumber: page.fields.documentNumber ?? "", description: page.fields.description ?? "",
    total: page.fields.totalSatang === null ? "" : serviceAmountBaht(page.fields.totalSatang),
    vat: page.fields.vatSatang === null ? "" : serviceAmountBaht(page.fields.vatSatang),
    subtotal: page.fields.subtotalSatang === null ? "" : serviceAmountBaht(page.fields.subtotalSatang),
  })
  const [reviewed, setReviewed] = useState(false)
  const [error, setError] = useState("")
  const [used, setUsed] = useState(false)
  function update(key: keyof typeof values, value: string) {
    setValues(current => ({ ...current, [key]: value })); setReviewed(false); setUsed(false); setError("")
  }
  function apply() {
    const result = reviewOcrFields(values, reviewed)
    if (result.error !== undefined) { setError(result.error); return }
    const applied = onUseReviewedFields?.(result.fields, page)
    if (applied === false) { setError("Required form fields are still unknown. Review and complete them before using these suggestions."); return }
    setUsed(true)
  }
  return <article className="space-y-4 rounded-xl border p-4" aria-label={`OCR page ${page.page}`}>
    <h3 className="font-semibold">Page {page.page} / {page.totalPages} · {page.model}</h3>
    <p className="break-all text-xs text-muted-foreground">Source SHA-256: {page.sourceSha256}<br />Rendered page SHA-256: {page.rasterSha256}</p>
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-2"><h4 className="font-medium">Original page preview / ต้นฉบับ</h4>{preview ? <a href={preview} target="_blank" rel="noreferrer" className="block"><Image src={preview} alt={`Original document page ${page.page}`} width={2400} height={2400} unoptimized className="h-auto max-h-[36rem] w-auto max-w-full rounded border object-contain" /></a> : <p>Preview unavailable.</p>}</div>
      <div className="min-w-0 space-y-2"><h4 className="font-medium">Verbatim OCR / ข้อความที่อ่านได้</h4><pre className="max-h-[36rem] overflow-auto whitespace-pre-wrap break-words rounded border bg-muted/20 p-3 font-sans text-sm">{page.text}</pre></div>
    </div>
    <ul className="list-inside list-disc text-sm text-muted-foreground">{page.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>
    <h4 className="font-medium">Editable suggestions / ตรวจสอบและแก้ไขข้อมูล</h4>
    <p className="text-sm text-muted-foreground">Blank = unknown. Suggestions belong to this page only; totals across pages are never added automatically. No confidence is invented.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-sm">Vendor / ผู้ขาย<Input value={values.vendor} maxLength={200} onChange={event => update("vendor", event.target.value)} /></label>
      <label className="space-y-1 text-sm">Document date / วันที่<Input type="date" value={values.date} onChange={event => update("date", event.target.value)} /></label>
      <label className="space-y-1 text-sm">Document number / เลขเอกสาร<Input value={values.documentNumber} maxLength={200} onChange={event => update("documentNumber", event.target.value)} /></label>
      <label className="space-y-1 text-sm">Description / รายการ<Input value={values.description} maxLength={1000} onChange={event => update("description", event.target.value)} /></label>
      {(["subtotal", "vat", "total"] as const).map(key => <label key={key} className="space-y-1 text-sm">{key === "vat" ? "VAT" : key === "total" ? "Total" : "Subtotal"} (THB)<Input inputMode="decimal" value={values[key]} onChange={event => update(key, event.target.value)} placeholder="Unknown / ไม่ทราบ" /></label>)}
    </div>
    {onUseReviewedFields && <><label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={event => { setReviewed(event.target.checked); setUsed(false) }} />I compared all suggested fields with the original. This only prefills the form; I must separately add/approve the financial record.</label><Button type="button" disabled={!reviewed} onClick={apply}>Use reviewed suggestions in form</Button>{used && <p role="status" className="text-sm">Reviewed suggestions copied into the form. Saving and approval are separate form actions.</p>}</>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </article>
}

export function OcrWorkbench({ onUseReviewedFields }: { onUseReviewedFields?: (fields: OcrFields, page: OcrPage) => boolean | void }) {
  const [pages, setPages] = useState<OcrPage[]>([])
  const [previews, setPreviews] = useState<Record<number, string>>({})
  const [progress, setProgress] = useState<OcrProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState("")
  const [sourceName, setSourceName] = useState("")
  const controller = useRef<AbortController | null>(null)
  const urls = useRef<string[]>([])
  useEffect(() => () => { controller.current?.abort(); urls.current.forEach(url => URL.revokeObjectURL(url)) }, [])
  async function scan(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget, file = input.files?.[0]
    if (!file) return
    controller.current?.abort()
    const current = new AbortController(); controller.current = current
    urls.current.forEach(url => URL.revokeObjectURL(url)); urls.current = []
    setPreviews({}); setPages([]); setError(""); setSourceName(file.name); setRunning(true)
    try {
      await processOcrFile(file, {
        signal: current.signal, onProgress: setProgress,
        onPage: page => setPages(previous => [...previous, page]),
        onPreview: (page, image) => { const url = URL.createObjectURL(image); urls.current.push(url); setPreviews(previous => ({ ...previous, [page]: url })) },
      })
    } catch (cause) {
      setError(current.signal.aborted ? "Cancelled. Completed pages remain review-only; incomplete pages were not extracted." : cause instanceof Error ? cause.message : "Local OCR could not read this file.")
    } finally { setRunning(false); input.value = "" }
  }
  return <section className="space-y-4" aria-label="Local Thai and English document OCR">
    <p className="text-sm text-muted-foreground">อ่านเอกสารไทย/อังกฤษบนเครื่อง · Local Thai/English OCR. JPEG, PNG, WebP or unencrypted PDF · 20 MiB/file · 12 pages · 20 MP/source image · 4 MP/rendered page. Documents are processed in memory by the ERP server’s local model; on private mobile access, bytes travel to that server. No cloud fallback, automatic model download, attachment saving or financial posting.</p>
    <p className="rounded-lg border p-3 text-sm">{REVIEW_WARNING}</p>
    <label className="block space-y-2 text-sm">Choose original document / เลือกเอกสาร<Input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" disabled={running} onChange={scan} /></label>
    {running && <Button type="button" variant="outline" onClick={() => controller.current?.abort()}>Cancel OCR / ยกเลิก</Button>}
    {progress && <p role="status" className="text-sm">{sourceName} · {running ? progress.phase : error ? "Stopped" : "Complete"}{progress.totalPages > 0 ? ` · page ${progress.page}/${progress.totalPages}` : " · inspecting file"}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error} {error.includes("Settings") && <a className="underline" href="/settings#local-models">Open local model settings</a>}</p>}
    {Object.entries(previews).filter(([number]) => !pages.some(page => page.page === Number(number))).map(([number, preview]) => <figure key={number} className="space-y-2 rounded-xl border p-4">
      <figcaption className="text-sm">Original page {number} / ต้นฉบับ · {running ? "Local OCR in progress" : "No completed transcription for this page"}</figcaption>
      <Image src={preview} alt={`Original document page ${number}`} width={2400} height={2400} unoptimized className="h-auto max-h-[36rem] w-auto max-w-full rounded border object-contain" />
    </figure>)}
    {pages.map(page => <PageReview key={`${page.sourceSha256}-${page.page}`} page={page} preview={previews[page.page]} onUseReviewedFields={onUseReviewedFields} />)}
  </section>
}
