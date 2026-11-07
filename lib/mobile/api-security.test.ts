import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createClient as createSupabase } from "@supabase/supabase-js"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"
import { hashToken } from "./pairing"

const state = vi.hoisted(() => ({
  user: { id: "actor", email: "actor@example.test" } as { id: string; email: string } | null,
  role: "owner", currentLevel: "aal1", nextLevel: "aal1", assuranceError: null as object | null,
  admin: {} as object,
}))
vi.mock("react", () => ({ cache: (fn: unknown) => fn }))
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "org-a" }) }) }))
vi.mock("next/navigation", () => ({ redirect: vi.fn(), forbidden: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  ...databaseFixture({ memberships: [{ user_id: "actor", org_id: "org-a", role: state.role }], organizations: [{ id: "org-a", name: "A" }] }),
  auth: {
    getUser: async () => ({ data: { user: state.user }, error: null }),
    getSession: async () => ({ data: { session: state.user ? { access_token: "verified-fixture-token" } : null }, error: null }),
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: state.currentLevel, nextLevel: state.nextLevel }, error: state.assuranceError }) },
  },
}) }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.admin }))
import { GET as list } from "@/app/api/mobile/devices/route"
import { DELETE as unlink } from "@/app/api/mobile/devices/[id]/route"
import { GET as status } from "@/app/api/mobile/status/route"

const origin = "https://erp.tailnet.ts.net"
const ownId = "11111111-1111-4111-8111-111111111111"
const foreignId = "22222222-2222-4222-8222-222222222222"
let devices: Record<string, unknown>[]
const browserRequest = (path: string, method = "GET", from = origin) => new Request(`${origin}${path}`, { method, headers: { origin: from } })
beforeEach(() => {
  state.user = { id: "actor", email: "actor@example.test" }; state.role = "owner"
  state.currentLevel = "aal1"; state.nextLevel = "aal1"; state.assuranceError = null
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin)
  devices = [
    { id: ownId, org_id: "org-a", user_id: "issuer", name: "Own phone", token_hash: hashToken("status-token"), revoked_at: null },
    { id: foreignId, org_id: "org-b", user_id: "other", name: "Private foreign phone", token_hash: hashToken("foreign-token"), revoked_at: null },
  ]
  state.admin = createSupabase("http://127.0.0.1:57211", "synthetic-service-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input))
      if (url.pathname !== "/rest/v1/mobile_devices") throw new Error("Device credential attempted account Auth or unrelated data access")
      const rows = devices.filter(row => [...url.searchParams].every(([key, value]) => {
        if (["select", "order"].includes(key)) return true
        return value.startsWith("eq.") ? String(row[key]) === value.slice(3) : value === "is.null" ? row[key] === null : false
      }))
      if (init?.method === "PATCH") {
        const patch = JSON.parse(String(init.body))
        rows.forEach(row => Object.assign(row, patch))
      }
      const columns = url.searchParams.get("select")?.split(",")
      const projected = rows.map(row => columns ? Object.fromEntries(columns.map(key => [key, row[key]])) : row)
      const object = new Headers(init?.headers).get("accept")?.includes("object+json")
      return Response.json(object ? projected[0] ?? null : projected)
    } },
  })
})
afterEach(() => vi.unstubAllEnvs())

describe("mobile pairing management and status", () => {
  it("lists and revokes only the verified actor's active workspace devices", async () => {
    const response = await list(browserRequest("/api/mobile/devices"))
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain("Private foreign phone")
    expect((await unlink(browserRequest(`/api/mobile/devices/${foreignId}`, "DELETE"), { params: Promise.resolve({ id: foreignId }) })).status).toBe(404)
    const revoked = await unlink(browserRequest(`/api/mobile/devices/${ownId}`, "DELETE"), { params: Promise.resolve({ id: ownId }) })
    expect(await revoked.json()).toEqual({ ok: true, browserSessionsSignedOut: false })
    expect(devices[1]?.revoked_at).toBeNull()
  })
  it("does not let a device bearer authorize management or ERP account identity", async () => {
    state.user = null
    const deviceOnly = new Request(`${origin}/api/mobile/devices`, { headers: { origin, authorization: "Bearer status-token" } })
    expect((await list(deviceOnly)).status).toBe(401)
    const response = await status(new Request(`${origin}/api/mobile/status`, { headers: { authorization: "Bearer status-token" } }))
    expect(await response.json()).toEqual({ ok: true, deviceName: "Own phone", connectionOnly: true })
    expect((await status(new Request(`${origin}/api/mobile/status`, { headers: { authorization: "Bearer unknown" } }))).status).toBe(401)
  })
  it("requires owner/admin, MFA and trusted Origin before list/unlink", async () => {
    state.role = "member"
    expect((await list(browserRequest("/api/mobile/devices"))).status).toBe(403)
    state.role = "owner"; state.nextLevel = "aal2"
    expect((await list(browserRequest("/api/mobile/devices"))).status).toBe(403)
    state.currentLevel = "aal2"; state.assuranceError = { message: "offline" }
    expect((await list(browserRequest("/api/mobile/devices"))).status).toBe(503)
    state.assuranceError = null
    expect((await unlink(browserRequest(`/api/mobile/devices/${ownId}`, "DELETE", "https://evil.example"), { params: Promise.resolve({ id: ownId }) })).status).toBe(403)
    expect(devices[0]?.revoked_at).toBeNull()
  })
})
