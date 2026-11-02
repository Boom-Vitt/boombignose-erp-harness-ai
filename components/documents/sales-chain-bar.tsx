import Link from "next/link"
import { Check } from "lucide-react"

import { cn } from "@/lib/utils"
import type { SalesChain } from "@/lib/documents/sales-chain"

const DOT = {
  done: "bg-emerald-400/15 text-emerald-300 border-emerald-400/30",
  current: "bg-sky-400/15 text-sky-200 border-sky-400/50",
  todo: "text-muted-foreground border-border",
  stopped: "bg-rose-400/10 text-rose-300 border-rose-400/30 line-through",
} as const

/** Quotation → invoice draft → issued → receipt. `nextHref` makes the next-step label a link (omit for read-only users). */
export function SalesChainBar({ chain, nextHref, compact }: { chain: SalesChain; nextHref?: string; compact?: boolean }) {
  return (
    <div className="space-y-2" aria-label="Sales document chain / ลำดับเอกสารขาย">
      <ol className="flex flex-wrap items-center gap-1.5">
        {chain.steps.map((step, i) => (
          <li key={step.key} className="flex items-center gap-1.5" aria-current={step.state === "current" ? "step" : undefined}>
            {i > 0 ? <span aria-hidden className="text-muted-foreground">→</span> : null}
            <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs", DOT[step.state])}>
              {step.state === "done" ? <Check aria-hidden className="size-3" /> : null}
              {step.th}{compact ? null : <span className="text-muted-foreground"> / {step.en}</span>}
            </span>
          </li>
        ))}
      </ol>
      {chain.next && !compact ? (
        <p className="text-sm">
          ขั้นถัดไป / Next:{" "}
          {nextHref ? <Link className="font-medium underline" href={nextHref}>{chain.next.th} / {chain.next.en}</Link>
            : <span className="font-medium">{chain.next.th} / {chain.next.en}</span>}
        </p>
      ) : null}
      {chain.vatNote && !compact ? <p className="text-xs text-muted-foreground">{chain.vatNote}</p> : null}
    </div>
  )
}
