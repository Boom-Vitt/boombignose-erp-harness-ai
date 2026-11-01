import { describe, expect, it } from "vitest"

import {
  buildSnapshot,
  catalogModelIds,
  createPullSanitizer,
  formatBytes,
  hostArch,
  hostOS,
  imageMediaType,
  modelPullable,
  namesMatch,
  parseGenerateLine,
  safeModelId,
  sanitizePullLine,
} from "./model-catalog"

describe("local model catalog", () => {
  it("ships the allowlist and no other weights", () => {
    expect(catalogModelIds()).toEqual(["qwen3:4b", "qwen2.5vl:3b", "x/flux2-klein:4b", "phonon"])
  })

  it("maps Node's Windows and x64 names onto the catalog", () => {
    expect(hostOS("win32")).toBe("windows")
    expect(hostArch("x64")).toBe("amd64")
    const windows = { platform: "win32" as const, arch: "x64" }
    expect(modelPullable("qwen3:4b", windows)).toBe(true)
    expect(modelPullable("qwen2.5vl:3b", windows)).toBe(true)
    expect(modelPullable("x/flux2-klein:4b", windows)).toBe(false)
    expect(modelPullable("phonon", windows)).toBe(false)
  })

  it("keeps image generation on macOS and speech on Apple Silicon", () => {
    expect(modelPullable("x/flux2-klein:4b", { platform: "darwin", arch: "x64" })).toBe(true)
    expect(modelPullable("phonon", { platform: "darwin", arch: "x64" })).toBe(false)
    expect(modelPullable("phonon", { platform: "darwin", arch: "arm64" })).toBe(true)
    expect(modelPullable("x/flux2-klein:4b", { platform: "linux", arch: "x64" })).toBe(false)
  })

  it("refuses names that are not the catalog", () => {
    expect(safeModelId("qwen3:4b")).toBe(true)
    expect(safeModelId("x/flux2-klein:4b")).toBe(true)
    expect(safeModelId("../qwen3:4b")).toBe(false)
    expect(safeModelId("qwen3:4b\nserve")).toBe(false)
    expect(safeModelId("Llama3")).toBe(false)
    expect(modelPullable("llama3", { platform: "linux", arch: "x64" })).toBe(false)
  })

  it("matches an installed tag without treating a different size as the same model", () => {
    expect(namesMatch("qwen3:4b", "qwen3:4b")).toBe(true)
    expect(namesMatch("phonon:latest", "phonon")).toBe(true)
    expect(namesMatch("qwen3:8b", "qwen3:4b")).toBe(false)
    expect(namesMatch("qwen2.5vl:7b", "qwen2.5vl:3b")).toBe(false)
  })

  it("shows install rows for text and vision, and says what this Linux build cannot run", () => {
    const snapshot = buildSnapshot(
      { platform: "linux", arch: "x64" },
      [{ name: "qwen3:4b", size: 2_500_000_000 }],
      { up: true },
    )
    expect(snapshot.daemonUp).toBe(true)
    expect(snapshot.rows.map((row) => row.id)).toEqual(["qwen3:4b", "qwen2.5vl:3b"])
    expect(snapshot.rows[0]?.installed).toBe(true)
    expect(snapshot.rows[1]?.installed).toBe(false)
    expect(snapshot.blocked.map((item) => item.modality)).toEqual(["image", "tts", "video", "asr", "voice-clone"])
    expect(snapshot.blocked.map((item) => item.reasonEn).join(" ")).toMatch(/Not available in this build/)
    expect(snapshot.blocked.find((item) => item.modality === "asr")?.reasonEn).toMatch(/Whisper/)
    expect(snapshot.blocked.find((item) => item.modality === "video")?.reasonEn).toMatch(/ComfyUI/)
    expect(snapshot.blocked.find((item) => item.modality === "voice-clone")?.reasonEn).toMatch(/not a clone|built-in voices/i)
  })

  it("offers image and speech rows on Apple Silicon", () => {
    const snapshot = buildSnapshot({ platform: "darwin", arch: "arm64" }, [], { up: false })
    expect(snapshot.rows.map((row) => row.modality)).toEqual(["text", "vision", "image", "tts"])
    expect(snapshot.blocked.map((item) => item.modality)).toEqual(["video", "asr", "voice-clone"])
    expect(snapshot.daemonMessage).toMatch(/Ollama Desktop/)
    expect(snapshot.daemonMessage).toMatch(/ไม่ต้องติดตั้ง/)
  })

  it("keeps download progress and drops digests", () => {
    const event = sanitizePullLine(
      JSON.stringify({ status: "downloading", digest: "sha256:abcdef", total: 100, completed: 25, error: "x".repeat(400) }),
    )
    expect(event).toEqual({ status: "downloading", total: 100, completed: 25, error: "x".repeat(200) })
    expect(JSON.stringify(event)).not.toContain("sha256")
    const sanitizer = createPullSanitizer()
    const first = sanitizer.push('{"status":"pulling manifest"}\n{"status":"success"}\n')
    expect(first).toContain('"status":"pulling manifest"')
    expect(first).toContain('"done":true')
    expect(sanitizer.finish()).toBe("")
  })

  it("formats a byte size and recognizes a picture", () => {
    expect(formatBytes(2_500_000_000)).toBe("2.3 GB")
    expect(imageMediaType("iVBORw0KGgoAAA")).toBe("image/png")
    expect(parseGenerateLine('{"image":"/9j/abc","status":"done"}')).toEqual({ status: "done", image: "/9j/abc" })
    expect(parseGenerateLine(`{"image":"${"a".repeat(8_000_001)}"}`)?.error).toMatch(/larger/)
  })
})
