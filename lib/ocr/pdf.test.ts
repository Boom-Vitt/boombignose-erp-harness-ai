import { describe, expect, it } from "vitest"
import { OCR_LIMITS } from "./contracts"
import { validatePdfEnvelope } from "./pdf"

// Real byte offsets, not a fake parser result; the browser subsequently performs full PDF.js parsing.
const encoder = new TextEncoder()
let body = "%PDF-1.7\n"
const offsets: number[] = []
for (const [index, object] of [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << >> >>",
].entries()) {
  offsets.push(encoder.encode(body).length)
  body += `${index + 1} 0 obj\n${object}\nendobj\n`
}
const pdf = `${body}xref\n0 4\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${encoder.encode(body).length}\n%%EOF\n`

describe("PDF envelope before worker allocation", () => {
  it("accepts a byte-addressable classic xref envelope without repairing the source", () => {
    expect(() => validatePdfEnvelope(encoder.encode(pdf))).not.toThrow()
  })
  it("rejects plausible corrupt, truncated, bad-version and out-of-bounds cross-reference uploads", () => {
    for (const source of ["%PDF-1.7\nnot a PDF", pdf.replace("%%EOF", ""), pdf.replace("%PDF-1.7", "%PDF-9.9"), pdf.replace(`startxref\n${encoder.encode(body).length}`, "startxref\n99999999"), pdf.replace(`startxref\n${encoder.encode(body).length}`, "startxref\n10")]) expect(() => validatePdfEnvelope(encoder.encode(source))).toThrow(/PDF/)
  })
  it("rejects an oversized PDF before passing it to the parser", () => {
    expect(() => validatePdfEnvelope(new Uint8Array(OCR_LIMITS.fileBytes + 1))).toThrow(/20 MiB/)
  })
})
