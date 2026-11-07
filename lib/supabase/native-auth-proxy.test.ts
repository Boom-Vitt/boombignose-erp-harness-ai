import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
import { proxyNativeAuth } from "./native-auth-proxy"

const publicOrigin = "https://erp.tailnet.ts.net"
const internal = "http://127.0.0.1:57211"
const req = (path: string, options: RequestInit = {}) => new Request(`${publicOrigin}/auth/local/${path}`, {
  method: "POST", ...options, headers: { origin: publicOrigin, "content-type": "application/json", ...options.headers },
})
beforeEach(() => {
  vi.stubEnv("BOOMBIGNOSE_NATIVE", "1"); vi.stubEnv("NEXT_PUBLIC_APP_URL", publicOrigin)
  vi.stubEnv("BOOMBIGNOSE_LOCAL_ORIGIN", "http://127.0.0.1:3128")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", internal); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon")
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "private-service")
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe("native Auth-only relay", () => {
  it("uses fixed runtime loopback upstream and allowlisted headers only", async () => {
    const fetcher = vi.fn(async () => Response.json({ access_token: "session" }, { headers: { "set-cookie": "internal=private", "access-control-allow-origin": "*", location: "https://evil.example" } }))
    vi.stubGlobal("fetch", fetcher)
    const response = await proxyNativeAuth(req("token?grant_type=password", { body: JSON.stringify({ email: "actor@example.test", password: "test-only" }), headers: { cookie: "private-cookie=value", apikey: "attacker-key", authorization: "Bearer user-token", "x-forwarded-host": "evil.example" } }), ["token"])
    expect(response.status).toBe(200)
    const [target, init] = fetcher.mock.calls[0] as unknown as [URL, RequestInit]
    expect(String(target)).toBe(`${internal}/auth/v1/token?grant_type=password`)
    expect(new Headers(init.headers).get("apikey")).toBe("public-anon")
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer user-token")
    expect(new Headers(init.headers).get("cookie")).toBeNull()
    expect(new Headers(init.headers).get("x-forwarded-host")).toBeNull()
    expect(init.redirect).toBe("manual")
    expect(response.headers.get("set-cookie")).toBeNull()
    expect(response.headers.get("location")).toBeNull()
    expect(response.headers.get("access-control-allow-origin")).toBeNull()
    expect(response.headers.get("cache-control")).toBe("no-store")
  })
  it.each(["admin/users", "../rest/v1/memberships", "rest/v1/memberships", "signup", "verify", "authorize", "settings", "factors/../../admin/users"])("does not expose %s", async path => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher)
    expect((await proxyNativeAuth(req(path), path.split("/"))).status).toBe(404)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it("rejects spoofed origins, unknown queries, service keys and oversized bodies before upstream", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher)
    expect((await proxyNativeAuth(req("token", { headers: { origin: "https://evil.example", "x-forwarded-host": "erp.tailnet.ts.net" } }), ["token"])).status).toBe(403)
    expect((await proxyNativeAuth(req("token?grant_type=password&redirect_to=https://evil.example"), ["token"])).status).toBe(400)
    expect((await proxyNativeAuth(req("token", { headers: { authorization: "Bearer private-service" } }), ["token"])).status).toBe(401)
    expect((await proxyNativeAuth(req("token", { body: "x".repeat(32769) }), ["token"])).status).toBe(413)
    expect(fetcher).not.toHaveBeenCalled()
  })
  it("permits same-origin browser GET without Origin only with trusted Referer", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ id: "actor" })))
    const request = new Request(`${publicOrigin}/auth/local/user`, { headers: { referer: `${publicOrigin}/login`, "sec-fetch-site": "same-origin", authorization: "Bearer user-token" } })
    expect((await proxyNativeAuth(request, ["user"])).status).toBe(200)
    expect((await proxyNativeAuth(new Request(`${publicOrigin}/auth/local/user`, { headers: { "x-forwarded-host": "erp.tailnet.ts.net" } }), ["user"])).status).toBe(403)
  })
  it("never follows redirects or exposes upstream errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.redirect("https://evil.example")))
    expect((await proxyNativeAuth(req("token"), ["token"])).status).toBe(502)
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "internal password=secret db=private" }, { status: 500 })))
    const response = await proxyNativeAuth(req("token"), ["token"])
    expect(response.status).toBe(502); expect(await response.text()).not.toContain("secret")
  })
  it("does not create a hosted-mode proxy", async () => {
    vi.stubEnv("BOOMBIGNOSE_NATIVE", "0")
    expect((await proxyNativeAuth(req("token"), ["token"])).status).toBe(404)
  })
})
