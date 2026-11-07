import Link from "next/link"

import { cn } from "@/lib/utils"
import type { CalendarDay } from "@/lib/calendar/month"
import type { CalendarItem } from "../types"

const DOT: Record<CalendarItem["tone"], string> = {
  amber: "bg-amber-500",
  violet: "bg-violet-500",
  blue: "bg-blue-500",
  neutral: "bg-muted-foreground",
  red: "bg-red-500",
  emerald: "bg-emerald-500",
  orange: "bg-orange-500",
}

/** A single chip for one dated item; links to its record when a href exists. */
function ItemChip({ item }: { item: CalendarItem }) {
  const inner = (
    <span
      className={cn(
        "flex items-center gap-1 truncate rounded px-1 py-0.5 text-[11px] leading-tight",
        "bg-muted/60"
      )}
    >
      <span className={cn("size-1.5 shrink-0 rounded-full", DOT[item.tone])} />
      <span className="truncate">{item.label}</span>
    </span>
  )
  return item.href ? (
    <Link href={item.href} className="block hover:bg-muted rounded">
      {inner}
    </Link>
  ) : (
    inner
  )
}

/** One day in the month grid: the date number plus its item chips. */
export function DayCell({
  cell,
  items,
  isToday,
}: {
  cell: CalendarDay
  items: CalendarItem[]
  isToday: boolean
}) {
  const MAX = 3
  const shown = items.slice(0, MAX)
  const overflow = items.length - shown.length

  return (
    <div
      className={cn(
        "flex min-h-20 flex-col gap-1 border-t border-l p-1.5 sm:min-h-28",
        cell.inMonth ? "bg-card" : "bg-muted/30",
        "[&:nth-child(7n+1)]:border-l-0"
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums",
            cell.inMonth ? "text-foreground" : "text-muted-foreground/60",
            isToday && "bg-primary text-primary-foreground font-semibold"
          )}
        >
          {cell.day}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        {shown.map((item) => (
          <ItemChip key={item.id} item={item} />
        ))}
        {overflow > 0 ? (
          <details className="text-muted-foreground px-1 text-[11px]">
            <summary
              className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-offset-2"
              aria-label={`${overflow} more items on ${cell.iso}`}
            >
              +{overflow} more
            </summary>
            <div className="mt-1 flex flex-col gap-0.5">
              {items.slice(MAX).map((item) => (
                <ItemChip key={item.id} item={item} />
              ))}
            </div>
          </details>
        ) : null}
      </div>
    </div>
  )
}
