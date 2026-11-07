type OriginEnv = Record<string, string | undefined>

/** Configuration is authoritative; Host and forwarded headers never grant trust. */
export function configuredOrigins(env: OriginEnv = process.env): string[] {
  return [...new Set([env.NEXT_PUBLIC_APP_URL, env.BOOMBIGNOSE_LOCAL_ORIGIN].flatMap((raw) => {
    if (!raw) return []
    try {
      const url = new URL(raw)
      if (url.username || url.password || url.search || url.hash || url.pathname !== "/") return []
      if (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))) return []
      return [url.origin]
    } catch { return [] }
  }))]
}

export function isTrustedRequestOrigin(request: Request, env: OriginEnv = process.env): boolean {
  const origin = request.headers.get("origin")
  return origin !== null && configuredOrigins(env).includes(origin) && request.headers.get("sec-fetch-site") !== "cross-site"
}


/** Read-only browser calls may omit Origin; require a configured Referer instead. */
export function isTrustedBrowserRequest(request: Request): boolean {
  if (request.headers.has("origin")) return isTrustedRequestOrigin(request)
  if (request.method !== "GET" || request.headers.get("sec-fetch-site") === "cross-site") return false
  try {
    return configuredOrigins().includes(new URL(request.headers.get("referer") ?? "").origin)
  } catch { return false }
}
/** Select a configured redirect origin, preferring the actual validated browser origin. */
export function trustedAppOrigin(request: Request, env: OriginEnv = process.env): string {
  const origins = configuredOrigins(env)
  if (!origins.length) throw new Error("An explicit application origin is required.")
  const requestOrigin = new URL(request.url).origin
  const originHeader = request.headers.get("origin")
  if (originHeader && origins.includes(originHeader)) return originHeader
  // Host may select among preconfigured origins, never introduce another one.
  const host = request.headers.get("host")
  const matched = origins.find((origin) => new URL(origin).host === host)
  return matched ?? (origins.includes(requestOrigin) ? requestOrigin : origins[0]!)
}
