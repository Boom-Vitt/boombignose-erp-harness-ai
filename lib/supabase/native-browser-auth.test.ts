import { afterEach, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
import { proxyNativeAuth } from "./native-auth-proxy"
import { createClient as createServerSupabase } from "./server"

const cookieJar = new Map<string, string>()
vi.mock("next/headers", () => ({ cookies: async () => ({
  getAll: () => [...cookieJar].map(([name, value]) => ({ name, value })),
  set: (name: string, value: string) => cookieJar.set(name, value),
}) }))
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); cookieJar.clear() })

it("normal phone password Auth stays HTTPS same-origin and preserves native session cookies across server reads", async () => {
  vi.resetModules()
  const origin = "https://erp.tailnet.ts.net"
  const internal = "http://127.0.0.1:57211"
  vi.stubEnv("BOOMBIGNOSE_NATIVE", "1"); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin)
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", internal); vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon")
  const doc = {
    getElementById: () => ({ textContent: JSON.stringify({ url: internal, anonKey: "anon", nativeAuthProxy: true }) }),
    get cookie() { return [...cookieJar].map(([key, value]) => `${key}=${value}`).join("; ") },
    set cookie(value: string) { const [pair] = value.split(";"); const index = pair!.indexOf("="); cookieJar.set(pair!.slice(0, index), pair!.slice(index + 1)) },
    visibilityState: "visible",
    addEventListener() {}, removeEventListener() {},
  }
  vi.stubGlobal("document", doc)
  vi.stubGlobal("window", { document: doc, location: { origin, href: `${origin}/login` }, addEventListener() {}, removeEventListener() {} })
  const now = Math.floor(Date.now() / 1000)
  const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString("base64url")
  const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ sub: "actor", aud: "authenticated", exp: now + 3600, iat: now, aal: "aal1" })}.synthetic-signature`
  const user = { id: "actor", aud: "authenticated", email: "actor@example.test", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString(), factors: [] }
  const browserCalls: string[] = []
  const upstreamCalls: string[] = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = input instanceof Request ? input.url : String(input)
    if (raw.startsWith("/auth/local/")) {
      browserCalls.push(raw)
      const headers = new Headers(init?.headers); headers.set("origin", origin)
      return proxyNativeAuth(new Request(new URL(raw, origin), { ...init, headers }), new URL(raw, origin).pathname.slice("/auth/local/".length).split("/"))
    }
    const target = new URL(raw)
    expect(target.origin).toBe(internal)
    upstreamCalls.push(target.pathname)
    if (target.pathname === "/auth/v1/token") return Response.json({ access_token: token, token_type: "bearer", refresh_token: "synthetic-refresh", expires_in: 3600, user })
    if (target.pathname === "/auth/v1/user") return Response.json(user)
    return Response.json({ error: "unexpected endpoint" }, { status: 404 })
  }))
  // Intentionally load after browser globals: exercise the SDK's browser/module boundary.
  const { createClient } = await import("./client")
  const browser = createClient()
  try {
    const signedIn = await browser.auth.signInWithPassword({ email: user.email, password: "synthetic-password" })
    expect(signedIn.error).toBeNull()
    expect((await browser.auth.getUser()).data.user?.id).toBe("actor")
    expect([...cookieJar.keys()].some(name => name === "sb-127-auth-token" || name.startsWith("sb-127-auth-token."))).toBe(true)
    const server = await createServerSupabase()
    try { expect((await server.auth.getUser()).data.user?.id).toBe("actor") }
    finally { await server.auth.dispose() }
    expect(browserCalls).toContain("/auth/local/token?grant_type=password")
    expect(browserCalls).toContain("/auth/local/user")
    expect(upstreamCalls).toContain("/auth/v1/user")
  } finally { await browser.auth.dispose() }
})
