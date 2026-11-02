import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "bg-card/40 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed p-10 text-center",
        className
      )}
    >
      {Icon ? (
        <div className="bg-primary/10 text-primary flex size-11 items-center justify-center rounded-xl">
          <Icon className="size-5" aria-hidden />
        </div>
      ) : null}
      <div className="space-y-1">
        <h3 className="font-semibold">{title}</h3>
        {description ? (
          <p className="text-muted-foreground mx-auto max-w-sm text-sm">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}
