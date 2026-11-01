import { createHash } from "node:crypto"

/** Support files a signed-in finance role can download. Not a filing. */
export const SUPPORT_EXPORT_KINDS = ["accountant_pack_csv", "accountant_pack_print", "outstanding_pack_csv"] as const

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
