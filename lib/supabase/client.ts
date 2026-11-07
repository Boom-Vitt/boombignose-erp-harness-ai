import { createBrowserClient } from "@supabase/ssr"

import { readPublicEnv } from "@/lib/supabase/public-env"
import type { Database } from "@/lib/types/database"

/**
 * Supabase client for Client Components (browser). Uses the public anon key and
 * is subject to RLS. Safe to call in "use client" components.
 */
export function createClient() {
  const { url, anonKey, nativeAuthProxy } = readPublicEnv(undefined, {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  })
  return createBrowserClient<Database>(url, anonKey, nativeAuthProxy ? {
    global: {
      fetch: async (input, init) => {
        const target = new URL(input instanceof Request ? input.url : String(input))
        const base = new URL(url)
        if (target.origin !== base.origin || !target.pathname.startsWith("/auth/v1/")) {
          throw new Error("Native browser access is limited to same-origin Auth.")
        }
        return fetch(`/auth/local/${target.pathname.slice("/auth/v1/".length)}${target.search}`, {
          ...init, credentials: "same-origin", redirect: "error",
        })
      },
    },
  } : undefined)
}
