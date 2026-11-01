"use client"

import { useState, useTransition } from "react"
import { Sparkles } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatTHB } from "@/lib/money"
import type { CloseOpenItems } from "@/lib/finance/close-summary"

import { summarizeMonthEnd } from "../close-summary-actions"

type State =
  | { status: "idle" }
  | { status: "ready"; counts: CloseOpenItems; content: string | null; notice: string | null }

function CountLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

export function CloseSummary() {
  const [pending, startTransition] = useTransition()
  const [state, setState] = useState<State>({ status: "idle" })

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">สรุปปิดเดือน / Month-end note</CardTitle>
        <CardDescription>
          Ollama reads overdue receivables, unpaid vendor bills, and unmatched bank lines in this workspace, then writes a short note. It does not post a journal or file tax. Your accountant prepares the statutory books. You and your accountant file with the Revenue Department.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => startTransition(async () => {
            const result = await summarizeMonthEnd()
            if (!("counts" in result)) {
              setState({ status: "ready", counts: emptyCounts(), content: null, notice: result.error })
              return
            }
            if ("notConfigured" in result) {
              setState({
                status: "ready",
                counts: result.counts,
                content: null,
                notice: "Ollama is not running on this machine, so there is no written note. The counts above are from this workspace. Start it with ollama serve, then ollama pull qwen3:4b. Nothing was sent to a cloud model.",
              })
              return
            }
            if ("error" in result) {
              setState({ status: "ready", counts: result.counts, content: null, notice: result.error })
              return
            }
            setState({ status: "ready", counts: result.counts, content: result.content, notice: null })
          })}
        >
          <Sparkles /> {pending ? "Reading…" : "Write the note"}
        </Button>

        {state.status === "ready" && state.counts.asOf ? (
          <div className="space-y-2">
            <CountLine label="ลูกหนี้เกินกำหนด / Overdue receivables" value={`${state.counts.overdueReceivableCount} · ${formatTHB(state.counts.overdueReceivableSatang)}`} />
            <CountLine label="เจ้าหนี้ที่ยังไม่จ่าย / Unpaid vendor bills" value={`${state.counts.unpaidBillCount} · ${formatTHB(state.counts.unpaidBillSatang)}`} />
            <CountLine
              label="ธนาคารที่ยังไม่จับคู่ / Unmatched bank lines"
              value={state.counts.unmatchedBankCount === null ? "ไม่พบข้อมูล / not available" : String(state.counts.unmatchedBankCount)}
            />
            <p className="text-muted-foreground text-xs">As of {state.counts.asOf}</p>
          </div>
        ) : null}

        {state.status === "ready" && state.notice ? (
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-sm">{state.notice}</p>
        ) : null}
        {state.status === "ready" && state.content ? (
          <p className="text-sm whitespace-pre-wrap">{state.content}</p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function emptyCounts(): CloseOpenItems {
  return {
    asOf: "",
    overdueReceivableCount: 0,
    overdueReceivableSatang: 0,
    unpaidBillCount: 0,
    unpaidBillSatang: 0,
    unmatchedBankCount: null,
  }
}
