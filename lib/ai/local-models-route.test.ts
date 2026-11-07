import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import sharp from "sharp"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"

const state = vi.hoisted(() => ({
  userId: "11111111-1111-4111-8111-111111111111",
  role: "owner",
  signedIn: true,
  currentLevel: "aal2" as string | null,
  nextLevel: "aal2" as string | null,
  client: {} as object,
}))

vi.mock("server-only", () => ({}))
vi.mock("react", () => ({ cache: (fn: unknown) => fn }))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }))
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`Unexpected redirect: ${path}`) },
  forbidden: () => { throw new Error("Unexpected page-level forbidden interrupt") },
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  ...state.client,
  auth: {
    getUser: async () => ({ data: { user: state.signedIn ? { id: state.userId, factors: [{ status: "verified" }] } : null }, error: null }),
    getSession: async () => ({ data: { session: state.signedIn ? { access_token: "verified-fixture-token" } : null }, error: null }),
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: state.currentLevel, nextLevel: state.nextLevel }, error: null }) },
  },
}) }))

import { DELETE, GET } from "@/app/api/local-models/route"
import { POST as pull } from "@/app/api/local-models/pull/route"
import { POST as vision } from "@/app/api/local-models/vision/route"
import { POST as speech } from "@/app/api/local-models/speech/route"
import { POST as image } from "@/app/api/local-models/image/route"
import { catalogModels, VISION_MODEL } from "./model-catalog"

const origin = "http://127.0.0.1:3100"
const textModel = catalogModels().find(model => model.modality === "text")!
const mutations = [
  { name: "pull", method: "POST", handler: pull },
  { name: "delete", method: "DELETE", handler: DELETE },
  { name: "vision", method: "POST", handler: vision },
  { name: "speech", method: "POST", handler: speech },
  { name: "image", method: "POST", handler: image },
]
function request(path: string, body?: unknown, headers: Record<string, string> = {}, method = "POST") {
  return new Request(`${origin}/api/local-models/${path}`, {
    method, headers: { "Content-Type": "application/json", Origin: origin, ...headers },
    ...(method === "GET" ? {} : { body: JSON.stringify(body ?? {}) }),
  })
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

describe("local model routes", () => {
  const fake = vi.fn()
  let png: string

  beforeEach(async () => {
    state.role = "owner"
    state.signedIn = true
    state.currentLevel = "aal2"
    state.nextLevel = "aal2"
    state.client = databaseFixture({ memberships: [{ user_id: state.userId, org_id: "org", role: state.role }], organizations: [{ id: "org", name: "Workspace" }] })
    fake.mockReset()
    vi.stubGlobal("fetch", fake)
    vi.stubEnv("OLLAMA_HOST", "")
    vi.stubEnv("NEXT_PUBLIC_APP_URL", origin)
    vi.stubEnv("BOOMBIGNOSE_LOCAL_ORIGIN", "")
    vi.stubEnv("BOOMBIGNOSE_OPERATOR_USER_IDS", state.userId)
    png = (await sharp({ create: { width: 16, height: 12, channels: 3, background: "white" } }).png().toBuffer()).toString("base64")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("lists installed checkpoints for a verified member without requiring settings permission", async () => {
    state.client = databaseFixture({ memberships: [{ user_id: state.userId, org_id: "org", role: "member" }], organizations: [{ id: "org", name: "Workspace" }] })
    fake.mockResolvedValueOnce(json({ models: [{ name: `${textModel.id}:latest`, size: 20 }] }))
    const response = await GET(request("", undefined, {}, "GET"))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.daemonUp).toBe(true)
    expect(body.rows.find((row: { id: string }) => row.id === textModel.id)).toMatchObject({ installed: true, installedBytes: 20 })
  })

  it.each([{ name: "list", method: "GET", handler: GET }, ...mutations])("requires a verified sign-in for $name", async ({ name, method, handler }) => {
    state.signedIn = false
    const response = await handler(request(name, {}, {}, method))
    expect(response.status).toBe(401)
    expect(fake).not.toHaveBeenCalled()
  })

  it.each(mutations)("rejects missing/foreign Origin before $name can contact a runtime", async ({ name, method, handler }) => {
    for (const untrusted of [null, "https://evil.example"]) {
      const req = request(name, { model: textModel.id, mediaType: "image/png", imageBase64: png }, {}, method)
      if (untrusted === null) req.headers.delete("origin")
      else req.headers.set("origin", untrusted)
      req.headers.set("x-forwarded-host", new URL(origin).host)
      const response = await handler(req)
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({ error: expect.stringMatching(/origin/i) })
    }
    expect(fake).not.toHaveBeenCalled()
  })

  it.each([{ name: "list", method: "GET", handler: GET }, ...mutations])("requires completed MFA and known assurance for $name", async ({ name, method, handler }) => {
    state.currentLevel = "aal1"
    // Live verified factors must win over stale cached nextLevel.
    state.nextLevel = "aal1"
    const denied = await handler(request(name, {}, {}, method))
    expect(denied.status).toBe(403)
    expect(await denied.json()).toMatchObject({ error: expect.stringMatching(/Authenticator/) })
    state.currentLevel = null
    expect((await handler(request(name, {}, {}, method))).status).toBe(503)
    expect(fake).not.toHaveBeenCalled()
  })

  it.each(mutations.filter(item => ["pull", "delete"].includes(item.name)))("requires settings permission to $name models", async ({ name, method, handler }) => {
    state.client = databaseFixture({ memberships: [{ user_id: state.userId, org_id: "org", role: "accountant" }], organizations: [{ id: "org", name: "Workspace" }] })
    expect((await handler(request(name, { model: textModel.id }, {}, method))).status).toBe(403)
    expect(fake).not.toHaveBeenCalled()
  })

  it.each(mutations.filter(item => ["pull", "delete"].includes(item.name)))("rejects a workspace owner without machine authority before $name", async ({ name, method, handler }) => {
    vi.stubEnv("BOOMBIGNOSE_OPERATOR_USER_IDS", "22222222-2222-4222-8222-222222222222")
    expect((await handler(request(name, { model: textModel.id }, {}, method))).status).toBe(403)
    expect(fake).not.toHaveBeenCalled()
  })

  it("refuses unlisted checkpoints without contacting the daemon", async () => {
    expect((await pull(request("pull", { model: "unlisted-checkpoint" }))).status).toBe(400)
    expect(fake).not.toHaveBeenCalled()
  })

  it("does not contact or disclose a remote configured model host", async () => {
    vi.stubEnv("OLLAMA_HOST", "https://models.example:11434")
    const body = await (await GET(request("", undefined, {}, "GET"))).json()
    expect(body.daemonUp).toBe(false)
    expect(JSON.stringify(body)).not.toContain("models.example")
    expect(fake).not.toHaveBeenCalled()
  })


  it("rejects corrupt or mismatched images before querying any model service", async () => {
    for (const [input, status] of [
      [{ mediaType: "image/png", imageBase64: "a".repeat(32) }, 415],
      [{ mediaType: "image/jpeg", imageBase64: png }, 415],
      [{ mediaType: "image/png", imageBase64: "a".repeat(2_000_001) }, 400],
    ] as const) expect((await vision(request("vision", input))).status).toBe(status)
    expect(fake).not.toHaveBeenCalled()
  })

  it("reports an offline inference service and rejects an empty answer", async () => {
    fake.mockResolvedValueOnce(json({ models: [{ name: VISION_MODEL, size: 3 }] }))
      .mockResolvedValueOnce(json({ details: { format: "gguf" }, capabilities: ["completion", "vision"] }))
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
    const offline = await vision(request("vision", { mediaType: "image/png", imageBase64: png }))
    expect(offline.status).toBe(503)

    fake.mockResolvedValueOnce(json({ models: [{ name: VISION_MODEL, size: 3 }] }))
      .mockResolvedValueOnce(json({ details: { format: "gguf" }, capabilities: ["completion", "vision"] }))
      .mockResolvedValueOnce(json({ message: { content: "", thinking: "not an answer" } }))
    const empty = await vision(request("vision", { mediaType: "image/png", imageBase64: png }))
    expect(empty.status).toBe(502)
  })
})
