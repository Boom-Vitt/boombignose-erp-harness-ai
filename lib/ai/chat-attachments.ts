/** Pure rules for the ERP AI chat: what a thread may carry and how a request is validated. No I/O, no server-only imports. */
import { imageMediaType } from "@/lib/ai/model-catalog"

export type AttachmentKind = "image" | "pdf" | "text"

export const MAX_ATTACHMENTS = 4
export const MAX_MESSAGES = 40
export const MAX_MESSAGE_CHARS = 8000
export const MAX_IMAGE_BASE64 = 2_800_000
export const MAX_TEXT_BYTES = 200_000
export const MAX_PDF_BYTES = 10_000_000
/** Raw image picked by the user. Larger screenshots are shrunk in the browser before they are sent. */
export const MAX_IMAGE_PICK_BYTES = 25_000_000

const TEXT_EXT = new Set(["txt", "md", "csv", "tsv", "json", "log"])

export type Classified = { ok: true; kind: AttachmentKind; mediaType: string } | { ok: false; reason: string }

function ext(name: string): string {
  const i = name.lastIndexOf(".")
  return i < 0 ? "" : name.slice(i + 1).toLowerCase()
}

/** Strip any path and control characters; the name is only a label. */
export function safeName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ""
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 120) || "file"
}

/**
 * Decide what a picked file is from its leading bytes and name, never from the declared MIME type.
 * Accepts PNG/JPEG/WebP screenshots, PDF, and plain text. Everything else (svg, html, exe, zip, ...) is refused.
 */
export function classifyFile(file: { name: string; size: number }, head: Uint8Array): Classified {
  if (file.size <= 0) return { ok: false, reason: "The file is empty." }
  const b64 = btoa(String.fromCharCode(...head.slice(0, 12)))
  const image = imageMediaType(b64)
  if (image) {
    return file.size <= MAX_IMAGE_PICK_BYTES ? { ok: true, kind: "image", mediaType: image } : { ok: false, reason: "The image is larger than 25 MB." }
  }
  if (String.fromCharCode(...head.slice(0, 5)) === "%PDF-") {
    return file.size <= MAX_PDF_BYTES ? { ok: true, kind: "pdf", mediaType: "application/pdf" } : { ok: false, reason: "The PDF is larger than 10 MB." }
  }
  if (TEXT_EXT.has(ext(file.name))) {
    if (head.includes(0)) return { ok: false, reason: "That file is not plain text." }
    return file.size <= MAX_TEXT_BYTES ? { ok: true, kind: "text", mediaType: "text/plain" } : { ok: false, reason: "The text file is larger than 200 KB." }
  }
  return { ok: false, reason: "Use a PNG, JPEG or WebP image, a PDF, or a .txt/.md/.csv/.json/.log file." }
}

export type WireAttachment =
  | { kind: "image"; name: string; mediaType: "image/png" | "image/jpeg" | "image/webp"; base64: string }
  | { kind: "text"; name: string; text: string }
  | { kind: "pdf"; name: string; size: number }

export type WireMessage = { role: "user" | "assistant"; content: string; attachments?: WireAttachment[] }

function parseAttachment(raw: unknown): WireAttachment | null {
  if (!raw || typeof raw !== "object") return null
  const a = raw as Record<string, unknown>
  if (typeof a.name !== "string") return null
  const name = safeName(a.name)
  if (a.kind === "image" && typeof a.base64 === "string") {
    const base64 = a.base64.replace(/\s/g, "")
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length < 16 || base64.length > MAX_IMAGE_BASE64) return null
    const mediaType = imageMediaType(base64)
    return mediaType ? { kind: "image", name, mediaType, base64 } : null
  }
  if (a.kind === "text" && typeof a.text === "string") {
    if (a.text.length > MAX_TEXT_BYTES || a.text.includes("\u0000")) return null
    return { kind: "text", name, text: a.text }
  }
  if (a.kind === "pdf" && typeof a.size === "number" && a.size > 0 && a.size <= MAX_PDF_BYTES) return { kind: "pdf", name, size: a.size }
  return null
}

/** Validate an untrusted chat request body. The last message must come from the user. */
export function parseChatRequest(body: unknown): { messages: WireMessage[] } | { error: string } {
  const list = body && typeof body === "object" ? (body as { messages?: unknown }).messages : null
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_MESSAGES) return { error: "Send between 1 and 40 messages." }
  const messages: WireMessage[] = []
  for (const raw of list) {
    if (!raw || typeof raw !== "object") return { error: "Bad message." }
    const m = raw as Record<string, unknown>
    if ((m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || m.content.length > MAX_MESSAGE_CHARS) {
      return { error: "Bad message." }
    }
    const rawAtt = m.attachments === undefined ? [] : m.attachments
    if (!Array.isArray(rawAtt) || rawAtt.length > MAX_ATTACHMENTS || (rawAtt.length > 0 && m.role !== "user")) {
      return { error: "Too many attachments, or attachments on a reply." }
    }
    const attachments: WireAttachment[] = []
    for (const r of rawAtt) {
      const att = parseAttachment(r)
      if (!att) return { error: "An attachment is not an accepted image, PDF or text file." }
      attachments.push(att)
    }
    if (m.content.trim() === "" && attachments.length === 0) return { error: "A message needs text or an attachment." }
    messages.push({ role: m.role, content: m.content, ...(attachments.length ? { attachments } : {}) })
  }
  if (messages[messages.length - 1].role !== "user") return { error: "The last message must be from you." }
  return { messages }
}

const TEXT_IN_PROMPT = 12_000

/**
 * Turn a thread into Ollama messages. Only the newest user turn carries pixels; older images become
 * a label so the request stays small. Attached text is fenced as data, never as instructions.
 */
export function toOllamaMessages(messages: WireMessage[], system: string): { messages: Array<Record<string, unknown>>; hasImages: boolean } {
  const last = messages.length - 1
  let hasImages = false
  const out: Array<Record<string, unknown>> = [{ role: "system", content: system }]
  messages.forEach((m, i) => {
    let content = m.content
    const images: string[] = []
    for (const a of m.attachments ?? []) {
      if (a.kind === "image") {
        if (i === last) { images.push(a.base64); hasImages = true } else content += `\n[image attached earlier: ${a.name}]`
      } else if (a.kind === "text") {
        content += `\n\n<attached_file name="${a.name.replace(/"/g, "'")}">\n${a.text.slice(0, TEXT_IN_PROMPT)}\n</attached_file>`
      } else {
        content += `\n[PDF attached: ${a.name}. Its pages are not read in this version; ask the user to paste the text.]`
      }
    }
    out.push(images.length ? { role: m.role, content, images } : { role: m.role, content })
  })
  return { messages: out, hasImages }
}
