import type { LucideIcon } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type StatCardProps = {
  label: string
  value: string
  hint?: string
  icon?: LucideIcon
  tone?: "default" | "positive" | "negative" | "warning"
  /** The one number the page leads with: large, on an orange-edged sheet. */
  featured?: boolean
  /** Dense ticket: icon and value on one line, no hint block. */
  compact?: boolean
  className?: string
}

const VALUE_TONE: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-foreground",
  positive: "text-emerald-300",
  negative: "text-rose-300",
  warning: "text-amber-300",
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  featured = false,
  compact = false,
  className,
}: StatCardProps) {
  const chip = Icon ? (
    <span
      className={cn(
        "bbn-rough-sm flex shrink-0 items-center justify-center border border-primary/60 bg-primary/10 text-primary",
        featured ? "size-9" : "size-7"
      )}
    >
      <Icon className={featured ? "size-4.5" : "size-3.5"} aria-hidden />
    </span>
  ) : null

  if (compact) {
    return (
      <Card size="sm" className={cn("gap-0", className)}>
        <CardContent className="flex items-center gap-3">
          {chip}
          <div className="min-w-0">
            <div className="text-muted-foreground truncate text-xs">{label}</div>
            <div className={cn("font-heading truncate text-lg leading-tight font-semibold tabular-nums", VALUE_TONE[tone])}>{value}</div>
            {hint ? <p className="text-muted-foreground truncate text-[11px]">{hint}</p> : null}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card
      className={cn(
        "gap-0",
        featured && "border-primary bg-gradient-to-br from-raised to-card shadow-[0_0_30px_rgb(242_138_60/0.22)]",
        className
      )}
    >
      <CardContent className={cn("flex h-full flex-col", featured ? "justify-between gap-6" : "gap-2")}>
        <div className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0 break-words">{label}</span>
          {chip}
        </div>
        <div className="min-w-0">
          <div
            className={cn(
              "font-heading min-w-0 truncate leading-none font-semibold tracking-tight tabular-nums",
              featured ? "text-4xl sm:text-6xl" : "text-xl sm:text-2xl",
              VALUE_TONE[tone]
            )}
          >
            {value}
          </div>
          {hint ? <p className="text-muted-foreground mt-2 text-xs break-words">{hint}</p> : null}
        </div>
      </CardContent>
    </Card>
  )
}
