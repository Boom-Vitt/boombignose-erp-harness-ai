"use server"

import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { normalizeSha256 } from "@/lib/finance/export-integrity"
import { readStoredSupportExport, type StoredSupportExport } from "@/lib/finance/reopen-request"
import { createClient } from "@/lib/supabase/server"

export async function findSupportExport(sha256: string): Promise<{ record: StoredSupportExport | null; error?: string }> {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "audit:view")) return { record: null, error: "Only owners, admins, and accountants can check an export." }
  const parsed = normalizeSha256(sha256)
  if (!parsed) return { record: null, error: "Enter a SHA-256 checksum." }
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("find_support_export", { p_org_id: ctx.orgId, p_sha256: parsed })
  if (error) return { record: null, error: error.message }
  return { record: readStoredSupportExport(data) }
}
