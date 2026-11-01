import Link from "next/link"

import { Badge } from "@/components/ui/badge"
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { BAHT_CAPTION_EN, BAHT_CAPTION_TH, CLOSE_STATE_LABEL, closeDateLabel, closeMonthLabel } from "@/lib/finance/close-copy"
import type { CloseChecklist } from "@/lib/finance/close-checklist"
import { formatTHB } from "@/lib/money"

function badgeLabel(checklist: CloseChecklist): string {
  if (checklist.alreadyClosed) return checklist.ready ? "ปิดแล้ว / Closed" : `${checklist.reviewCount} รายการยังเปิด / ${checklist.reviewCount} still open`
  if (!checklist.closable) return "เดือนนี้ยังเปิด / Month still open"
  return checklist.ready ? "พร้อมปิด / Ready to close" : `${checklist.reviewCount} รายการต้องตรวจ / ${checklist.reviewCount} to review`
}

/** Reports section. Counts and links come from the pure checklist. */
export function MonthEndCloseSection({ checklist }: { checklist: CloseChecklist }) {
  return (
    <Card id="month-end-close" className="scroll-mt-20">
      <CardHeader>
        <CardTitle><h2 id="month-end-close-title">ปิดงบเดือน / Month-end close</h2></CardTitle>
        <CardDescription>เดือน {closeMonthLabel(checklist.month)} · สิ้นงวด {closeDateLabel(checklist.periodEnd)} · {BAHT_CAPTION_TH} / {BAHT_CAPTION_EN}</CardDescription>
        <CardAction>
          <Badge variant={!checklist.ready && (checklist.closable || checklist.alreadyClosed) ? "destructive" : "secondary"}>
            {badgeLabel(checklist)}
          </Badge>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm">{checklist.summary}</p>
        <ul className="divide-y rounded-lg border">
          {checklist.items.map(item => (
            <li key={item.id} data-close-item={item.id} data-state={item.state}>
              <Link href={item.href} className="flex flex-col gap-2 p-3 text-sm hover:bg-muted/50 sm:flex-row sm:items-start sm:justify-between">
                <span className="min-w-0">
                  <span className="font-medium">{item.title}</span>
                  <span className="mt-1 block text-muted-foreground">{item.detail}</span>
                  {item.outputVatSatang !== null && item.inputVatSatang !== null ? (
                    <span className="mt-1 block tabular-nums">ภาษีขาย / Output VAT {formatTHB(item.outputVatSatang)} · ภาษีซื้อ / Input VAT {formatTHB(item.inputVatSatang)}</span>
                  ) : item.state === "review" && item.amountSatang !== null ? (
                    <span className="mt-1 block tabular-nums">{formatTHB(item.amountSatang)}</span>
                  ) : null}
                </span>
                <Badge variant={item.state === "review" ? "destructive" : "secondary"} className="shrink-0">
                  {item.state === "review" ? item.count : CLOSE_STATE_LABEL[item.state]}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
        <Link href="/settings/finance" className="text-sm underline">การตั้งค่างวดบัญชี ที่เจ้าของหรือผู้ดูแลล็อกเดือน / Finance settings, where an owner or admin locks the month</Link>
      </CardContent>
    </Card>
  )
}
