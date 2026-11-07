import { ACTIVE_ORG_COOKIE } from "@/lib/auth"
import { trustedAppOrigin } from "@/lib/supabase/trusted-origin"

/** Default storage key supabase-js derives from the project URL. */
export function supabaseStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`
}

/**
 * Redirects use explicit configured public/local origins, not arbitrary Host,
 * request URL, or forwarded host/proto values.
 */
export function loopbackRedirect(path: string, request: Request, fallbackOrigin: string): URL {
  const env = process.env
  return new URL(path, trustedAppOrigin(request, {
    NEXT_PUBLIC_APP_URL: env.NEXT_PUBLIC_APP_URL || fallbackOrigin,
    BOOMBIGNOSE_LOCAL_ORIGIN: env.BOOMBIGNOSE_LOCAL_ORIGIN,
  }))
}

/** Session chunks, PKCE verifiers and workspace scope must all expire on logout. */
export function authCookieNames(cookieHeader: string, storageKey: string): string[] {
  const names: string[] = []
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf("=")
    const name = eq === -1 ? trimmed : trimmed.slice(0, eq).trim()
    if (!name) continue
    if (name === storageKey || name.startsWith(`${storageKey}.`) || name.startsWith(`${storageKey}-`) || name === ACTIVE_ORG_COOKIE) {
      names.push(name)
    }
  }
  return names
}
