import { describe, expect, it } from "vitest"

import {
  buildSnapshot,
  catalogModels,
  createPullSanitizer,
  formatBytes,
  hostArch,
  hostOS,
  modelPullable,
  namesMatch,
  parseGenerateLine,
  safeModelId,
  sanitizePullLine,
} from "./model-catalog"

const textModel = catalogModels().find(model => model.modality === "text")!
const visionModel = catalogModels().find(model => model.modality === "vision")!

describe("local model catalog", () => {
  it("maps Node's Windows and x64 names onto the catalog", () => {
    expect(hostOS("win32")).toBe("windows")
    expect(hostArch("x64")).toBe("amd64")
    const windows = { platform: "win32" as const, arch: "x64" }
    expect(modelPullable(textModel.id, windows)).toBe(true)
    expect(modelPullable(visionModel.id, windows)).toBe(true)
    expect(modelPullable("x/flux2-klein:4b", windows)).toBe(false)
    expect(modelPullable("phonon", windows)).toBe(false)
  })

  it("keeps image generation on macOS and speech on Apple Silicon", () => {
    expect(modelPullable("x/flux2-klein:4b", { platform: "darwin", arch: "x64" })).toBe(true)
    expect(modelPullable("phonon", { platform: "darwin", arch: "x64" })).toBe(false)
    expect(modelPullable("phonon", { platform: "darwin", arch: "arm64" })).toBe(true)
    expect(modelPullable("x/flux2-klein:4b", { platform: "linux", arch: "x64" })).toBe(false)
  })

  it("rejects unsafe model identifiers and prevents pulling unlisted identifiers", () => {
    expect(safeModelId("local-checkpoint:3b")).toBe(true)
    expect(safeModelId("x/flux2-klein:4b")).toBe(true)
    expect(safeModelId("../qwen2.5:3b")).toBe(false)
    expect(safeModelId("qwen2.5:3b\nserve")).toBe(false)
    expect(safeModelId("Llama3")).toBe(false)
    expect(safeModelId("a".repeat(81))).toBe(false)
    expect(safeModelId("/absolute/model")).toBe(false)
    expect(safeModelId("model\\path")).toBe(false)
    expect(safeModelId("model\u0000name")).toBe(false)
    expect(modelPullable("llama3", { platform: "linux", arch: "x64" })).toBe(false)
  })

  it("matches an installed tag without treating a different size as the same model", () => {
    expect(namesMatch("qwen2.5:3b", "qwen2.5:3b")).toBe(true)
    expect(namesMatch("phonon:latest", "phonon")).toBe(true)
    expect(namesMatch("qwen2.5:7b", "qwen2.5:3b")).toBe(false)
    expect(namesMatch("qwen2.5vl:7b", "qwen2.5vl:3b")).toBe(false)
  })

  it("shows install rows for text and vision, and says what this Linux build cannot run", () => {
    const snapshot = buildSnapshot(
      { platform: "linux", arch: "x64" },
      [{ name: `${textModel.id}:latest`, size: 2_500_000_000 }, { name: "unlisted-checkpoint", size: 42 }],
      { up: true },
    )
    expect(snapshot.daemonUp).toBe(true)
    expect(snapshot.rows.find(row => row.id === textModel.id)).toMatchObject({ installed: true, installedBytes: 2_500_000_000 })
    expect(snapshot.rows.find(row => row.id === visionModel.id)).toMatchObject({ installed: false, installedBytes: null })
    expect(snapshot.rows.some(row => row.id === "unlisted-checkpoint")).toBe(false)
    expect(snapshot.rows.some(row => row.modality === "image" || row.modality === "tts")).toBe(false)
    expect(snapshot.blocked.map(item => item.modality)).toEqual(expect.arrayContaining(["image", "tts", "video", "asr", "voice-clone"]))
    expect(snapshot.daemonMessage).toBeNull()
  })

  it("offers supported local media runtimes on Apple Silicon and preserves an actionable daemon error", () => {
    const snapshot = buildSnapshot({ platform: "darwin", arch: "arm64" }, [], { up: false, message: "Local model service is offline." })
    expect(snapshot.rows.map(row => row.modality)).toEqual(expect.arrayContaining(["text", "vision", "image", "tts"]))
    expect(snapshot.rows.every(row => !row.installed && row.installedBytes === null)).toBe(true)
    expect(snapshot.blocked.map(item => item.modality)).toEqual(expect.arrayContaining(["video", "asr", "voice-clone"]))
    expect(snapshot.daemonUp).toBe(false)
    expect(snapshot.daemonMessage).toBe("Local model service is offline.")
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

  it("formats unavailable and bounded byte sizes", () => {
    expect(formatBytes(2_500_000_000)).toBe("2.3 GB")
    expect(formatBytes(0)).toBe("0 B")
    expect(formatBytes(null)).toBeNull()
    expect(formatBytes(-1)).toBeNull()
    expect(formatBytes(Number.NaN)).toBeNull()
  })

  it("rejects malformed or oversized generated-image events", () => {
    expect(parseGenerateLine("not JSON")?.error).toMatch(/could not read/)
    expect(parseGenerateLine("   ")).toBeNull()
    expect(parseGenerateLine('{"ignored":true}')).toBeNull()
    expect(parseGenerateLine(`{"image":"${"a".repeat(8_000_001)}"}`)).toEqual({ error: expect.stringMatching(/larger/) })
  })

  it("handles split progress events and an unterminated final event without exposing digests", () => {
    const sanitizer = createPullSanitizer()
    expect(sanitizer.push('{"status":"down')).toBe("")
    const progress = sanitizer.push('loading","digest":"private-digest","completed":5,"total":10}\n{"status":"succ')
    expect(JSON.parse(progress)).toEqual({ status: "downloading", completed: 5, total: 10 })
    expect(sanitizer.push('ess"}')).toBe("")
    expect(JSON.parse(sanitizer.finish())).toEqual({ status: "success", done: true })
    expect(sanitizer.finish()).toBe("")
  })

  it("drops invalid counters and clips untrusted progress text", () => {
    expect(sanitizePullLine(JSON.stringify({ status: "x".repeat(200), completed: -1, total: 0 }))).toEqual({ status: "x".repeat(120) })
    expect(sanitizePullLine("not JSON")).toEqual({ error: expect.stringMatching(/could not read/) })
    expect(sanitizePullLine('{"digest":"private-digest","total":100}')).toBeNull()
  })
})
