import { createClient } from "@/lib/supabase/server"
import { supportExportCall, type SupportExportKind } from "@/lib/finance/export-integrity"

export type SupportExportRecord =
  | { ok: true; sha256: string }
  | { ok: false; error: string }

/**
 * Store the checksum of a support file before it is downloaded.
 * The download is refused when this row cannot be written.
 */
export async function commitSupportExport(orgId: string, kind: SupportExportKind, period: string, body: string): Promise<SupportExportRecord> {
  const call = supportExportCall(orgId, kind, period, body)
  const supabase = await createClient()
  const { error } = await supabase.rpc(call.rpc, call.args)
  if (error) return { ok: false, error: "Support export was not recorded. Reload and try the download again." }
  return { ok: true, sha256: call.sha256 }
}
