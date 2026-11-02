import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"

/** Hand-drawn loop behind the icon, so an empty list looks like a note on the board. */
function Doodle() {
  return (
    <svg aria-hidden viewBox="0 0 80 80" className="text-primary/70 absolute inset-0 size-full" fill="none">
      <path
        d="M14 44C9 24 28 9 46 11c19 2 28 20 22 37-5 15-26 22-41 15"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeDasharray="3 5"
      />
      <path d="M62 62l8 7M70 62l-8 7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

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
        "bbn-rough flex flex-col items-center justify-center gap-4 border-[1.5px] border-dashed border-input bg-card/30 p-10 text-center",
        className
      )}
    >
      {Icon ? (
        <div className="text-primary relative flex size-16 items-center justify-center">
          <Doodle />
          <Icon className="size-6" aria-hidden />
        </div>
      ) : null}
      <div className="space-y-1">
        <h3 className="font-heading font-semibold">{title}</h3>
        {description ? (
          <p className="text-muted-foreground mx-auto max-w-sm text-sm">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}
