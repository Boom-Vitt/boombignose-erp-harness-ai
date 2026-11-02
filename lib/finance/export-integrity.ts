import { createHash } from "node:crypto"

/** Support files a signed-in finance role can download. Not a filing. */
export const SUPPORT_EXPORT_KINDS = ["accountant_pack_csv", "accountant_pack_print", "outstanding_pack_csv", "close_activity_csv", "vat_support_csv", "wht_support_csv"] as const

export type SupportExportKind = (typeof SUPPORT_EXPORT_KINDS)[number]

export function sha256Utf8(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex")
}

export type SupportExportCall = {
  rpc: "record_support_export"
  sha256: string
  args: {
    p_org_id: string
    p_kind: SupportExportKind
    p_period: string
    p_sha256: string
    p_bytes: number
  }
}

/** Checksum of the exact response body, for the activity-log command. */
export function supportExportCall(orgId: string, kind: SupportExportKind, period: string, body: string): SupportExportCall {
  const sha256 = sha256Utf8(body)
  return {
    rpc: "record_support_export",
    sha256,
    args: {
      p_org_id: orgId,
      p_kind: kind,
      p_period: period,
      p_sha256: sha256,
      p_bytes: Buffer.byteLength(body, "utf8"),
    },
  }
}

export function normalizeSha256(value: string): string | null {
  const hex = value.trim().toLowerCase()
  return /^[a-f0-9]{64}$/.test(hex) ? hex : null
}

export async function sha256HexBytes(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const digest = await crypto.subtle.digest("SHA-256", copy)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")
}

export type StoredExport = {
  sha256: string
  kind: string
  period: string
  bytes: number
}

export type ChecksumVerdict =
  | { match: true; kind: string; period: string }
  | { match: false; message: string }

/** Compare a saved file with one stored support-export checksum. Not a filing seal. */
export function checksumVerdict(file: { sha256: string; bytes: number }, record: StoredExport | null): ChecksumVerdict {
  if (!record) return { match: false, message: "No stored support export has this checksum." }
  if (file.sha256 !== record.sha256) return { match: false, message: "This file does not match the stored checksum." }
  if (file.bytes !== record.bytes) return { match: false, message: "The checksum matches but the file size does not." }
  return { match: true, kind: record.kind, period: record.period }
}

export function supportExportHeaders(
  filename: string,
  contentType: string,
  sha256: string,
  disposition: "attachment" | "inline",
): Record<string, string> {
  return {
    "Content-Type": contentType,
    "Content-Disposition": `${disposition}; filename="${filename}"`,
    "X-Content-SHA256": sha256,
    "X-Robots-Tag": "noindex",
  }
}
