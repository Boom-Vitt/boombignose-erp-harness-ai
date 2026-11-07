"use server"

import { randomUUID } from "node:crypto"
import { z } from "zod"
import { revalidatePath } from "next/cache"
import { requireCapability, requireOrgContext, type OrgContext } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"
import { createClient } from "@/lib/supabase/server"
import { AttachmentInput, CompleteInput, NoteInput, RecordInput, ScheduleInput, TimelinePageInput, UpdateActivityInput, type ActivityFields } from "./input"
import { recordTimelinePage } from "./queries"
import type { TimelinePage } from "./timeline"
import { RECORD_TABLES, recordHref, type RecordRef, type RecordType } from "./model"
import { attachmentBytes } from "@/lib/storage/attachment-content"
import { NativeAttachmentStore, nativeAttachmentStorage } from "@/lib/storage/native-attachments"
import { authorizedRecordAttachment } from "@/lib/storage/record-attachments"

async function writableRecord(ref: RecordRef) {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "record:write")
  const supabase = await createClient()
  const { data, error } = await supabase.from(RECORD_TABLES[ref.recordType]).select("id").eq("org_id", ctx.orgId).eq("id", ref.recordId).maybeSingle()
  if (error || !data) throw new Error("Record not found in the active workspace.")
  return { ctx, supabase }
}
function refresh(ref: RecordRef) {
  revalidatePath(recordHref(ref.recordType, ref.recordId))
  revalidatePath("/activities")
  revalidatePath("/", "layout")
}
export async function logRecordNote(input: unknown): Promise<{ error?: string }> {
  const parsed = NoteInput.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues.some(issue => issue.path[0] === "body") ? "Enter a note of 1 to 20,000 characters." : "This record is not available. Reload the page and try again." }
  const ref = parsed.data
  const { ctx, supabase } = await writableRecord(ref)
  const { error } = await supabase.from("record_notes").insert({ org_id: ctx.orgId, record_type: ref.recordType, record_id: ref.recordId, author: ctx.userId, body: ref.body })
  if (error) return { error: "Unable to save the note. Please try again." }
  refresh(ref)
  return {}
}
type Supabase = Awaited<ReturnType<typeof createClient>>
const GONE = "This activity was already completed or removed."
async function isAssignee(supabase: Supabase, orgId: string, owner: string) {
  const { data, error } = await supabase.rpc("record_activity_assignees", { p_org_id: orgId })
  return !error && !!data?.some(member => member.user_id === owner)
}
async function addActivity(ctx: OrgContext, supabase: Supabase, ref: RecordRef, fields: ActivityFields) {
  const { error } = await supabase.from("activities").insert({ org_id: ctx.orgId, record_type: ref.recordType, record_id: ref.recordId, owner: fields.owner, type: fields.type, body: fields.summary, due_date: fields.dueDate })
  if (error) return false
  await writeAudit(ctx, { entity: ref.recordType, entityId: ref.recordId, action: "activity_scheduled", summary: `Scheduled ${fields.type.replaceAll("_", " ")}`, meta: { dueDate: fields.dueDate } })
  return true
}
function refreshActivity(row: { record_type: RecordType | null; record_id: string | null }) {
  if (row.record_type && row.record_id) refresh({ recordType: row.record_type, recordId: row.record_id })
  else { revalidatePath("/activities"); revalidatePath("/", "layout") }
}
export async function scheduleRecordActivity(input: unknown): Promise<{ error?: string }> {
  const parsed = ScheduleInput.safeParse(input)
  if (!parsed.success) return { error: "Choose a type, valid due date, assignee, and summary." }
  const ref = parsed.data
  const { ctx, supabase } = await writableRecord(ref)
  if (!await isAssignee(supabase, ctx.orgId, ref.owner)) return { error: "Choose an assignee from the active workspace." }
  if (!await addActivity(ctx, supabase, ref, ref)) return { error: "Unable to schedule the activity. Please try again." }
  refresh(ref)
  return {}
}
export async function completeRecordActivity(input: unknown): Promise<{ error?: string }> {
  const parsed = CompleteInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid activity." }
  const { id, feedback, next } = parsed.data
  const ctx = await requireOrgContext()
  requireCapability(ctx, "record:write")
  const supabase = await createClient()
  const { data: activity, error: readError } = await supabase.from("activities").select("record_type,record_id,body").eq("org_id", ctx.orgId).eq("id", id).maybeSingle()
  if (readError || !activity) return { error: "Activity not found in the active workspace." }
  const ref = activity.record_type && activity.record_id ? { recordType: activity.record_type, recordId: activity.record_id } : null
  if (next && !ref) return { error: "Only an activity on a record can schedule a next activity." }
  if (next && !await isAssignee(supabase, ctx.orgId, next.owner)) return { error: "Choose an assignee from the active workspace." }
  const body = feedback ? { body: [activity.body, `Note: ${feedback}`].filter(Boolean).join("\n\n") } : {}
  const { data: done, error } = await supabase.from("activities").update({ done: true, completed_by: ctx.userId, completed_at: new Date().toISOString(), ...body }).eq("org_id", ctx.orgId).eq("id", id).eq("done", false).select("id")
  if (error) return { error: "Unable to complete the activity. Please try again." }
  if (!done?.length) return { error: GONE }
  const scheduled = !(next && ref) || await addActivity(ctx, supabase, ref, next)
  refreshActivity(activity)
  return scheduled ? {} : { error: "Activity completed, but the next activity could not be scheduled." }
}
export async function updateRecordActivity(input: unknown): Promise<{ error?: string }> {
  const parsed = UpdateActivityInput.safeParse(input)
  if (!parsed.success) return { error: "Choose a type, valid due date, assignee, and summary." }
  const { id, type, dueDate, owner, summary } = parsed.data
  const ctx = await requireOrgContext()
  requireCapability(ctx, "record:write")
  const supabase = await createClient()
  if (!await isAssignee(supabase, ctx.orgId, owner)) return { error: "Choose an assignee from the active workspace." }
  const { data, error } = await supabase.from("activities").update({ type, due_date: dueDate, owner, body: summary }).eq("org_id", ctx.orgId).eq("id", id).eq("done", false).select("record_type,record_id")
  if (error) return { error: "Unable to update the activity. Please try again." }
  const activity = data?.[0]
  if (!activity) return { error: GONE }
  await writeAudit(ctx, { entity: activity.record_type ?? "activity", entityId: activity.record_id ?? id, action: "activity_updated", summary: `Updated ${type.replaceAll("_", " ")}`, meta: { dueDate } })
  refreshActivity(activity)
  return {}
}
export async function cancelRecordActivity(input: unknown): Promise<{ error?: string }> {
  const parsed = z.guid().safeParse(input)
  if (!parsed.success) return { error: "Invalid activity." }
  const ctx = await requireOrgContext()
  requireCapability(ctx, "record:write")
  const supabase = await createClient()
  const { data, error } = await supabase.from("activities").delete().eq("org_id", ctx.orgId).eq("id", parsed.data).eq("done", false).select("type,record_type,record_id")
  if (error) return { error: "Unable to cancel the activity. Please try again." }
  const activity = data?.[0]
  if (!activity) return { error: GONE }
  await writeAudit(ctx, { entity: activity.record_type ?? "activity", entityId: activity.record_id ?? parsed.data, action: "activity_cancelled", summary: `Cancelled ${activity.type.replaceAll("_", " ")}` })
  refreshActivity(activity)
  return {}
}
export async function attachRecordFile(form: FormData): Promise<{ error?: string }> {
  const parsed = RecordInput.safeParse({ recordType: form.get("recordType"), recordId: form.get("recordId") })
  const file = form.get("file")
  if (!parsed.success || !(file instanceof File)) return { error: "Choose a file and a valid record." }
  const valid = AttachmentInput.safeParse({ name: file.name, size: file.size, type: file.type })
  if (!valid.success) return { error: "Use a PDF, JPEG, PNG, WebP, text, or CSV file up to 10 MB with a valid filename." }
  const ref = parsed.data
  const { ctx, supabase } = await writableRecord(ref)
  let bytes: Buffer
  try { bytes = await attachmentBytes(file) } catch { return { error: "The file contents do not match a supported attachment type." } }
  const id = randomUUID()
  const path = `${ctx.orgId}/${ref.recordType}/${ref.recordId}/${id}`
  let discardOrphan: () => Promise<void>
  try {
    if (nativeAttachmentStorage()) {
      const published = await new NativeAttachmentStore().publish(id, bytes)
      discardOrphan = published.discardOrphan
    } else {
      const bucket = supabase.storage.from("record-attachments")
      const { error } = await bucket.upload(path, file, { contentType: file.type, upsert: false })
      if (error) return { error: "Unable to upload the file. Please try again." }
      discardOrphan = async () => {
        const cleanup = await bucket.remove([path])
        if (cleanup.error) throw new Error("Attachment cleanup failed.")
      }
    }
  } catch { return { error: "Unable to upload the file. Please try again." } }
  try {
    const { error } = await supabase.from("record_attachments").insert({ id, org_id: ctx.orgId, record_type: ref.recordType, record_id: ref.recordId, path, filename: valid.data.name, size: file.size, content_type: file.type, uploaded_by: ctx.userId })
    if (error) {
      // Supabase can represent a lost HTTP response as an error with no SQL/PostgREST
      // code. Only an explicit database rejection proves the published file is orphaned.
      if (!/^(?:[0-9A-Z]{5}|PGRST[0-9]{3})$/.test(error.code ?? "")) return { error: "Unable to confirm the attachment was saved. Reload before trying again." }
      try { await discardOrphan() } catch { console.error("Record attachment orphan cleanup failed.") }
      return { error: "Unable to save the attachment. Please try again." }
    }
  } catch {
    // A transport exception has an uncertain commit outcome: retain evidence rather than
    // deleting an object whose metadata may have committed on the server.
    return { error: "Unable to confirm the attachment was saved. Reload before trying again." }
  }
  await writeAudit(ctx, { entity: ref.recordType, entityId: ref.recordId, action: "file_attached", summary: `Attached ${valid.data.name}` })
  refresh(ref)
  return {}
}
export async function recordAttachmentUrl(input: unknown): Promise<{ url?: string; error?: string }> {
  const parsed = z.guid().safeParse(input)
  if (!parsed.success) return { error: "Invalid attachment." }
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const data = await authorizedRecordAttachment(supabase, ctx, parsed.data)
  if (!data) return { error: "Attachment not found in the active workspace." }
  if (nativeAttachmentStorage()) return { url: `/api/attachments/${parsed.data}` }
  const result = await supabase.storage.from("record-attachments").createSignedUrl(data.path, 60, { download: data.filename })
  if (result.error) return { error: "Unable to download the attachment." }
  return { url: result.data.signedUrl }
}

export async function loadRecordHistoryPage(input: unknown): Promise<{ page?: TimelinePage; error?: string }> {
  const parsed = TimelinePageInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid history page." }
  try {
    return { page: await recordTimelinePage(parsed.data, parsed.data.cursor) }
  } catch { return { error: "Unable to load older history. Please try again." } }
}
