import type { LucideIcon } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"
import { cn } from "@/lib/utils"

export type StatCardProps = {
  label: string
  value: string
  hint?: string
  icon?: LucideIcon
  tone?: "default" | "positive" | "negative" | "warning"
  /** The one number the page leads with: larger, with a gold edge. */
  featured?: boolean
  className?: string
}

const VALUE_TONE: Record<NonNullable<StatCardProps["tone"]>, string> = {
  default: "text-foreground",
  positive: "text-emerald-400",
  negative: "text-rose-400",
  warning: "text-amber-300",
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  featured = false,
  className,
}: StatCardProps) {
  return (
    <Card className={cn("gap-0", featured && "bg-gradient-to-br from-raised to-card ring-primary/25", className)}>
      <CardContent className="flex flex-col gap-2">
        <div className="text-muted-foreground flex items-center justify-between gap-2 text-sm">
          <span className="min-w-0">{label}</span>
          {Icon ? (
            <span className="bg-primary/10 text-primary flex size-7 shrink-0 items-center justify-center rounded-lg">
              <Icon className="size-3.5" aria-hidden />
            </span>
          ) : null}
        </div>
        <div className={cn("font-heading leading-none font-semibold tracking-tight tabular-nums", featured ? "text-4xl sm:text-5xl" : "text-xl sm:text-2xl lg:text-[1.75rem]", VALUE_TONE[tone])}>
          {value}
        </div>
        {hint ? <p className="text-muted-foreground text-xs">{hint}</p> : null}
      </CardContent>
    </Card>
  )
}
