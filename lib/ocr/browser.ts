"use client"

import { OCR_LIMITS, readBoundedBody, sniffOcrMime, type OcrDocument, type OcrPage, type OcrProgress } from "./contracts"
import { rasterDimensions } from "./image"
import { validatePdfEnvelope } from "./pdf"

export type ProcessOcrOptions = {
  signal?: AbortSignal
  onProgress?: (progress: OcrProgress) => void
  onPage?: (page: OcrPage) => void
  /** Raster preview rendered from the original page, never OCR-generated HTML. Caller owns object URL disposal. */
  onPreview?: (page: number, image: Blob) => void
}

async function jpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  const { promise, resolve } = Promise.withResolvers<Blob | null>()
  canvas.toBlob(resolve, "image/jpeg", 0.9)
  const blob = await promise
  if (!blob || blob.size > OCR_LIMITS.pageBytes) throw new Error("Rendered page exceeds 3 MiB. Split or reduce the source image.")
  return blob
}
function pageCanvas(width: number, height: number): HTMLCanvasElement {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width * height > OCR_LIMITS.sourcePixels || Math.max(width, height) > 20000) throw new Error("Page dimensions exceed the local OCR limit.")
  const scale = Math.min(1.8, OCR_LIMITS.pageEdge / Math.max(width, height), Math.sqrt(OCR_LIMITS.pagePixels / (width * height)))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.floor(width * scale)); canvas.height = Math.max(1, Math.floor(height * scale))
  return canvas
}

/** No persistence: all bytes stay in browser memory and the authenticated ERP's loopback model service. */
export async function processOcrFile(file: File, options: ProcessOcrOptions = {}): Promise<OcrDocument> {
  if (!file.size || file.size > OCR_LIMITS.fileBytes) throw new Error("Choose an image or PDF up to 20 MiB.")
  const signal = options.signal ?? new AbortController().signal
  signal.throwIfAborted()
  options.onProgress?.({ page: 0, totalPages: 0, phase: "preparing" })
  const bytes = new Uint8Array(await file.arrayBuffer())
  signal.throwIfAborted()
  const mime = sniffOcrMime(bytes)
  if (!mime || (file.type && file.type !== mime)) throw new Error("File content and MIME must match: JPEG, PNG, WebP or PDF only.")
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), n => n.toString(16).padStart(2, "0")).join("")
  const document: OcrDocument = { source: { sha256, name: file.name.slice(0, 240), mime, bytes: file.size }, pages: [] }
  async function recognize(image: Blob, page: number, totalPages: number) {
    signal.throwIfAborted()
    options.onPreview?.(page, image)
    options.onProgress?.({ page, totalPages, phase: "recognizing" })
    const response = await fetch("/api/ocr/page", {
      method: "POST", credentials: "same-origin", cache: "no-store", signal,
      headers: { "Content-Type": "image/jpeg", "X-OCR-Source-SHA256": sha256, "X-OCR-Page": String(page), "X-OCR-Pages": String(totalPages) }, body: image,
    })
    const payload = JSON.parse(new TextDecoder().decode(await readBoundedBody(response, 200_000, signal))) as OcrPage & { error?: string }
    if (!response.ok) throw new Error(payload.error || "Local OCR could not read this page.")
    if (payload.sourceSha256 !== sha256 || payload.page !== page || payload.totalPages !== totalPages || typeof payload.text !== "string" || payload.text.length > OCR_LIMITS.textChars) throw new Error("Invalid OCR page provenance.")
    document.pages.push(payload)
    options.onPage?.(payload)
    options.onProgress?.({ page, totalPages, phase: "complete" })
  }
  if (mime !== "application/pdf") {
    const dimensions = rasterDimensions(bytes)
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    try {
      signal.throwIfAborted()
      // EXIF rotation can swap axes, but cannot change the pixel count.
      if (bitmap.width * bitmap.height !== dimensions.width * dimensions.height) throw new Error("Decoded image dimensions do not match its header.")
      const canvas = pageCanvas(bitmap.width, bitmap.height)
      try {
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Canvas is unavailable in this browser.")
        context.fillStyle = "white"; context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        await recognize(await jpeg(canvas), 1, 1)
      } finally { canvas.width = 0; canvas.height = 0 }
    } finally { bitmap.close() }
    return document
  }
  validatePdfEnvelope(bytes)
  // Browser-only PDF.js initializes DOMMatrix; static loading would execute during Next SSR.
  const pdfjs = await import("pdfjs-dist")
  signal.throwIfAborted()
  // Statically bundled by Next; never a CDN or a worker URL from the document.
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString()
  const task = pdfjs.getDocument({
    data: bytes, useWorkerFetch: false, useWasm: false,
    useSystemFonts: true, disableFontFace: true, disableAutoFetch: true, disableStream: true, disableRange: true,
    maxImageSize: OCR_LIMITS.sourcePixels, canvasMaxAreaInBytes: OCR_LIMITS.pagePixels * 4, stopAtErrors: true,
    enableXfa: false, isOffscreenCanvasSupported: false, isImageDecoderSupported: false,
  })
  let encrypted = false
  task.onPassword = () => { encrypted = true; void task.destroy() }
  const abort = () => { void task.destroy() }
  signal.addEventListener("abort", abort, { once: true })
  const deadline = setTimeout(abort, 30_000)
  try {
    const pdf = await task.promise
    signal.throwIfAborted()
    if (pdf.numPages < 1 || pdf.numPages > OCR_LIMITS.pages) throw new Error("PDF exceeds 12 pages. Split it before OCR.")
    // Preflight all pages before any inference; never partially process an over-limit document.
    for (let page = 1; page <= pdf.numPages; page++) {
      signal.throwIfAborted()
      const sourcePage = await pdf.getPage(page)
      const viewport = sourcePage.getViewport({ scale: 1 })
      const canvas = pageCanvas(viewport.width, viewport.height)
      canvas.width = 0; canvas.height = 0
      sourcePage.cleanup()
    }
    clearTimeout(deadline)
    for (let page = 1; page <= pdf.numPages; page++) {
      signal.throwIfAborted()
      options.onProgress?.({ page, totalPages: pdf.numPages, phase: "preparing" })
      const sourcePage = await pdf.getPage(page)
      const base = sourcePage.getViewport({ scale: 1 })
      const canvas = pageCanvas(base.width, base.height)
      try {
        const context = canvas.getContext("2d")
        if (!context) throw new Error("Canvas is unavailable in this browser.")
        const viewport = sourcePage.getViewport({ scale: Math.min(canvas.width / base.width, canvas.height / base.height) })
        const render = sourcePage.render({ canvas, canvasContext: context, viewport, background: "white", annotationMode: pdfjs.AnnotationMode.DISABLE })
        const cancel = () => render.cancel()
        signal.addEventListener("abort", cancel, { once: true })
        const renderDeadline = setTimeout(cancel, 30_000)
        try { await render.promise } finally { clearTimeout(renderDeadline); signal.removeEventListener("abort", cancel) }
        await recognize(await jpeg(canvas), page, pdf.numPages)
      } finally { canvas.width = 0; canvas.height = 0; sourcePage.cleanup() }
    }
    return document
  } catch (error) {
    signal.throwIfAborted()
    if (encrypted || (error instanceof Error && error.name === "PasswordException")) throw new Error("Encrypted/password-protected PDFs are not accepted. Export an unencrypted copy locally first.")
    if (error instanceof Error && (error.name === "InvalidPDFException" || error.name === "UnknownErrorException")) throw new Error("Corrupt or unsupported PDF. Export a valid PDF or scan individual pages.")
    throw error
  } finally { clearTimeout(deadline); signal.removeEventListener("abort", abort); await task.destroy() }
}
