import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const ok = (content: unknown) =>
  new Response(JSON.stringify({ message: { role: "assistant", content } }), {
    status: 200,
  })

async function load() {
  vi.resetModules()
  return import("./client")
}

describe("lib/ai/client", () => {
  const fake = vi.fn()

  beforeEach(() => {
    fake.mockReset()
    vi.stubGlobal("fetch", fake)
    vi.stubEnv("OLLAMA_HOST", "")
    vi.stubEnv("OLLAMA_MODEL", "")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("posts to local Ollama with the default model", async () => {
    fake.mockResolvedValue(ok("hi"))
    const { generateText } = await load()
    await generateText({ system: "sys", prompt: "usr", maxTokens: 50 })

    const [url, init] = fake.mock.calls[0]
    expect(url).toBe("http://127.0.0.1:11434/api/chat")
    expect(init.method).toBe("POST")
    expect(init.headers.Authorization).toBeUndefined()
    expect(JSON.parse(init.body)).toEqual({
      model: "qwen2.5:3b",
      stream: false,
      think: false,
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "usr" },
      ],
      options: { num_predict: 50 },
    })
  })

  it("OLLAMA_MODEL and a loopback OLLAMA_HOST override the defaults", async () => {
    vi.stubEnv("OLLAMA_MODEL", "llama3.2")
    vi.stubEnv("OLLAMA_HOST", "http://localhost:11435")
    fake.mockResolvedValue(ok("hi"))
    const { generateText, DEFAULT_MODEL } = await load()
    await generateText({ system: "s", prompt: "p" })

    expect(DEFAULT_MODEL).toBe("llama3.2")
    expect(fake.mock.calls[0][0]).toBe("http://localhost:11435/api/chat")
    expect(JSON.parse(fake.mock.calls[0][1].body).model).toBe("llama3.2")
  })

  it("a remote host makes no request", async () => {
    vi.stubEnv("OLLAMA_HOST", "https://models.example:11434")
    const { generateText, isAIConfigured, AINotConfiguredError } = await load()

    expect(isAIConfigured()).toBe(false)
    const run = generateText({ system: "s", prompt: "p" })
    await expect(run).rejects.toBeInstanceOf(AINotConfiguredError)
    await expect(run).rejects.toThrow(/not configured/i)
    expect(fake).not.toHaveBeenCalled()
  })

  it("a refused connection degrades as not configured", async () => {
    fake.mockRejectedValue(new TypeError("fetch failed"))
    const { generateText, isAIConfigured, AINotConfiguredError } = await load()

    expect(isAIConfigured()).toBe(true)
    await expect(generateText({ system: "s", prompt: "p" })).rejects.toBeInstanceOf(
      AINotConfiguredError,
    )
    await expect(generateText({ system: "s", prompt: "p" })).rejects.toThrow(
      /not configured/i,
    )
  })

  it("an HTTP error stays short and does not echo a huge body", async () => {
    fake.mockResolvedValue(
      new Response(JSON.stringify({ error: "x".repeat(500) }), { status: 404 }),
    )
    const { generateText, AINotConfiguredError } = await load()
    const err = await generateText({ system: "s", prompt: "p" }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(AINotConfiguredError)
    expect((err as Error).message).toContain("HTTP 404")
    expect((err as Error).message.length).toBeLessThan(280)

    fake.mockResolvedValue(new Response("<html>raw gateway page</html>", { status: 502 }))
    const raw = await generateText({ system: "s", prompt: "p" }).catch((e: Error) => e)
    expect((raw as Error).message).toContain("HTTP 502")
    expect((raw as Error).message).not.toContain("<html>")
  })

  it("returns the trimmed reply text", async () => {
    fake.mockResolvedValue(ok("  hello world \n"))
    const { generateText } = await load()
    expect(await generateText({ system: "s", prompt: "p" })).toBe("hello world")
  })

  it("rejects a blank reply instead of returning it", async () => {
    fake.mockResolvedValue(ok("  \n"))
    const { generateText } = await load()
    await expect(generateText({ system: "s", prompt: "p" })).rejects.toThrow(
      "Ollama returned no text",
    )
  })

  it("strips leaked chain of thought and asks for no thinking", async () => {
    fake.mockResolvedValue(
      new Response(
        JSON.stringify({ message: { role: "assistant", content: "Okay, let's see. The user wants a note.\n\nFollow up tomorrow.", thinking: "plan" } }),
        { status: 200 },
      ),
    )
    const { generateText } = await load()
    expect(await generateText({ system: "s", prompt: "p" })).toBe("Follow up tomorrow.")
    expect(JSON.parse(fake.mock.calls[0][1].body).think).toBe(false)
  })

  it("an answer channel holding only thinking is an error, not a reply", async () => {
    fake.mockResolvedValue(
      new Response(JSON.stringify({ message: { role: "assistant", content: "", thinking: "Follow up tomorrow." } }), { status: 200 }),
    )
    const { generateText } = await load()
    await expect(generateText({ system: "s", prompt: "p" })).rejects.toThrow("Ollama returned no text")
  })

  it("a 200 carrying an error degrades as not configured", async () => {
    fake.mockResolvedValue(
      new Response(JSON.stringify({ error: "model not found" }), { status: 200 }),
    )
    const { generateText, AINotConfiguredError } = await load()
    const err = await generateText({ system: "s", prompt: "p" }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(AINotConfiguredError)
    expect((err as Error).message).toContain("model not found")
  })
})
