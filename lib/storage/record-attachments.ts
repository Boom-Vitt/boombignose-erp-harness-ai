import type { OrgContext } from "@/lib/auth"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/types/database"
import { AttachmentInput, RecordInput } from "@/lib/record-history/input"
import { RECORD_TABLES } from "@/lib/record-history/model"

/** Recheck both membership-scoped metadata and current record visibility through session RLS. */
export async function authorizedRecordAttachment(supabase: SupabaseClient<Database>, ctx: Pick<OrgContext, "orgId">, id: string) {
  const { data, error } = await supabase.from("record_attachments").select("id,org_id,record_type,record_id,path,filename,size,content_type").eq("org_id", ctx.orgId).eq("id", id).maybeSingle()
  if (error || !data) return null
  const ref = RecordInput.safeParse({ recordType: data.record_type, recordId: data.record_id })
  const metadata = AttachmentInput.safeParse({ name: data.filename, size: data.size, type: data.content_type })
  if (!ref.success || !metadata.success || data.path !== `${ctx.orgId}/${ref.data.recordType}/${ref.data.recordId}/${id}`) return null
  const record = await supabase.from(RECORD_TABLES[ref.data.recordType]).select("id").eq("org_id", ctx.orgId).eq("id", ref.data.recordId).maybeSingle()
  if (record.error || !record.data) return null
  return data
}

export function attachmentDisposition(filename: string): string {
  const fallback = filename.replace(/[^a-zA-Z0-9 ._-]/g, "_").replace(/^\.+/, "_") || "attachment"
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`
}
