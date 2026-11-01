import { createHash } from "node:crypto"

/**
 * Hash chain for close-activity rows. Each row stores the previous row's
 * SHA-256. A missing or edited row breaks the next check. This is not the
 * checksum of an export file, not an external timestamp, and not a filing.
 */

export const CLOSE_CHAIN_META_KEYS = [
  "lockDate",
  "previousLockDate",
  "month",
  "reason",
  "kind",
  "period",
  "sha256",
  "bytes",
  "filing",
  "requestId",
  "requestedBy",
  "confirmedBy",
  "staffCount",
] as const

export type CloseChainInput = {
  orgId: string
  id: string
  recordedAt: string
  action: string
  actorId: string | null
  summary: string
  meta: Record<string, unknown> | null
}

export type CloseChainLink = CloseChainInput & {
  seq: number
  previous: string
  sha256: string
}

export type CloseChainHead = { sha256: string; seq: number }

export type CloseChainCheck =
  | { ok: true; checked: number; reason: null; brokenAt: null }
  | { ok: false; checked: number; reason: string; brokenAt: string | null }

export function closeChainEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n")
}

/** Stable meta text. Keys stay in CLOSE_CHAIN_META_KEYS order. Empty values are left out. */
export function closeChainMeta(meta: Record<string, unknown> | null): string {
  const parts: string[] = []
  for (const key of CLOSE_CHAIN_META_KEYS) {
    const value = meta?.[key]
    if (value === null || value === undefined || value === "") continue
    if (typeof value === "boolean") parts.push(`${key}=${value ? "true" : "false"}`)
    else if (typeof value === "number" && Number.isSafeInteger(value)) parts.push(`${key}=${value}`)
    else if (typeof value === "string") parts.push(`${key}=${closeChainEscape(value)}`)
  }
  return parts.join(";")
}

/** Canonical row text. The previous hash is its own line and may be empty. */
export function closeChainPayload(row: CloseChainInput, previous: string): string {
  return [
    "v1",
    row.orgId,
    row.id,
    row.recordedAt,
    row.action,
    row.actorId ?? "",
    closeChainEscape(row.summary),
    previous,
    closeChainMeta(row.meta),
  ].join("\n")
}

export function closeChainSha256(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex")
}

/** Link rows in the order they were recorded. The first previous hash is empty. */
export function linkCloseChain(rows: readonly CloseChainInput[]): { links: CloseChainLink[]; head: CloseChainHead } {
  const links: CloseChainLink[] = []
  let previous = ""
  rows.forEach((row, index) => {
    const payload = closeChainPayload(row, previous)
    const sha256 = closeChainSha256(payload)
    links.push({ ...row, seq: index + 1, previous, sha256 })
    previous = sha256
  })
  return { links, head: { sha256: previous, seq: links.length } }
}

/**
 * Recompute the chain. A gap, a changed row, or a head that still names a
 * removed last row fails. Rewriting the head to hide a deleted tail is outside
 * what this check can see.
 */
export function verifyCloseChain(links: readonly CloseChainLink[], head: CloseChainHead | null): CloseChainCheck {
  let previous = ""
  for (let index = 0; index < links.length; index += 1) {
    const link = links[index]
    if (!link) continue
    if (link.seq !== index + 1) {
      return { ok: false, checked: index, reason: "A close-activity row is missing before this one.", brokenAt: link.id }
    }
    if (link.previous !== previous) {
      return { ok: false, checked: link.seq - 1, reason: "A close-activity row is missing before this one.", brokenAt: link.id }
    }
    const again = closeChainSha256(closeChainPayload(link, link.previous))
    if (again !== link.sha256) {
      return { ok: false, checked: link.seq - 1, reason: "This close-activity row was changed after it was written.", brokenAt: link.id }
    }
    previous = link.sha256
  }
  if ((head?.seq ?? 0) !== links.length || (head?.sha256 ?? "") !== previous) {
    return { ok: false, checked: links.length, reason: "The latest close-activity row does not match the stored chain head.", brokenAt: null }
  }
  return { ok: true, checked: links.length, reason: null, brokenAt: null }
}

export function readChainStatus(data: unknown): CloseChainCheck | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  const row = data as { ok?: unknown; checked?: unknown; reason?: unknown; brokenAt?: unknown }
  if (typeof row.checked !== "number" || !Number.isSafeInteger(row.checked) || row.checked < 0) return null
  if (row.ok === true) return { ok: true, checked: row.checked, reason: null, brokenAt: null }
  if (row.ok !== false || typeof row.reason !== "string" || row.reason.trim() === "") return null
  return { ok: false, checked: row.checked, reason: row.reason, brokenAt: typeof row.brokenAt === "string" ? row.brokenAt : null }
}
