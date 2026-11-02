"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { Bot, Check, Copy, FileText, ImageIcon, Paperclip, Plug, Send, X } from "lucide-react"
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

/** A thread entry. `thumb` is only for display; the wire attachment carries the bytes. */
type Entry = WireMessage & { id: number; notice?: boolean; thumbs?: string[] }
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

export function AssistantChat() {
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
        setMcp(ok && data?.tools ? { state: "ok", server: data.server, tools: data.tools } : { state: "error", message: data?.error ?? "ERP MCP is not reachable." })
      })
      .catch(() => live && setMcp({ state: "error", message: "ERP MCP is not reachable." }))
    return () => { live = false }
  }, [])

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: "end" }) }, [thread, busy])

  async function addFiles(files: File[]) {
    for (const file of files) {
      if (pending.length >= MAX_ATTACHMENTS) return void toast.error(`Up to ${MAX_ATTACHMENTS} attachments per message.`)
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
      const data = (await res.json().catch(() => null)) as { reply?: string; notConfigured?: boolean; message?: string; error?: string } | null
      if (data?.reply) setThread((t) => [...t, { id: ++idRef.current, role: "assistant", content: data.reply! }])
      else if (data?.notConfigured) setNotConfigured(data.message ?? "AI is not set up yet.")
      else toast.error(data?.error ?? "The assistant could not answer.")
    } catch {
      toast.error("The assistant could not answer.")
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
      toast.error("Could not copy. Select the text and copy manually.")
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
            ERP AI · แชท AI องค์กร
            <span className="bbn-chip ml-auto">รันบนเครื่องนี้ / On-device</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-3" role="log" aria-live="polite" aria-label="Conversation" data-testid="assistant-thread">
            {thread.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                พิมพ์คำถาม หรือแนบภาพหน้าจอ / ไฟล์ แล้วถามได้เลย · Ask a question, or attach a screenshot or file. Paste an image straight into the box.
              </p>
            ) : null}
            {thread.map((m) => (
              <div key={m.id} className={m.role === "user" ? "ml-auto max-w-[85%] space-y-2" : "bbn-hud-reply max-w-[90%] space-y-2 p-3"} data-role={m.role}>
                {m.attachments?.length ? <AttachmentChips atts={m.attachments} thumbs={m.thumbs} /> : null}
                {m.content ? <p className="text-sm leading-relaxed whitespace-pre-wrap">{m.content}</p> : null}
              </div>
            ))}
            {busy ? <p className="text-muted-foreground text-sm">กำลังคิด… / Thinking…</p> : null}
            {notConfigured ? (
              <p className="bbn-sticky text-sm" data-testid="assistant-not-configured">
                AI ยังไม่พร้อม / AI is not set up yet. {notConfigured}{" "}
                <Link href={LOCAL_AI} className="underline">ติดตั้งโมเดลในหน้าตั้งค่า / Install a model in Settings</Link>. Nothing is sent to a cloud model.
              </p>
            ) : null}
            <div ref={endRef} />
          </div>

          <div className="bbn-hud-composer space-y-2">
            {pending.length > 0 ? (
              <ul className="flex flex-wrap gap-2" aria-label="Attachments to send">
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
            <label htmlFor="assistant-input" className="sr-only">ข้อความ / Message</label>
            <Textarea
              id="assistant-input"
              rows={3}
              placeholder="ถามอะไรก็ได้ / Ask anything… (Enter to send, Shift+Enter for a new line)"
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
                แนบไฟล์ / Attach
              </Button>
              <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                <ImageIcon className="size-3" aria-hidden /> PNG · JPEG · WebP · PDF · txt/md/csv/json
              </span>
              <Button type="button" className="ml-auto" disabled={busy || (text.trim() === "" && pending.length === 0)} onClick={() => void send()}>
                <Send className="size-3.5" aria-hidden />
                ส่ง / Send
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
            <span className="bbn-chip ml-auto">{mcp.state === "ok" ? "เชื่อมแล้ว / Connected" : mcp.state === "loading" ? "…" : "ไม่พร้อม / Unavailable"}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {mcp.state === "ok" ? (
            <>
              <p>
                {mcp.server} · อ่านอย่างเดียว / read-only · {mcp.tools.length} tools
              </p>
              <ul className="bbn-ledger space-y-1">
                {mcp.tools.map((t) => (
                  <li key={t.name} title={t.description} className="font-mono text-xs">{t.name}</li>
                ))}
              </ul>
            </>
          ) : mcp.state === "error" ? (
            <p className="bbn-sticky">{mcp.message}</p>
          ) : null}
          <p className="text-muted-foreground text-xs">
            เครื่องมือเหล่านี้ใช้ผ่านแผง BigNose บนเดสก์ท็อป ยังไม่ถูกเรียกจากแชทนี้ · These tools are used by the BigNose desktop panel; this chat does not call them yet.
          </p>
          <details>
            <summary className="cursor-pointer text-xs font-medium">วิธีเชื่อม / How to connect</summary>
            <pre className="bg-muted mt-2 overflow-x-auto rounded-md p-2 text-xs">{MCP_CONFIG}</pre>
            <Button type="button" variant="ghost" size="xs" onClick={copyConfig}>
              {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <p className="text-muted-foreground mt-1 text-xs">Add it as a stdio connector in BigNose. See docs/desktop/erp-mcp.md.</p>
          </details>
        </CardContent>
      </Card>
    </div>
  )
}
