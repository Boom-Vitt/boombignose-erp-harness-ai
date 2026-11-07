import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const localCheckpoint = (format = "gguf") => ({ details: { format }, capabilities: ["completion"] })

async function load() {
  vi.resetModules()
  return import("./client")
}

describe("lib/ai/client", () => {
  const fake = vi.fn()
  const verifiedReply = (response: Response) => fake.mockResolvedValueOnce(json(localCheckpoint())).mockResolvedValueOnce(response)

  beforeEach(() => {
    fake.mockReset()
    vi.stubGlobal("fetch", fake)
    vi.stubEnv("OLLAMA_HOST", "")
    vi.stubEnv("OLLAMA_MODEL", "local-checkpoint:4b")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it.each(["gguf", "safetensors"])("verifies a local %s completion checkpoint before sending business text", async (format) => {
    vi.stubEnv("OLLAMA_HOST", "http://localhost:11435")
    fake.mockResolvedValueOnce(json(localCheckpoint(format))).mockResolvedValueOnce(json({ message: { role: "assistant", content: "Ready" } }))
    const { generateText } = await load()
    await generateText({ system: "private policy", prompt: "private invoice", maxTokens: 50 })

    expect(fake).toHaveBeenCalledTimes(2)
    const [showUrl, show] = fake.mock.calls[0]
    expect(showUrl).toBe("http://localhost:11435/api/show")
    expect(JSON.parse(show.body)).toEqual({ model: "local-checkpoint:4b" })
    expect(show.body).not.toContain("private")
    const [chatUrl, chat] = fake.mock.calls[1]
    expect(chatUrl).toBe("http://localhost:11435/api/chat")
    expect(JSON.parse(chat.body)).toMatchObject({
      model: "local-checkpoint:4b",
      messages: [{ role: "system", content: "private policy" }, { role: "user", content: "private invoice" }],
      options: { num_predict: 50 },
      think: false,
    })
    for (const [, init] of fake.mock.calls) {
      expect(init.redirect).toBe("error")
      expect(init.headers.Authorization).toBeUndefined()
    }
  })

  it.each([
    { ...localCheckpoint(), remote_host: "https://cloud.example" },
    { ...localCheckpoint(), remote_model: "cloud-checkpoint" },
    { details: { format: "onnx" }, capabilities: ["completion"] },
    { details: { format: "gguf" }, capabilities: ["embedding"] },
    null,
  ])("refuses unverified or remote-backed metadata before sending prompts: %j", async (metadata) => {
    fake.mockResolvedValueOnce(json(metadata))
    const { generateText, AINotConfiguredError } = await load()
    await expect(generateText({ system: "private policy", prompt: "private invoice" })).rejects.toBeInstanceOf(AINotConfiguredError)
    expect(fake).toHaveBeenCalledTimes(1)
    expect(fake.mock.calls[0][0]).toMatch(/\/api\/show$/)
    expect(fake.mock.calls[0][1].body).not.toContain("private")
  })

  it.each(["remote/cloud:latest", "../checkpoint"])("rejects an unsafe model name without contacting any service: %s", async (model) => {
    vi.stubEnv("OLLAMA_MODEL", model)
    const { generateText, AINotConfiguredError } = await load()
    await expect(generateText({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(AINotConfiguredError)
    expect(fake).not.toHaveBeenCalled()
  })

  it("a remote host makes no request", async () => {
    vi.stubEnv("OLLAMA_HOST", "https://models.example:11434")
    const { generateText, isAIConfigured, AINotConfiguredError } = await load()
    expect(isAIConfigured()).toBe(false)
    await expect(generateText({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(AINotConfiguredError)
    expect(fake).not.toHaveBeenCalled()
  })

  it.each([302, 404, 500])("fails closed when metadata verification returns HTTP %s", async (status) => {
    fake.mockResolvedValueOnce(new Response(null, { status, headers: { Location: "https://cloud.example/api/show" } }))
    const { generateText, AINotConfiguredError } = await load()
    await expect(generateText({ system: "s", prompt: "private invoice" })).rejects.toBeInstanceOf(AINotConfiguredError)
    expect(fake).toHaveBeenCalledTimes(1)
    expect(fake.mock.calls[0][1].redirect).toBe("error")
  })

  it("a refused connection degrades as not configured without sending a prompt", async () => {
    fake.mockRejectedValueOnce(new TypeError("fetch failed"))
    const { generateText, isAIConfigured, AINotConfiguredError } = await load()
    expect(isAIConfigured()).toBe(true)
    await expect(generateText({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(AINotConfiguredError)
    expect(fake).toHaveBeenCalledTimes(1)
  })

  it("does not retry or follow a redirect when inference fetch fails", async () => {
    fake.mockResolvedValueOnce(json(localCheckpoint())).mockRejectedValueOnce(new TypeError("redirect disallowed"))
    const { generateText, AINotConfiguredError } = await load()
    await expect(generateText({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(AINotConfiguredError)
    expect(fake).toHaveBeenCalledTimes(2)
    expect(fake.mock.calls[1][1].redirect).toBe("error")
  })

  it("keeps HTTP errors short and never displays a raw gateway page", async () => {
    verifiedReply(json({ error: "x".repeat(500) }, 404))
    const { generateText, AINotConfiguredError } = await load()
    const err = await generateText({ system: "s", prompt: "p" }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(AINotConfiguredError)
    expect((err as Error).message).toContain("HTTP 404")
    expect((err as Error).message.length).toBeLessThan(350)
    expect((err as Error).message).not.toContain("x".repeat(201))

    verifiedReply(new Response("<html>raw gateway page</html>", { status: 502 }))
    const raw = await generateText({ system: "s", prompt: "p" }).catch((e: Error) => e)
    expect((raw as Error).message).toContain("HTTP 502")
    expect((raw as Error).message).not.toContain("<html>")
  })

  it("returns trimmed answer text without leaked chain of thought", async () => {
    verifiedReply(json({ message: { content: "Okay, let's see. The user wants a note.\n\nFollow up tomorrow.  ", thinking: "private plan" } }))
    const { generateText } = await load()
    expect(await generateText({ system: "s", prompt: "p" })).toBe("Follow up tomorrow.")
  })

  it.each(["  \n", ""])("rejects an empty answer even when a thinking channel exists", async (content) => {
    verifiedReply(json({ message: { content, thinking: "not an answer" } }))
    const { generateText } = await load()
    await expect(generateText({ system: "s", prompt: "p" })).rejects.toThrow("Ollama returned no text")
  })

  it("a successful HTTP response carrying a model error degrades as not configured", async () => {
    verifiedReply(json({ error: "model not found" }))
    const { generateText, AINotConfiguredError } = await load()
    const err = await generateText({ system: "s", prompt: "p" }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(AINotConfiguredError)
    expect((err as Error).message).toContain("model not found")
  })
})
