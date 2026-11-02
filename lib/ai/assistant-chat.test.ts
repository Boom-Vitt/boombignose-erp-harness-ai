import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { chatLocal } from "./assistant-chat"
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
