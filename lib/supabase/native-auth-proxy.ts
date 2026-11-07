import "server-only"
import { isTrustedBrowserRequest } from "@/lib/supabase/trusted-origin"
import { runtimeSupabaseEnv } from "@/lib/supabase/runtime-env"

const MAX_BODY = 32 * 1024
const MAX_RESPONSE = 256 * 1024
// GoTrue enrollment includes a QR SVG; the measured native response exceeds 400 KiB.
const MAX_ENROLL_RESPONSE = 1024 * 1024
const FACTOR = "[a-fA-F0-9-]{36}"

export function allowedAuthEndpoint(path: string, method: string): boolean {
  if (method === "POST" && ["token", "logout"].includes(path)) return true
  if (path === "user" && method === "GET") return true
  if (path === "factors" && method === "POST") return true
  if (new RegExp(`^factors/${FACTOR}$`).test(path) && method === "DELETE") return true
  return method === "POST" && new RegExp(`^factors/${FACTOR}/(challenge|verify)$`).test(path)
}

export async function readBoundedBody(request: Request | Response, maximum = MAX_BODY): Promise<Uint8Array> {
  if (Number(request.headers.get("content-length")) > maximum) throw new Error("body_limit")
  const reader = request.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maximum) { await reader.cancel(); throw new Error("body_limit") }
      chunks.push(value)
    }
  } finally { reader.releaseLock() }
  const body = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return body
}

/** Fixed upstream Auth only: no REST, storage, admin, redirect, cookies or service credential forwarding. */
export async function proxyNativeAuth(request: Request, segments: string[]): Promise<Response> {
  const json = (error: string, status: number) => Response.json({ error, msg: error }, { status, headers: { "cache-control": "no-store" } })
  if (process.env.BOOMBIGNOSE_NATIVE !== "1") return json("Not found.", 404)
  if (!isTrustedBrowserRequest(request)) return json("Untrusted request origin.", 403)
  const path = segments.join("/")
  if (!allowedAuthEndpoint(path, request.method)) return json("Auth operation not available.", 404)
  const incoming = new URL(request.url)
  const params = new URLSearchParams()
  for (const [key, value] of incoming.searchParams) {
    if ((path === "token" && key === "grant_type" && ["password", "refresh_token"].includes(value)) ||
        (path === "logout" && key === "scope" && ["global", "local", "others"].includes(value))) params.set(key, value)
    else return json("Invalid Auth query.", 400)
  }
  try {
    const runtime = runtimeSupabaseEnv()
    const env = process.env
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY
    const base = new URL(runtime.url)
    if (base.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(base.hostname) || base.username || base.password || base.pathname !== "/" || base.search || base.hash) return json("Auth is not configured.", 503)
    const anonKey = runtime.anonKey
    if (!anonKey || anonKey === serviceKey) return json("Auth is not configured.", 503)
    const headers = new Headers({ apikey: anonKey, "content-type": "application/json", "accept": "application/json" })
    const auth = request.headers.get("authorization")
    if (auth) {
      if (!/^Bearer [A-Za-z0-9._-]+$/.test(auth) || auth === `Bearer ${serviceKey}`) return json("Invalid authorization.", 401)
      headers.set("authorization", auth)
    }
    const body = request.method === "GET" ? undefined : await readBoundedBody(request)
    const response = await fetch(new URL(`/auth/v1/${path}?${params}`, base), {
      method: request.method, headers, body: body as BodyInit | undefined,
      redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(15_000),
    })
    if (response.status >= 300 && response.status < 400) return json("Auth redirect refused.", 502)
    if (response.status === 204) return new Response(null, { status: 204, headers: { "cache-control": "no-store" } })
    if (!response.headers.get("content-type")?.includes("application/json")) return json("Auth service unavailable.", 502)
    const maximum = path === "factors" && request.method === "POST" ? MAX_ENROLL_RESPONSE : MAX_RESPONSE
    const bytes = await readBoundedBody(response, maximum)
    // Do not return server diagnostics or internal upstream details on failure.
    if (!response.ok) return json(response.status === 429 ? "Too many attempts. Please try again later." : "Authentication failed. Check your credentials or authenticator.", response.status >= 500 ? 502 : response.status)
    return new Response(bytes as BodyInit, { status: response.status, headers: { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" } })
  } catch (error) {
    return json(error instanceof Error && error.message === "body_limit" ? "Auth payload too large." : "Auth service unavailable.", error instanceof Error && error.message === "body_limit" ? 413 : 502)
  }
}
