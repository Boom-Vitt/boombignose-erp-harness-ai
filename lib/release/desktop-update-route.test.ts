import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ role: "owner" as string | null }))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({
  getOrgContext: async () =>
    state.role
      ? { role: state.role, orgId: "org", userId: "user", email: null, orgName: "Workspace" }
      : null,
}))

import { POST } from "@/app/api/desktop-update/route"

describe("desktop update route", () => {
  const fake = vi.fn()

  beforeEach(() => {
    state.role = "owner"
    fake.mockReset()
    vi.stubGlobal("fetch", fake)
    vi.stubEnv("BOOMBIGNOSE_UPDATE_URL", "")
    vi.stubEnv("BOOMBIGNOSE_UPDATE_TOKEN", "")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("requires an owner or admin and does not download when replace is unavailable", async () => {
    state.role = null
    const signedOut = await POST()
    expect(signedOut.status).toBe(401)

    state.role = "accountant"
    const denied = await POST()
    expect(denied.status).toBe(403)
    expect(fake).not.toHaveBeenCalled()

    state.role = "owner"
    const response = await POST()
    expect(response.status).toBe(200)
    const text = await response.text()
    expect(text).toContain('"phase":"error"')
    if (process.platform === "darwin" && process.arch === "arm64") {
      expect(text).toContain("BoomBigNose window")
    } else {
      expect(text).toContain("Windows")
    }
    expect(fake).not.toHaveBeenCalled()
  })
})
