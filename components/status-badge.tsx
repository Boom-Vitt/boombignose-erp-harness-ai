import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { STATUS_DISPLAY, type RecordStatus, type Tone } from "@/lib/record/status"
import type { Enums } from "@/lib/types/database"

const TONE: Record<Tone, string> = {
  neutral: "bg-slate-400/10 text-slate-300 border-transparent [--dot:#94a3b8]",
  info: "bg-sky-400/10 text-sky-300 border-transparent [--dot:#38bdf8]",
  success: "bg-emerald-400/10 text-emerald-300 border-transparent [--dot:#34d399]",
  warning: "bg-amber-400/10 text-amber-300 border-transparent [--dot:#e0a84a]",
  danger: "bg-rose-400/10 text-rose-300 border-transparent [--dot:#fb7185]",
}

export function StatusBadge({ status }: { status: RecordStatus }) {
  const { label, tone } = STATUS_DISPLAY[status]
  return (
    <Badge variant="outline" className={cn("font-medium", TONE[tone])}>
      <span aria-hidden className="size-1.5 rounded-full bg-(--dot)" />
      {label}
    </Badge>
  )
}

export function DealStageBadge({ stage }: { stage: Enums<"deal_stage"> }) {
  return <StatusBadge status={stage} />
}

export function ProjectStatusBadge({ status }: { status: Enums<"project_status"> }) {
  return <StatusBadge status={status} />
}

export function InvoiceStatusBadge({ status }: { status: Enums<"invoice_status"> }) {
  return <StatusBadge status={status} />
}

export function TaskStatusBadge({ status }: { status: Enums<"task_status"> }) {
  return <StatusBadge status={status} />
}

export function QuoteStatusBadge({ status }: { status: Enums<"quote_status"> }) {
  return <StatusBadge status={status} />
}

export function SubscriptionStatusBadge({ status }: { status: Enums<"subscription_status"> }) {
  return <StatusBadge status={status} />
}
