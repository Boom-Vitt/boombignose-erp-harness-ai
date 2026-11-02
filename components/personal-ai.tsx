"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { Bot, Check, Clock, Copy, Cpu, ListChecks, NotebookPen, Receipt, Wand2 } from "lucide-react"
import { toast } from "sonner"

import { intakeMeeting, type IntakeResult } from "@/app/(app)/intake/actions"
import { useMode } from "@/components/mode-switch"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { ActionItem } from "@/lib/ai/parse"

const LOCAL_AI = "/settings#local-models"

type Result = { kind: "idle" } | { kind: "notConfigured" } | { kind: "done"; content: string; items: ActionItem[] }

/** Individual mode only: the personal assistant on the dashboard. Quick jump links plus a note box that runs on the local model. */
export function PersonalAssistant() {
  const mode = useMode()
  const [notes, setNotes] = useState("")
  const [result, setResult] = useState<Result>({ kind: "idle" })
  const [pending, startTransition] = useTransition()
  const [copied, setCopied] = useState(false)
  if (mode !== "individual") return null

  function run() {
    setCopied(false)
    startTransition(async () => {
      const res: IntakeResult = await intakeMeeting(notes)
      if ("error" in res) return void toast.error(res.error)
      if ("notConfigured" in res) return setResult({ kind: "notConfigured" })
      setResult({ kind: "done", content: res.content, items: res.items })
    })
  }

  async function copy() {
    if (result.kind !== "done") return
    try {
      await navigator.clipboard.writeText(result.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Could not copy. Select the text and copy manually.")
    }
  }

  return (
    <Card className="bbn-deck-panel bbn-hud-chat border-0" data-testid="personal-assistant">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          <span className="bbn-rough-sm border-primary/60 bg-primary/10 text-primary flex size-7 items-center justify-center border">
            <Bot className="size-3.5" aria-hidden />
          </span>
          ผู้ช่วยส่วนตัว / Personal assistant
          <span className="bbn-chip ml-auto">รันบนเครื่องนี้ / On-device</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="bbn-hud-tools flex flex-wrap gap-2">
          <Button variant="outline" render={<Link href="/intake" prefetch={false} />}>
            <NotebookPen className="size-3.5" aria-hidden />
            สรุปบันทึก / Summarize notes
          </Button>
          <Button variant="outline" render={<Link href="/timesheets" prefetch={false} />}>
            <Clock className="size-3.5" aria-hidden />
            จดเวลา / Log time
          </Button>
          <Button variant="outline" render={<Link href="/expenses" prefetch={false} />}>
            <Receipt className="size-3.5" aria-hidden />
            ค่าใช้จ่าย / Expenses
          </Button>
          <Button variant="outline" render={<Link href={LOCAL_AI} prefetch={false} />}>
            <Cpu className="size-3.5" aria-hidden />
            โมเดล AI / Local AI
          </Button>
        </div>

        <div className="bbn-hud-composer space-y-2">
          <label htmlFor="personal-note" className="text-sm font-medium">
            จดอะไรสักอย่าง แล้วให้ AI สรุป / Jot something, let AI sum it up
          </label>
          <Textarea
            id="personal-note"
            rows={4}
            placeholder="วางบันทึกหรือรายการที่ต้องทำ / Paste a note or a to-do list…"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
          <Button type="button" disabled={pending || notes.trim() === ""} onClick={run}>
            <Wand2 className="size-3.5" aria-hidden />
            {pending ? "กำลังสรุป… / Summarizing…" : "สรุป / Summarize"}
          </Button>
        </div>

        {result.kind === "notConfigured" ? (
          <p className="bbn-sticky text-sm">
            AI ยังไม่พร้อม / AI is not set up yet. <Link href={LOCAL_AI} className="underline">ติดตั้งโมเดลในหน้าตั้งค่า / Install a model in Settings</Link>. Nothing is sent to a cloud model.
          </p>
        ) : null}

        {result.kind === "done" ? (
          <div className="bbn-hud-reply space-y-3 p-4" role="log" aria-live="polite">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-medium">สรุป / Summary</span>
              <Button type="button" variant="ghost" size="xs" onClick={copy} aria-label="Copy to clipboard">
                {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{result.content}</p>
            {result.items.length > 0 ? (
              <ul className="bbn-ledger text-sm">
                {result.items.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 py-1.5">
                    <ListChecks className="text-primary mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {item.title}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

/** Individual mode only: pinned at the top of Settings, jumps straight to the Local AI section. */
export function PersonalAiCallout({ installed, total, daemonUp }: { installed: number; total: number; daemonUp: boolean }) {
  const mode = useMode()
  if (mode !== "individual") return null
  return (
    <aside className="bbn-sticky items-center gap-3 text-sm" data-testid="personal-ai-callout">
      <Cpu className="text-gold size-4 shrink-0 self-center" aria-hidden />
      <span>
        <strong>AI ส่วนตัวบนเครื่อง / Personal AI</strong>{" "}
        {daemonUp ? `${installed}/${total} โมเดลติดตั้งแล้ว / models installed` : "บริการ AI ยังไม่เริ่ม / AI service not running"}
      </span>
      <Button size="sm" className="ml-auto" render={<a href="#local-models" />}>
        จัดการโมเดล / Manage models
      </Button>
    </aside>
  )
}
