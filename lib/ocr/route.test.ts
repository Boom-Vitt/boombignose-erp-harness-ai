import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import sharp from "sharp"
import { createHash } from "node:crypto"

const auth = vi.hoisted(() => ({ response: null as Response | null }))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ getVerifiedApiContext: async () => auth.response ? { response: auth.response } : { ctx: { orgId: "workspace", userId: "member" } } }))

import { POST } from "@/app/api/ocr/page/route"
import { catalogModels, modelPullable } from "@/lib/ai/model-catalog"
import { validateRaster } from "./server"
import { OCR_LIMITS } from "./contracts"

function request(bytes: Uint8Array, headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1/api/ocr/page", { method: "POST", headers: { "Content-Type": "image/png", "X-OCR-Page": "1", "X-OCR-Pages": "1", "X-OCR-Source-SHA256": "a".repeat(64), ...headers }, body: new Uint8Array(bytes) })
}
function reply(content: string, done_reason = "stop") { return new Response(JSON.stringify({ done: true, done_reason, message: { content } })) }

describe("authenticated local review-only OCR endpoint", () => {
  const fake = vi.fn()
  let image: Buffer
  beforeEach(async () => {
    auth.response = null
    fake.mockReset(); vi.stubGlobal("fetch", fake)
    vi.stubEnv("OLLAMA_HOST", "127.0.0.1:11434")
    const model = catalogModels().find(item => (item.try === "vision" || item.modality === "vision") && modelPullable(item.id, { platform: process.platform, arch: process.arch }))
    if (!model) throw new Error("This build must include a local vision model")
    vi.stubEnv("OCR_MODEL", model.id)
    image = await sharp({ create: { width: 32, height: 24, channels: 3, background: "white" } }).png().toBuffer()
    fake.mockResolvedValueOnce(new Response(JSON.stringify({ details: { format: "safetensors" }, capabilities: ["completion", "vision"] })))
  })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

  it("returns the verified auth/origin boundary denial without reading/inferencing", async () => {
    auth.response = Response.json({ error: "Sign in required" }, { status: 401 })
    expect((await POST(request(image))).status).toBe(401)
    expect(fake).not.toHaveBeenCalled()
  })
  it("decodes real bytes and rejects corrupt, mismatched, animated/oversized or bad page uploads before inference", async () => {
    expect((await POST(request(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])))).status).toBe(400)
    expect((await POST(request(image, { "Content-Type": "image/jpeg" }))).status).toBe(415)
    expect((await POST(request(image, { "X-OCR-Page": "2" }))).status).toBe(400)
    expect((await POST(request(image, { "X-OCR-Pages": "13" }))).status).toBe(400)
    expect((await POST(request(image, { "Content-Length": String(OCR_LIMITS.pageBytes + 1) }))).status).toBe(413)
    const huge = await sharp({ create: { width: 2401, height: 4, channels: 3, background: "white" } }).png().toBuffer()
    await expect(validateRaster(huge, "image/png")).rejects.toThrow(/over-limit/)
    await expect(validateRaster(image.subarray(0, image.length - 20), "image/png")).rejects.toThrow(/Corrupt/)
    expect(fake).not.toHaveBeenCalled()
  })
  it("keeps verbatim text separate, quotes structured fields and returns source/page hashes without financial writes", async () => {
    const text = "ร้านสมชาย\n2026-11-06\nTotal 1,284.00\nVAT 84.00"
    fake.mockResolvedValueOnce(reply(text)).mockResolvedValueOnce(reply(JSON.stringify({ vendor: "ร้านสมชาย", date: "2026-11-06", documentNumber: null, description: null, subtotal: null, vat: "84.00", total: "1,284.00" })))
    const response = await POST(request(image))
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("no-store")
    const result = await response.json()
    expect(result).toMatchObject({ page: 1, totalPages: 1, sourceSha256: "a".repeat(64), rasterSha256: createHash("sha256").update(image).digest("hex"), text, fields: { totalSatang: 128400, vatSatang: 8400 } })
    expect(result.warnings.join(" ")).toMatch(/does not save, approve or post/)
    expect(fake).toHaveBeenCalledTimes(3)
    for (const [url, options] of fake.mock.calls) {
      expect(url).toMatch(/^http:\/\/127\.0\.0\.1:11434\/api\/(?:show|chat)$/)
      expect(options.redirect).toBe("error")
    }
    expect(JSON.parse(fake.mock.calls[0][1].body)).not.toHaveProperty("images")
    const first = JSON.parse(fake.mock.calls[1][1].body), second = JSON.parse(fake.mock.calls[2][1].body)
    expect(first.messages[1].images).toEqual([image.toString("base64")])
    expect(first.format).toBeUndefined()
    expect(second.format.type).toBe("object")
    expect(second.messages[1].images).toBeUndefined()
    expect(JSON.parse(second.messages[1].content)).toEqual({ sourceText: text })
  })
  it("returns a quoted Thai-month document date and Thai printed amounts without inventing normalized source values", async () => {
    const text = "ร้าน ตัวอย่างเลขไทย\nเลขที่ QA-TN-0001\nวันที่ ๖ พฤศจิกายน ๒๕๖๙\nยอดก่อนภาษี (THB): ๑,๐๐๐.๐๐\nภาษีมูลค่าเพิ่ม (THB): ๗๐.๐๐\nยอดรวมสุทธิ (THB): ๑,๐๗๐.๐๐"
    fake.mockResolvedValueOnce(reply(text)).mockResolvedValueOnce(reply(JSON.stringify({
      vendor: "ร้าน ตัวอย่างเลขไทย", date: "๖ พฤศจิกายน ๒๕๖๙", documentNumber: "QA-TN-0001", description: null,
      subtotal: "๑,๐๐๐.๐๐", vat: "๗๐.๐๐", total: "๑,๐๗๐.๐๐",
    })))
    const response = await POST(request(image))
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      text,
      fields: { date: "2026-11-06", documentNumber: "QA-TN-0001", subtotalSatang: 100000, vatSatang: 7000, totalSatang: 107000 },
    })
  })
  it("preserves source transcription when structured extraction fails", async () => {
    fake.mockResolvedValueOnce(reply("[unreadable]")).mockResolvedValueOnce(reply("not valid JSON"))
    const result = await (await POST(request(image))).json()
    expect(result.text).toBe("[unreadable]")
    expect(Object.values(result.fields).every(value => value === null)).toBe(true)
  })
  it("returns actionable missing-model status without an automatic pull or cloud fallback", async () => {
    fake.mockReset().mockResolvedValue(new Response("missing", { status: 404 }))
    const response = await POST(request(image))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "missing_model", error: expect.stringMatching(/Settings.*never pulls/) })
    expect(fake).toHaveBeenCalledTimes(1)
  })
  it("rejects nonlocal hosts, unlisted model overrides and truncated transcription", async () => {
    vi.stubEnv("OLLAMA_HOST", "https://cloud.example")
    expect((await POST(request(image))).status).toBe(503)
    expect(fake).not.toHaveBeenCalled()
    vi.stubEnv("OLLAMA_HOST", "127.0.0.1:11434"); vi.stubEnv("OCR_MODEL", "remote/cloud:latest")
    expect((await POST(request(image))).status).toBe(409)
    expect(fake).not.toHaveBeenCalled()
  })
  it("does not pass truncated OCR into structured extraction", async () => {
    fake.mockResolvedValue(reply("plausible incomplete receipt", "length"))
    expect((await POST(request(image))).status).toBe(422)
    expect(fake).toHaveBeenCalledTimes(2)
  })
  it("bounds concurrent inferences before another page can consume GPU memory", async () => {
    const { promise, resolve } = Promise.withResolvers<Response>()
    fake.mockReturnValue(promise)
    const first = POST(request(image))
    // The second request is rejected even while the first is decoding its page.
    expect((await POST(request(image))).status).toBe(429)
    resolve(new Response("missing", { status: 404 }))
    expect((await first).status).toBe(409)
  })
  it("forwards request cancellation to the local model without a fallback", async () => {
    const reached = Promise.withResolvers<void>()
    fake.mockImplementation((_url, options) => {
      const result = Promise.withResolvers<Response>()
      options.signal.addEventListener("abort", () => result.reject(options.signal.reason), { once: true })
      reached.resolve()
      return result.promise
    })
    const controller = new AbortController()
    const base = request(image)
    const pending = POST(new Request(base, { signal: controller.signal }))
    await reached.promise
    controller.abort()
    expect((await pending).status).toBe(499)
    expect(fake).toHaveBeenCalledTimes(2)
    expect(fake.mock.calls[1][1].signal.aborted).toBe(true)
  })
  it("does not send a document to a loopback cloud proxy disguised as a catalog model", async () => {
    fake.mockReset().mockResolvedValue(new Response(JSON.stringify({ remote_host: "https://cloud.example", remote_model: "remote", details: { format: "safetensors" }, capabilities: ["completion", "vision"] })))
    const response = await POST(request(image))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: "local_model_unavailable" })
    expect(fake).toHaveBeenCalledTimes(1)
    expect(fake.mock.calls[0][0]).toBe("http://127.0.0.1:11434/api/show")
    expect(JSON.parse(fake.mock.calls[0][1].body)).not.toHaveProperty("images")
  })
})
