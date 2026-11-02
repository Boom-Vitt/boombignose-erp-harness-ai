import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ signedIn: true }))

vi.mock("@/lib/auth", () => ({
  getOrgContext: async () => (state.signedIn ? { role: "member", orgId: "org", userId: "user", email: null, orgName: "Workspace" } : null),
}))

import { GET, POST } from "@/app/api/desktop-window/route"

const TOKEN = "a".repeat(64)
const post = (body: unknown) => new Request("http://x/api/desktop-window", { method: "POST", body: JSON.stringify(body) })

describe("desktop window route", () => {
  const fake = vi.fn()
  beforeEach(() => {
    state.signedIn = true
    fake.mockReset()
    vi.stubGlobal("fetch", fake)
    vi.stubEnv("BOOMBIGNOSE_UPDATE_URL", "")
    vi.stubEnv("BOOMBIGNOSE_UPDATE_TOKEN", "")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("needs a session and a boolean", async () => {
    state.signedIn = false
    expect((await GET()).status).toBe(401)
    state.signedIn = true
    expect((await POST(post({ fullscreen: "yes" }))).status).toBe(400)
  })

  it("reports a plain browser when no helper is configured", async () => {
    expect(await (await GET()).json()).toEqual({ desktop: false })
    expect(fake).not.toHaveBeenCalled()
  })

  it("forwards the toggle to the helper with the token", async () => {
    vi.stubEnv("BOOMBIGNOSE_UPDATE_URL", "http://127.0.0.1:5123")
    vi.stubEnv("BOOMBIGNOSE_UPDATE_TOKEN", TOKEN)
    fake.mockResolvedValue(Response.json({ fullscreen: true }))
    expect(await (await POST(post({ fullscreen: true }))).json()).toEqual({ desktop: true, fullscreen: true })
    const [url, init] = fake.mock.calls[0]
    expect(String(url)).toBe("http://127.0.0.1:5123/v1/fullscreen")
    expect(init.headers.Authorization).toBe(`Bearer ${TOKEN}`)
    expect(init.body).toBe('{"fullscreen":true}')
  })
})
