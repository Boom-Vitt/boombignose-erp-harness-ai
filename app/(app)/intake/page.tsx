"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { NotebookPen, ListChecks, Copy, Check } from "lucide-react"
import { toast } from "sonner"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState } from "@/components/empty-state"
import { intakeMeeting, type IntakeResult } from "./actions"
import type { ActionItem } from "@/lib/ai/parse"

type State =
  | { status: "idle" }
  | { status: "notConfigured" }
  | { status: "done"; content: string; items: ActionItem[] }

export default function IntakePage() {
  const [notes, setNotes] = useState("")
  const [state, setState] = useState<State>({ status: "idle" })
  const [pending, startTransition] = useTransition()
  const [copied, setCopied] = useState(false)

  function submit() {
    setCopied(false)
    startTransition(async () => {
      const res: IntakeResult = await intakeMeeting(notes)
      if ("error" in res) {
        toast.error(res.error)
        return
      }
      if ("notConfigured" in res) {
        setState({ status: "notConfigured" })
        return
      }
      setState({ status: "done", content: res.content, items: res.items })
    })
  }

  async function copySummary() {
    if (state.status !== "done") return
    try {
      await navigator.clipboard.writeText(state.content)
      setCopied(true)
      toast.success("Copied to clipboard")
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Could not copy — select the text and copy manually.")
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Meeting intake"
        description="Paste raw meeting notes and get a clean summary plus action items."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <NotebookPen className="size-4 text-primary" aria-hidden />
              Notes
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="intake-notes">Meeting notes</Label>
              <Textarea
                id="intake-notes"
                rows={12}
                placeholder="Paste what happened in the meeting — decisions, next steps, who owns what…"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
            <Button
              type="button"
              onClick={submit}
              disabled={pending || notes.trim() === ""}
            >
              {pending ? "Summarizing…" : "Summarize & extract"}
            </Button>

            {state.status === "notConfigured" ? (
              <p className="text-muted-foreground rounded-lg border p-3 text-sm">
                AI is not configured. <Link href="/settings#local-models" className="underline">Install the text model in Settings</Link>. The BoomBigNose window starts the local service. You do not need a separate AI app, and nothing is sent to a cloud model.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ListChecks className="size-4 text-primary" aria-hidden />
              Summary & action items
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {state.status !== "done" ? (
              <EmptyState
                icon={ListChecks}
                title="Nothing yet"
                description="Your summary and action items will appear here."
                className="border-0 p-6"
              />
            ) : (
              <>
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                      Summary
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={copySummary}
                      aria-label="Copy summary"
                    >
                      {copied ? (
                        <Check className="size-3" />
                      ) : (
                        <Copy className="size-3" />
                      )}
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">
                    {state.content}
                  </p>
                </div>

                <div className="space-y-2">
                  <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
                    Action items
                  </span>
                  {state.items.length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      No action items were found.
                    </p>
                  ) : (
                    <ul className="divide-y rounded-lg border">
                      {state.items.map((item, i) => (
                        <li key={i} className="p-3 text-sm">
                          {item.title}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
