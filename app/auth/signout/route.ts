import { createServerClient } from "@supabase/ssr"
import { NextResponse } from "next/server"

import { ACTIVE_ORG_COOKIE } from "@/lib/auth"
import { authCookieNames, loopbackRedirect, supabaseStorageKey } from "@/lib/supabase/auth-cookies"
import type { Database } from "@/lib/types/database"
import { runtimeSupabaseEnv } from "@/lib/supabase/runtime-env"
import { isTrustedRequestOrigin, configuredOrigins } from "@/lib/supabase/trusted-origin"

const expired = { path: "/", maxAge: 0, sameSite: "lax" as const }

function cookiePairs(header: string) {
  return header.split(";").flatMap((part) => {
    const trimmed = part.trim()
    if (!trimmed) return []
    const eq = trimmed.indexOf("=")
    const name = eq === -1 ? trimmed : trimmed.slice(0, eq).trim()
    if (!name) return []
    return [{ name, value: eq === -1 ? "" : trimmed.slice(eq + 1) }]
  })
}

export async function POST(request: Request) {
  if (!isTrustedRequestOrigin(request)) return Response.json({ error: "Untrusted request origin." }, { status: 403 })
  const { url, anonKey } = runtimeSupabaseEnv()
  const response = NextResponse.redirect(
    loopbackRedirect("/login", request, configuredOrigins()[0] ?? ""),
    { status: 303 },
  )
  const header = request.headers.get("cookie") ?? ""
  const supabase = createServerClient<Database>(
    url,
    anonKey,
    {
      cookies: {
        getAll() {
          return cookiePairs(header)
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options)
          })
        },
      },
    },
  )
  await supabase.auth.signOut()
  // setAll only expires names it loaded. Expire every chunk from the request
  // as well, so a later sign-in is not combined with a leftover piece.
  for (const name of authCookieNames(header, supabaseStorageKey(url))) {
    response.cookies.set(name, "", expired)
  }
  response.cookies.set(ACTIVE_ORG_COOKIE, "", expired)
  return response
}
