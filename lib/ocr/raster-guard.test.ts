import { afterEach, describe, expect, it, vi } from "vitest"
import sharp from "sharp"

vi.mock("server-only", () => ({}))
import { decodeRaster, parseRasterReply } from "./raster-guard"

const wire = (value: unknown) => new TextEncoder().encode(JSON.stringify(value))
afterEach(() => vi.unstubAllEnvs())

describe("bounded native raster validation", () => {
  it("fully decodes real PNG, JPEG and lossy/lossless/alpha WebP without changing their dimensions", async () => {
    const source = { create: { width: 32, height: 24, channels: 4 as const, background: { r: 80, g: 40, b: 20, alpha: 0.5 } } }
    const fixtures = [
      { bytes: await sharp(source).png().toBuffer(), mime: "image/png" },
      { bytes: await sharp(source).jpeg().toBuffer(), mime: "image/jpeg" },
      { bytes: await sharp(source).webp({ lossless: true }).toBuffer(), mime: "image/webp" },
      { bytes: await sharp(source).webp({ lossless: false }).toBuffer(), mime: "image/webp" },
      { bytes: await sharp(source).removeAlpha().webp({ lossless: false }).toBuffer(), mime: "image/webp" },
    ]
    for (const fixture of fixtures) {
      await expect(decodeRaster(fixture.bytes)).resolves.toEqual({ mime: fixture.mime, width: 32, height: 24 })
      await expect(decodeRaster(fixture.bytes.subarray(0, fixture.bytes.length - 12))).rejects.toMatchObject({ kind: "invalid" })
    }
  })

  it("rejects actual over-edge and over-pixel images before bitmap decode", async () => {
    for (const [width, height] of [[2401, 1], [2000, 2001]]) {
      const image = await sharp({ create: { width, height, channels: 3, background: "white" } }).png().toBuffer()
      await expect(decodeRaster(image)).rejects.toMatchObject({ kind: "invalid" })
    }
  })

  it("rejects WebP animation flags and a small canvas hiding a larger real bitstream", async () => {
    const image = await sharp({ create: { width: 32, height: 24, channels: 4, background: { r: 1, g: 2, b: 3, alpha: 0.5 } } }).webp().toBuffer()
    expect(image.toString("ascii", 12, 16)).toBe("VP8X")
    const animated = Buffer.from(image)
    animated[20] |= 2
    await expect(decodeRaster(animated)).rejects.toMatchObject({ kind: "invalid" })
    const mismatched = Buffer.from(image)
    mismatched.fill(0, 24, 30)
    await expect(decodeRaster(mismatched)).rejects.toMatchObject({ kind: "invalid" })
  })

  it("classifies unavailable helper configuration without falling back to PATH", async () => {
    vi.stubEnv("BOOMBIGNOSE_RASTER_HELPER", "boombignose-image")
    await expect(decodeRaster(new Uint8Array([1]))).rejects.toMatchObject({ kind: "unavailable" })
  })

  it("preserves preexisting request cancellation", async () => {
    const controller = new AbortController()
    const reason = new Error("request cancelled")
    controller.abort(reason)
    await expect(decodeRaster(new Uint8Array([1]), controller.signal)).rejects.toBe(reason)
  })
})

  it("cancels an in-flight native decode without replacing the request reason", async () => {
    const image = await sharp({ create: { width: 2000, height: 2000, channels: 3, background: "white" } }).png().toBuffer()
    const controller = new AbortController()
    const reason = new Error("page request disconnected")
    const decoding = decodeRaster(image, controller.signal)
    controller.abort(reason)
    await expect(decoding).rejects.toBe(reason)
  })

describe("strict bounded helper reply", () => {
  it("accepts exact metadata at the configured boundaries", () => {
    expect(parseRasterReply(wire({ ok: true, mime: "image/png", width: 2000, height: 2000 }))).toEqual({ mime: "image/png", width: 2000, height: 2000 })
    expect(parseRasterReply(wire({ ok: true, mime: "image/webp", width: 2400, height: 1 }))).toEqual({ mime: "image/webp", width: 2400, height: 1 })
  })

  it.each([
    null, [], {}, { ok: true, mime: ["image/png"], width: 1, height: 1 },
    { ok: true, mime: "image/png", width: 2401, height: 1 },
    { ok: true, mime: "image/png", width: 2001, height: 2000 },
    { ok: true, mime: "image/png", width: -1, height: 1 },
    { ok: true, mime: "image/png", width: 1.5, height: 1 },
    { ok: true, mime: "image/png", width: "1", height: 1 },
    { ok: true, mime: "image/svg+xml", width: 1, height: 1 },
    { ok: true, mime: "image/png", width: 1, height: 1, secret: "unexpected" },
    { ok: false, code: "unknown" }, { ok: false, code: "framing" },
  ])("fails closed on malformed or inconsistent metadata %#", value => {
    expect(() => parseRasterReply(wire(value))).toThrow(expect.objectContaining({ kind: "unavailable" }))
  })

  it("distinguishes rejected images from broken protocol and bounds all output", () => {
    for (const code of ["size", "unsupported", "corrupt", "animated", "dimensions"]) {
      expect(() => parseRasterReply(wire({ ok: false, code }))).toThrow(expect.objectContaining({ kind: "invalid" }))
    }
    for (const bytes of [new Uint8Array(), new Uint8Array(513), new Uint8Array([255]), new TextEncoder().encode('{"ok":false,"code":"corrupt"}\n{}')]) {
      expect(() => parseRasterReply(bytes)).toThrow(expect.objectContaining({ kind: "unavailable" }))
    }
  })
})
