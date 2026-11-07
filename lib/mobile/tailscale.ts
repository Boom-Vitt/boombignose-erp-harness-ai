import { execFile } from "node:child_process"
import { promisify } from "node:util"
import { normalizeBaseUrl } from "@/lib/mobile/pairing"

const run = promisify(execFile)
const CLIS = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]

type ServeStatus = {
  TCP?: Record<string, { HTTPS?: boolean }>
  Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>
  AllowFunnel?: Record<string, boolean>
}

/** DNS is identity, not readiness. Require a private HTTPS Serve mapping to this ERP. */
export function verifiedServeOrigin(status: unknown, serve: unknown, backend: string): string | null {
  const node = status as { BackendState?: string; Self?: { DNSName?: string; Online?: boolean } }
  const config = serve as ServeStatus
  if (node?.BackendState !== "Running" || node.Self?.Online !== true) return null
  const host = node.Self.DNSName?.replace(/\.$/, "")
  if (!host || !normalizeBaseUrl(`https://${host}`)) return null
  let expected: URL
  try { expected = new URL(backend) } catch { return null }
  if (expected.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(expected.hostname) || expected.pathname !== "/" || expected.search || expected.hash || expected.username || expected.password) return null
  let origin: string | null = null
  for (const [port, listener] of Object.entries(config?.TCP ?? {})) {
    if (listener?.HTTPS !== true || !/^[1-9]\d{0,4}$/.test(port)) continue
    const candidate = normalizeBaseUrl(`https://${host}:${port}`)
    if (!candidate) continue
    const endpoint = `${host}:${port}`
    let actual: URL
    try { actual = new URL(config.Web?.[endpoint]?.Handlers?.["/"]?.Proxy ?? "") } catch { continue }
    if (actual.origin !== expected.origin || actual.pathname !== "/" || actual.search || actual.hash || actual.username || actual.password) continue
    // A separate unrelated Funnel is not this ERP, but any public ERP mapping
    // or ambiguous private origin must not be advertised as a ready connection.
    if (config.AllowFunnel?.[endpoint] || origin) return null
    origin = candidate
  }
  return origin
}

/** Discovery is read-only: never installs, logs in, enables Serve/Funnel or changes tailnet state. */
export async function detectTailscaleBaseUrl(): Promise<string | null> {
  const env = process.env
  const backend = env.BOOMBIGNOSE_LOCAL_ORIGIN
  if (!backend) return null
  for (const cli of CLIS) {
    try {
      const options = { timeout: 3000, maxBuffer: 512 * 1024 }
      const [status, serve] = await Promise.all([
        run(cli, ["status", "--json"], options),
        run(cli, ["serve", "status", "--json"], options),
      ])
      const origin = verifiedServeOrigin(JSON.parse(status.stdout), JSON.parse(serve.stdout), backend)
      if (origin) return origin
    } catch { /* Missing CLI, offline state, unsupported JSON or absent mapping is not readiness. */ }
  }
  return null
}
