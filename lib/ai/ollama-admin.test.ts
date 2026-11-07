import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import sharp from "sharp"

vi.mock("server-only", () => ({}))

import {
  deleteInstalledModel,
  describeLocalImage,
  drawLocalImage,
  listInstalledModels,
  pullInstalledModel,
  speakLocalText,
} from "./ollama-admin"
import { catalogModels, VISION_MODEL } from "./model-catalog"

const linux = { platform: "linux" as const, arch: "x64" }
const mac = { platform: "darwin" as const, arch: "arm64" }
const textModel = catalogModels().find(model => model.modality === "text")!

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

describe("ollama model admin", () => {
  const fake = vi.fn()
  let png: string
  const installedVision = (metadata: unknown = { details: { format: "gguf" }, capabilities: ["completion", "vision"] }) => {
    fake.mockResolvedValueOnce(json({ models: [{ name: VISION_MODEL, size: 3 }] }))
      .mockResolvedValueOnce(json(metadata))
  }

  beforeEach(async () => {
    png = (await sharp({ create: { width: 16, height: 12, channels: 3, background: "white" } }).png().toBuffer()).toString("base64")
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
    fake.mockResolvedValue(json({ models: [{ name: "qwen2.5:3b", size: 10 }, { name: "bad\nname", size: 1 }, { name: 3 }] }))
    const listed = await listInstalledModels(fake)
    expect(listed).toEqual({ up: true, models: [{ name: "qwen2.5:3b", size: 10 }] })
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
    const result = await pullInstalledModel(textModel.id, linux, fake)
    expect("stream" in result).toBe(true)
    if (!("stream" in result)) return
    const text = await new Response(result.stream).text()
    expect(text).toContain('"completed":1')
    expect(text).toContain('"done":true')
    expect(text).not.toContain("sha256")
    const init = fake.mock.calls[0][1]
    expect(fake.mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/pull")
    expect(JSON.parse(init.body)).toEqual({ model: textModel.id, stream: true })
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
    const removed = await deleteInstalledModel("../qwen2.5:3b", linux, fake)
    expect(removed).toMatchObject({ status: 400 })
    expect(fake).not.toHaveBeenCalled()
  })

  it("deletes an installed checkpoint only through the loopback API", async () => {
    fake.mockResolvedValueOnce(new Response(null, { status: 200 }))
    const removed = await deleteInstalledModel(textModel.id, linux, fake)
    expect(removed).toEqual({ ok: true })
    expect(fake).toHaveBeenCalledTimes(1)
    expect(fake.mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/delete")
    expect(fake.mock.calls[0][1].redirect).toBe("error")
    expect(fake.mock.calls[0][1].method).toBe("DELETE")
  })

  it("does not transmit pixels or automatically pull a missing vision model", async () => {
    fake.mockResolvedValueOnce(json({ models: [] }))
    const missing = await describeLocalImage({ mediaType: "image/png", imageBase64: png }, linux, fake)
    expect(missing).toMatchObject({ status: 409, error: expect.stringMatching(/Install/) })
    expect(fake).toHaveBeenCalledTimes(1)
    expect(fake.mock.calls[0][0]).toMatch(/\/api\/tags$/)
    expect(fake.mock.calls[0][1]).not.toHaveProperty("body")
  })

  it.each(["gguf", "safetensors"])("sends a decoded image only after verifying a local %s completion checkpoint", async (format) => {
    installedVision({ details: { format }, capabilities: ["completion", "vision"] })
    fake.mockResolvedValueOnce(json({ message: { content: "  ใบเสร็จ / a receipt  " } }))
    const described = await describeLocalImage({ mediaType: "image/png", imageBase64: png }, linux, fake)
    expect(described).toEqual({ text: "ใบเสร็จ / a receipt" })
    expect(fake.mock.calls.map(call => new URL(call[0]).pathname)).toEqual(["/api/tags", "/api/show", "/api/chat"])
    expect(JSON.parse(fake.mock.calls[1][1].body)).toEqual({ model: VISION_MODEL })
    expect(fake.mock.calls[1][1].body).not.toContain(png)
    const body = JSON.parse(fake.mock.calls[2][1].body)
    expect(body.messages[0].images).toEqual([png])
    for (const [url, init] of fake.mock.calls) {
      expect(String(url)).toMatch(/^http:\/\/127\.0\.0\.1:11434\//)
      expect(init.redirect).toBe("error")
    }
  })

  it.each([
    { details: { format: "gguf" }, capabilities: ["completion"], remote_host: "https://cloud.example" },
    { details: { format: "safetensors" }, capabilities: ["completion"], remote_model: "remote-checkpoint" },
    { details: { format: "onnx" }, capabilities: ["completion"] },
    { details: { format: "gguf" }, capabilities: ["embedding"] },
    null,
  ])("refuses remote-backed or unsupported aliases without transmitting pixels: %j", async (metadata) => {
    installedVision(metadata)
    const result = await describeLocalImage({ mediaType: "image/png", imageBase64: png }, linux, fake)
    expect(result).toMatchObject({ status: 409 })
    expect(fake).toHaveBeenCalledTimes(2)
    expect(fake.mock.calls[1][0]).toMatch(/\/api\/show$/)
    expect(fake.mock.calls[1][1].body).not.toContain(png)
  })

  it.each([302, 404, 500])("fails closed on HTTP %s during checkpoint verification", async (status) => {
    fake.mockResolvedValueOnce(json({ models: [{ name: VISION_MODEL, size: 3 }] }))
      .mockResolvedValueOnce(new Response(null, { status, headers: { Location: "https://cloud.example/api/show" } }))
    expect(await describeLocalImage({ mediaType: "image/png", imageBase64: png }, linux, fake)).toMatchObject({ status: 409 })
    expect(fake).toHaveBeenCalledTimes(2)
    expect(fake.mock.calls[1][1].redirect).toBe("error")
  })

  it("rejects corrupt, mismatched, oversized and over-dimension images before any model request", async () => {
    const tooWide = await sharp({ create: { width: 2401, height: 2, channels: 3, background: "white" } }).png().toBuffer()
    for (const [input, status] of [
      [{ mediaType: "image/png", imageBase64: "a".repeat(32) }, 415],
      [{ mediaType: "image/jpeg", imageBase64: png }, 415],
      [{ mediaType: "image/png", imageBase64: "a".repeat(2_000_001) }, 400],
      [{ mediaType: "image/png", imageBase64: tooWide.toString("base64") }, 400],
      [{ mediaType: "image/png", imageBase64: Buffer.from(png, "base64").subarray(0, 40).toString("base64") }, 400],
    ] as const) {
      expect(await describeLocalImage(input, linux, fake)).toMatchObject({ status })
    }
    expect(fake).not.toHaveBeenCalled()
  })

  it("never promotes thinking to an image description and bounds returned answer text", async () => {
    installedVision()
    fake.mockResolvedValueOnce(json({ message: { content: "", thinking: "a slip" } }))
    expect(await describeLocalImage({ mediaType: "image/png", imageBase64: png }, linux, fake)).toEqual({ error: "The vision model returned no text.", status: 502 })

    installedVision()
    fake.mockResolvedValueOnce(json({ message: { content: "x".repeat(5000) } }))
    const result = await describeLocalImage({ mediaType: "image/png", imageBase64: png }, linux, fake)
    expect("text" in result && result.text.length).toBe(4000)
  })

  it("does not retry or follow redirects when image inference fetch fails", async () => {
    installedVision()
    fake.mockRejectedValueOnce(new TypeError("redirect disallowed"))
    expect(await describeLocalImage({ mediaType: "image/png", imageBase64: png }, linux, fake)).toMatchObject({ status: 503 })
    expect(fake).toHaveBeenCalledTimes(3)
    expect(fake.mock.calls[2][1].redirect).toBe("error")
  })

  it("refuses unsupported speech and invalid speech input before contacting a model", async () => {
    expect(await speakLocalText("Hello from the shop.", linux, fake)).toMatchObject({ status: 409 })
    expect(await speakLocalText(" ", mac, fake)).toMatchObject({ status: 400 })
    expect(await speakLocalText("x".repeat(201), mac, fake)).toMatchObject({ status: 400 })
    expect(fake).not.toHaveBeenCalled()
  })

  it.each([0, 43, 8_000_001])("rejects a speech response of %s bytes rather than returning unusable audio", async (size) => {
    fake.mockResolvedValueOnce(json({ models: [{ name: "phonon:latest", size: 120 }] }))
      .mockResolvedValueOnce(new Response(new Uint8Array(size), { status: 200 }))
    expect(await speakLocalText("Hello from the shop.", mac, fake)).toMatchObject({ status: 502, error: expect.stringMatching(/did not return audio/) })
  })

  it("refuses unsupported image generation and invalid prompts before contacting a model", async () => {
    expect(await drawLocalImage("a blue notebook", linux, fake)).toMatchObject({ status: 409 })
    expect(await drawLocalImage(" ", mac, fake)).toMatchObject({ status: 400 })
    expect(await drawLocalImage("x".repeat(301), mac, fake)).toMatchObject({ status: 400 })
    expect(fake).not.toHaveBeenCalled()
  })

  it.each([
    ['{"status":"done"}\n', /no picture/],
    ['{"error":"GPU unavailable"}\n', /GPU unavailable/],
    ["not JSON\n", /could not read/],
  ] as const)("reports an image-generation failure rather than returning a picture: %s", async (body, error) => {
    fake.mockResolvedValueOnce(json({ models: [{ name: "x/flux2-klein:4b", size: 5 }] }))
      .mockResolvedValueOnce(new Response(body, { status: 200 }))
    expect(await drawLocalImage("a blue notebook", mac, fake)).toMatchObject({ status: 502, error: expect.stringMatching(error) })
  })
})
