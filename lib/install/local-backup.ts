import { createHash } from "node:crypto"
import { access } from "node:fs/promises"
import path from "node:path"

const DUMP_NAME = /^boombignose-[0-9]{8}T[0-9]{6}Z\.dump$/

/** Process env or a small test fixture. The index signature accepts Next's ProcessEnv. */
export type BackupEnv = { [key: string]: string | undefined }

/** Loopback URL for the install's own cluster. DATABASE_URL is ignored. */
export function loopbackBackupURL(env: BackupEnv): string {
  const raw = (env.BOOMBIGNOSE_PG_PORT || "54329").trim()
  if (!/^[1-9][0-9]{1,4}$/.test(raw) || Number(raw) > 65535) {
    throw new Error("Local database port is not allowed.")
  }
  return `postgresql://boombignose@127.0.0.1:${raw}/boombignose`
}

export function backupFileName(now: Date): string {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")
  const name = `boombignose-${stamp}.dump`
  if (!DUMP_NAME.test(name)) throw new Error("Backup name is not allowed.")
  return name
}

export function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

export function checksumLine(filename: string, hex: string): string {
  if (!DUMP_NAME.test(filename) || !/^[a-f0-9]{64}$/.test(hex)) {
    throw new Error("Backup checksum does not match.")
  }
  return `${hex}  ${filename}\n`
}

/** Returns the hex digest when the sidecar names this file and matches. */
export function checksumMatches(filename: string, dump: Buffer, sidecar: string): boolean {
  const line = sidecar.replace(/\r\n/g, "\n").trim()
  const splitAt = line.indexOf("  ")
  if (splitAt !== 64) return false
  const hex = line.slice(0, splitAt)
  const name = line.slice(splitAt + 2)
  if (name !== filename || !/^[a-f0-9]{64}$/.test(hex)) return false
  const got = sha256Hex(dump)
  if (hex.length !== got.length) return false
  let diff = 0
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

export function dumpLooksCustom(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("utf8") === "PGDMP"
}

/** Absolute pg_dump or pg_restore next to the bundle or BOOMBIGNOSE_PG_BIN. */
export async function resolvePgTool(
  env: BackupEnv,
  name: "pg_dump" | "pg_restore",
): Promise<string> {
  const roots = [
    env.BOOMBIGNOSE_PG_BIN?.trim() ?? "",
    env.BOOMBIGNOSE_BUNDLE?.trim() ? path.join(env.BOOMBIGNOSE_BUNDLE.trim(), "postgres", "bin") : "",
  ]
  for (const root of roots) {
    if (!root || !path.isAbsolute(root)) continue
    for (const file of [name, `${name}.exe`]) {
      const candidate = path.join(root, file)
      if (path.basename(candidate) !== file) continue
      try {
        await access(candidate)
        return candidate
      } catch {
        continue
      }
    }
  }
  throw new Error(`${name} was not found next to this install.`)
}
