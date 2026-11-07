import { afterEach, beforeEach, expect, it, vi } from "vitest"

import { authCookieNames, loopbackRedirect, supabaseStorageKey } from "./auth-cookies"

const key = supabaseStorageKey("http://127.0.0.1:55101")
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://erp.tailnet.ts.net")
  vi.stubEnv("BOOMBIGNOSE_LOCAL_ORIGIN", "http://127.0.0.1:3101")
})
afterEach(() => vi.unstubAllEnvs())

it("derives the storage key from the API host label", () => {
  expect(key).toBe("sb-127-auth-token")
})

it("collects session chunks, the verifier, and the workspace cookie", () => {
  const header = [
    "sb-127-auth-token.0=aaa",
    "sb-127-auth-token.1=bbb",
    "sb-127-auth-token-code-verifier=ccc",
    "active_org=11111111-1111-1111-1111-111111111111",
    "theme=dark",
  ].join("; ")
  expect(authCookieNames(header, key)).toEqual([
    "sb-127-auth-token.0",
    "sb-127-auth-token.1",
    "sb-127-auth-token-code-verifier",
    "active_org",
  ])
})

it("ignores an empty cookie header", () => {
  expect(authCookieNames("", key)).toEqual([])
})

it("keeps a sign-out redirect on the loopback host the browser used", () => {
  const request = new Request("http://localhost:3101/auth/signout", { headers: { host: "127.0.0.1:3101" } })
  expect(loopbackRedirect("/login", request, "http://127.0.0.1:3100").href).toBe("http://127.0.0.1:3101/login")
})

it("does not trust arbitrary Host, request or forwarded origins", () => {
  const request = new Request("https://evil.example/auth/confirm", { headers: {
    host: "evil.example", "x-forwarded-host": "other.example", "x-forwarded-proto": "https",
  } })
  expect(loopbackRedirect("/dashboard", request, "http://127.0.0.1:3100").href).toBe("https://erp.tailnet.ts.net/dashboard")
})

it("keeps a configured private HTTPS confirmation origin", () => {
  const request = new Request("http://localhost:3101/auth/confirm", { headers: { host: "erp.tailnet.ts.net" } })
  expect(loopbackRedirect("/dashboard", request, "http://127.0.0.1:3100").href).toBe("https://erp.tailnet.ts.net/dashboard")
})
