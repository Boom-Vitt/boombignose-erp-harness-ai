import { open, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { START_LOGS, type StartLogName } from "@/lib/install/log-names"

export { START_LOGS }
export type { StartLogName }

const CAP = 64 * 1024

export function localDataDir(): string | null {
  const configured = process.env.BOOMBIGNOSE_DATA?.trim()
  if (configured) return configured
  const home = process.env.HOME || process.env.USERPROFILE
  if (!home) return null
  return path.join(home, ".local", "share", "boombignose", "pg")
}

/** Sibling of the Postgres data directory. The desktop helper reads the same folder. */
export function localUpdatesDir(): string | null {
  const data = localDataDir()
  if (!data) return null
  return path.resolve(data, "..", "updates")
}

export function redactLog(text: string): string {
  return text
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/(secret|password|token|api[_-]?key|service_role|anon_key)(["']?\s*[:=]\s*["']?)[^\s"',]+/gi, "$1$2[redacted]")
}

/** Last 64KiB of one allowlisted log. The file must stay inside the data directory after resolving links. */
export async function readStartLog(dir: string, name: string): Promise<{ text: string } | { error: string }> {
  if (!START_LOGS.includes(name as StartLogName)) return { error: "That log is not available." }
  let root: string
  try { root = await realpath(dir) } catch { return { error: "No local data directory yet." } }
  let file: string
  try { file = await realpath(path.join(root, name)) } catch { return { error: "That log is not on this computer yet." } }
  if (path.relative(root, file) !== name) return { error: "That log cannot be read." }
  const info = await stat(file)
  if (!info.isFile()) return { error: "That log cannot be read." }
  const length = Math.min(CAP, info.size)
  const start = info.size - length
  const handle = await open(file, "r")
  try {
    const buf = Buffer.alloc(length)
    await handle.read(buf, 0, length, start)
    let text = buf.toString("utf8")
    if (start > 0) text = text.slice(text.indexOf("\n") + 1)
    return { text: redactLog(text) }
  } finally {
    await handle.close()
  }
}
