import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ role: "owner" as string | null }))

vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({
  getOrgContext: async () =>
    state.role
      ? { role: state.role, orgId: "org", userId: "user", email: null, orgName: "Workspace" }
      : null,
}))

import { POST as install } from "@/app/api/local-asr/install/route"
import { POST as transcribe } from "@/app/api/local-asr/transcribe/route"

describe("speech-to-text routes", () => {
  beforeEach(() => {
    state.role = "owner"
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope")))
  })

  it("lets an owner start a download and refuses a bad checksum", async () => {
    if (process.platform === "darwin") return
    const response = await install()
    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body.error).toMatch(/checksum/)
    expect(JSON.stringify(body)).not.toContain("evil")
  })

  it("requires an owner to install and a sign-in to transcribe", async () => {
    state.role = "member"
    const denied = await install()
    expect(denied.status).toBe(403)
    state.role = null
    const signedOut = await transcribe(new Request("http://127.0.0.1/api/local-asr/transcribe", {
      method: "POST",
      body: JSON.stringify({ audioBase64: Buffer.from("RIFFxxxxWAVEhello").toString("base64") }),
    }))
    expect(signedOut.status).toBe(401)
  })
})
