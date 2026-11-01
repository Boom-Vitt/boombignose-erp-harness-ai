import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import {
  deleteInstalledModel,
  describeLocalImage,
  drawLocalImage,
  listInstalledModels,
  pullInstalledModel,
  speakLocalText,
} from "./ollama-admin"

const linux = { platform: "linux" as const, arch: "x64" }
const mac = { platform: "darwin" as const, arch: "arm64" }

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

describe("ollama model admin", () => {
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

  it("lists installed models from loopback and ignores a broken name", async () => {
    fake.mockResolvedValue(json({ models: [{ name: "qwen3:4b", size: 10 }, { name: "bad\nname", size: 1 }, { name: 3 }] }))
    const listed = await listInstalledModels(fake)
    expect(listed).toEqual({ up: true, models: [{ name: "qwen3:4b", size: 10 }] })
    expect(fake.mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/tags")
    expect(fake.mock.calls[0][1].headers?.Authorization).toBeUndefined()
  })

  it("does not call a remote host", async () => {
    vi.stubEnv("OLLAMA_HOST", "https://models.example:11434")
    const listed = await listInstalledModels(fake)
    expect(listed.up).toBe(false)
    if (listed.up) return
    expect(listed.error).toMatch(/not configured/i)
    expect(listed.error).not.toContain("models.example")
    expect(fake).not.toHaveBeenCalled()
  })

  it("treats a refused connection as the daemon being down", async () => {
    fake.mockRejectedValue(new TypeError("fetch failed"))
    const listed = await listInstalledModels(fake)
    expect(listed).toEqual({ up: false, error: "Ollama is not running on this computer." })
  })

  it("pulls an allowlisted text model and forwards progress without the digest", async () => {
    fake.mockResolvedValue(new Response('{"status":"downloading","digest":"sha256:secret","total":4,"completed":1}\n{"status":"success"}\n', { status: 200 }))
    const result = await pullInstalledModel("qwen3:4b", linux, fake)
    expect("stream" in result).toBe(true)
    if (!("stream" in result)) return
    const text = await new Response(result.stream).text()
    expect(text).toContain('"completed":1')
    expect(text).toContain('"done":true')
    expect(text).not.toContain("sha256")
    const init = fake.mock.calls[0][1]
    expect(fake.mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/pull")
    expect(JSON.parse(init.body)).toEqual({ model: "qwen3:4b", stream: true })
    expect(init.headers.Authorization).toBeUndefined()
  })

  it("refuses a speech pull on Linux before any request", async () => {
    const result = await pullInstalledModel("phonon", linux, fake)
    expect(result).toMatchObject({ status: 409 })
    if (!("error" in result)) return
    expect(result.error).toMatch(/Not available in this build/)
    expect(result.error).toMatch(/Apple Silicon/)
    expect(fake).not.toHaveBeenCalled()
  })

  it("refuses a name outside the catalog", async () => {
    const result = await pullInstalledModel("llama3", linux, fake)
    expect(result).toEqual({ error: "That model is not in this build.", status: 400 })
    expect(fake).not.toHaveBeenCalled()
    const removed = await deleteInstalledModel("../qwen3:4b", linux, fake)
    expect(removed).toMatchObject({ status: 400 })
    expect(fake).not.toHaveBeenCalled()
  })

  it("deletes only through the loopback delete API", async () => {
    fake.mockResolvedValue(new Response(null, { status: 200 }))
    const removed = await deleteInstalledModel("qwen2.5vl:3b", linux, fake)
    expect(removed).toEqual({ ok: true })
    expect(fake.mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/delete")
    expect(fake.mock.calls[0][1].method).toBe("DELETE")
    expect(JSON.parse(fake.mock.calls[0][1].body)).toEqual({ model: "qwen2.5vl:3b" })
  })

  it("reads an image only after the vision model is installed", async () => {
    fake.mockResolvedValueOnce(json({ models: [] }))
    const missing = await describeLocalImage({ mediaType: "image/png", imageBase64: "a".repeat(20) }, linux, fake)
    expect(missing).toMatchObject({ status: 409 })
    expect(fake).toHaveBeenCalledTimes(1)

    fake.mockReset()
    fake.mockResolvedValueOnce(json({ models: [{ name: "qwen2.5vl:3b", size: 3 }] }))
    fake.mockResolvedValueOnce(json({ message: { content: "  ใบเสร็จ / a receipt  " } }))
    const described = await describeLocalImage({ mediaType: "image/png", imageBase64: "a".repeat(32) }, linux, fake)
    expect(described).toEqual({ text: "ใบเสร็จ / a receipt" })
    const body = JSON.parse(fake.mock.calls[1][1].body)
    expect(body.model).toBe("qwen2.5vl:3b")
    expect(body.messages[0].images).toEqual(["a".repeat(32)])
    expect(body.messages[0].content).toMatch(/do not file tax/i)
    expect(fake.mock.calls[1][0]).toBe("http://127.0.0.1:11434/api/chat")
  })

  it("speaks English on Apple Silicon and refuses the same call on Linux", async () => {
    const blocked = await speakLocalText("Hello from the shop.", linux, fake)
    expect(blocked).toMatchObject({ status: 409 })
    expect(fake).not.toHaveBeenCalled()

    const wav = new Uint8Array(64)
    wav.set([82, 73, 70, 70], 0)
    fake.mockResolvedValueOnce(json({ models: [{ name: "phonon:latest", size: 120 }] }))
    fake.mockResolvedValueOnce(new Response(wav, { status: 200, headers: { "Content-Type": "audio/wav" } }))
    const spoken = await speakLocalText("Hello from the shop.", mac, fake)
    expect(spoken).toMatchObject({ audio: wav })
    expect(fake.mock.calls[1][0]).toBe("http://127.0.0.1:11434/v1/audio/speech")
    expect(JSON.parse(fake.mock.calls[1][1].body)).toEqual({
      model: "phonon",
      input: "Hello from the shop.",
      voice: "default",
      response_format: "wav",
    })
  })

  it("draws on macOS from the image model and does not call it on Linux", async () => {
    const blocked = await drawLocalImage("a blue notebook", linux, fake)
    expect(blocked).toMatchObject({ status: 409 })
    expect(fake).not.toHaveBeenCalled()

    fake.mockResolvedValueOnce(json({ models: [{ name: "x/flux2-klein:4b", size: 5 }] }))
    fake.mockResolvedValueOnce(new Response('{"status":"generating"}\n{"image":"iVBORw0KGgoAAA"}\n', { status: 200 }))
    const drawn = await drawLocalImage("a blue notebook", mac, fake)
    expect(drawn).toEqual({ mediaType: "image/png", image: "iVBORw0KGgoAAA" })
    const body = JSON.parse(fake.mock.calls[1][1].body)
    expect(body.model).toBe("x/flux2-klein:4b")
    expect(body.prompt).toBe("a blue notebook")
    expect(fake.mock.calls[1][0]).toBe("http://127.0.0.1:11434/api/generate")
  })
})
