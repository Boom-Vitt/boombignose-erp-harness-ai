import { execFile } from "node:child_process"
import { promisify } from "node:util"

const run = promisify(execFile)

// The Mac app bundles the CLI; a brew/standalone install is on PATH.
const CLIS = ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]

/**
 * Best effort: this machine's MagicDNS name as an https origin (the `tailscale serve` front door),
 * or null when Tailscale is missing, signed out or has no MagicDNS. Callers fall back to a manual URL.
 */
export async function detectTailscaleBaseUrl(): Promise<string | null> {
  for (const cli of CLIS) {
    try {
      const { stdout } = await run(cli, ["status", "--json"], { timeout: 3000 })
      const dns = (JSON.parse(stdout) as { Self?: { DNSName?: string } }).Self?.DNSName
      const host = dns?.replace(/\.$/, "")
      if (host) return `https://${host}`
    } catch {
      // not installed, not running, or bad JSON: try the next one
    }
  }
  return null
}
