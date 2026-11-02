import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { chatLocal, erpToolRunner } from "./assistant-chat"
import { createErpMcpServer } from "@/lib/mcp/erp-server.mjs"
import { probeErpMcp } from "@/lib/mcp/probe"

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"

describe("chatLocal", () => {
  beforeEach(() => {
    vi.stubEnv("OLLAMA_HOST", "")
    vi.stubEnv("OLLAMA_MODEL", "")
  })
  afterEach(() => vi.unstubAllEnvs())

  it("replies from the text model on loopback and never sets an image", async () => {
    const fake = vi.fn().mockResolvedValue(json({ message: { content: "สวัสดี" } }))
    const out = await chatLocal([{ role: "user", content: "hi" }], fake)
    expect(out).toMatchObject({ reply: "สวัสดี" })
    expect(String(fake.mock.calls[0][0])).toBe("http://127.0.0.1:11434/api/chat")
    expect(JSON.parse(fake.mock.calls[0][1].body).model).not.toBe("qwen2.5vl:3b")
  })
  it("switches to the vision model when the newest turn has an image", async () => {
    const fake = vi.fn().mockResolvedValue(json({ message: { content: "a receipt" } }))
    await chatLocal([{ role: "user", content: "see", attachments: [{ kind: "image", name: "a.png", mediaType: "image/png", base64: PNG_B64 }] }], fake)
    const sent = JSON.parse(fake.mock.calls[0][1].body)
    expect(sent.model).toBe("qwen2.5vl:3b")
    expect(sent.messages[1].images).toEqual([PNG_B64])
  })
  it("refuses a non-loopback host before any request", async () => {
    vi.stubEnv("OLLAMA_HOST", "http://example.com:11434")
    const fake = vi.fn()
    expect(await chatLocal([{ role: "user", content: "hi" }], fake)).toHaveProperty("notConfigured", true)
    expect(fake).not.toHaveBeenCalled()
  })
  it("reports notConfigured when Ollama is down or the model is missing, and error otherwise", async () => {
    expect(await chatLocal([{ role: "user", content: "hi" }], vi.fn().mockRejectedValue(new Error("ECONNREFUSED")))).toHaveProperty("notConfigured", true)
    expect(await chatLocal([{ role: "user", content: "hi" }], vi.fn().mockResolvedValue(json({ error: "model 'x' not found" }, 404)))).toHaveProperty("notConfigured", true)
    expect(await chatLocal([{ role: "user", content: "hi" }], vi.fn().mockResolvedValue(json({ message: { content: "" } })))).toHaveProperty("error")
  })
})

describe("probeErpMcp", () => {
  it("lists the read-only ERP tools through a real initialize + tools/list", async () => {
    const out = await probeErpMcp()
    expect(out).toMatchObject({ readOnly: true })
    expect("tools" in out && out.tools.map((t) => t.name)).toEqual(expect.arrayContaining(["list_invoices", "finance_summary"]))
    expect("tools" in out && out.tools.every((t) => /^(list_|finance_)/.test(t.name))).toBe(true)
  })
})

const MINE = "11111111-1111-4111-8111-111111111111"
const OTHER = "22222222-2222-4222-8222-222222222222"

/** Real MCP server over a fake data layer that records which org each query ran for. */
function fakeServer() {
  const asked: string[] = []
  const orgs = [{ id: MINE, name: "Mine", slug: "mine" }, { id: OTHER, name: "Other", slug: "other" }]
  const dataLayer = {
    listOrganizations: async (o: { id?: string }) => ({ rows: orgs.filter((x) => !o.id || x.id === o.id), total: orgs.length }),
    listClients: async (orgId: string) => (asked.push(orgId), { rows: [{ id: "c1", org_id: orgId, name: "Acme" }], total: 1 }),
  }
  return { asked, server: createErpMcpServer({ dataLayer, onLog: () => {}, erpOrgId: MINE }) }
}

describe("erpToolRunner", () => {
  it("offers only read-only org-scoped tools and hides org_id from the model", async () => {
    const runner = await erpToolRunner(MINE, fakeServer().server)
    const fns = runner!.specs.map((s) => (s as { function: { name: string; parameters: { properties: object } } }).function)
    expect(fns.map((f) => f.name)).toEqual(expect.arrayContaining(["list_clients", "finance_summary"]))
    expect(fns.map((f) => f.name)).not.toContain("list_workspaces")
    expect(fns.every((f) => /^(list_|finance_)/.test(f.name) && !("org_id" in f.parameters.properties))).toBe(true)
  })
  it("rewrites org_id to the signed-in org whatever the model sends, and refuses other tools", async () => {
    const { asked, server } = fakeServer()
    const runner = (await erpToolRunner(MINE, server))!
    const out = await runner.call("list_clients", { org_id: OTHER })
    expect(out).toMatchObject({ ok: true, total: 1 })
    expect(asked).toEqual([MINE])
    expect(await runner.call("list_workspaces", {})).toMatchObject({ ok: false })
    expect(await runner.call("delete_client", { org_id: OTHER })).toMatchObject({ ok: false })
    expect(asked).toEqual([MINE])
  })
})

describe("chatLocal tool loop", () => {
  beforeEach(() => { vi.stubEnv("OLLAMA_HOST", ""); vi.stubEnv("OLLAMA_MODEL", "") })
  afterEach(() => vi.unstubAllEnvs())

  it("runs the model's tool call through MCP, feeds the result back and returns a grounded reply with chips", async () => {
    const { server, asked } = fakeServer()
    const runner = await erpToolRunner(MINE, server)
    const fake = vi
      .fn()
      .mockResolvedValueOnce(json({ message: { role: "assistant", content: "", tool_calls: [{ function: { name: "list_clients", arguments: { org_id: OTHER } } }] } }))
      .mockResolvedValueOnce(json({ message: { content: "คุณมีลูกค้า 1 ราย: Acme" } }))
    const out = await chatLocal([{ role: "user", content: "มีลูกค้ากี่ราย" }], fake, runner)
    expect(out).toMatchObject({ reply: "คุณมีลูกค้า 1 ราย: Acme", toolCalls: [{ name: "list_clients", ok: true, total: 1 }] })
    expect(asked).toEqual([MINE])
    const first = JSON.parse(fake.mock.calls[0][1].body)
    const second = JSON.parse(fake.mock.calls[1][1].body)
    expect(first.tools.length).toBeGreaterThan(0)
    expect(second.messages.at(-1)).toMatchObject({ role: "tool", tool_name: "list_clients" })
    expect(second.messages.at(-1).content).toContain("Acme")
  })
  it("stops calling tools after the round limit and still answers", async () => {
    const runner = await erpToolRunner(MINE, fakeServer().server)
    const loop = json({ message: { content: "", tool_calls: [{ function: { name: "list_clients", arguments: {} } }] } })
    const fake = vi.fn().mockImplementation(async (_u, init) => (JSON.parse(init.body).tools ? loop.clone() : json({ message: { content: "done" } })))
    expect(await chatLocal([{ role: "user", content: "x" }], fake, runner)).toMatchObject({ reply: "done" })
    expect(fake.mock.calls.length).toBe(5)
  })
  it("sends no tools with an image, and retries plain when the model has no tool support", async () => {
    const runner = await erpToolRunner(MINE, fakeServer().server)
    const fake = vi.fn().mockResolvedValue(json({ message: { content: "ok" } }))
    await chatLocal([{ role: "user", content: "see", attachments: [{ kind: "image", name: "a.png", mediaType: "image/png", base64: PNG_B64 }] }], fake, runner)
    expect(JSON.parse(fake.mock.calls[0][1].body).tools).toBeUndefined()
    const noTools = vi.fn().mockResolvedValueOnce(json({ error: "registry.ollama.ai/x does not support tools" }, 400)).mockResolvedValueOnce(json({ message: { content: "plain" } }))
    expect(await chatLocal([{ role: "user", content: "hi" }], noTools, runner)).toMatchObject({ reply: "plain" })
    expect(JSON.parse(noTools.mock.calls[1][1].body).tools).toBeUndefined()
  })
})
