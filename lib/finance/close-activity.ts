import { closeDateLabel } from "@/lib/finance/close-copy"

/** Activity rows that belong to the operational close. Not a statutory ledger. */
export const CLOSE_AUDIT_ACTIONS = [
  "finance_lock_updated",
  "finance_lock_reopened",
  "finance_lock_reopen_requested",
  "finance_lock_reopen_cancelled",
  "period_closed",
  "support_exported",
] as const

export type CloseAuditAction = (typeof CLOSE_AUDIT_ACTIONS)[number]

const ACTION_LABELS: Record<CloseAuditAction, string> = {
  finance_lock_updated: "เลื่อนล็อกไปข้างหน้า / Lock moved forward",
  finance_lock_reopened: "เปิดงวดใหม่ / Finance lock reopened",
  finance_lock_reopen_requested: "ขอเปิดงวด / Reopen requested",
  finance_lock_reopen_cancelled: "ยกเลิกคำขอเปิดงวด / Reopen request cancelled",
  period_closed: "ปิดเดือนที่จบแล้ว / Completed month closed",
  support_exported: "ส่งไฟล์ประกอบ / Support file exported",
}

export type CloseActivityView = {
  actionLabel: string
  previousLockDate: string | null
  lockDate: string | null
  month: string | null
  reason: string | null
  sha256: string | null
  period: string | null
  bytes: number | null
  kind: string | null
}

function text(meta: Record<string, unknown>, key: string): string | null {
  const value = meta[key]
  return typeof value === "string" && value.trim() !== "" ? value : null
}

function whole(meta: Record<string, unknown>, key: string): number | null {
  const value = meta[key]
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null
}

function dateLabel(value: string | null): string | null {
  if (!value) return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? closeDateLabel(value) : value
}

export function isCloseAuditAction(action: string): action is CloseAuditAction {
  return (CLOSE_AUDIT_ACTIONS as readonly string[]).includes(action)
}

/** Fields for one close-activity row. Dates that are real calendar days include พ.ศ. */
export function closeActivityView(action: string, meta: unknown): CloseActivityView {
  const record = meta && typeof meta === "object" && !Array.isArray(meta) ? meta as Record<string, unknown> : {}
  return {
    actionLabel: isCloseAuditAction(action) ? ACTION_LABELS[action] : action,
    previousLockDate: dateLabel(text(record, "previousLockDate")),
    lockDate: dateLabel(text(record, "lockDate")),
    month: text(record, "month"),
    reason: text(record, "reason"),
    sha256: text(record, "sha256"),
    period: text(record, "period"),
    bytes: whole(record, "bytes"),
    kind: text(record, "kind") === "operational_lock" || text(record, "kind") === "operational_close" ? null : text(record, "kind"),
  }
}
