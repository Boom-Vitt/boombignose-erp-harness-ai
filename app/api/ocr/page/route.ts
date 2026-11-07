import { getVerifiedApiContext } from "@/lib/auth"
import { OCR_LIMITS, readBoundedBody } from "@/lib/ocr/contracts"
import { OcrError, recognizePage, validateRaster } from "@/lib/ocr/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// One in-flight inference per ERP process: prevents parallel uploads exhausting the local GPU.
let busy = false
export async function POST(request: Request) {
  const access = await getVerifiedApiContext(request, { mutation: true })
  if (access.response) return access.response
  if (busy) return Response.json({ error: "Another local OCR page is running. Wait for it to finish, then retry.", code: "busy" }, { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": "5" } })
  busy = true
  try {
    const pageText = request.headers.get("x-ocr-page") ?? ""
    const totalText = request.headers.get("x-ocr-pages") ?? ""
    const sourceSha256 = request.headers.get("x-ocr-source-sha256") ?? ""
    const page = Number(pageText), totalPages = Number(totalText)
    if (!/^[1-9]\d*$/.test(pageText) || !/^[1-9]\d*$/.test(totalText) || totalPages > OCR_LIMITS.pages || page > totalPages || !/^[a-f0-9]{64}$/.test(sourceSha256)) throw new OcrError("Invalid source SHA-256 or page reference.")
    let bytes: Uint8Array
    const uploadSignal = AbortSignal.any([request.signal, AbortSignal.timeout(15_000)])
    try { bytes = await readBoundedBody(request, OCR_LIMITS.pageBytes, uploadSignal) }
    catch {
      request.signal.throwIfAborted()
      if (uploadSignal.aborted) throw new OcrError("Page upload timed out. Retry over a stable private connection.", 408, "upload_timeout")
      throw new OcrError("Page upload is empty or exceeds 3 MiB.", 413)
    }
    await validateRaster(bytes, request.headers.get("content-type") ?? "", request.signal)
    const result = await recognizePage(bytes, { page, totalPages, sourceSha256 }, request.signal)
    return Response.json(result, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (request.signal.aborted) return Response.json({ error: "OCR cancelled.", code: "cancelled" }, { status: 499, headers: { "Cache-Control": "no-store" } })
    if (error instanceof OcrError) return Response.json({ error: error.message, code: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } })
    if (error instanceof Error && error.name === "TimeoutError") return Response.json({ error: "Local OCR timed out. Try a smaller page or check model memory in Settings.", code: "timeout" }, { status: 504, headers: { "Cache-Control": "no-store" } })
    return Response.json({ error: "Local OCR could not finish this page. Retry or enter the document manually.", code: "ocr_failed" }, { status: 500, headers: { "Cache-Control": "no-store" } })
  } finally { busy = false }
}
