import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { AssistantAnswerView } from "@/components/assistant/answer"

vi.mock("server-only", () => ({}))

import { chatLocal, erpToolRunner } from "./assistant-chat"
import { createErpMcpServer } from "@/lib/mcp/erp-server.mjs"
import { createFakeDataLayer } from "@/lib/mcp/data.mjs"
import { answerText, parseAssistantAnswer, referenceEvidence, toolEvidence, type AssistantAnswer, type AssistantSource } from "./assistant-evidence"

const MINE = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"
const CLIENT = "33333333-3333-4333-8333-333333333333"
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const localCheckpoint = () => json({ details: { format: "gguf" }, capabilities: ["completion", "tools", "vision"] })

function server(extra: Record<string, unknown> = {}) {
  const dataLayer = createFakeDataLayer({
    organizations: [{ id: MINE, name: "Mine" }, { id: OTHER, name: "Other" }],
    clients: [{ id: CLIENT, org_id: MINE, name: "Visible client" }, { id: "44444444-4444-4444-8444-444444444444", org_id: OTHER, name: "Foreign secret client" }],
    ...extra,
  })
  return createErpMcpServer({ dataLayer, onLog: () => {}, erpOrgId: MINE })
}

beforeEach(() => { vi.stubEnv("OLLAMA_HOST", "127.0.0.1:11434") })
afterEach(() => vi.unstubAllEnvs())

describe("session-bound assistant privileges", () => {
  it("does not allow a model to select another workspace or invoke privileged tools", async () => {
    const runner = await erpToolRunner({ orgId: MINE, role: "member" }, server())
    const result = await runner.call("list_clients", { org_id: OTHER })
    expect(result.ok).toBe(true)
    expect(result.text).toContain("Visible client")
    expect(result.text).not.toContain("Foreign secret client")
    expect(result.evidence?.records).toEqual([{ label: "Visible client", href: `/clients/${CLIENT}` }])
    for (const name of ["list_workspaces", "finance_summary", "delete_client"]) {
      expect(await runner.call(name, {})).toMatchObject({ ok: false })
    }
  })

  it("does not mistake failed authorized reads for zero records or successful evidence", async () => {
    const broken = createErpMcpServer({ erpOrgId: MINE, onLog: () => {}, dataLayer: {
      listOrganizations: async () => ({ rows: [{ id: MINE }], total: 1 }),
      listClients: async () => { throw new Error("permission denied") },
    } })
    const runner = await erpToolRunner({ orgId: MINE, role: "owner" }, broken)
    const result = await runner.call("list_clients", {})
    expect(result.ok).toBe(false)
    expect(result.evidence).toBeUndefined()
    expect(result.total).toBeUndefined()
  })

  it("exposes partial coverage rather than corrupting a large list's JSON or claiming a complete total", async () => {
    const clients = Array.from({ length: 70 }, (_, index) => ({ id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`, org_id: MINE, name: "Thai client ลูกค้า " + index + "x".repeat(450) }))
    const runner = await erpToolRunner({ orgId: MINE, role: "owner" }, server({ clients }))
    const result = await runner.call("list_clients", { limit: 100 })
    const envelope = JSON.parse(result.text)
    expect(result.evidence?.partial).toBe(true)
    expect(envelope.data.total).toBe(70)
    expect(envelope.data.has_more).toBe(true)
    expect(envelope.data.items.every((item: { name: string }) => item.name.startsWith("Thai client"))).toBe(true)
  })

  it("reports UTF-8 byte-limited Thai records as partial instead of claiming complete coverage", async () => {
    const clients = Array.from({ length: 16 }, (_, index) => ({
      id: `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
      org_id: MINE,
      name: "ลูกค้า".repeat(35),
      industry: "ค้าปลีก".repeat(30),
    }))
    const runner = await erpToolRunner({ orgId: MINE, role: "owner" }, server({ clients }))
    const result = await runner.call("list_clients", { limit: 100 })
    expect(result.evidence).toMatchObject({ total: 16, partial: true })
    expect(JSON.parse(result.text).data).toMatchObject({ total: 16, has_more: true })
  })
})

describe("source-owned receivable calculations", () => {
  const invoiceId = (index: number) => `${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`
  it("totals all matching issued balances, applies credits/receipts, and does not count drafts or cancelled invoices", async () => {
    const invoices = [
      { id: invoiceId(1), status: "sent", amount_satang: 9700 },
      { id: invoiceId(2), status: "sent", amount_satang: 3_500_000 },
      { id: invoiceId(3), status: "sent", amount_satang: 8_200_000 },
      { id: invoiceId(4), status: "draft", amount_satang: 4_000_000 },
      { id: invoiceId(5), status: "cancelled", amount_satang: 7_000_000 },
      { id: invoiceId(6), status: "paid", amount_satang: 120_000 },
    ].map(invoice => ({ ...invoice, org_id: MINE, client_id: CLIENT }))
    const runner = await erpToolRunner({ orgId: MINE, role: "owner" }, server({
      invoices,
      invoice_balances: [
        { invoice_id: invoiceId(3), org_id: MINE, paid_satang: 100_000, credited_satang: 100_000 },
        { invoice_id: invoiceId(6), org_id: MINE, paid_satang: 120_000, credited_satang: 0 },
      ],
    }))
    const firstPage = await runner.call("list_invoices", { limit: 1 })
    expect(firstPage.ok).toBe(true)
    expect(JSON.parse(firstPage.text).data.summary).toMatchObject({ scope: "all_matching_records", issued_unpaid_count: 3, outstanding_satang: 11_509_700, outstanding_thb: "฿115,097.00" })
    expect(firstPage.evidence?.partial).toBe(true)
    expect(firstPage.evidence?.facts.find(fact => fact.id.endsWith(":summary:outstanding"))).toMatchObject({ value: "฿115,097.00", scope: "matching-records" })
    const complete = JSON.parse((await runner.call("list_invoices", { limit: 100 })).text).data
    expect(complete.items.find((invoice: { id: string }) => invoice.id === invoiceId(4)).outstanding_satang).toBe(0)
    expect(complete.items.find((invoice: { id: string }) => invoice.id === invoiceId(5)).outstanding_satang).toBe(0)
  })

  it("refuses an unsafe aggregate rather than rounding it or presenting a zero balance", async () => {
    const runner = await erpToolRunner({ orgId: MINE, role: "owner" }, server({ invoices: [1, 2].map(index => ({ id: invoiceId(index), org_id: MINE, status: "sent", amount_satang: Number.MAX_SAFE_INTEGER })) }))
    const result = await runner.call("list_invoices", {})
    expect(result.ok).toBe(false)
    expect(result.evidence).toBeUndefined()
  })

  it("shows all issued receivables even when AI selects a filtered subset, without duplicating later reads", async () => {
    const runner = await erpToolRunner({ orgId: MINE, role: "owner" }, server({
      invoices: [
        { id: invoiceId(1), org_id: MINE, number: "OVERDUE", status: "sent", amount_satang: 10000, due_date: "1900-01-01" },
        { id: invoiceId(2), org_id: MINE, number: "SENT", status: "sent", amount_satang: 20000, due_date: "2999-01-01" },
        { id: invoiceId(3), org_id: MINE, number: "PARTIAL", status: "sent", amount_satang: 30000, due_date: "2999-01-01" },
        { id: invoiceId(4), org_id: MINE, number: "DRAFT", status: "draft", amount_satang: 40000 },
        { id: invoiceId(5), org_id: OTHER, number: "FOREIGN", status: "sent", amount_satang: 90000 },
      ],
      invoice_balances: [{ invoice_id: invoiceId(3), org_id: MINE, paid_satang: 10000, credited_satang: 0 }],
    }))
    const overdue = (await runner.call("list_invoices", { status: "overdue" })).evidence!
    const sent = (await runner.call("list_invoices", { status: "sent" })).evidence!
    const answer: AssistantAnswer = {
      kind: "erp-review", factIds: [],
      summary: "Notes about the filtered records",
      findings: [{ text: "Review overdue records", sourceIds: [overdue.id], factIds: [`${overdue.id}:row:${invoiceId(1)}:outstanding`], quotes: [] }],
      nextActions: ["Contact the client after checking the original records"], limitations: [],
    }
    const sources = [overdue, sent]
    const html = renderToStaticMarkup(createElement(AssistantAnswerView, { answer, sources, messageId: 1, lang: "en" }))
    const table = html.slice(html.indexOf("<table"), html.indexOf("</table>") + 8)
    expect(table).toContain("฿500.00")
    expect(table).toContain("Issued unpaid invoices")
    for (const id of [invoiceId(1), invoiceId(2), invoiceId(3)]) {
      expect(table.match(new RegExp(`/finance/invoices/${id}`, "g"))).toHaveLength(1)
    }
    expect(table).not.toContain("DRAFT")
    expect(table).not.toContain("FOREIGN")
    const history = answerText(answer, sources)
    expect(history).toContain("SENT · Outstanding: ฿200.00")
    expect(history).toContain("PARTIAL · Outstanding: ฿200.00")
    expect(history).toContain("Issued unpaid invoices: 3")
  })
})

describe("local model failure and privacy", () => {
  it("reports an installed checkpoint's runtime load failure instead of treating error text as an answer", async () => {
    const runner = await erpToolRunner({ orgId: MINE, role: "owner" }, server())
    const fetchModel = vi.fn<typeof fetch>().mockImplementation(async (input) => String(input).endsWith("/api/show") ? localCheckpoint() : json({ error: "model not found" }, 404))
    const result = await chatLocal([{ role: "user", content: "Show current invoices" }], fetchModel, runner)
    expect(result).toMatchObject({ error: expect.stringMatching(/could not load/i) })
    expect(result).not.toHaveProperty("reply")
    expect(result).not.toHaveProperty("notConfigured")
  })

  it("refuses cloud-backed aliases before offering business tools or sending conversation data", async () => {
    const runner = { specs: [], call: vi.fn() }
    const fetchModel = vi.fn<typeof fetch>().mockResolvedValue(json({ details: { format: "gguf" }, capabilities: ["completion"], remote_host: "https://cloud.example" }))
    expect(await chatLocal([{ role: "user", content: "Sensitive ERP question" }], fetchModel, runner)).toMatchObject({ notConfigured: true })
    expect(runner.call).not.toHaveBeenCalled()
    expect(fetchModel.mock.calls.some(([input]) => String(input).endsWith("/api/chat"))).toBe(false)
  })

  it("does not silently downgrade ERP questions when a model cannot call authorized tools", async () => {
    const runner = await erpToolRunner({ orgId: MINE, role: "owner" }, server())
    const fetchModel = vi.fn<typeof fetch>().mockImplementation(async (input) => String(input).endsWith("/api/show") ? localCheckpoint() : json({ error: "model does not support tools" }, 400))
    expect(await chatLocal([{ role: "user", content: "What is unpaid?" }], fetchModel, runner)).toMatchObject({ notConfigured: true })
  })
})

describe("source-owned ERP review plans", () => {
  const source: AssistantSource = {
    id: "erp-1", kind: "erp", label: "list_invoices", observedAt: "2026-11-06T00:00:00Z",
    partial: false, records: [], facts: [
      { id: "erp-1:total", label: { en: "Matching records", th: "รายการที่ตรงเงื่อนไข" }, value: "6", scope: "matching-records" },
      { id: "erp-1:outstanding", label: { en: "Outstanding", th: "ยอดค้างชำระ" }, value: "฿385,096.00", scope: "workspace" },
    ],
  }
  const plan = {
    language: "en", factIds: ["erp-1:total", "erp-1:outstanding"],
    tasks: [{ action: "reconcile-receipts-and-credits", sourceIds: ["erp-1"], factIds: ["erp-1:outstanding"], quotes: [] }],
  }

  it("renders source amounts while refusing model-authored amounts, counts, conclusions and navigation", () => {
    const answer = parseAssistantAnswer(JSON.stringify(plan), [source])!
    expect(answer.kind).toBe("erp-review")
    expect(answerText(answer, [source])).toContain("Outstanding: ฿385,096.00")
    for (const extra of [
      { amount: "385996" }, { summary: "Five invoices are unpaid" }, { summary: "All invoices have been paid" },
      { limitations: ["Invoice identifiers are case-sensitive."] },
    ]) expect(parseAssistantAnswer(JSON.stringify({ ...plan, ...extra }), [source])).toBeNull()
    expect(parseAssistantAnswer(JSON.stringify({ ...plan, tasks: [{ ...plan.tasks[0], href: "javascript:alert(1)" }] }), [source])).toBeNull()
  })

  it("rejects invented evidence and substitutions from a source not cited by the task", () => {
    expect(parseAssistantAnswer(JSON.stringify({ ...plan, factIds: ["erp-999:outstanding"] }), [source])).toBeNull()
    expect(parseAssistantAnswer(JSON.stringify({ ...plan, tasks: [{ ...plan.tasks[0], sourceIds: ["erp-999"] }] }), [source])).toBeNull()
    expect(parseAssistantAnswer(JSON.stringify({ ...plan, tasks: [{ ...plan.tasks[0], sourceIds: [] }] }), [source])).toBeNull()
    const other: AssistantSource = { ...source, id: "erp-2", facts: [{ ...source.facts[1], id: "erp-2:outstanding" }] }
    expect(parseAssistantAnswer(JSON.stringify({ ...plan, tasks: [{ ...plan.tasks[0], factIds: ["erp-2:outstanding"] }] }), [source, other])).toBeNull()
  })

  it("cannot turn a proposed review into an autonomous operation or apply finance tasks to client-only evidence", () => {
    expect(parseAssistantAnswer(JSON.stringify({ ...plan, tasks: [{ ...plan.tasks[0], action: "approve-invoices" }] }), [source])).toBeNull()
    const clients: AssistantSource = { ...source, label: "list_clients" }
    expect(parseAssistantAnswer(JSON.stringify(plan), [clients])).toBeNull()
  })

  it("supports factual answers without adding unrequested tasks and rejects the obsolete ERP prose protocol", () => {
    expect(parseAssistantAnswer(JSON.stringify({ ...plan, tasks: [] }), [source])?.factIds).toEqual(plan.factIds)
    expect(parseAssistantAnswer(JSON.stringify({ summary: "Review the records", findings: [], nextActions: [], limitations: [] }), [source])).toBeNull()
  })

  it("accepts an exact document quote in a mixed-source review but rejects invented or uncited text", () => {
    const document: AssistantSource = { id: "doc-1", kind: "document", label: "bill.txt", observedAt: source.observedAt, partial: false, records: [], facts: [] }
    const quote = "รวมสุทธิ ๑,๐๗๐.๐๐ บาท"
    const documents = new Map([["doc-1", `ใบเสร็จ\n${quote}\nVAT 70.00`]])
    const task = { action: "review-original-document", sourceIds: ["doc-1"], factIds: [], quotes: [{ sourceId: "doc-1", text: quote }] }
    const mixed = { ...plan, tasks: [task] }
    const reconciliation = { ...plan, tasks: [{ ...plan.tasks[0], sourceIds: ["erp-1", "doc-1"], quotes: task.quotes }] }
    expect(parseAssistantAnswer(JSON.stringify(reconciliation), [source, document], documents)?.findings[0].quotes).toEqual(task.quotes)
    expect(parseAssistantAnswer(JSON.stringify(mixed), [source, document], documents)?.findings[0].quotes).toEqual(task.quotes)
    expect(parseAssistantAnswer(JSON.stringify({ ...mixed, tasks: [{ ...task, quotes: [{ sourceId: "doc-1", text: "รวมสุทธิ 9,999.00 บาท" }] }] }), [source, document], documents)).toBeNull()
    expect(parseAssistantAnswer(JSON.stringify({ ...mixed, tasks: [{ ...task, sourceIds: ["erp-1"] }] }), [source, document], documents)).toBeNull()
  })
})

describe("unreviewed guidance and document citations", () => {
  const source: AssistantSource = { id: "doc-1", kind: "document", label: "bill.txt", observedAt: "2026-11-06T00:00:00Z", partial: false, records: [], facts: [] }
  const answer = { summary: "Review the original document", findings: [{ text: "Check the original attachment", sourceIds: ["doc-1"], factIds: [], quotes: [] }], nextActions: ["Review the record"], limitations: [] }

  it("rejects unsupported findings when this request has no source evidence", () => {
    expect(parseAssistantAnswer(JSON.stringify({ ...answer, findings: [{ ...answer.findings[0], sourceIds: [] }] }), [])).toBeNull()
  })

  it("rejects invented document evidence, navigation and model-authored technical restrictions", () => {
    expect(parseAssistantAnswer(JSON.stringify({ ...answer, findings: [{ ...answer.findings[0], sourceIds: ["doc-999"] }] }), [source])).toBeNull()
    expect(parseAssistantAnswer(JSON.stringify({ ...answer, findings: [{ ...answer.findings[0], href: "javascript:alert(1)" }] }), [source])).toBeNull()
    expect(parseAssistantAnswer(JSON.stringify({ ...answer, limitations: ["Invoice identifiers are case-sensitive."] }), [source])).toBeNull()
  })

  it.each([
    ["summary", "Outstanding is three hundred eighty-five thousand nine hundred ninety-six baht"],
    ["summary", "Five issued invoices remain unpaid"],
    ["finding", "ยอดรวมสามแสนแปดหมื่นห้าพันเก้าร้อยหกบาท"],
    ["action", "Collect two hundred baht from the client"],
    ["finding", "The unverified amount is 三百八十五千零九十六"],
  ] as const)("rejects spelled-out figures in generated %s rather than bypassing source-owned values", (field, prose) => {
    const candidate = {
      ...answer,
      ...(field === "summary" ? { summary: prose } : {}),
      ...(field === "finding" ? { findings: [{ ...answer.findings[0], text: prose }] } : {}),
      ...(field === "action" ? { nextActions: [prose] } : {}),
    }
    expect(parseAssistantAnswer(JSON.stringify(candidate), [source])).toBeNull()
  })

  it("keeps valid Thai review language without confusing whole words with numeral substrings", () => {
    const review = { ...answer, summary: "ไม่สามารถอนุมัติรายการได้", nextActions: ["ตรวจสอบภาระผูกพันและยืนยันหลักฐานก่อนดำเนินการ"] }
    expect(parseAssistantAnswer(JSON.stringify(review), [source])).toEqual({ ...review, kind: "guidance", factIds: [] })
  })

  it("allows exact unreviewed document quotes but not invented monetary text", () => {
    const quote = "รวมสุทธิ ๑,๐๗๐.๐๐ บาท"
    const documents = new Map([["doc-1", `ใบเสร็จ\n${quote}\nVAT 70.00`]])
    const quoted = { ...answer, findings: [{ ...answer.findings[0], quotes: [{ sourceId: "doc-1", text: quote }] }] }
    expect(parseAssistantAnswer(JSON.stringify(quoted), [source], documents)?.findings[0].quotes).toEqual([{ sourceId: "doc-1", text: quote }])
    expect(parseAssistantAnswer(JSON.stringify({ ...quoted, findings: [{ ...quoted.findings[0], quotes: [{ sourceId: "doc-1", text: "รวมสุทธิ 9,999.00 บาท" }] }] }), [source], documents)).toBeNull()
  })
})

describe("source-owned record reference checks", () => {
  const reference = "abcdefab-1234-4234-8234-abcdefabcdef"
  const source = (): AssistantSource => ({ id: "erp-1", kind: "erp", label: "list_invoices", observedAt: "2026-11-07T00:00:00Z", partial: false, records: [], facts: [] })

  it("matches a case-insensitive UUID only against records actually retrieved in the current scope", () => {
    const current = source()
    current.records.push({ label: "Current invoice", href: `/finance/invoices/${reference}` })
    expect(referenceEvidence(current, `Check ${reference.toUpperCase()}`).facts).toEqual([expect.objectContaining({ recordPresence: "present", href: `/finance/invoices/${reference}` })])
    expect(referenceEvidence(source(), `Check ${reference}`).facts[0].recordPresence).toBe("not-returned")
  })

  it("never turns a bounded read into proof of global absence", () => {
    const partial = { ...source(), partial: true }
    expect(referenceEvidence(partial, reference).facts[0].recordPresence).toBe("partial")
    const coveragePartial = { ...source(), coverage: { factIds: [], partial: true } }
    expect(referenceEvidence(coveragePartial, reference).facts[0].recordPresence).toBe("partial")
  })

  it("keeps the actual scoped reference result visible even when the model selects no facts", () => {
    const current = referenceEvidence(source(), reference)
    const answer: AssistantAnswer = { kind: "erp-review", factIds: [], summary: "Review the source", findings: [], nextActions: [], limitations: [] }
    const html = renderToStaticMarkup(createElement(AssistantAnswerView, { answer, sources: [current], messageId: 1, lang: "en" }))
    const table = html.slice(html.indexOf("<table"), html.indexOf("</table>") + 8)
    expect(table).toContain(reference)
    expect(table).toContain(current.facts[0].value)
  })
})

describe("whole-domain source facts", () => {
  const at = "2026-11-07T00:00:00Z"
  const generic = (entity: string, row: Record<string, unknown>) => toolEvidence("erp-1", "erp_data_read", {
    entity: { key: entity, fields: Object.keys(row).filter(key => key !== "_text").map(key => ({ key })) },
    items: [row], total: 1, offset: 0, has_more: false,
  }, at)

  it("renders exact currency and actual product links while binding inventory tasks to their source domain", () => {
    const source = generic("products", { id: CLIENT, name: "Review product", list_price_satang: 12345 })
    const amount = source.facts.find(fact => fact.id.endsWith(":list_price_satang"))!
    expect(amount.value).toBe("฿123.45")
    expect(amount.label.en).toContain("THB")
    expect(amount.label.en.toLowerCase()).not.toContain("satang")
    const plan = { language: "en", factIds: [amount.id], tasks: [{ action: "review-inventory", sourceIds: [source.id], factIds: [amount.id], quotes: [] }] }
    const answer = parseAssistantAnswer(JSON.stringify(plan), [source])!
    const html = renderToStaticMarkup(createElement(AssistantAnswerView, { answer, sources: [source], messageId: 1, lang: "en" }))
    expect(html).toContain("฿123.45")
    expect(html).toContain(`/products/${CLIENT}`)
    const clients = generic("clients", { id: CLIENT, name: "Not inventory" })
    expect(parseAssistantAnswer(JSON.stringify({ ...plan, factIds: [], tasks: [{ ...plan.tasks[0], factIds: [] }] }), [clients])).toBeNull()
  })

  it("distinguishes equal IDs in different entity types and preserves scoped reference presence without invented links", () => {
    const clients = generic("clients", { id: CLIENT, name: "Client with shared ID" })
    const products = generic("products", { id: CLIENT, name: "Product with shared ID" })
    expect(clients.facts.find(fact => fact.id.endsWith(":name"))!.id).not.toBe(products.facts.find(fact => fact.id.endsWith(":name"))!.id)
    const note = generic("record_notes", { id: CLIENT, body: "Actual note" })
    expect(note.records).toEqual([])
    expect(referenceEvidence(note, CLIENT).facts.find(fact => fact.recordPresence)?.recordPresence).toBe("present")
  })

  it("does not present a preview-only business text row as complete even when every matching row was returned", () => {
    const source = generic("record_notes", { id: CLIENT, body: "Beginning only", _text: { body: { preview: true, has_more: true } } })
    expect(source).toMatchObject({ total: 1, returned: 1, partial: true })
    expect(referenceEvidence(source, OTHER).facts.find(fact => fact.recordPresence)?.recordPresence).toBe("partial")
  })
})
