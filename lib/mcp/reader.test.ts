import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { z } from "zod"
import { capabilitiesFor } from "@/lib/permissions"
import { createSupabaseDataLayer } from "./data.mjs"
import { createErpMcpServer } from "./erp-server.mjs"
import { ERP_DATA_ENTITIES, readerTextSlice, runErpDataTool } from "./reader.mjs"

const ORG = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const ID = "33333333-3333-4333-8333-333333333333"
const ATTACHMENT = "44444444-4444-4444-8444-444444444444"
const USER = "55555555-5555-4555-8555-555555555555"
const sha = (text: string) => createHash("sha256").update(text).digest("hex")
type Row = Record<string, unknown>
type Context = { erpOrgId: string; trustedCapabilities: string[]; dataLayer: object }
const Field = z.object({ key: z.string(), kind: z.string(), unit: z.string().optional() }).passthrough()
const TextPointer = z.object({ preview: z.boolean(), sha256: z.string(), total_length: z.number(), read: z.object({ tool: z.string(), entity: z.string(), record: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])), field: z.string(), offset: z.number(), expected_sha256: z.string() }) }).passthrough()
const Item = z.object({ key: z.string().optional(), available: z.boolean().optional(), fields: z.array(Field).default([]), exclusions: z.record(z.string(), z.string()).default({}), _text: z.record(z.string(), TextPointer).optional() }).passthrough()
const Output = z.object({ items: z.array(Item).default([]), total: z.number().optional(), total_entities: z.number().optional(), has_more: z.boolean(), text: z.string().nullable().optional(), next_offset: z.number().optional(), sha256: z.string().nullable().optional(), text_sha256: z.string().nullable().optional(), entity: z.object({ fields: z.array(Field), financialAuthority: z.string().optional() }).passthrough().optional() }).passthrough()
function row(key: string, values: Row) {
  const definition = ERP_DATA_ENTITIES.find(entity => entity.key === key)!
  return Object.fromEntries([...definition.fields.map(field => [field.key, null]), ...Object.entries(values)])
}
async function read(name: string, args: Record<string, unknown>, ctx: Context) {
  return Output.parse(await runErpDataTool(name, args, ctx))
}
type DbRows = { data: Row[]; count: number; error: null }
type QueryBuilder = {
  select: (columns: string) => QueryBuilder
  eq: (key: string, value: unknown) => QueryBuilder
  is: (key: string, value: unknown) => QueryBuilder
  ilike: (key: string, pattern: string) => QueryBuilder
  order: (key: string) => QueryBuilder
  range: (start: number, end: number) => QueryBuilder
  maybeSingle: () => Promise<{ data: Row | null; error: null }>
  then: (resolve: (result: DbRows) => unknown) => void
}

// Session-visible PostgREST fixture: tests exercise results and private storage,
// not source text. Real PostgreSQL RLS is verified by the parent integration run.
function fixture(tables: Record<string, Row[]> = {}, options: { user?: string; staff?: boolean } = {}) {
  const requests: Array<{ table: string; columns: string; predicates: Array<[string, unknown]> }> = []
  const downloaded = vi.fn(async () => ({ data: new Blob(["private,retained\nภาษาไทย 😀"]), error: null }))
  function query(table: string, source = tables[table] ?? []): QueryBuilder {
    const state = { table, columns: "", predicates: [] as Array<[string, unknown]> }
    requests.push(state)
    const conditions: Array<(value: Row) => boolean> = [], orders: string[] = []
    let from = 0, to = Number.MAX_SAFE_INTEGER
    function execute(): DbRows {
      const visible = source.filter(value => {
        if (table === "expense_claims" && !options.staff && value.employee !== options.user) return false
        if (table === "expense_lines" && !options.staff && !(tables.expense_claims ?? []).some(claim => claim.id === value.claim_id && claim.org_id === value.org_id && claim.employee === options.user)) return false
        return conditions.every(condition => condition(value))
      }).sort((left, right) => {
        for (const key of orders) {
          const a = String(left[key] ?? ""), b = String(right[key] ?? "")
          if (a < b) return -1
          if (a > b) return 1
        }
        return 0
      })
      return { data: visible.slice(from, to + 1).map(value => Object.fromEntries(state.columns.split(",").map(key => [key, value[key]]))), count: visible.length, error: null }
    }
    const builder: QueryBuilder = {
      select(columns) { state.columns = columns; return builder },
      eq(key, value) { state.predicates.push([key, value]); conditions.push(row => row[key] === value); return builder },
      is(key, value) { return builder.eq(key, value) },
      ilike(key, pattern) {
        const literal = pattern.slice(1, -1).replace(/\\([\\%_])/g, "$1").toLowerCase()
        conditions.push(row => String(row[key] ?? "").toLowerCase().includes(literal)); return builder
      },
      order(key) { orders.push(key); return builder },
      range(start, end) { from = start; to = end; return builder },
      async maybeSingle() { return { data: execute().data[0] ?? null, error: null } },
      then(resolve) { resolve(execute()) },
    }
    return builder
  }
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: options.user ?? USER } }, error: null }) },
    from: (table: string) => query(table),
    rpc: (name: string, args: Record<string, string>) => {
      if (name === "list_finance_lock_reopen_requests") return Promise.resolve({ data: tables.pending_locks ?? [], error: null })
      if (name === "assistant_workspace_profiles") {
        const members = (tables.memberships ?? []).filter(member => member.org_id === args.p_org_id && (options.staff || member.user_id === options.user))
        return query("profiles", (tables.profiles ?? []).filter(profile => members.some(member => member.user_id === profile.id)))
      }
      throw new Error("Unexpected RPC")
    },
    storage: { from: () => ({ download: downloaded }) },
  }
  const dataLayer = createSupabaseDataLayer(client)
  const ctx = { erpOrgId: ORG, trustedCapabilities: capabilitiesFor("owner"), dataLayer }
  return { client, dataLayer, ctx, requests, downloaded }
}

describe("authorized business catalog", () => {
  it("pages every actual table and explicitly classifies internal exclusions", async () => {
    const { ctx } = fixture(), keys: string[] = []
    for (let offset = 0; offset < 80; offset += 9) {
      const result = await read("erp_data_catalog", { offset, limit: 9 }, ctx)
      keys.push(...result.items.map(entity => entity.key!))
      expect(result.total_entities).toBe(80)
      expect(result.total).toBe(80)
      expect(result.has_more).toBe(offset + result.items.length < 80)
    }
    expect(new Set(keys).size).toBe(80)
    for (const entity of ERP_DATA_ENTITIES.filter(entity => "readable" in entity && entity.readable === false)) {
      const result = await read("erp_data_catalog", { entity: entity.key }, ctx)
      expect(result.items[0]).toMatchObject({ available: false, fields: [], reason: expect.any(String), excludedFields: expect.any(Array) })
    }
  })
  it("keeps business PII/notes but excludes actual bearer/config fields", async () => {
    const { ctx } = fixture()
    const clients = await read("erp_data_catalog", { entity: "clients" }, ctx)
    expect(clients.items[0].fields.map(field => field.key)).toEqual(expect.arrayContaining(["notes", "billing_address", "tax_id"]))
    expect(clients.items[0].fields.some(field => field.key === "portal_token")).toBe(false)
    expect(clients.items[0].exclusions.portal_token).toMatch(/bearer/i)
    const connections = await read("erp_data_catalog", { entity: "accounting_connections" }, ctx)
    expect(connections.items[0].fields.map(field => field.key)).toContain("provider")
    expect(connections.items[0].fields.some(field => field.key === "config")).toBe(false)
    expect((await read("erp_data_catalog", { search: "ผู้ขาย" }, ctx)).items.some(entity => entity.key === "vendors")).toBe(true)
  })
  it("does not mistake write/manage permissions for broad read gates", async () => {
    const { ctx } = fixture(), member = { ...ctx, trustedCapabilities: capabilitiesFor("member") }
    for (const key of ["products", "purchase_orders", "warehouses", "automation_templates", "subscriptions", "invoices"]) expect((await read("erp_data_catalog", { entity: key }, member)).items[0].available).toBe(true)
    for (const key of ["bank_lines", "journal_lines", "audit_log", "accounting_connections", "member_cost_rates", "network_devices", "lead_submissions"]) {
      expect((await read("erp_data_catalog", { entity: key }, member)).items[0].available).toBe(false)
      await expect(read("erp_data_read", { entity: key }, member)).rejects.toThrow(/requires/i)
    }
    const accountant = { ...ctx, trustedCapabilities: capabilitiesFor("accountant") }
    expect((await read("erp_data_catalog", { entity: "journal_lines" }, accountant)).items[0].available).toBe(true)
    expect((await read("erp_data_catalog", { entity: "member_cost_rates" }, accountant)).items[0].available).toBe(false)
  })
})

describe("session and current-workspace boundaries", () => {
  it("fails before opening a source without verified capabilities, explicit org or session injection", async () => {
    const load = vi.fn(), source = { readBusinessData: vi.fn() }
    for (const options of [{ erpOrgId: ORG, dataLayer: source }, { trustedCapabilities: capabilitiesFor("owner"), dataLayer: source }, { erpOrgId: ORG, trustedCapabilities: capabilitiesFor("owner"), execFileSyncImpl: load }]) {
      const server = createErpMcpServer({ ...options, onLog: () => {} })
      const listed = z.object({ result: z.object({ tools: z.array(z.object({ name: z.string() })) }) }).parse(await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" }))
      expect(listed.result.tools.some(tool => tool.name === "erp_data_read")).toBe(false)
      const response = z.object({ result: z.object({ isError: z.boolean() }) }).parse(await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "erp_data_catalog", arguments: {} } }))
      expect(response.result.isError).toBe(true)
    }
    expect(load).not.toHaveBeenCalled()
    expect(source.readBusinessData).not.toHaveBeenCalled()
  })

  it("hashes the visible redacted text and marks it incomplete instead of certifying a hidden original as the model read", async () => {
    const secret = "SYNTHETIC_RUNTIME_SECRET_FOR_REDACTION"
    const original = `ส่งมอบเชียงราย\n${secret}\nยืนยันวันศุกร์`
    const { ctx } = fixture({ record_notes: [row("record_notes", { id: ID, org_id: ORG, body: original })] })
    const server = createErpMcpServer({ erpOrgId: ORG, trustedCapabilities: capabilitiesFor("owner"), dataLayer: ctx.dataLayer, secrets: [secret], onLog: () => {} })
    const reply = z.object({ result: z.object({ content: z.array(z.object({ text: z.string() })), isError: z.boolean().optional() }) }).parse(await server.handleMessage({
      jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "erp_data_text", arguments: { entity: "record_notes", record: { id: ID }, field: "body" } },
    }))
    expect(reply.result.isError).toBeUndefined()
    expect(reply.result.content[0].text).not.toContain(secret)
    const source = z.object({ text: z.string(), text_sha256: z.string(), original_text_sha256: z.string().optional(), redacted: z.boolean().optional(), partial: z.boolean() }).parse(JSON.parse(reply.result.content[0].text))
    expect(source.text_sha256).toBe(sha(source.text))
    expect(source.original_text_sha256).toBe(sha(original))
    expect(source).toMatchObject({ redacted: true, partial: true })
  })
  it("cannot change current org through arguments/filters despite multi-workspace membership", async () => {
    const { ctx, requests } = fixture({ clients: [row("clients", { id: "b", org_id: OTHER, name: "foreign" }), row("clients", { id: "a", org_id: ORG, name: "current" })] })
    const result = await read("erp_data_read", { entity: "clients", fields: ["name"] }, ctx)
    expect(result.items).toEqual([{ id: "a", name: "current", fields: [], exclusions: {} }])
    expect(result.total).toBe(1)
    await expect(read("erp_data_read", { entity: "clients", filters: { org_id: OTHER } }, ctx)).rejects.toThrow(/current organization/i)
    await expect(read("erp_data_read", { entity: "clients", org_id: OTHER }, ctx)).rejects.toThrow(/arguments/i)
    expect(requests[0].predicates).toContainEqual(["org_id", ORG])
  })
  it("binds profiles to current-org visible memberships rather than shared-org visibility alone", async () => {
    const { ctx } = fixture({ memberships: [{ org_id: ORG, user_id: USER }, { org_id: OTHER, user_id: ID }], profiles: [row("profiles", { id: USER, full_name: "current team" }), row("profiles", { id: ID, full_name: "other team" })] }, { staff: true })
    const result = await read("erp_data_read", { entity: "profiles", fields: ["full_name"] }, ctx)
    expect(result.items).toEqual([{ id: USER, full_name: "current team", fields: [], exclusions: {} }])
  })
  it("preserves child expense visibility/counts imposed by session RLS", async () => {
    const { ctx } = fixture({ expense_claims: [{ id: ID, org_id: ORG, employee: USER }, { id: ATTACHMENT, org_id: ORG, employee: ID }], expense_lines: [row("expense_lines", { id: "own", org_id: ORG, claim_id: ID, description: "own meal" }), row("expense_lines", { id: "private", org_id: ORG, claim_id: ATTACHMENT, description: "other employee" })] }, { user: USER })
    const result = await read("erp_data_read", { entity: "expense_lines", fields: ["description"] }, { ...ctx, trustedCapabilities: capabilitiesFor("member") })
    expect(result.items).toEqual([{ id: "own", description: "own meal", fields: [], exclusions: {} }])
    expect(result.total).toBe(1)
  })
  it("keeps saved views private to the session actor and projects only known view configuration", async () => {
    const { ctx } = fixture({ saved_views: [
      row("saved_views", { id: ID, org_id: ORG, user_id: USER, name: "Mine", config: { q: "Acme", status: "sent", api_token: "DO_NOT_RETURN" } }),
      row("saved_views", { id: ATTACHMENT, org_id: ORG, user_id: ID, name: "Other person's view", config: { q: "private" } }),
    ] }, { user: USER })
    const result = await read("erp_data_read", { entity: "saved_views", fields: ["name", "config"] }, ctx)
    expect(result.total).toBe(1)
    expect(result.items[0]).toMatchObject({ id: ID, name: "Mine" })
    const pointer = result.items[0]._text!.config.read
    const text = await read("erp_data_text", { entity: pointer.entity, record: pointer.record, field: pointer.field }, ctx)
    expect(JSON.parse(text.text!)).toEqual({ q: "Acme", status: "sent" })
    expect(JSON.stringify([result, text])).not.toContain("DO_NOT_RETURN")
  })
})

describe("allowlisted complete reads and explicit text paging", () => {
  it("uses stable unique ordering, exact counts and literal search without exposing secrets", async () => {
    const { ctx, requests } = fixture({ clients: [row("clients", { id: "c", org_id: ORG, name: "100%_literal", portal_token: "DO_NOT_RETURN" }), row("clients", { id: "a", org_id: ORG, name: "100%_literal" }), row("clients", { id: "b", org_id: ORG, name: "ordinary" })] })
    const args = { entity: "clients", fields: ["name"], search: "%_", search_field: "name", limit: 1 }
    const first = await read("erp_data_read", args, ctx), second = await read("erp_data_read", { ...args, offset: 1 }, ctx)
    expect(first).toMatchObject({ items: [{ id: "a", name: "100%_literal" }], total: 2, has_more: true })
    expect(second).toMatchObject({ items: [{ id: "c", name: "100%_literal" }], total: 2, has_more: false })
    expect(requests.every(request => request.columns === "id,name")).toBe(true)
    expect(JSON.stringify([first, second])).not.toContain("DO_NOT_RETURN")
    for (const extra of [{ fields: ["portal_token"] }, { fields: ["id,*"] }, { filters: { "org_id.or.id": OTHER } }, { search_field: "name),org_id.eq.other", search: "x" }, { limit: 101 }, { offset: 1_000_001 }]) await expect(read("erp_data_read", { entity: "clients", ...extra }, ctx)).rejects.toThrow()
  })
  it("marks long Thai/emoji notes as previews and reads every character including the tail", async () => {
    const text = "ต้นเรื่อง🙂\n" + "รายละเอียดภาษาไทย mixed 😀\n".repeat(700) + "TAIL-ยอดท้ายเอกสาร🧾"
    const { ctx } = fixture({ record_notes: [row("record_notes", { id: ID, org_id: ORG, body: text })] })
    const result = await read("erp_data_read", { entity: "record_notes", fields: ["body"] }, ctx)
    expect(result.items[0].body).not.toBe(text)
    const info = result.items[0]._text!.body
    expect(info).toMatchObject({ preview: true, sha256: sha(text), total_length: Array.from(text).length })
    const pointer = info.read
    let offset = 0, assembled = "", pages = 0
    while (true) {
      const chunk = await read("erp_data_text", { entity: pointer.entity, record: pointer.record, field: pointer.field, expected_sha256: pointer.expected_sha256, offset, length: 317 }, ctx)
      expect(chunk.sha256).toBe(sha(text))
      expect(chunk.text_sha256).toBe(sha(chunk.text!))
      expect(chunk.text).not.toMatch(/[\uD800-\uDBFF]$/)
      assembled += chunk.text; pages++
      if (!chunk.has_more) break
      expect(chunk.next_offset).toBeGreaterThan(offset)
      offset = chunk.next_offset!
    }
    expect(pages).toBeGreaterThan(20)
    expect(assembled).toBe(text)
    await expect(read("erp_data_text", { entity: "record_notes", record: { id: ID }, field: "body", expected_sha256: sha("stale") }, ctx)).rejects.toThrow(/changed/i)
    await expect(read("erp_data_text", { entity: "record_notes", record: { id: ID }, field: "body", offset: Array.from(text).length + 1 }, ctx)).rejects.toThrow(/exceeds/i)
  })
  it("keeps exact satang and distinguishes raw invoice rows from settlement snapshots", async () => {
    const { ctx } = fixture({ invoices: [row("invoices", { id: ID, org_id: ORG, amount_satang: "9007199254740991", status: "sent" })] })
    const result = await read("erp_data_read", { entity: "invoices", fields: ["amount_satang", "status"] }, ctx)
    expect(result.items[0].amount_satang).toBe(Number.MAX_SAFE_INTEGER)
    expect(result.entity!.fields.find(field => field.key === "amount_satang")).toMatchObject({ kind: "money-in-satang", unit: "satang" })
    expect(result.entity!.financialAuthority).toMatch(/list_invoices/)
    expect(result.summary).toBeUndefined()
  })
  it("rejects invalid text bounds and reads empty text honestly", () => {
    expect(readerTextSlice("", 0, 10)).toMatchObject({ text: "", total_length: 0, next_offset: 0, has_more: false, partial: false })
    for (const [offset, length] of [[-1, 1], [0, 0], [0, 2049], [0.5, 2], [NaN, 2]]) expect(() => readerTextSlice("😀ไทย", offset, length)).toThrow()
    expect(readerTextSlice("a😀ข", 1, 1)).toMatchObject({ text: "😀", offset: 1, next_offset: 2, total_length: 3 })
  })
})

describe("private retained attachment content", () => {
  function attachments(path = `${ORG}/client/${ID}/${ATTACHMENT}`) {
    const text = "private,retained\nภาษาไทย 😀"
    return fixture({ clients: [{ id: ID, org_id: ORG }], record_attachments: [{ id: ATTACHMENT, org_id: ORG, record_type: "client", record_id: ID, path, filename: "private.csv", size: Buffer.byteLength(text), content_type: "text/csv" }] })
  }
  it("reauthorizes metadata and parent before real content extraction and retains warnings", async () => {
    const { client, ctx, downloaded } = attachments(), retained = "real extracted text ไทย 😀"
    const readAttachmentText = vi.fn(async () => ({ text: retained, filename: "private.csv", contentType: "text/csv", extraction: { method: "actual-test-extractor", partial: true, limitations: ["Only the supported original page was extracted."] } }))
    const dataLayer = createSupabaseDataLayer(client, { readAttachmentText })
    const result = await read("erp_data_text", { entity: "record_attachments", record: { id: ATTACHMENT }, field: "content" }, { ...ctx, dataLayer })
    expect(readAttachmentText).toHaveBeenCalledWith({ orgId: ORG, attachmentId: ATTACHMENT })
    expect(result).toMatchObject({ text: retained, sha256: sha(retained), partial: true, extraction: { partial: true } })
    expect(downloaded).not.toHaveBeenCalled()
    expect(result.href).toBeUndefined()
    expect(result.path).toBeUndefined()
  })
  it("does not advertise or call unsupported binary extraction", async () => {
    const { client, ctx } = fixture({
      clients: [{ id: ID, org_id: ORG }],
      record_attachments: [{ id: ATTACHMENT, org_id: ORG, record_type: "client", record_id: ID, path: `${ORG}/client/${ID}/${ATTACHMENT}`, filename: "scan.pdf", size: 50, content_type: "application/pdf" }],
    })
    const readAttachmentText = vi.fn()
    const dataLayer = createSupabaseDataLayer(client, { readAttachmentText, attachmentTextFormats: ["text/plain", "text/csv", "image/png"] })
    const scoped = { ...ctx, dataLayer }
    const catalog = await read("erp_data_catalog", { entity: "record_attachments" }, scoped)
    expect(catalog.items[0]).toMatchObject({ attachment_content: { formats: ["text/plain", "text/csv", "image/png"] } })
    await expect(read("erp_data_text", { entity: "record_attachments", record: { id: ATTACHMENT }, field: "content" }, scoped)).rejects.toThrow(/not supported/i)
    expect(readAttachmentText).not.toHaveBeenCalled()
  })
  it("never opens forged-path or absent-parent content", async () => {
    const readAttachmentText = vi.fn(), invalid = attachments(`${OTHER}/client/${ID}/${ATTACHMENT}`)
    const missing = fixture({ record_attachments: [{ id: ATTACHMENT, org_id: ORG, record_type: "client", record_id: ID, path: `${ORG}/client/${ID}/${ATTACHMENT}`, filename: "private.csv", size: 5, content_type: "text/csv" }] })
    for (const value of [invalid, missing]) {
      const dataLayer = createSupabaseDataLayer(value.client, { readAttachmentText })
      await expect(read("erp_data_text", { entity: "record_attachments", record: { id: ATTACHMENT }, field: "content" }, { ...value.ctx, dataLayer })).rejects.toThrow(/unavailable|authorized/i)
      expect(value.downloaded).not.toHaveBeenCalled()
    }
    expect(readAttachmentText).not.toHaveBeenCalled()
  })
})
