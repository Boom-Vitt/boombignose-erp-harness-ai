import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"
const state = vi.hoisted(() => ({
  client: {} as unknown,
  ctx: { orgId: "10000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000002", role: "member" },
  capability: vi.fn(), upload: vi.fn(), remove: vi.fn(), signed: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => state.ctx, requireCapability: state.capability }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { writeAudit } from "@/lib/audit"
import { attachRecordFile, cancelRecordActivity, completeRecordActivity, logRecordNote, recordAttachmentUrl, scheduleRecordActivity, loadRecordHistoryPage, updateRecordActivity } from "./actions"

const recordId = "10000000-0000-4000-8000-000000000003"
const activityId = "10000000-0000-4000-8000-000000000004"
const ref = { recordType: "quote", recordId }
let tables: Record<string, Record<string, unknown>[]>
let updates: { table: string; values: unknown }[]
let filters: { table: string; key: string; value: unknown }[]
type Rows = Record<string, unknown>[]
function client(failedTable?: string, failInsertInto?: string) {
  const fixture = databaseFixture(tables)
  return {
    from(table: string) {
      const query = fixture.from(table)
      const eq = query.eq
      query.eq = (key, value) => { filters.push({ table, key, value }); return eq(key, value) }
      const read = query.then
      let mutate: ((rows: Rows) => void) | undefined
      query.then = (resolve, reject) => read(result => { if (mutate) mutate((result as { data: Rows }).data); return resolve(result) }, reject)
      const failed = () => { query.then = (resolve, reject) => Promise.resolve({ data: null, error: { message: "Synthetic failure", code: "23514" } }).then(resolve, reject) }
      if (table === failedTable) failed()
      if (table === failInsertInto) query.insert = () => { failed(); return query }
      return Object.assign(query, {
        update: (values: unknown) => { updates.push({ table, values }); mutate = rows => rows.forEach(row => Object.assign(row, values)); return query },
        delete: () => { mutate = rows => { tables[table] = tables[table].filter(row => !rows.includes(row)) }; return query },
      })
    },
    rpc: async (_name: string, args: { p_org_id: string }) => ({ data: (tables.memberships ?? []).filter(member => member.org_id === args.p_org_id), error: null }),
    storage: { from: () => ({ upload: state.upload, remove: state.remove, createSignedUrl: state.signed }) },
  }
}
beforeEach(() => {
  vi.stubEnv("BOOMBIGNOSE_NATIVE", "")
  vi.clearAllMocks()
  state.capability.mockReset()
  state.upload.mockResolvedValue({ error: null })
  state.remove.mockResolvedValue({ error: null })
  state.signed.mockResolvedValue({ data: { signedUrl: "https://storage.example.invalid/signed" }, error: null })
  updates = []; filters = []
  tables = {
    quotes: [{ id: recordId, org_id: state.ctx.orgId }],
    memberships: [{ org_id: state.ctx.orgId, user_id: state.ctx.userId }, { org_id: state.ctx.orgId, user_id: "10000000-0000-4000-8000-000000000005" }],
    activities: [{ id: activityId, org_id: state.ctx.orgId, done: false, record_type: "quote", record_id: recordId }],
  }
  state.client = client()
})
afterEach(() => { vi.unstubAllEnvs() })
it("saves trimmed notes under the active org and authenticated author", async () => {
  expect(await logRecordNote({ ...ref, body: "  Team context  ", author: "forged", org_id: "foreign" })).toEqual({})
  expect(tables.record_notes).toEqual([{ org_id: state.ctx.orgId, record_type: "quote", record_id: recordId, author: state.ctx.userId, body: "Team context" }])
  expect(state.capability).toHaveBeenCalledWith(state.ctx, "record:write")
})
it("blames the record, not the note, when the target id is invalid", async () => {
  expect(await logRecordNote({ ...ref, recordId: "not-an-id", body: "Context" })).toEqual({ error: "This record is not available. Reload the page and try again." })
  expect(await logRecordNote({ ...ref, body: "  " })).toEqual({ error: "Enter a note of 1 to 20,000 characters." })
  expect(tables.record_notes).toBeUndefined()
})
it("rejects missing active-workspace targets before mutation", async () => {
  tables.quotes[0].org_id = "foreign"
  await expect(logRecordNote({ ...ref, body: "Context" })).rejects.toThrow("Record not found")
  expect(tables.record_notes).toBeUndefined()
})
it("honors capability denial before writing", async () => {
  state.capability.mockImplementation(() => { throw new Error("Forbidden") })
  await expect(logRecordNote({ ...ref, body: "Context" })).rejects.toThrow("Forbidden")
  expect(tables.record_notes).toBeUndefined()
})
it("schedules for a current workspace member and rejects foreign assignees", async () => {
  const input = { ...ref, type: "meeting", dueDate: "2026-10-23", owner: "10000000-0000-4000-8000-000000000005", summary: "Scope review" }
  expect(await scheduleRecordActivity({ ...input, owner: "10000000-0000-4000-8000-000000000099" })).toHaveProperty("error")
  expect(tables.activities).toHaveLength(1)
  expect(await scheduleRecordActivity(input)).toEqual({})
  expect(tables.activities[1]).toMatchObject({ org_id: state.ctx.orgId, record_type: "quote", record_id: recordId, owner: input.owner, due_date: input.dueDate, body: input.summary })
})
it("marks only a stored activity in the active org done and scopes the update", async () => {
  expect(await completeRecordActivity(activityId)).toEqual({})
  expect(updates).toEqual([{ table: "activities", values: { done: true, completed_by: state.ctx.userId, completed_at: expect.any(String) } }])
  expect(filters).toEqual(expect.arrayContaining([
    { table: "activities", key: "org_id", value: state.ctx.orgId }, { table: "activities", key: "id", value: activityId }, { table: "activities", key: "done", value: false },
  ]))
  tables.activities[0].org_id = "foreign"
  updates = []
  expect(await completeRecordActivity(activityId)).toHaveProperty("error")
  expect(updates).toHaveLength(0)
})
function uploadForm(file: File) {
  const form = new FormData()
  form.set("recordType", "quote"); form.set("recordId", recordId); form.set("file", file)
  return form
}
it("rejects an unsupported attachment at the action boundary before storage", async () => {
  expect(await attachRecordFile(uploadForm(new File(["html"], "page.html", { type: "text/html" })))).toHaveProperty("error")
  expect(state.upload).not.toHaveBeenCalled()
  expect(state.capability).not.toHaveBeenCalled()
})
it("generates a bound private path and records upload metadata", async () => {
  const file = new File(["scope"], "scope.txt", { type: "text/plain" })
  expect(await attachRecordFile(uploadForm(file))).toEqual({})
  const attachment = tables.record_attachments[0]
  expect(attachment.path).toBe(`${state.ctx.orgId}/quote/${recordId}/${attachment.id}`)
  expect(attachment).toMatchObject({ org_id: state.ctx.orgId, uploaded_by: state.ctx.userId, filename: "scope.txt", size: 5, content_type: "text/plain" })
  expect(state.upload).toHaveBeenCalledWith(attachment.path, expect.any(File), { contentType: "text/plain", upsert: false })
})
it("cleans up uploaded objects when metadata cannot be saved", async () => {
  state.client = client("record_attachments")
  expect(await attachRecordFile(uploadForm(new File(["scope"], "scope.txt", { type: "text/plain" })))).toHaveProperty("error")
  expect(state.remove).toHaveBeenCalledWith([state.upload.mock.calls[0][0]])
})
it("signs only active-org downloads for one minute with attachment disposition", async () => {
  tables.record_attachments = [{ id: activityId, org_id: state.ctx.orgId, record_type: "quote", record_id: recordId, path: `${state.ctx.orgId}/quote/${recordId}/${activityId}`, filename: "scope.txt", size: 5, content_type: "text/plain" }]
  expect(await recordAttachmentUrl(activityId)).toEqual({ url: "https://storage.example.invalid/signed" })
  expect(state.signed).toHaveBeenCalledWith(`${state.ctx.orgId}/quote/${recordId}/${activityId}`, 60, { download: "scope.txt" })
  state.signed.mockClear()
  tables.record_attachments[0].org_id = "foreign"
  expect(await recordAttachmentUrl(activityId)).toHaveProperty("error")
  expect(state.signed).not.toHaveBeenCalled()
})

it("rejects forged or malformed timeline cursors before querying history", async () => {
  expect(await loadRecordHistoryPage({ ...ref, cursor: { at: "2026-10-23T10:00:00Z", id: "note:forged),or(org_id.neq.any)" } })).toHaveProperty("error")
  expect(await loadRecordHistoryPage({ ...ref, cursor: { at: "yesterday", id: `note:${activityId}` } })).toHaveProperty("error")
  expect(filters).toHaveLength(0)
})
it("completes activities and signs attachments whose ids lack RFC 9562 version bits", async () => {
  const [seedActivity, seedAttachment] = ["40000000-0000-0000-0000-000000000001", "40000000-0000-0000-0000-000000000002"]
  tables.activities[0].id = seedActivity
  tables.record_attachments = [{ id: seedAttachment, org_id: state.ctx.orgId, record_type: "quote", record_id: recordId, path: `${state.ctx.orgId}/quote/${recordId}/${seedAttachment}`, filename: "scope.txt", size: 5, content_type: "text/plain" }]
  expect(await completeRecordActivity(seedActivity)).toEqual({})
  expect(filters).toEqual(expect.arrayContaining([{ table: "activities", key: "id", value: seedActivity }]))
  expect(await recordAttachmentUrl(seedAttachment)).toEqual({ url: "https://storage.example.invalid/signed" })
})

const otherMember = "10000000-0000-4000-8000-000000000005"
const foreignMember = "10000000-0000-4000-8000-000000000099"
const next = { type: "meeting", dueDate: "2026-11-02", owner: otherMember, summary: "Review the revised scope" }
const openActivity = () => tables.activities[0]
describe("completing an activity with a note and a next activity", () => {
  it("appends the note to the body in the same update that marks it done", async () => {
    Object.assign(openActivity(), { type: "call", body: "Discuss scope" })
    expect(await completeRecordActivity({ id: activityId, feedback: "  Agreed on Friday  " })).toEqual({})
    expect(updates).toEqual([{ table: "activities", values: { done: true, completed_by: state.ctx.userId, completed_at: expect.any(String), body: "Discuss scope\n\nNote: Agreed on Friday" } }])
    expect(filters).toEqual(expect.arrayContaining([{ table: "activities", key: "org_id", value: state.ctx.orgId }, { table: "activities", key: "id", value: activityId }, { table: "activities", key: "done", value: false }]))
    expect(openActivity()).toMatchObject({ done: true, body: "Discuss scope\n\nNote: Agreed on Friday" })
  })
  it("uses the note alone for an activity without a summary and ignores a blank note", async () => {
    Object.assign(openActivity(), { body: null })
    expect(await completeRecordActivity({ id: activityId, feedback: "Left a voicemail" })).toEqual({})
    expect(openActivity().body).toBe("Note: Left a voicemail")
    tables.activities.push({ id: "10000000-0000-4000-8000-000000000006", org_id: state.ctx.orgId, done: false, body: "Untouched" })
    expect(await completeRecordActivity({ id: "10000000-0000-4000-8000-000000000006", feedback: "   " })).toEqual({})
    expect(tables.activities[1].body).toBe("Untouched")
  })
  it("rejects an oversized note or an incomplete next activity before changing anything", async () => {
    expect(await completeRecordActivity({ id: activityId, feedback: "x".repeat(2001) })).toHaveProperty("error")
    expect(await completeRecordActivity({ id: activityId, next: { ...next, summary: " " } })).toHaveProperty("error")
    expect(updates).toHaveLength(0)
    expect(await completeRecordActivity({ id: activityId, feedback: "x".repeat(2000) })).toEqual({})
  })
  it("schedules the next activity on the same record and audits it", async () => {
    expect(await completeRecordActivity({ id: activityId, next })).toEqual({})
    expect(tables.activities).toHaveLength(2)
    expect(openActivity().done).toBe(true)
    expect(tables.activities[1]).toMatchObject({ org_id: state.ctx.orgId, record_type: "quote", record_id: recordId, owner: otherMember, type: "meeting", due_date: "2026-11-02", body: "Review the revised scope" })
    expect(writeAudit).toHaveBeenCalledWith(state.ctx, expect.objectContaining({ entity: "quote", entityId: recordId, action: "activity_scheduled" }))
  })
  it("rejects a foreign next assignee before completing the activity", async () => {
    expect(await completeRecordActivity({ id: activityId, feedback: "Done", next: { ...next, owner: foreignMember } })).toEqual({ error: "Choose an assignee from the active workspace." })
    expect(openActivity().done).toBe(false)
    expect(updates).toHaveLength(0)
    expect(tables.activities).toHaveLength(1)
  })
  it("refuses a next activity for an activity that is not linked to a record, before completing it", async () => {
    Object.assign(openActivity(), { record_type: null, record_id: null })
    expect(await completeRecordActivity({ id: activityId, next })).toHaveProperty("error")
    expect(openActivity().done).toBe(false)
    expect(await completeRecordActivity({ id: activityId, feedback: "Done" })).toEqual({})
  })
  it("reports an already completed activity and schedules nothing", async () => {
    openActivity().done = true
    expect(await completeRecordActivity({ id: activityId, feedback: "Again", next })).toEqual({ error: "This activity was already completed or removed." })
    expect(tables.activities).toHaveLength(1)
    expect(openActivity().body).toBeUndefined()
    expect(writeAudit).not.toHaveBeenCalled()
  })
  it("keeps the completion and says so when the next activity cannot be saved", async () => {
    state.client = client(undefined, "activities")
    expect(await completeRecordActivity({ id: activityId, next })).toEqual({ error: "Activity completed, but the next activity could not be scheduled." })
    expect(openActivity().done).toBe(true)
    expect(writeAudit).not.toHaveBeenCalled()
  })
})
describe("editing and cancelling a planned activity", () => {
  const edit = { id: activityId, type: "meeting", dueDate: "2026-11-05", owner: otherMember, summary: "  Moved to the client site  " }
  beforeEach(() => { Object.assign(openActivity(), { type: "follow_up", body: "Chase reply", due_date: "2026-10-30", owner: state.ctx.userId }) })
  it("edits only an open activity in the active org and audits the change on its record", async () => {
    expect(await updateRecordActivity(edit)).toEqual({})
    expect(openActivity()).toMatchObject({ type: "meeting", due_date: "2026-11-05", owner: otherMember, body: "Moved to the client site", done: false })
    expect(filters).toEqual(expect.arrayContaining([{ table: "activities", key: "org_id", value: state.ctx.orgId }, { table: "activities", key: "id", value: activityId }, { table: "activities", key: "done", value: false }]))
    expect(writeAudit).toHaveBeenCalledWith(state.ctx, expect.objectContaining({ entity: "quote", entityId: recordId, action: "activity_updated" }))
  })
  it("refuses to edit a completed, foreign or foreign-assigned activity", async () => {
    expect(await updateRecordActivity({ ...edit, owner: foreignMember })).toEqual({ error: "Choose an assignee from the active workspace." })
    openActivity().done = true
    expect(await updateRecordActivity(edit)).toEqual({ error: "This activity was already completed or removed." })
    Object.assign(openActivity(), { done: false, org_id: "foreign" })
    expect(await updateRecordActivity(edit)).toHaveProperty("error")
    expect(openActivity()).toMatchObject({ type: "follow_up", body: "Chase reply" })
    expect(writeAudit).not.toHaveBeenCalled()
  })
  it("cancels only an open activity in the active org and audits it", async () => {
    expect(await cancelRecordActivity(activityId)).toEqual({})
    expect(tables.activities).toHaveLength(0)
    expect(filters).toEqual(expect.arrayContaining([{ table: "activities", key: "org_id", value: state.ctx.orgId }, { table: "activities", key: "id", value: activityId }, { table: "activities", key: "done", value: false }]))
    expect(writeAudit).toHaveBeenCalledWith(state.ctx, expect.objectContaining({ entity: "quote", entityId: recordId, action: "activity_cancelled", summary: "Cancelled follow up" }))
  })
  it("will not cancel a completed or foreign activity", async () => {
    openActivity().done = true
    expect(await cancelRecordActivity(activityId)).toEqual({ error: "This activity was already completed or removed." })
    Object.assign(openActivity(), { done: false, org_id: "foreign" })
    expect(await cancelRecordActivity(activityId)).toHaveProperty("error")
    expect(tables.activities).toHaveLength(1)
    expect(writeAudit).not.toHaveBeenCalled()
  })
  it("honors capability denial before editing or cancelling", async () => {
    state.capability.mockImplementation(() => { throw new Error("Forbidden") })
    await expect(updateRecordActivity(edit)).rejects.toThrow("Forbidden")
    await expect(cancelRecordActivity(activityId)).rejects.toThrow("Forbidden")
    await expect(completeRecordActivity({ id: activityId, feedback: "x" })).rejects.toThrow("Forbidden")
    expect(openActivity()).toMatchObject({ done: false, body: "Chase reply" })
    expect(tables.activities).toHaveLength(1)
  })
})
