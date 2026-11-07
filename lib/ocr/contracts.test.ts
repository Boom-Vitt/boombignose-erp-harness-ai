import { describe, expect, it } from "vitest"
import sharp from "sharp"
import { OCR_LIMITS, readBoundedBody, sniffOcrMime } from "./contracts"
import { rasterDimensions } from "./image"

describe("bounded OCR upload reads", () => {
  it("reads chunks only within the byte cap and cancels a lying/no-length stream", async () => {
    let cancelled = false
    let chunks = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { chunks++; controller.enqueue(new Uint8Array(4)) },
      cancel() { cancelled = true },
    })
    await expect(readBoundedBody(new Response(body), 7)).rejects.toThrow(/byte limit/)
    expect(cancelled).toBe(true)
    expect(chunks).toBeLessThanOrEqual(4)
  })
  it("rejects a declared oversized body before reading and checks an abort", async () => {
    await expect(readBoundedBody(new Response("x", { headers: { "Content-Length": "100" } }), 10)).rejects.toThrow(/byte limit/)
    const signal = AbortSignal.abort()
    await expect(readBoundedBody(new Response("x"), 10, signal)).rejects.toThrow()
    expect(new TextDecoder().decode(await readBoundedBody(new Response("abc"), 3))).toBe("abc")
  })
})

describe("real raster header inspection before bitmap allocation", () => {
  it("recognizes real generated PNG/JPEG/WebP bytes and exact dimensions", async () => {
    for (const format of ["png", "jpeg", "webp"] as const) {
      const bytes = await sharp({ create: { width: 32, height: 24, channels: 3, background: "white" } }).toFormat(format).toBuffer()
      expect(sniffOcrMime(bytes)).toBe(`image/${format}`)
      expect(rasterDimensions(bytes)).toEqual({ width: 32, height: 24, mime: `image/${format}` })
    }
  })
  it("rejects disguised SVG/HTML, corrupt headers and oversized dimensions before decode", () => {
    for (const source of ["<svg xmlns='http://www.w3.org/2000/svg' />", "<html>receipt</html>"]) expect(sniffOcrMime(new TextEncoder().encode(source))).toBeNull()
    expect(() => rasterDimensions(new Uint8Array([255, 216, 255]))).toThrow()
    const bytes = new Uint8Array(33)
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10])
    const view = new DataView(bytes.buffer)
    view.setUint32(8, 13); bytes.set(new TextEncoder().encode("IHDR"), 12)
    view.setUint32(16, OCR_LIMITS.sourcePixels); view.setUint32(20, 2)
    expect(() => rasterDimensions(bytes)).toThrow(/exceeds/)
  })
})
