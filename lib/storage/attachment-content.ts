import { AttachmentInput, MAX_ATTACHMENT_SIZE } from "@/lib/record-history/input"

/** The filename is display metadata only; it never participates in a filesystem path. */
export async function attachmentBytes(file: File): Promise<Buffer> {
  const metadata = AttachmentInput.safeParse({ name: file.name, size: file.size, type: file.type })
  if (!metadata.success || /[\u202a-\u202e\u2066-\u2069]/.test(file.name)) throw new Error("Invalid attachment.")
  const bytes = Buffer.from(await file.arrayBuffer())
  if (bytes.length !== file.size || !validAttachmentContent(bytes, file.type)) throw new Error("Attachment content does not match its type.")
  return bytes
}

export function validAttachmentContent(bytes: Uint8Array, type: string): boolean {
  if (!bytes.length || bytes.length > MAX_ATTACHMENT_SIZE) return false
  const starts = (...prefix: number[]) => prefix.every((byte, index) => bytes[index] === byte)
  switch (type) {
    case "application/pdf": return starts(0x25, 0x50, 0x44, 0x46, 0x2d)
    case "image/jpeg": return starts(0xff, 0xd8, 0xff)
    case "image/png": return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
    case "image/webp": return bytes.length >= 12 && starts(0x52, 0x49, 0x46, 0x46) && String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
    case "text/plain":
    case "text/csv":
      try {
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes)
        if (text.startsWith("%PDF-") || (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP")) return false
        return !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(text)
      } catch { return false }
    default: return false
  }
}
