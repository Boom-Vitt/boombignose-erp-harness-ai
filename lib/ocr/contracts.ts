export const OCR_LIMITS = {
  fileBytes: 20 * 1024 * 1024,
  pageBytes: 3 * 1024 * 1024,
  pages: 12,
  sourcePixels: 20_000_000,
  pagePixels: 4_000_000,
  pageEdge: 2400,
  textChars: 24_000,
} as const

export type OcrSource = { sha256: string; name: string; mime: string; bytes: number }
export type OcrFields = {
  vendor: string | null
  date: string | null
  documentNumber: string | null
  description: string | null
  subtotalSatang: number | null
  vatSatang: number | null
  totalSatang: number | null
}
export type OcrPage = {
  page: number
  totalPages: number
  sourceSha256: string
  rasterSha256: string
  text: string
  fields: OcrFields
  warnings: string[]
  model: string
}
export type OcrDocument = { source: OcrSource; pages: OcrPage[] }
export type OcrProgress = { page: number; totalPages: number; phase: "preparing" | "recognizing" | "complete" }
export const REVIEW_WARNING = "Unverified local AI transcription, not a confidence score. Compare every field with the original; unreadable or ambiguous values stay unknown. Extraction does not save, approve or post anything."
export function emptyOcrFields(): OcrFields {
  return { vendor: null, date: null, documentNumber: null, description: null, subtotalSatang: null, vatSatang: null, totalSatang: null }
}

/** Check magic bytes, never trust an extension or an upload's declared MIME. SVG/HTML are excluded. */
export function sniffOcrMime(bytes: Uint8Array): string | null {
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) return "image/png"
  if (bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg"
  if (bytes.length >= 12 && String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP") return "image/webp"
  if (bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-") return "application/pdf"
  return null
}

/** Bounded even when Content-Length is absent, false, or transfer-encoded. */
export async function readBoundedBody(response: Pick<Response, "body" | "headers">, max: number, signal?: AbortSignal): Promise<Uint8Array> {
  const declared = response.headers.get("content-length")
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > max)) {
    await response.body?.cancel().catch(() => {})
    throw new Error("Body exceeds the allowed byte limit.")
  }
  if (!response.body) throw new Error("Empty request or response.")
  const reader = response.body.getReader()
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal?.addEventListener("abort", abort, { once: true })
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      signal?.throwIfAborted()
      const { value, done } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > max) throw new Error("Body exceeds the allowed byte limit.")
      chunks.push(value)
    }
    signal?.throwIfAborted()
    const bytes = new Uint8Array(size)
    let at = 0
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.length }
    return bytes
  } finally {
    signal?.removeEventListener("abort", abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
