import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { getClaims: async () => ({ data: null, error: null }) } }),
}))
import { updateSession } from "@/lib/supabase/middleware"
beforeEach(() => vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test"))
afterEach(() => vi.unstubAllEnvs())

it("allows public form URLs without exposing finance or similar prefixes", async () => {
  for (const path of [`/f/${"a".repeat(43)}`, "/f/invalid-token"]) {
    expect((await updateSession(new NextRequest(`https://app.example.test${path}`))).headers.get("location")).toBeNull()
  }
  for (const path of ["/finance", "/finance/invoices/x", "/foo", "/f", "/forms", "/f/token/nested"]) {
    expect((await updateSession(new NextRequest(`https://app.example.test${path}`))).headers.get("location"))
      .toBe(`https://app.example.test/login?redirect=${encodeURIComponent(path)}`)
  }
})
