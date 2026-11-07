"use client"

import Link from "next/link"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Bot, Check, Copy, FileText, ImageIcon, Languages, Paperclip, Plug, Send, Wrench, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MAX_ATTACHMENTS, MAX_IMAGE_BASE64, MAX_MESSAGE_CHARS, classifyFile, type ChatDataScope, type WireAttachment, type WireMessage } from "@/lib/ai/chat-attachments"
import { MAX_TEXT_BYTES } from "@/lib/ai/chat-attachments"
import type { AssistantAnswer, AssistantSource } from "@/lib/ai/assistant-evidence"
import { AssistantAnswerView } from "./answer"
import { processOcrFile } from "@/lib/ocr/browser"
import { rasterDimensions } from "@/lib/ocr/image"

const LOCAL_AI = "/settings#local-models"
const MCP_CONFIG = `{
  "transport": "stdio",
  "command": "<absolute node path>",
  "args": ["<repo>/lib/mcp/erp-server.mjs"],
  "enabled": true
}`

type Lang = "th" | "en"
const LANG_KEY = "bbn-ui-lang"
const onLangChange = (cb: () => void) => {
  window.addEventListener(LANG_KEY, cb)
  return () => window.removeEventListener(LANG_KEY, cb)
}

/** Thai is the default; English is one switch away. Both languages for every string on this screen live here. */
const COPY = {
  th: {
    title: "ERP AI · แชท AI องค์กร",
    intro: "โมเดลบนเครื่องนี้ อ่านข้อมูล ERP แบบอ่านอย่างเดียว",
    onDevice: "รันบนเครื่องนี้",
    toggle: "สลับ ENG",
    toggleHint: "Switch to English",
    empty: "พิมพ์คำถาม หรือแนบภาพ / ไฟล์",
    thinking: "กำลังคิด…",
    toolUsed: "อ่านแหล่งข้อมูล",
    toolFailed: "ล้มเหลว",
    rows: "รายการ",
    notReady: "AI ยังไม่พร้อม",
    install: "ติดตั้งโมเดลในหน้าตั้งค่า",
    noCloud: "ไม่มีอะไรถูกส่งไปโมเดลบนคลาวด์",
    message: "ข้อความ",
    placeholder: "ถามอะไรก็ได้… (Enter เพื่อส่ง, Shift+Enter เพื่อขึ้นบรรทัดใหม่)",
    attachments: "ไฟล์แนบที่จะส่ง",
    attach: "แนบไฟล์",
    send: "ส่ง",
    maxFiles: (n: number) => `แนบได้สูงสุด ${n} ไฟล์ต่อข้อความ`,
    cannotAnswer: "AI ตอบไม่ได้ในขณะนี้",
    copyFail: "คัดลอกไม่สำเร็จ เลือกข้อความแล้วคัดลอกเอง",
    connected: "เชื่อมแล้ว",
    unavailable: "ไม่พร้อม",
    mcpDown: "เชื่อม ERP MCP ไม่ได้",
    readOnly: "อ่านอย่างเดียว",
    tools: "เครื่องมือ",
    mcpNote: "แชทเรียกเครื่องมือเหล่านี้ได้เอง เฉพาะองค์กรของคุณ อ่านอย่างเดียว",
    howTo: "เชื่อม MCP ภายนอก (ไม่จำเป็นสำหรับแชทนี้)",
    copy: "คัดลอก",
    copied: "คัดลอกแล้ว",
    howToNote: "แชท ERP ใช้เครื่องมือในโปรเซสเดิมอยู่แล้ว ไม่ต้องเปิด BigNose หรือ ERP/model server เพิ่ม ตัวเชื่อม stdio นี้เป็นทางเลือกภายนอก · docs/desktop/erp-mcp.md",
    formats: "PNG · JPEG · WebP · PDF · txt/md/csv/json",
  },
  en: {
    title: "ERP AI · Organization chat",
    intro: "On-device model with read-only access to ERP data.",
    onDevice: "On-device",
    toggle: "สลับ ไทย",
    toggleHint: "เปลี่ยนเป็นภาษาไทย",
    empty: "Ask a question, or attach an image or file.",
    thinking: "Thinking…",
    toolUsed: "Read source",
    toolFailed: "failed",
    rows: "items",
    notReady: "AI is not set up yet.",
    install: "Install a model in Settings",
    noCloud: "Nothing is sent to a cloud model.",
    message: "Message",
    placeholder: "Ask anything… (Enter to send, Shift+Enter for a new line)",
    attachments: "Attachments to send",
    attach: "Attach",
    send: "Send",
    maxFiles: (n: number) => `Up to ${n} attachments per message.`,
    cannotAnswer: "The assistant could not answer.",
    copyFail: "Could not copy. Select the text and copy manually.",
    connected: "Connected",
    unavailable: "Unavailable",
    mcpDown: "ERP MCP is not reachable.",
    readOnly: "read-only",
    tools: "tools",
    mcpNote: "The chat calls these tools itself. Read-only, your organization only.",
    howTo: "Optional external MCP connector",
    copy: "Copy",
    copied: "Copied",
    howToNote: "ERP chat already uses in-process tools; no extra BigNose, ERP or model server is needed. This stdio connector is an optional external integration · docs/desktop/erp-mcp.md",
    formats: "PNG · JPEG · WebP · PDF · txt/md/csv/json",
  },
} as const

/** A thread entry. `thumb` is only for display; the wire attachment carries the bytes. */
type Entry = WireMessage & { id: number; notice?: boolean; thumbs?: string[]; toolCalls?: Array<{ name: string; ok: boolean; total?: number }>; answer?: AssistantAnswer; sources?: AssistantSource[] }
type Pending = { att: WireAttachment; thumb?: string; warnings?: string[] }
type Mcp = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; server: string; tools: Array<{ name: string; description: string }> }

/** Previews are local; selected bytes go only to the authenticated ERP and its local model. */
async function shrinkToJpeg(file: File): Promise<string> {
  rasterDimensions(new Uint8Array(await file.arrayBuffer()))
  const bitmap = await createImageBitmap(file)
  try {
    for (const edge of [1568, 1024, 640]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      const context = canvas.getContext("2d")
      if (!context) throw new Error("Canvas is unavailable.")
      context.fillStyle = "white"
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const b64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1]
      canvas.width = 0; canvas.height = 0
      if (b64.length <= MAX_IMAGE_BASE64) return b64
    }
    throw new Error("The image is too large.")
  } finally { bitmap.close() }
}

async function toPending(file: File, signal: AbortSignal, progress: (text: string) => void): Promise<Pending | string> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const classified = classifyFile(file, head)
  if (!classified.ok) return `${file.name}: ${classified.reason}`
  try {
    if (classified.kind === "image") {
      const base64 = await shrinkToJpeg(file)
      signal.throwIfAborted()
      return { att: { kind: "image", name: file.name, mediaType: "image/jpeg", base64 }, thumb: `data:image/jpeg;base64,${base64}` }
    }
    if (classified.kind === "pdf") {
      const document = await processOcrFile(file, { signal, onProgress: (status) => progress(`${file.name} · OCR ${status.page}/${status.totalPages || "?"}`) })
      const text = document.pages.map((page) => `[Page ${page.page}/${page.totalPages} · source SHA256 ${page.sourceSha256} · ${page.model}]\n${page.text}\n[Review warnings: ${page.warnings.join("; ")}]`).join("\n\n")
      if (new TextEncoder().encode(text).byteLength > MAX_TEXT_BYTES) return `${file.name}: OCR text exceeds the chat limit. Review the full document in Documents → OCR instead.`
      return { att: { kind: "text", name: file.name, text }, warnings: ["PDF pages were OCR-read locally; compare with the original. The full accepted text is available through local source search and paged reads, not treated as an ERP balance."] }
    }
    return { att: { kind: "text", name: file.name, text: await file.text() } }
  } catch (error) {
    signal.throwIfAborted()
    return `${file.name}: ${error instanceof Error ? error.message : "The file could not be read."}`
  }
}

function AttachmentChips({ atts, thumbs }: { atts: WireAttachment[]; thumbs?: string[] }) {
  let t = 0
  return (
    <div className="flex flex-wrap gap-2">
      {atts.map((a, i) =>
        a.kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element -- local data URL, nothing to optimise
          <img key={i} src={thumbs?.[t++] ?? `data:${a.mediaType};base64,${a.base64}`} alt={a.name} className="h-24 max-w-48 rounded-md border object-cover" />
        ) : (
          <span key={i} className="bbn-chip inline-flex items-center gap-1">
            <FileText className="size-3" aria-hidden />
            {a.name}
            {a.kind === "text" && /\.pdf$/i.test(a.name) ? " · OCR" : ""}
          </span>
        ),
      )}
      {atts.filter((attachment) => attachment.kind === "text").map((attachment, index) => attachment.kind === "text" ? <details key={`text-${index}`} className="w-full text-xs"><summary className="cursor-pointer">{attachment.name} · text / ข้อความ</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{attachment.text}</pre></details> : null)}
    </div>
  )
}

/** `profileLocale` is profiles.locale (default "th"); a choice made with the switch wins and is remembered in this browser. */
export function AssistantChat({ profileLocale = "th", workspaceName }: { profileLocale?: string; workspaceName: string }) {
  const saved = useSyncExternalStore(onLangChange, () => localStorage.getItem(LANG_KEY), () => null)
  const lang: Lang = saved === "th" || saved === "en" ? saved : profileLocale === "en" ? "en" : "th"
  const t = COPY[lang]
  function switchLang() {
    localStorage.setItem(LANG_KEY, lang === "th" ? "en" : "th")
    window.dispatchEvent(new Event(LANG_KEY))
  }

  const [thread, setThread] = useState<Entry[]>([])
  const [dataScope, setDataScope] = useState<ChatDataScope>("erp")
  const [text, setText] = useState("")
  const [pending, setPending] = useState<Pending[]>([])
  const [longText, setLongText] = useState("")
  const [busy, setBusy] = useState(false)
  const [notConfigured, setNotConfigured] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)
  const [mcp, setMcp] = useState<Mcp>({ state: "loading" })
  const [copied, setCopied] = useState(false)
  const [preparing, setPreparing] = useState<string | null>(null)
  const conversationAbort = useRef<AbortController | null>(null)
  const attachmentAbort = useRef<AbortController | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const idRef = useRef(0)
  const endRef = useRef<HTMLDivElement>(null)

  function resetThread() {
    setThread([]); setText(""); setLongText(""); setPending([]); setNotConfigured(null); setFailure(null)
  }

  useEffect(() => {
    let live = true
    fetch("/api/assistant/mcp")
      .then(async (r) => ({ ok: r.ok, data: await r.json().catch(() => null) }))
      .then(({ ok, data }) => {
        if (!live) return
        setMcp(ok && data?.tools ? { state: "ok", server: data.server, tools: data.tools } : { state: "error", message: "" })
      })
      .catch(() => live && setMcp({ state: "error", message: "" }))
    return () => { live = false }
  }, [])
  useEffect(() => () => { conversationAbort.current?.abort(); attachmentAbort.current?.abort() }, [])

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "end" }) }, [thread, busy])

  async function addFiles(files: File[]) {
    if (busy || preparing) return
    const controller = new AbortController()
    attachmentAbort.current = controller
    setPreparing(lang === "th" ? "กำลังอ่านไฟล์…" : "Reading file…")
    let count = pending.length
    try {
      for (const file of files) {
        if (count >= MAX_ATTACHMENTS) { toast.error(t.maxFiles(MAX_ATTACHMENTS)); break }
        const out = await toPending(file, controller.signal, setPreparing)
        if (typeof out === "string") toast.error(out)
        else { count++; setPending((current) => [...current, out]) }
      }
    } catch (error) {
      if (!controller.signal.aborted) toast.error(error instanceof Error ? error.message : t.cannotAnswer)
    } finally { setPreparing(null); attachmentAbort.current = null }
  }

  function attachPastedText(value: string): boolean {
    if (busy || preparing || !value.trim()) return false
    if (pending.length >= MAX_ATTACHMENTS) { toast.error(t.maxFiles(MAX_ATTACHMENTS)); return false }
    if (new TextEncoder().encode(value).byteLength > MAX_TEXT_BYTES || value.includes("\u0000")) {
      toast.error(lang === "th" ? "ข้อความแนบต้องเป็น UTF-8 ไม่เกิน 200 KB และไม่มี NUL ข้อความเดิมยังอยู่" : "Use UTF-8 text up to 200 KB without NUL. The original text has not been cleared.")
      return false
    }
    setPending((current) => [...current, { att: { kind: "text", name: `pasted-text-${++idRef.current}.txt`, text: value } }])
    toast.success(lang === "th" ? "แนบข้อความครบแล้ว ไม่ตัดช่วงท้าย พิมพ์คำถามแยกในช่องข้อความ" : "Full text attached without dropping its tail. Enter your question separately.")
    return true
  }

  async function send() {
    const content = text.trim()
    if (busy || preparing || (!content && pending.length === 0)) return
    if (content.length > MAX_MESSAGE_CHARS) {
      toast.error(lang === "th" ? "ใช้ «แนบข้อความยาว» สำหรับเนื้อหา แล้วพิมพ์คำถามแยก" : "Attach long content with Add long text, then enter a separate question.")
      return
    }
    const entry: Entry = { id: ++idRef.current, role: "user", content, attachments: pending.map((p) => p.att), thumbs: pending.flatMap((p) => (p.thumb ? [p.thumb] : [])) }
    const next = [...thread.filter((m) => !m.notice), entry]
    setThread([...thread, entry]); setText(""); setPending([]); setBusy(true); setNotConfigured(null); setFailure(null)
    const controller = new AbortController()
    conversationAbort.current = controller
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataScope, messages: next.map(({ role, content: c, attachments }) => ({ role, content: c, ...(attachments?.length ? { attachments } : {}) })) }),
        signal: controller.signal,
      })
      const data = (await res.json().catch(() => null)) as { reply?: string; answer?: AssistantAnswer; sources?: AssistantSource[]; toolCalls?: Entry["toolCalls"]; notConfigured?: boolean; message?: string; error?: string } | null
      if (res.ok && data?.reply && data.answer) setThread((current) => [...current, { id: ++idRef.current, role: "assistant", content: data.reply!, answer: data.answer, sources: data.sources ?? [], toolCalls: data.toolCalls }])
      else if (data?.notConfigured) setNotConfigured(data.message ?? "-")
      else setFailure(data?.error ?? t.cannotAnswer)
    } catch {
      if (!controller.signal.aborted) setFailure(t.cannotAnswer)
    } finally {
      conversationAbort.current = null
      setBusy(false)
    }
  }

  async function copyConfig() {
    try {
      await navigator.clipboard.writeText(MCP_CONFIG)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error(t.copyFail)
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]" data-testid="assistant-chat">
      <Card className="bbn-deck-panel bbn-hud-chat border-0">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span className="bbn-rough-sm border-primary/60 bg-primary/10 text-primary flex size-7 items-center justify-center border">
              <Bot className="size-3.5" aria-hidden />
            </span>
            {t.title}
            <span className="bbn-chip ml-auto">{t.onDevice}</span>
            <Button type="button" variant="outline" size="xs" onClick={switchLang} title={t.toggleHint} data-testid="assistant-lang">
              <Languages className="size-3" aria-hidden />
              {t.toggle}
            </Button>
          </CardTitle>
          <p className="text-muted-foreground text-sm">{t.intro}</p>
          <p className="text-muted-foreground text-xs">{lang === "th" ? "Workspace ปัจจุบัน" : "Current workspace"}: <strong>{workspaceName}</strong> · {lang === "th" ? "เปลี่ยน workspace แล้วเริ่มบทสนทนาใหม่" : "Switching workspace starts a new thread"}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3" role="log" aria-live="polite" aria-label="Conversation" data-testid="assistant-thread">
            {thread.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                {t.empty}
              </p>
            ) : null}
            {thread.map((m) => (
              <div key={m.id} className={m.role === "user" ? "ml-auto max-w-[85%] space-y-2" : "bbn-hud-reply max-w-[90%] space-y-2 p-3"} data-role={m.role}>
                {m.attachments?.length ? <AttachmentChips atts={m.attachments} thumbs={m.thumbs} /> : null}
                {m.toolCalls?.length ? (
                  <ul className="flex flex-wrap gap-1" aria-label={t.toolUsed} data-testid="assistant-tool-calls">
                    {m.toolCalls.map((c, i) => (
                      <li key={i} className="bbn-chip inline-flex items-center gap-1 font-mono text-xs">
                        <Wrench className="size-3" aria-hidden />
                        {c.name}
                        {!c.ok ? ` · ${t.toolFailed}` : c.total !== undefined ? ` · ${c.total} ${t.rows}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {m.answer ? <AssistantAnswerView answer={m.answer} sources={m.sources ?? []} messageId={m.id} lang={lang} /> : m.content ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p> : null}
              </div>
            ))}
            {busy ? <p className="text-muted-foreground text-sm" role="status">{t.thinking} <button type="button" className="underline" onClick={() => conversationAbort.current?.abort()}>{lang === "th" ? "หยุด" : "Stop"}</button></p> : null}
            {failure ? <p className="bbn-sticky text-sm" role="alert">{failure}</p> : null}
            {notConfigured ? (
              <p className="bbn-sticky text-sm" data-testid="assistant-not-configured">
                {t.notReady} {lang === "en" && notConfigured !== "-" ? notConfigured : ""}{" "}
                <Link href={LOCAL_AI} className="underline">{t.install}</Link>. {t.noCloud}
              </p>
            ) : null}
            <div ref={endRef} />
          </div>

          <div className="bbn-hud-composer space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <label htmlFor="assistant-data-scope">{lang === "th" ? "การอ่านข้อมูล" : "Source access"}</label>
              <select id="assistant-data-scope" className="bbn-chip max-w-full" value={dataScope} disabled={busy || !!preparing} onChange={(event) => { resetThread(); setDataScope(event.target.value as ChatDataScope) }}>
                <option value="erp">{lang === "th" ? "ERP · อ่านข้อมูลใหม่ตามสิทธิ์" : "ERP records · fresh authorized reads"}</option>
                <option value="guidance">{lang === "th" ? "คำแนะนำ/เอกสาร · ไม่อ่าน ERP" : "Guidance / documents · no ERP reads"}</option>
              </select>
              <span className="text-muted-foreground">{lang === "th" ? "เปลี่ยนขอบเขตจะเริ่มบทสนทนาใหม่ ใช้คำแนะนำ/เอกสารเมื่ออ่านไฟล์โดยไม่เทียบ ERP" : "Changing access starts a new thread. Choose guidance/documents for file-only interpretation."}</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {dataScope === "erp" && (lang === "th" ? ["สรุปยอดค้างรับพร้อมหลักฐาน", "แสดงดีลที่ต้องติดตามพร้อมวันที่", "สรุปสถานะโปรเจกต์และงานถัดไป"] : ["Summarize receivables with evidence", "List deals needing follow-up with dates", "Summarize project status and next actions"]).map((question) => <button key={question} type="button" className="bbn-chip text-left text-xs" disabled={busy || !!preparing} onClick={() => setText(question)}>{question}</button>)}
              <button type="button" className="bbn-chip text-xs" disabled={busy || !!preparing} onClick={resetThread}>{lang === "th" ? "บทสนทนาใหม่" : "New thread"}</button>
            </div>
            {preparing ? <p className="text-sm" role="status">{preparing} <button type="button" className="underline" onClick={() => attachmentAbort.current?.abort()}>{lang === "th" ? "ยกเลิกอ่านไฟล์" : "Cancel file reading"}</button></p> : null}
            {pending.flatMap((item) => item.warnings ?? []).map((warning, index) => <p key={index} className="text-muted-foreground text-xs">{warning}</p>)}
            {pending.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label={t.attachments}>
                {pending.map((p, i) => (
                  <li key={i} className="bbn-chip inline-flex items-center gap-1">
                    {p.thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element -- local data URL
                      <img src={p.thumb} alt={p.att.name} className="size-8 rounded object-cover" />
                    ) : (
                      <FileText className="size-3" aria-hidden />
                    )}
                    {p.att.name}
                    <button type="button" aria-label={`Remove ${p.att.name}`} onClick={() => setPending((all) => all.filter((_, j) => j !== i))}>
                      <X className="size-3" aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <label htmlFor="assistant-input" className="sr-only">{t.message}</label>
            <Textarea
              id="assistant-input"
              rows={3}
              placeholder={dataScope === "erp" ? (lang === "th" ? "ถามข้อมูล ERP ปัจจุบันหรือข้อความแนบ… (Enter เพื่อส่ง)" : "Ask about current ERP records or attached text… (Enter to send)") : t.placeholder}
              value={text}
              maxLength={MAX_MESSAGE_CHARS}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files)
                if (files.length) { e.preventDefault(); void addFiles(files); return }
                const pasted = e.clipboardData.getData("text/plain")
                const input = e.currentTarget
                if (input.value.length - (input.selectionEnd - input.selectionStart) + pasted.length > MAX_MESSAGE_CHARS) {
                  e.preventDefault()
                  attachPastedText(pasted)
                }
              }}
            />
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                hidden
                accept="image/png,image/jpeg,image/webp,application/pdf,.txt,.md,.csv,.tsv,.json,.log"
                onChange={(e) => { void addFiles(Array.from(e.target.files ?? [])); e.target.value = "" }}
                data-testid="assistant-file"
              />
              <Button type="button" variant="outline" disabled={busy || !!preparing} onClick={() => fileRef.current?.click()}>
                <Paperclip className="size-3.5" aria-hidden />
                {t.attach}
              </Button>
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <ImageIcon className="size-3" aria-hidden /> {t.formats}
              </span>
              <Button type="button" className="ml-auto" disabled={busy || !!preparing || (text.trim() === "" && pending.length === 0)} onClick={() => void send()}>
                <Send className="size-3.5" aria-hidden />
                {t.send}
              </Button>
            </div>
            <details className="text-xs">
              <summary className="cursor-pointer">{lang === "th" ? "แนบข้อความยาว / แชท WhatsApp" : "Add long text / WhatsApp export"}</summary>
              <div className="mt-2 space-y-2">
                <label htmlFor="assistant-long-text">{lang === "th" ? "เนื้อหาฉบับเต็ม · UTF-8 สูงสุด 200 KB แล้วพิมพ์คำถามแยกด้านบน" : "Full source text · up to 200 KB UTF-8; enter the question separately above"}</label>
                <Textarea id="assistant-long-text" rows={6} value={longText} disabled={busy || !!preparing} onChange={(event) => setLongText(event.target.value)} />
                <Button type="button" variant="outline" size="sm" disabled={busy || !!preparing || !longText.trim()} onClick={() => { if (attachPastedText(longText)) setLongText("") }}>{lang === "th" ? "แนบฉบับเต็ม" : "Attach full text"}</Button>
              </div>
            </details>
          </div>
        </CardContent>
      </Card>

      <Card id="assistant-mcp" className="bbn-deck-panel border-0" data-testid="assistant-mcp">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Plug className="size-4" aria-hidden />
            MCP
            <span className="bbn-chip ml-auto">{mcp.state === "ok" ? t.connected : mcp.state === "loading" ? "…" : t.unavailable}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {mcp.state === "ok" ? (
            <>
              <p>
                {mcp.server} · {t.readOnly} · {mcp.tools.length} {t.tools}
              </p>
              <ul className="bbn-ledger space-y-1">
                {mcp.tools.map((t) => (
                  <li key={t.name} title={t.description} className="font-mono text-xs">{t.name}</li>
                ))}
              </ul>
            </>
          ) : mcp.state === "error" ? (
            <p className="bbn-sticky">{t.mcpDown}</p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            {t.mcpNote}
          </p>
          <details>
            <summary className="cursor-pointer text-xs font-medium">{t.howTo}</summary>
            <pre className="bg-muted mt-2 overflow-x-auto rounded-md p-2 text-xs">{MCP_CONFIG}</pre>
            <Button type="button" variant="ghost" size="xs" onClick={copyConfig}>
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? t.copied : t.copy}
            </Button>
            <p className="text-muted-foreground mt-1 text-xs">{t.howToNote}</p>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}
