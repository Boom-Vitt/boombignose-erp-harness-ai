import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { databaseFixture } from "./__tests__/tenant-fixture"

const state = vi.hoisted(() => ({ client: {} as object, createUser: vi.fn(), signup: vi.fn(), origin: "https://erp.tailnet.ts.net" }))
vi.mock("next/headers", () => ({ headers: async () => new Headers({ origin: state.origin }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signUp: state.signup } }) }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ ...state.client, auth: { admin: { createUser: state.createUser } } }) }))
import { signUp } from "@/app/signup/actions"

const token = "a".repeat(32)
const input = { email: "recipient@example.test", password: "SecurePassword123", inviteToken: token, redirectTo: `/invite/${token}` }
const live = { token, email: input.email, status: "pending", expires_at: "2099-01-01T00:00:00Z", accepted_by: null }
beforeEach(() => {
  vi.clearAllMocks(); state.origin = "https://erp.tailnet.ts.net"
  vi.stubEnv("NEXT_PUBLIC_APP_URL", state.origin); vi.stubEnv("BOOMBIGNOSE_NATIVE", "1"); vi.stubEnv("BOOMBIGNOSE_ALLOW_SIGNUP", "0")
  state.client = databaseFixture({ invitations: [live] })
  state.createUser.mockResolvedValue({ data: { user: { id: "new-recipient" } }, error: null })
  state.signup.mockResolvedValue({ data: { session: { access_token: "synthetic" } }, error: null })
})
afterEach(() => vi.unstubAllEnvs())

describe("native remote invited registration", () => {
  it("creates only the invited recipient and requires independent normal login", async () => {
    const result = await signUp({ ...input, email: "Recipient@Example.test" })
    expect(result).toEqual({ ok: true, requiresConfirmation: false, requiresLogin: true })
    expect(state.createUser).toHaveBeenCalledExactlyOnceWith({ email: input.email, password: input.password, email_confirm: true })
    expect(state.signup).not.toHaveBeenCalled()
    expect(JSON.stringify(result)).not.toContain("access_token")
  })
  it.each([
    { ...live, status: "revoked" }, { ...live, status: "accepted", accepted_by: "other" },
    { ...live, expires_at: "2000-01-01T00:00:00Z" }, { ...live, expires_at: "invalid" },
    { ...live, email: "different@example.test" }, { ...live, token: "b".repeat(32) },
  ])("does not register from an unavailable or wrong-recipient invitation", async invitation => {
    state.client = databaseFixture({ invitations: [invitation] })
    expect((await signUp(input)).ok).toBe(false)
    expect(state.createUser).not.toHaveBeenCalled(); expect(state.signup).not.toHaveBeenCalled()
  })
  it("does not expose arbitrary user creation, mutate an existing account, or trust another Origin", async () => {
    expect((await signUp({ email: input.email, password: input.password })).ok).toBe(false)
    expect((await signUp({ ...input, inviteToken: "../../admin" })).ok).toBe(false)
    state.origin = "https://evil.example"
    expect((await signUp(input)).ok).toBe(false)
    expect(state.createUser).not.toHaveBeenCalled()
    state.origin = "https://erp.tailnet.ts.net"
    state.createUser.mockResolvedValue({ error: { message: "already exists" } })
    expect((await signUp(input)).ok).toBe(false)
    expect(state.signup).not.toHaveBeenCalled()
  })
  it("retains native local-only first-owner signup and hosted confirmation conventions", async () => {
    vi.stubEnv("BOOMBIGNOSE_ALLOW_SIGNUP", "1")
    expect(await signUp({ email: input.email, password: input.password })).toEqual({ ok: true, requiresConfirmation: false })
    expect(state.createUser).not.toHaveBeenCalled()
    state.signup.mockClear(); vi.stubEnv("BOOMBIGNOSE_NATIVE", "0")
    state.signup.mockResolvedValue({ data: { session: null }, error: null })
    expect(await signUp(input)).toEqual({ ok: true, requiresConfirmation: true })
    expect(state.signup).toHaveBeenCalledWith(expect.objectContaining({ options: { emailRedirectTo: `https://erp.tailnet.ts.net/auth/confirm?redirect=${encodeURIComponent(input.redirectTo)}` } }))
  })
})
