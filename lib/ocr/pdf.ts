import { OCR_LIMITS, sniffOcrMime } from "./contracts"

/** Cheap structural gate before the PDF worker parses untrusted bytes. Full parsing still uses stopAtErrors. */
export function validatePdfEnvelope(bytes: Uint8Array): void {
  if (!bytes.length || bytes.length > OCR_LIMITS.fileBytes) throw new Error("PDF exceeds 20 MiB.")
  const header = new TextDecoder("latin1").decode(bytes.subarray(0, 16))
  if (sniffOcrMime(bytes) !== "application/pdf" || !/^%PDF-(?:1\.[0-7]|2\.0)(?:\r|\n)/.test(header)) throw new Error("Corrupt or unsupported PDF header.")
  const ending = new TextDecoder("latin1").decode(bytes.subarray(Math.max(0, bytes.length - 4096)))
  const trailer = /startxref[\t\n\r ]+(\d+)[\t\n\r ]+%%EOF[\x00\t\n\f\r ]*$/.exec(ending)
  if (!trailer) throw new Error("Corrupt or truncated PDF: final cross-reference trailer is missing.")
  const offset = Number(trailer[1])
  if (!Number.isSafeInteger(offset) || offset < 8 || offset >= bytes.length) throw new Error("Corrupt PDF cross-reference offset.")
  const crossReference = new TextDecoder("latin1").decode(bytes.subarray(offset, Math.min(offset + 64, bytes.length)))
  // Classic xref tables or PDF 1.5+ cross-reference stream objects.
  if (!/^(?:xref\b|\d+[\t\n\r ]+\d+[\t\n\r ]+obj\b)/.test(crossReference)) throw new Error("Corrupt PDF cross-reference location.")
}
