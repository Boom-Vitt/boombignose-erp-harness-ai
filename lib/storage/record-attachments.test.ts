import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { mkdtemp, readFile, readdir, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"

const state = vi.hoisted(() => ({
  client: {} as unknown,
  ctx: { orgId: "10000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000002", role: "member", email: null, orgName: "Test" },
  capability: vi.fn(),
  denied: false,
}))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => { if (state.denied) throw new Error("Forbidden"); return state.ctx },
  requireCapability: state.capability,
  getVerifiedApiContext: async () => state.denied ? { response: Response.json({ error: "Unauthorized" }, { status: 401 }) } : { ctx: state.ctx },
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { attachRecordFile, recordAttachmentUrl } from "@/lib/record-history/actions"
import { GET } from "@/app/api/attachments/[id]/route"
import { NativeAttachmentStore } from "./native-attachments"

const recordId = "10000000-0000-4000-8000-000000000003"
let temporary: string
let root: string
let tables: Record<string, Record<string, unknown>[]>
const bytes = Buffer.from("ใบเสร็จ receipt\nสินค้า,125.50\n")
function form(name = "ใบเสร็จ.txt") {
  const data = new FormData()
  data.set("recordType", "quote"); data.set("recordId", recordId)
  data.set("file", new File([bytes], name, { type: "text/plain" }))
  return data
}
async function download(id: string) {
  return GET(new Request(`http://localhost/api/attachments/${id}`), { params: Promise.resolve({ id }) })
}
beforeEach(async () => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  state.denied = false
  state.capability.mockReset()
  temporary = await mkdtemp(join(await realpath(tmpdir()), "bbn-attachment-"))
  root = join(temporary, "attachments")
  vi.stubEnv("BOOMBIGNOSE_NATIVE", "1")
  vi.stubEnv("BOOMBIGNOSE_FILES_ROOT", root)
  tables = { quotes: [{ id: recordId, org_id: state.ctx.orgId, total: 125.5, status: "draft" }], activities: [{ id: "unchanged", done: false }] }
  // No Storage API exists in the native runtime. Accidental fallback fails this boundary.
  state.client = databaseFixture(tables)
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(temporary, { recursive: true, force: true })
})

describe("native record attachment consumers", () => {
  it("uploads exact durable bytes and downloads through a private reauthorized endpoint, never a filesystem URL", async () => {
    const financialState = JSON.stringify(tables.quotes)
    expect(await attachRecordFile(form())).toEqual({})
    const attachment = tables.record_attachments[0]
    const id = String(attachment.id)
    expect(attachment).toMatchObject({ org_id: state.ctx.orgId, record_type: "quote", record_id: recordId, uploaded_by: state.ctx.userId, filename: "ใบเสร็จ.txt", size: bytes.length, content_type: "text/plain" })
    expect(attachment.path).toBe(`${state.ctx.orgId}/quote/${recordId}/${id}`)
    expect(await readFile(join(root, id))).toEqual(bytes)
    expect(await new NativeAttachmentStore(root).read(id, bytes.length)).toEqual(bytes)
    expect(await recordAttachmentUrl(id)).toEqual({ url: `/api/attachments/${id}` })
    const response = await download(id)
    expect(response.status).toBe(200)
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes)
    expect(response.headers.get("content-type")).toBe("text/plain")
    expect(response.headers.get("cache-control")).toContain("no-store")
    expect(response.headers.get("x-content-type-options")).toBe("nosniff")
    expect(response.headers.get("content-disposition")).toContain("attachment;")
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''")
    expect(response.headers.get("content-disposition")).not.toContain(root)
    expect(JSON.stringify(tables.quotes)).toBe(financialState)
    expect(tables.activities).toEqual([{ id: "unchanged", done: false }])
  })
  it("reauthorizes after link creation for foreign org, deleted record and lost membership", async () => {
    await attachRecordFile(form())
    const attachment = tables.record_attachments[0]
    const id = String(attachment.id)
    expect(await recordAttachmentUrl(id)).toHaveProperty("url")
    attachment.org_id = "10000000-0000-4000-8000-000000000099"
    expect((await download(id)).status).toBe(404)
    expect(await recordAttachmentUrl(id)).toHaveProperty("error")
    attachment.org_id = state.ctx.orgId
    tables.quotes[0].org_id = "10000000-0000-4000-8000-000000000099"
    expect((await download(id)).status).toBe(404)
    expect(await recordAttachmentUrl(id)).toHaveProperty("error")
    tables.quotes[0].org_id = state.ctx.orgId
    state.denied = true
    const denied = await download(id)
    expect(denied.status).toBe(401)
    expect(denied.headers.get("cache-control")).toContain("no-store")
    expect(await readFile(join(root, id))).toEqual(bytes)
  })
  it("rejects forged metadata paths and arbitrary download ids without disclosing local bytes", async () => {
    await attachRecordFile(form())
    const attachment = tables.record_attachments[0]
    for (const path of ["../outside", "https://example.invalid/file", join(root, String(attachment.id))]) {
      attachment.path = path
      const response = await download(String(attachment.id))
      expect(response.status).toBe(404)
      expect(await response.text()).not.toContain(root)
    }
    expect((await download("../outside")).status).toBe(404)
  })
  it("cleans only the new orphan after a rejected metadata insert and preserves old evidence", async () => {
    await attachRecordFile(form())
    const retainedId = String(tables.record_attachments[0].id)
    const fixture = databaseFixture(tables)
    state.client = { from(table: string) {
      if (table === "record_attachments") return { insert: async () => ({ error: { message: "Rejected metadata", code: "23514" } }) }
      return fixture.from(table)
    } }
    expect(await attachRecordFile(form("second.txt"))).toHaveProperty("error")
    expect(await readdir(root)).toEqual([retainedId])
    expect(await readFile(join(root, retainedId))).toEqual(bytes)
    expect(tables.record_attachments).toHaveLength(1)
  })
  it("retains bytes on an uncertain metadata transport exception rather than erasing potentially committed evidence", async () => {
    const fixture = databaseFixture(tables)
    state.client = { from(table: string) {
      if (table === "record_attachments") return { insert: async () => { throw new Error("Connection lost after submission") } }
      return fixture.from(table)
    } }
    expect(await attachRecordFile(form())).toHaveProperty("error")
    const objects = await readdir(root)
    expect(objects).toHaveLength(1)
    expect(await readFile(join(root, objects[0]))).toEqual(bytes)
  })
  it("retains potentially committed bytes when Supabase reports a transport failure without a database code", async () => {
    const fixture = databaseFixture(tables)
    state.client = { from(table: string) {
      if (table === "record_attachments") return { insert: async () => ({ error: { message: "Fetch failed", code: "" } }) }
      return fixture.from(table)
    } }
    expect(await attachRecordFile(form())).toHaveProperty("error")
    const objects = await readdir(root)
    expect(objects).toHaveLength(1)
    expect(await readFile(join(root, objects[0]))).toEqual(bytes)
  })
  it("rejects non-writers, invisible records, mismatched content and missing native configuration without financial mutation", async () => {
    const before = JSON.stringify(tables)
    state.capability.mockImplementationOnce(() => { throw new Error("Forbidden") })
    await expect(attachRecordFile(form())).rejects.toThrow("Forbidden")
    tables.quotes[0].org_id = "foreign"
    await expect(attachRecordFile(form())).rejects.toThrow("Record not found")
    tables.quotes[0].org_id = state.ctx.orgId
    const forged = form()
    forged.set("file", new File(["not png"], "bill.png", { type: "image/png" }))
    expect(await attachRecordFile(forged)).toHaveProperty("error")
    vi.stubEnv("BOOMBIGNOSE_FILES_ROOT", "")
    expect(await attachRecordFile(form())).toHaveProperty("error")
    expect(JSON.stringify(tables)).toBe(before)
    expect(await readdir(temporary)).toEqual([])
  })
})
