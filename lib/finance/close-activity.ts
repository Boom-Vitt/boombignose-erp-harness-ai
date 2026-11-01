import { toCsv } from "@/lib/export/csv"
import { closeDateLabel } from "@/lib/finance/close-copy"

export const CLOSE_ACTIVITY_DISCLAIMER_TH =
  "บันทึกกิจกรรมปิดงวด ไฟล์นี้คือรายการที่มีอยู่ตอนส่งออก และไม่รวมแถวเช็คซัมของไฟล์นี้เอง ไม่ใช่การยื่นแบบ ภ.พ.30 และไม่ใช่งบการเงินตามกฎหมาย"

export const CLOSE_ACTIVITY_DISCLAIMER_EN =
  "Close activity log. This file is the rows that existed when it was exported. It does not include its own checksum row. It does not file ภ.พ.30 and it is not a statutory ledger."

export const CLOSE_ACTIVITY_LEGACY_TH =
  "การเปิดงวดที่ไม่มีเหตุผลมาจากคำสั่งล็อกแบบเก่า หน้าจอตอนนี้ต้องมีเหตุผล และถ้ามีเจ้าของหรือผู้ดูแลมากกว่าหนึ่งคนต้องมีคนที่สองยืนยัน"

export const CLOSE_ACTIVITY_LEGACY_EN =
  "A reopen with no reason came from the older lock command. The screen now requires a reason, and a second owner or admin when the workspace has more than one."

export const CLOSE_ACTIVITY_CHAIN_TH =
  "แต่ละแถวเก็บ SHA-256 ของแถวก่อนหน้า แถวที่หายหรือถูกแก้จะทำให้โซ่ขาด เจ้าของฐานข้อมูลยังแก้โซ่ได้ นี่ไม่ใช่ตราเวลาจากภายนอก และไม่ใช่การยื่นแบบ"

export const CLOSE_ACTIVITY_CHAIN_EN =
  "Each close-activity row stores the SHA-256 of the previous row. A missing or edited row breaks the chain. The database owner can still rewrite it. This is not an external timestamp and not a filing."

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
  control: string | null
  sha256: string | null
  period: string | null
  bytes: number | null
  kind: string | null
}

export type CloseActivityRow = {
  id: string
  createdAt: string
  actorEmail: string | null
  action: string
  summary: string
  meta: unknown
  chainSeq: number | null
  chainPrev: string | null
  chainSha256: string | null
}

const CSV_HEADERS = [
  "Section",
  "Id",
  "Recorded at",
  "Actor",
  "Action",
  "Summary",
  "Previous lock",
  "Lock date",
  "Month",
  "Reason",
  "Control",
  "File kind",
  "Period",
  "SHA-256",
  "Bytes",
  "Chain seq",
  "Chain previous",
  "Chain SHA-256",
]

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

function controlLabel(action: string, meta: Record<string, unknown>): string | null {
  if (action === "finance_lock_reopen_requested") return "รอคนที่สอง / waiting for a second owner or admin"
  if (action !== "finance_lock_reopened") return null
  const reason = text(meta, "reason")
  const requested = text(meta, "requestedBy")
  const confirmed = text(meta, "confirmedBy")
  if (!reason) return "คำสั่งเก่า ไม่มีเหตุผล / older command, no reason recorded"
  if (requested && confirmed && requested !== confirmed) return "คนที่สองยืนยัน / a second owner or admin confirmed"
  return "คนเดียว / one owner or admin"
}

function asRecord(meta: unknown): Record<string, unknown> {
  return meta && typeof meta === "object" && !Array.isArray(meta) ? meta as Record<string, unknown> : {}
}

/** Fields for one close-activity row. Dates that are real calendar days include พ.ศ. */
export function closeActivityView(action: string, meta: unknown): CloseActivityView {
  const record = asRecord(meta)
  return {
    actionLabel: isCloseAuditAction(action) ? ACTION_LABELS[action] : action,
    previousLockDate: dateLabel(text(record, "previousLockDate")),
    lockDate: dateLabel(text(record, "lockDate")),
    month: text(record, "month"),
    reason: text(record, "reason"),
    control: controlLabel(action, record),
    sha256: text(record, "sha256"),
    period: text(record, "period"),
    bytes: whole(record, "bytes"),
    kind: text(record, "kind") === "operational_lock" || text(record, "kind") === "operational_close" ? null : text(record, "kind"),
  }
}

function byNewest(a: CloseActivityRow, b: CloseActivityRow): number {
  return b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
}

/** Full close-activity CSV. The checksum row for this file is written after these bytes. */
export function closeActivityCsv(rows: readonly CloseActivityRow[], exportedOn: string): string {
  const notes: (string | number | null)[][] = [
    ["note", "", exportedOn, "", "", CLOSE_ACTIVITY_DISCLAIMER_TH, "", "", "", "", "", "", "", "", "", "", "", ""],
    ["note", "", exportedOn, "", "", CLOSE_ACTIVITY_DISCLAIMER_EN, "", "", "", "", "", "", "", "", "", "", "", ""],
    ["note", "", exportedOn, "", "", CLOSE_ACTIVITY_LEGACY_TH, "", "", "", "", "", "", "", "", "", "", "", ""],
    ["note", "", exportedOn, "", "", CLOSE_ACTIVITY_LEGACY_EN, "", "", "", "", "", "", "", "", "", "", "", ""],
    ["note", "", exportedOn, "", "", CLOSE_ACTIVITY_CHAIN_TH, "", "", "", "", "", "", "", "", "", "", "", ""],
    ["note", "", exportedOn, "", "", CLOSE_ACTIVITY_CHAIN_EN, "", "", "", "", "", "", "", "", "", "", "", ""],
  ]
  const body = [...rows].sort(byNewest).map(row => {
    const view = closeActivityView(row.action, row.meta)
    return [
      "event",
      row.id,
      row.createdAt,
      row.actorEmail,
      row.action,
      row.summary,
      view.previousLockDate,
      view.lockDate,
      view.month,
      view.reason,
      view.control,
      view.kind,
      view.period,
      view.sha256,
      view.bytes,
      row.chainSeq,
      row.chainPrev,
      row.chainSha256,
    ]
  })
  return toCsv(CSV_HEADERS, [...notes, ...body])
}
