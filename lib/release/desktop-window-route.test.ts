import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"

const state = vi.hoisted(() => ({ signedIn: true, role: "owner", level: "aal2" as string | null }))
const actor = "11111111-1111-4111-8111-111111111111"
vi.mock("server-only", () => ({}))
vi.mock("react", () => ({ cache: (fn: unknown) => fn }))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "org" }) }) }))
vi.mock("next/navigation", () => ({ redirect: vi.fn(), forbidden: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  ...databaseFixture({ memberships: [{ user_id: "11111111-1111-4111-8111-111111111111", org_id: "org", role: state.role }], organizations: [{ id: "org", name: "Workspace" }] }),
  auth: {
    getUser: async () => ({ data: { user: state.signedIn ? { id: "11111111-1111-4111-8111-111111111111", factors: [{ status: "verified" }] } : null }, error: null }),
    getSession: async () => ({ data: { session: state.signedIn ? { access_token: "verified-fixture-token" } : null }, error: null }),
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: state.level, nextLevel: "aal2" }, error: null }) },
  },
}) }))
import { GET, POST } from "@/app/api/desktop-window/route"

const origin = "http://127.0.0.1:3100"
const token = "a".repeat(64)
function post(body: unknown, from: string | null = origin) {
  return new Request(`${origin}/api/desktop-window`, {
    method: "POST", headers: { "Content-Type": "application/json", ...(from ? { Origin: from } : {}) }, body: JSON.stringify(body),
  })
}
const get = () => new Request(`${origin}/api/desktop-window`)

describe("native host window authority", () => {
  const helper = vi.fn()
  beforeEach(() => {
    state.signedIn = true; state.role = "owner"; state.level = "aal2"
    helper.mockReset(); vi.stubGlobal("fetch", helper)
    vi.stubEnv("NEXT_PUBLIC_APP_URL", origin); vi.stubEnv("BOOMBIGNOSE_LOCAL_ORIGIN", "")
    vi.stubEnv("BOOMBIGNOSE_UPDATE_URL", "http://127.0.0.1:5123")
    vi.stubEnv("BOOMBIGNOSE_UPDATE_TOKEN", token)
    vi.stubEnv("BOOMBIGNOSE_OPERATOR_USER_IDS", actor)
  })
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

  it("anonymous capability discovery exposes no window state and commands require identity", async () => {
    state.signedIn = false
    expect(await (await GET(get())).json()).toEqual({ desktop: false })
    expect((await POST(post({ fullscreen: true }))).status).toBe(401)
    expect(helper).not.toHaveBeenCalled()
  })
  it("membership alone cannot control the host even if its UUID is OS-enrolled", async () => {
    state.role = "member"
    expect(await (await GET(get())).json()).toEqual({ desktop: false })
    expect((await POST(post({ fullscreen: true }))).status).toBe(403)
    expect(helper).not.toHaveBeenCalled()
  })
  it("workspace ownership without machine authority exposes neither state nor helper credential", async () => {
    vi.stubEnv("BOOMBIGNOSE_OPERATOR_USER_IDS", "22222222-2222-4222-8222-222222222222")
    expect(await (await GET(get())).json()).toEqual({ desktop: false })
    const response = await POST(post({ fullscreen: true }))
    expect(response.status).toBe(403)
    expect(await response.text()).not.toContain(token)
    expect(helper).not.toHaveBeenCalled()
  })
  it("requires completed step-up for an enrolled operator", async () => {
    state.level = "aal1"
    expect(await (await GET(get())).json()).toEqual({ desktop: false })
    expect((await POST(post({ fullscreen: true }))).status).toBe(403)
    expect(helper).not.toHaveBeenCalled()
  })
  it.each([null, "https://hostile.invalid"])("rejects mutation Origin %s before contacting the helper", async from => {
    expect((await POST(post({ fullscreen: true }, from))).status).toBe(403)
    expect(helper).not.toHaveBeenCalled()
  })
  it("rejects malformed or oversized commands from an otherwise authorized operator", async () => {
    expect((await POST(post({ fullscreen: "yes" }))).status).toBe(400)
    expect((await POST(post({ fullscreen: true, extra: "x".repeat(300) }))).status).toBe(413)
    expect(helper).not.toHaveBeenCalled()
  })
  it("does not disguise unavailable assurance as an authorized plain-browser result", async () => {
    state.level = null
    expect((await GET(get())).status).toBe(503)
    expect((await POST(post({ fullscreen: true }))).status).toBe(503)
    expect(helper).not.toHaveBeenCalled()
  })
})
