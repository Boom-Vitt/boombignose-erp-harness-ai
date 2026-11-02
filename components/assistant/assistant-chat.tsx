"use client"

import Link from "next/link"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { Bot, Check, Copy, FileText, ImageIcon, Languages, Paperclip, Plug, Send, Wrench, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { MAX_ATTACHMENTS, MAX_IMAGE_BASE64, classifyFile, type WireAttachment, type WireMessage } from "@/lib/ai/chat-attachments"

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
    intro: "คุยกับโมเดลบนเครื่องนี้ แนบภาพหน้าจอหรือไฟล์ และให้ AI อ่านข้อมูล ERP ขององค์กรนี้ผ่านเครื่องมือ MCP แบบอ่านอย่างเดียว ไม่มีอะไรถูกส่งไปโมเดลบนคลาวด์",
    onDevice: "รันบนเครื่องนี้",
    toggle: "สลับ ENG",
    toggleHint: "Switch to English",
    empty: "พิมพ์คำถาม หรือแนบภาพหน้าจอ / ไฟล์ แล้วถามได้เลย วางภาพลงในกล่องข้อความได้โดยตรง",
    thinking: "กำลังคิด…",
    toolUsed: "ใช้เครื่องมือ ERP",
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
    mcpNote: "แชทนี้เรียกเครื่องมือเหล่านี้ได้เอง เฉพาะข้อมูลขององค์กรที่คุณล็อกอินอยู่ และอ่านอย่างเดียว (ต้องเปิด Supabase บนเครื่อง และเลือกโมเดลข้อความ ภาพหน้าจอใช้โมเดลภาพซึ่งยังไม่เรียกเครื่องมือ)",
    howTo: "วิธีเชื่อมกับ BigNose",
    copy: "คัดลอก",
    copied: "คัดลอกแล้ว",
    howToNote: "เพิ่มเป็นตัวเชื่อมแบบ stdio ใน BigNose ดู docs/desktop/erp-mcp.md",
    formats: "PNG · JPEG · WebP · PDF · txt/md/csv/json",
  },
  en: {
    title: "ERP AI · Organization chat",
    intro: "Chat with the on-device model, attach screenshots and files, and let it read this organization's ERP data through read-only MCP tools. Nothing is sent to a cloud model.",
    onDevice: "On-device",
    toggle: "สลับ ไทย",
    toggleHint: "เปลี่ยนเป็นภาษาไทย",
    empty: "Ask a question, or attach a screenshot or file. Paste an image straight into the box.",
    thinking: "Thinking…",
    toolUsed: "Used ERP tool",
    toolFailed: "failed",
    rows: "rows",
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
    mcpNote: "This chat can call these tools itself: read-only, and only for the organization you are signed in to (needs local Supabase and the text model; screenshots use the vision model, which does not call tools).",
    howTo: "How to connect to BigNose",
    copy: "Copy",
    copied: "Copied",
    howToNote: "{t.howToNote}",
    formats: "PNG · JPEG · WebP · PDF · txt/md/csv/json",
  },
} as const

/** A thread entry. `thumb` is only for display; the wire attachment carries the bytes. */
type Entry = WireMessage & { id: number; notice?: boolean; thumbs?: string[]; toolCalls?: Array<{ name: string; ok: boolean; total?: number }> }
type Pending = { att: WireAttachment; thumb?: string }
type Mcp = { state: "loading" } | { state: "error"; message: string } | { state: "ok"; server: string; tools: Array<{ name: string; description: string }> }

/** Screenshots are shrunk to a JPEG in the browser so the loopback model accepts them. They never leave this computer. */
async function shrinkToJpeg(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file)
  for (const edge of [1568, 1024, 640]) {
    const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const b64 = canvas.toDataURL("image/jpeg", 0.85).split(",")[1]
    if (b64.length <= MAX_IMAGE_BASE64) return b64
  }
  throw new Error("too large")
}

async function toPending(file: File): Promise<Pending | string> {
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer())
  const c = classifyFile(file, head)
  if (!c.ok) return `${file.name}: ${c.reason}`
  if (c.kind === "image") {
    try {
      const base64 = await shrinkToJpeg(file)
      return { att: { kind: "image", name: file.name, mediaType: "image/jpeg", base64 }, thumb: `data:image/jpeg;base64,${base64}` }
    } catch {
      return `${file.name}: could not be shrunk to a size the local model accepts.`
    }
  }
  if (c.kind === "pdf") return { att: { kind: "pdf", name: file.name, size: file.size } }
  return { att: { kind: "text", name: file.name, text: await file.text() } }
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
            {a.kind === "pdf" ? " · PDF" : ""}
          </span>
        ),
      )}
    </div>
  )
}

/** `profileLocale` is profiles.locale (default "th"); a choice made with the switch wins and is remembered in this browser. */
export function AssistantChat({ profileLocale = "th" }: { profileLocale?: string }) {
  const saved = useSyncExternalStore(onLangChange, () => localStorage.getItem(LANG_KEY), () => null)
  const lang: Lang = saved === "th" || saved === "en" ? saved : profileLocale === "en" ? "en" : "th"
  const t = COPY[lang]
  function switchLang() {
    localStorage.setItem(LANG_KEY, lang === "th" ? "en" : "th")
    window.dispatchEvent(new Event(LANG_KEY))
  }

  const [thread, setThread] = useState<Entry[]>([])
  const [text, setText] = useState("")
  const [pending, setPending] = useState<Pending[]>([])
  const [busy, setBusy] = useState(false)
  const [notConfigured, setNotConfigured] = useState<string | null>(null)
  const [mcp, setMcp] = useState<Mcp>({ state: "loading" })
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const idRef = useRef(0)
  const endRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "end" }) }, [thread, busy])

  async function addFiles(files: File[]) {
    for (const file of files) {
      if (pending.length >= MAX_ATTACHMENTS) return void toast.error(t.maxFiles(MAX_ATTACHMENTS))
      const out = await toPending(file)
      if (typeof out === "string") toast.error(out)
      else setPending((p) => (p.length < MAX_ATTACHMENTS ? [...p, out] : p))
    }
  }

  async function send() {
    const content = text.trim()
    if (busy || (!content && pending.length === 0)) return
    const entry: Entry = { id: ++idRef.current, role: "user", content, attachments: pending.map((p) => p.att), thumbs: pending.flatMap((p) => (p.thumb ? [p.thumb] : [])) }
    const next = [...thread.filter((m) => !m.notice), entry]
    setThread([...thread, entry]); setText(""); setPending([]); setBusy(true); setNotConfigured(null)
    try {
      const res = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.slice(-20).map(({ role, content: c, attachments }) => ({ role, content: c, ...(attachments?.length ? { attachments } : {}) })) }),
      })
      const data = (await res.json().catch(() => null)) as { reply?: string; toolCalls?: Entry["toolCalls"]; notConfigured?: boolean; message?: string; error?: string } | null
      if (data?.reply) setThread((t) => [...t, { id: ++idRef.current, role: "assistant", content: data.reply!, toolCalls: data.toolCalls }])
      else if (data?.notConfigured) setNotConfigured(data.message ?? "-")
      else toast.error(t.cannotAnswer)
    } catch {
      toast.error(t.cannotAnswer)
    } finally {
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
                {m.content ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p> : null}
              </div>
            ))}
            {busy ? <p className="text-muted-foreground text-sm">{t.thinking}</p> : null}
            {notConfigured ? (
              <p className="bbn-sticky text-sm" data-testid="assistant-not-configured">
                {t.notReady} {lang === "en" && notConfigured !== "-" ? notConfigured : ""}{" "}
                <Link href={LOCAL_AI} className="underline">{t.install}</Link>. {t.noCloud}
              </p>
            ) : null}
            <div ref={endRef} />
          </div>

          <div className="bbn-hud-composer space-y-2">
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
              placeholder={t.placeholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send() }
              }}
              onPaste={(e) => {
                const files = Array.from(e.clipboardData.files)
                if (files.length) { e.preventDefault(); void addFiles(files) }
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
              <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}>
                <Paperclip className="size-3.5" aria-hidden />
                {t.attach}
              </Button>
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <ImageIcon className="size-3" aria-hidden /> {t.formats}
              </span>
              <Button type="button" className="ml-auto" disabled={busy || (text.trim() === "" && pending.length === 0)} onClick={() => void send()}>
                <Send className="size-3.5" aria-hidden />
                {t.send}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bbn-deck-panel border-0" data-testid="assistant-mcp">
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
            <p className="text-muted-foreground mt-1 text-xs">Add it as a stdio connector in BigNose. See docs/desktop/erp-mcp.md.</p>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}
