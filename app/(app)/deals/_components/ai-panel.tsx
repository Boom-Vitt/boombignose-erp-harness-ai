"use client"

import Link from "next/link"
import { useState, useTransition } from "react"
import { Sparkles, MessageSquareText, Copy, Check } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { summarizeDeal, draftFollowup, type AIResult } from "../ai-actions"

type Panel = {
  content: string | null
  notConfigured: boolean
}

const EMPTY: Panel = { content: null, notConfigured: false }

export function AiPanel({ dealId }: { dealId: string }) {
  const [panel, setPanel] = useState<Panel>(EMPTY)
  const [pending, startTransition] = useTransition()
  const [action, setAction] = useState<"summary" | "followup" | null>(null)
  const [copied, setCopied] = useState(false)

  function run(kind: "summary" | "followup") {
    setAction(kind)
    setCopied(false)
    startTransition(async () => {
      const res: AIResult =
        kind === "summary"
          ? await summarizeDeal(dealId)
          : await draftFollowup(dealId)

      if ("error" in res) {
        toast.error(res.error)
        return
      }
      if ("notConfigured" in res) {
        setPanel({ content: null, notConfigured: true })
        return
      }
      setPanel({ content: res.content, notConfigured: false })
    })
  }

  async function copy() {
    if (!panel.content) return
    try {
      await navigator.clipboard.writeText(panel.content)
      setCopied(true)
      toast.success("Copied to clipboard")
      setTimeout(() => setCopied(false), 1500)
    } catch {
      toast.error("Could not copy — select the text and copy manually.")
    }
  }

  return (
    <Card className="bbn-deck-panel ring-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-primary" aria-hidden />
          AI assist
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="default"
            disabled={pending}
            onClick={() => run("summary")}
          >
            <Sparkles className="size-3.5" />
            {pending && action === "summary" ? "Summarizing…" : "Summarize deal"}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="default"
            disabled={pending}
            onClick={() => run("followup")}
          >
            <MessageSquareText className="size-3.5" />
            {pending && action === "followup" ? "Drafting…" : "Draft follow-up"}
          </Button>
        </div>

        {panel.notConfigured ? (
          <p className="text-muted-foreground rounded-xl border border-dashed p-4 text-sm">
            AI is not configured. <Link href="/settings#local-models" className="underline">Install the text model in Settings</Link>. The BoomBigNose window starts the local service. You do not need a separate AI app, and nothing is sent to a cloud model.
          </p>
        ) : null}

        {panel.content ? (
          <div className="bg-background/60 border-l-primary space-y-2 rounded-xl border border-l-2 p-4">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground text-xs font-medium">
                {action === "followup" ? "Draft follow-up" : "Summary"}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="xs"
                onClick={copy}
                aria-label="Copy to clipboard"
              >
                {copied ? (
                  <Check className="size-3" />
                ) : (
                  <Copy className="size-3" />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </div>
            <p className={cn("whitespace-pre-wrap text-sm leading-relaxed")}>
              {panel.content}
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
