import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("next/server", () => ({
  connection: vi.fn(async () => undefined),
}))

import {
  PUBLIC_ENV_SCRIPT_ID,
  PublicEnvScript,
  readPublicEnv,
  serializePublicEnv,
} from "./index"
beforeEach(() => vi.stubEnv("BOOMBIGNOSE_NATIVE", "0"))
afterEach(() => vi.unstubAllEnvs())

describe("public-env", () => {
  it("renders only the Supabase URL and anon key, escaped", async () => {
    const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const oldAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const oldService = process.env.SUPABASE_SERVICE_ROLE_KEY
    const oldCron = process.env.CRON_SECRET

    try {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54421/<test>"
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-</script>-val"
      process.env.SUPABASE_SERVICE_ROLE_KEY = "srv-role-hidden"
      process.env.CRON_SECRET = "cron-hidden"

      const element = await PublicEnvScript()
      const html = renderToStaticMarkup(element)

      expect(html).toContain(`id="${PUBLIC_ENV_SCRIPT_ID}"`)
      expect(html).toContain('type="application/json"')
      expect(html).not.toContain("srv-role-hidden")
      expect(html).not.toContain("cron-hidden")
      expect(html).not.toContain("SUPABASE_SERVICE_ROLE_KEY")
      expect(html).not.toContain("</script>-val")
      expect(html).toContain("\\u003c/script>-val")
      expect(html).toContain("\\u003ctest>")

      const raw = serializePublicEnv(process.env)
      expect(raw).not.toContain("<")
      expect(JSON.parse(raw)).toEqual({
        url: "http://127.0.0.1:54421/<test>",
        anonKey: "anon-</script>-val",
      })
    } finally {
      if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL
      else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl
      if (oldAnon === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = oldAnon
      if (oldService === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
      else process.env.SUPABASE_SERVICE_ROLE_KEY = oldService
      if (oldCron === undefined) delete process.env.CRON_SECRET
      else process.env.CRON_SECRET = oldCron
    }
  })

  it("prefers the data script over build-time env and falls back when absent", () => {
    const fallbackEnv = {
      NODE_ENV: "test" as const,
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "build-anon",
    }

    const fromScript = readPublicEnv(
      {
        getElementById(id: string) {
          if (id !== PUBLIC_ENV_SCRIPT_ID) return null
          return {
            textContent: JSON.stringify({
              url: "http://127.0.0.1:54421",
              anonKey: "runtime-anon",
            }),
          }
        },
      },
      fallbackEnv
    )
    expect(fromScript).toEqual({
      url: "http://127.0.0.1:54421",
      anonKey: "runtime-anon",
    })

    const fromFallback = readPublicEnv(
      {
        getElementById() {
          return null
        },
      },
      fallbackEnv
    )
    expect(fromFallback).toEqual({
      url: "http://127.0.0.1:54321",
      anonKey: "build-anon",
    })
  })

  it("advertises native same-origin transport without changing the project identity", () => {
    const serialized = serializePublicEnv({
      NODE_ENV: "test", BOOMBIGNOSE_NATIVE: "1",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:57211",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "runtime-anon",
      SUPABASE_SERVICE_ROLE_KEY: "private-hidden",
    })
    const payload = JSON.parse(serialized)
    expect(payload).toEqual({ url: "http://127.0.0.1:57211", anonKey: "runtime-anon", nativeAuthProxy: true })
    expect(serialized).not.toContain("private-hidden")
    expect(readPublicEnv({ getElementById: () => ({ textContent: serialized }) })).toEqual(payload)
  })
})
