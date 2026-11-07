import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { updateSession } from "./middleware"
vi.mock("server-only", () => ({}))

const url = "https://proxy-test.supabase.test"
const kid = "proxy-test-key"
const cookieName = "sb-proxy-test-auth-token"
const encode = (value: object | Uint8Array) => Buffer.from(value instanceof Uint8Array ? value : JSON.stringify(value)).toString("base64url")
const ecdsa = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" }
// Every segment is valid base64url, but the payload does not decode to JSON.
const garbledToken = `${encode({ alg: "ES256", kid, typ: "JWT" })}.${Buffer.from("not json").toString("base64url")}.${encode(new Uint8Array(64))}`
let signer: CryptoKeyPair
let jwk: object
let calls: string[]
let auth: Record<string, () => Response>

async function signedToken(key: CryptoKey) {
  const now = Math.floor(Date.now() / 1000)
  const unsigned = `${encode({ alg: "ES256", kid, typ: "JWT" })}.${encode({ sub: crypto.randomUUID(), role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, session_id: crypto.randomUUID() })}`
  const signature = new Uint8Array(await crypto.subtle.sign(ecdsa, key, new TextEncoder().encode(unsigned)))
  return `${unsigned}.${encode(signature)}`
}

function request(path: string, accessToken: string) {
  const now = Math.floor(Date.now() / 1000)
  const session = { access_token: accessToken, refresh_token: "refresh", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user: { id: crypto.randomUUID(), aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }
  return new NextRequest(`https://app.example.test${path}`, { headers: { cookie: `${cookieName}=base64-${encode(session)}` } })
}

const goTrueError = (status: number, code: string) => Response.json({ code, message: code }, { status, headers: { "x-supabase-api-version": "2024-01-01" } })

// auth-js caches the JWKS globally for ten minutes, so every test signs with one key.
beforeAll(async () => {
  signer = await crypto.subtle.generateKey(ecdsa, true, ["sign", "verify"]) as CryptoKeyPair
  jwk = { ...await crypto.subtle.exportKey("jwk", signer.publicKey), kid, alg: "ES256" }
})
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url)
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon")
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test")
  calls = []
  auth = { "/auth/v1/.well-known/jwks.json": () => Response.json({ keys: [jwk] }) }
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const target = String(input instanceof Request ? input.url : input)
    calls.push(target)
    return auth[new URL(target).pathname]?.() ?? Response.json({ msg: "unavailable" }, { status: 500 })
  }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

// Each page view prefetches dozens of routes through the proxy; an auth-server round trip per request exhausted the local auth service.
it("the health check does not call the auth server", async () => {
  const res = await updateSession(request("/api/health", await signedToken(signer.privateKey)))
  expect(res.headers.get("location")).toBeNull()
  expect(calls).toEqual([])
})

it("a validly signed session reaches app routes without an auth-server user lookup", async () => {
  const res = await updateSession(request("/deals", await signedToken(signer.privateKey)))
  expect(res.headers.get("location")).toBeNull()
  expect(calls.filter(call => call.includes("/auth/v1/user"))).toEqual([])
})

it("a session signed by another key is sent to login", async () => {
  const forger = await crypto.subtle.generateKey(ecdsa, true, ["sign"]) as CryptoKeyPair
  const res = await updateSession(request("/deals", await signedToken(forger.privateKey)))
  expect(res.headers.get("location")).toBe("https://app.example.test/login?redirect=%2Fdeals")
})

it("a live session on login goes on to the app", async () => {
  auth["/auth/v1/user"] = () => Response.json({ id: crypto.randomUUID(), aud: "authenticated" })
  const res = await updateSession(request("/login", await signedToken(signer.privateKey)))
  expect(res.headers.get("location")).toBe("https://app.example.test/dashboard")
})

// Pages reject a revoked session with getUser and send it to login; bouncing it back to the app would loop until the JWT expires.
it.each(["/login", "/signup"])("a revoked but unexpired session stays on %s and its cookie is cleared", async path => {
  auth["/auth/v1/user"] = () => goTrueError(403, "session_not_found")
  const res = await updateSession(request(path, await signedToken(signer.privateKey)))
  expect(res.headers.get("location")).toBeNull()
  expect(res.cookies.get(cookieName)).toMatchObject({ value: "", maxAge: 0 })
})

// The auth server is down in these tests: clearing the cookie must not depend on it.
it.each(["/login", "/f/lead-token", "/portal/portal-token"])("a session cookie that does not decode still loads public %s and is cleared", async path => {
  const res = await updateSession(request(path, garbledToken))
  expect(res.headers.get("location")).toBeNull()
  expect(res.cookies.get(cookieName)).toMatchObject({ value: "", maxAge: 0 })
  expect(calls).toEqual([])
})

it("a session cookie that does not decode is sent from app routes to login", async () => {
  const res = await updateSession(request("/deals", garbledToken))
  expect(res.headers.get("location")).toBe("https://app.example.test/login?redirect=%2Fdeals")
  expect(res.cookies.get(cookieName)).toMatchObject({ value: "", maxAge: 0 })
  expect(calls).toEqual([])
})
