import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"

const state = vi.hoisted(() => ({
  user: { id: "actor", email: "actor@example.test" } as { id: string; email: string; factors?: { status: string }[] } | null,
  authError: null as object | null,
  level: { data: { currentLevel: "aal1", nextLevel: "aal1" } as { currentLevel: string | null; nextLevel: string | null } | null, error: null as object | null },
  preferred: "org-a", client: {} as object, assuranceThrows: false,
}))
vi.mock("react", () => ({ cache: (fn: unknown) => fn }))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: state.preferred }) }) }))
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`) }, forbidden: () => { throw new Error("FORBIDDEN:403") } }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  ...state.client, auth: {
    getUser: async () => ({ data: { user: state.user }, error: state.authError }),
    getSession: async () => ({ data: { session: state.user ? { access_token: "verified-fixture-token" } : null }, error: null }),
    mfa: { getAuthenticatorAssuranceLevel: async () => { if (state.assuranceThrows) throw new Error("offline"); return state.level } },
  },
}) }))
import { getVerifiedApiContext, requireOrgContext, requireRole, requireCapability } from "@/lib/auth"

const request = (origin = "https://erp.tailnet.ts.net") => new Request("http://localhost:3128/api/example", { method: "POST", headers: { origin } })
beforeEach(() => {
  state.user = { id: "actor", email: "actor@example.test" }; state.authError = null
  state.level = { data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null }; state.assuranceThrows = false
  state.preferred = "org-a"
  state.client = databaseFixture({ memberships: [{ user_id: "actor", org_id: "org-a", role: "owner" }], organizations: [{ id: "org-a", name: "A" }] })
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://erp.tailnet.ts.net"); vi.stubEnv("BOOMBIGNOSE_LOCAL_ORIGIN", "http://127.0.0.1:3128")
})
afterEach(() => vi.unstubAllEnvs())

describe("verified JSON API boundary", () => {
  it("requires verified user rather than a device credential", async () => {
    state.user = null
    const result = await getVerifiedApiContext(new Request("http://localhost/api/example", { headers: { authorization: "Bearer device-token" } }))
    expect(result.response?.status).toBe(401)
    state.user = { id: "actor", email: "actor@example.test" }; state.authError = { message: "revoked" }
    expect((await getVerifiedApiContext(request())).response?.status).toBe(401)
  })
  it("fails closed on assurance errors, exceptions and unknown levels", async () => {
    state.level.error = { message: "offline" }
    expect((await getVerifiedApiContext(request())).response?.status).toBe(503)
    state.level.error = null; state.level.data = null
    expect((await getVerifiedApiContext(request())).response?.status).toBe(503)
    state.assuranceThrows = true
    expect((await getVerifiedApiContext(request())).response?.status).toBe(503)
    state.assuranceThrows = false; state.level.data = { currentLevel: "unknown", nextLevel: "aal1" }
    expect((await getVerifiedApiContext(request())).response?.status).toBe(503)
  })
  it("enforces MFA before role or workspace access and permits completed step-up", async () => {
    state.level.data = { currentLevel: "aal1", nextLevel: "aal2" }
    expect((await getVerifiedApiContext(request())).response?.status).toBe(403)
    await expect(requireOrgContext()).rejects.toThrow("REDIRECT:/login/mfa")
    state.level.data.currentLevel = "aal2"
    expect((await getVerifiedApiContext(request(), { roles: ["owner"] })).ctx?.orgId).toBe("org-a")
  })
  it("requires MFA from live verified factors even when the cached session nextLevel is stale", async () => {
    state.user!.factors = [{ status: "verified" }]
    state.level.data = { currentLevel: "aal1", nextLevel: "aal1" }
    expect((await getVerifiedApiContext(request())).response?.status).toBe(403)
    state.level.data.currentLevel = "aal2"
    expect((await getVerifiedApiContext(request())).ctx?.userId).toBe("actor")
  })
  it("ignores a stale foreign workspace selection and rejects insufficient role", async () => {
    state.preferred = "org-b"
    expect((await getVerifiedApiContext(request())).ctx?.orgId).toBe("org-a")
    expect((await getVerifiedApiContext(request(), { roles: ["admin"] })).response?.status).toBe(403)
    state.client = databaseFixture({})
    expect((await getVerifiedApiContext(request())).response?.status).toBe(403)
  })
  it("rejects CSRF and forwarded host substitution, accepting only configured origins", async () => {
    expect((await getVerifiedApiContext(request("https://evil.example"), { mutation: true })).response?.status).toBe(403)
    const spoofed = new Request("https://evil.example/api/example", { method: "POST", headers: { "x-forwarded-host": "erp.tailnet.ts.net", host: "erp.tailnet.ts.net" } })
    expect((await getVerifiedApiContext(spoofed, { mutation: true })).response?.status).toBe(403)
    expect((await getVerifiedApiContext(request(), { mutation: true })).ctx?.userId).toBe("actor")
    expect((await getVerifiedApiContext(request("http://127.0.0.1:3128"), { mutation: true })).ctx?.userId).toBe("actor")
  })
  it("uses designed 403 interrupts for role denial and unverified assurance", async () => {
    const ctx = (await getVerifiedApiContext(request())).ctx!
    expect(() => requireRole(ctx, ["member"])).toThrow("FORBIDDEN:403")
    expect(() => requireCapability({ ...ctx, role: "member" }, "settings:manage")).toThrow("FORBIDDEN:403")
    state.level.error = { message: "offline" }
    await expect(requireOrgContext()).rejects.toThrow("FORBIDDEN:403")
  })
})
