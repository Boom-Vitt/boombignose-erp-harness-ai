export type ReopenRequest = {
  id: string
  requestedBy: string
  requesterEmail: string | null
  lockDate: string | null
  previousLockDate: string | null
  reason: string
  createdAt: string
}

export type StoredSupportExport = {
  sha256: string
  kind: string
  period: string
  bytes: number
  summary: string
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key]
  return typeof value === "string" && value.trim() !== "" ? value : null
}

/** Pending reopen requests returned by the database command. */
export function readReopenRequests(data: unknown): ReopenRequest[] {
  if (!Array.isArray(data)) return []
  const requests: ReopenRequest[] = []
  for (const item of data) {
    const row = record(item)
    const id = row ? text(row, "id") : null
    const requestedBy = row ? text(row, "requestedBy") : null
    const reason = row ? text(row, "reason") : null
    const createdAt = row ? text(row, "createdAt") : null
    if (!row || !id || !requestedBy || !reason || !createdAt) continue
    requests.push({
      id,
      requestedBy,
      requesterEmail: text(row, "requesterEmail"),
      lockDate: text(row, "lockDate"),
      previousLockDate: text(row, "previousLockDate"),
      reason,
      createdAt,
    })
  }
  return requests
}

/** One stored support export, or null when the checksum is not in the log. */
export function readStoredSupportExport(data: unknown): StoredSupportExport | null {
  const row = record(data)
  if (!row) return null
  const sha256 = text(row, "sha256")
  const kind = text(row, "kind")
  const period = text(row, "period")
  const summary = text(row, "summary") ?? ""
  const bytes = row.bytes
  if (!sha256 || !kind || !period || typeof bytes !== "number" || !Number.isSafeInteger(bytes) || bytes < 0) return null
  return { sha256, kind, period, bytes, summary }
}
