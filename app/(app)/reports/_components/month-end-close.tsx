import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { CloseChecklist } from "@/lib/finance/close-checklist"
import { formatTHB } from "@/lib/money"
import { FilingResponsibility } from "@/components/finance/filing-responsibility"

const STATE_LABEL = { clear: "Clear", review: "Review", info: "Note" } as const

function badgeLabel(checklist: CloseChecklist): string {
  if (checklist.alreadyClosed) return checklist.ready ? "Closed" : `${checklist.reviewCount} still open`
  if (!checklist.closable) return "Month still open"
  return checklist.ready ? "Ready to close" : `${checklist.reviewCount} to review`
}

/** Reports section. Counts and links come from the pure checklist. */
export function MonthEndCloseSection({ checklist }: { checklist: CloseChecklist }) {
  return (
    <Card id="month-end-close" className="scroll-mt-20">
      <CardHeader>
        <CardTitle><h2 id="month-end-close-title">ปิดงบเดือน / Month-end close</h2></CardTitle>
        <CardDescription>เดือน {checklist.month} · สิ้นงวด {checklist.periodEnd}</CardDescription>
        <CardAction>
          <Badge variant={!checklist.ready && (checklist.closable || checklist.alreadyClosed) ? "destructive" : "secondary"}>
            {badgeLabel(checklist)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <FilingResponsibility />
        <p className="text-sm">{checklist.summary}</p>
        <ul className="divide-y rounded-lg border">
          {checklist.items.map(item => (
            <li key={item.id} data-close-item={item.id} data-state={item.state}>
              <Link href={item.href} className="flex flex-col gap-2 p-3 text-sm hover:bg-muted/50 sm:flex-row sm:items-start sm:justify-between">
                <span className="min-w-0">
                  <span className="font-medium">{item.title}</span>
                  <span className="mt-1 block text-muted-foreground">{item.detail}</span>
                  {item.outputVatSatang !== null && item.inputVatSatang !== null ? (
                    <span className="mt-1 block tabular-nums">Output {formatTHB(item.outputVatSatang)} · Input {formatTHB(item.inputVatSatang)}</span>
                  ) : item.state === "review" && item.amountSatang !== null ? (
                    <span className="mt-1 block tabular-nums">{formatTHB(item.amountSatang)}</span>
                  ) : null}
                </span>
                <Badge variant={item.state === "review" ? "destructive" : "secondary"} className="shrink-0">
                  {item.state === "review" ? item.count : STATE_LABEL[item.state]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/settings/finance" className="text-sm underline">Finance settings, where an owner or admin locks the month</Link>
      </CardContent>
    </Card>
  )
}
