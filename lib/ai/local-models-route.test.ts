import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ role: "owner" as string | null }))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({
  getOrgContext: async () =>
    state.role
      ? { role: state.role, orgId: "org", userId: "user", email: null, orgName: "Workspace" }
      : null,
}))

import { DELETE, GET } from "@/app/api/local-models/route"
import { POST as pull } from "@/app/api/local-models/pull/route"
import { POST as vision } from "@/app/api/local-models/vision/route"
import { POST as speech } from "@/app/api/local-models/speech/route"
import { POST as image } from "@/app/api/local-models/image/route"

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

describe("local model routes", () => {
  const fake = vi.fn()

  beforeEach(() => {
    state.role = "owner"
    fake.mockReset()
    vi.stubGlobal("fetch", fake)
    vi.stubEnv("OLLAMA_HOST", "")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("lists text and vision for a signed-in member and hides weights that cannot run here", async () => {
    state.role = "member"
    fake.mockResolvedValue(json({ models: [{ name: "qwen2.5:3b:latest", size: 20 }] }))
    const response = await GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.daemonUp).toBe(true)
    expect(body.rows.find((row: { id: string }) => row.id === "qwen2.5:3b")?.installed).toBe(true)
    expect(body.rows.some((row: { id: string }) => row.id === "qwen2.5vl:3b")).toBe(true)
    const blocked = body.blocked.map((item: { modality: string }) => item.modality)
    expect(blocked).toEqual(expect.arrayContaining(["video", "asr", "voice-clone"]))
    if (process.platform !== "darwin") expect(blocked).toContain("image")
    if (!(process.platform === "darwin" && process.arch === "arm64")) expect(blocked).toContain("tts")
  })

  it("requires a sign-in and an owner or admin to download", async () => {
    state.role = null
    const signedOut = await pull(new Request("http://127.0.0.1/api/local-models/pull", { method: "POST", body: "{}" }))
    expect(signedOut.status).toBe(401)
    state.role = "accountant"
    const denied = await DELETE(new Request("http://127.0.0.1/api/local-models", { method: "DELETE", body: JSON.stringify({ model: "qwen2.5:3b" }) }))
    expect(denied.status).toBe(403)
    expect(fake).not.toHaveBeenCalled()
  })

  it("streams a text-model download and refuses models this build cannot run", async () => {
    fake.mockResolvedValue(new Response('{"status":"success"}\n', { status: 200 }))
    const response = await pull(new Request("http://127.0.0.1/api/local-models/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "qwen2.5:3b" }),
    }))
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('"done":true')
    expect(JSON.parse(fake.mock.calls[0][1].body).model).toBe("qwen2.5:3b")

    fake.mockClear()
    const unknown = await pull(new Request("http://127.0.0.1/api/local-models/pull", {
      method: "POST",
      body: JSON.stringify({ model: "llama3" }),
    }))
    expect(unknown.status).toBe(400)
    expect(fake).not.toHaveBeenCalled()

    if (!(process.platform === "darwin" && process.arch === "arm64")) {
      const speechPull = await pull(new Request("http://127.0.0.1/api/local-models/pull", {
        method: "POST",
        body: JSON.stringify({ model: "phonon" }),
      }))
      expect(speechPull.status).toBe(409)
      expect(await speechPull.json()).toMatchObject({ error: expect.stringMatching(/Not available in this build/) })
      expect(fake).not.toHaveBeenCalled()
    }
  })

  it("does not contact a remote model host", async () => {
    vi.stubEnv("OLLAMA_HOST", "https://models.example:11434")
    const response = await GET()
    const body = await response.json()
    expect(body.daemonUp).toBe(false)
    expect(JSON.stringify(body)).not.toContain("models.example")
    expect(fake).not.toHaveBeenCalled()
  })

  it("describes an image on the vision model and blocks speech and image generation where they cannot run", async () => {
    fake.mockResolvedValueOnce(json({ models: [{ name: "qwen2.5vl:3b", size: 3 }] }))
    fake.mockResolvedValueOnce(json({ message: { content: "visible text" } }))
    const described = await vision(new Request("http://127.0.0.1/api/local-models/vision", {
      method: "POST",
      body: JSON.stringify({ mediaType: "image/png", imageBase64: "a".repeat(32) }),
    }))
    expect(described.status).toBe(200)
    expect(await described.json()).toEqual({ text: "visible text" })

    if (process.platform !== "darwin") {
      const drawn = await image(new Request("http://127.0.0.1/api/local-models/image", {
        method: "POST",
        body: JSON.stringify({ prompt: "a notebook" }),
      }))
      expect(drawn.status).toBe(409)
    }
    if (!(process.platform === "darwin" && process.arch === "arm64")) {
      const spoken = await speech(new Request("http://127.0.0.1/api/local-models/speech", {
        method: "POST",
        body: JSON.stringify({ text: "Hello" }),
      }))
      expect(spoken.status).toBe(409)
    }
  })
})
