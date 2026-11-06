import { clearAuthCookiesAtScopes, createServerClient, type CookieMethodsServer } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

import { safeReturnPath } from "@/lib/supabase/redirect"

import type { Database } from "@/lib/types/database"

/** Public route prefixes that do not require an authenticated session. */
const PUBLIC_PREFIXES = ["/login", "/signup", "/auth", "/api/webhooks", "/api/cron", "/portal", "/api/mobile/pair/redeem", "/api/mobile/session", "/api/mobile/status"]

function isPublic(pathname: string): boolean {
  if (pathname === "/" || pathname === "/blueprint-preview" || pathname === "/network-preview" || pathname === "/api/network/telemetry") return true
  if (/^\/f\/[^/]+$/.test(pathname)) return true
  return PUBLIC_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`)
  )
}

/**
 * Refreshes the Supabase session cookie on every request and guards app routes.
 * Must be invoked from `proxy.ts` (Next.js 16 proxy convention). Do NOT run
 * logic between `createServerClient` and `auth.getClaims()`.
 */
export async function updateSession(request: NextRequest) {
  // The bundle smoke check hits this path before Supabase is configured.
  if (request.nextUrl.pathname === "/api/health") {
    return NextResponse.next()
  }

  let supabaseResponse = NextResponse.next({ request })

  const cookies = {
    getAll() {
      return request.cookies.getAll()
    },
    setAll(cookiesToSet) {
      cookiesToSet.forEach(({ name, value }) =>
        request.cookies.set(name, value)
      )
      supabaseResponse = NextResponse.next({ request })
      cookiesToSet.forEach(({ name, value, options }) =>
        supabaseResponse.cookies.set(name, value, options)
      )
    },
  } satisfies CookieMethodsServer

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies }
  )

  // IMPORTANT: refreshes tokens; keep this immediately after client creation.
  // getClaims verifies the signed JWT locally; getUser cost an auth-server round trip on every prefetch.
  // Pages and actions still call getUser through requireOrgContext.
  const { data } = await supabase.auth.getClaims().catch(async () => {
    // A session cookie that does not decode (say a JWT payload that is base64url but not JSON) makes getClaims throw.
    // Expire it locally and route as signed out; signOut would call the auth server and could revoke a valid session.
    // This is the default storage key supabase-js derives from the project URL, which server.ts and client.ts also use.
    const storageKey = `sb-${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0]}-auth-token`
    await clearAuthCookiesAtScopes({ ...cookies, storageKey, scopes: [{}] })
    return { data: null }
  })
  const user = data?.claims

  const { pathname } = request.nextUrl

  // Redirects must carry token refreshes as well as the ordinary response.
  function redirectWithSession(url: URL) {
    const response = NextResponse.redirect(url)
    supabaseResponse.cookies.getAll().forEach((cookie) => response.cookies.set(cookie))
    return response
  }

  if (!user && !isPublic(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    url.searchParams.set("redirect", pathname)
    return redirectWithSession(url)
  }

  // Preserve local invitation destinations when already signed in.
  // Pages send a revoked but unexpired session here, so confirm it with getUser, which also clears its cookie, or the two redirects loop.
  if (user && (pathname === "/login" || pathname === "/signup") && (await supabase.auth.getUser()).data.user) {
    const url = request.nextUrl.clone()
    const destination = new URL(safeReturnPath(request.nextUrl.searchParams.get("redirect")), request.url)
    url.pathname = destination.pathname
    url.search = destination.search
    url.hash = destination.hash
    return redirectWithSession(url)
  }

  return supabaseResponse
}
