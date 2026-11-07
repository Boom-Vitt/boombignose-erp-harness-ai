import { createHash } from "node:crypto"
import { constants } from "node:fs"
import { access, lstat, realpath } from "node:fs/promises"
import path from "node:path"

const DUMP_NAME = /^boombignose-[0-9]{8}T[0-9]{6}Z\.dump$/

/** Process env or a small test fixture. The index signature accepts Next's ProcessEnv. */
export type BackupEnv = { [key: string]: string | undefined }

/** No default port: a web process must never discover the installed database. */
export function loopbackBackupURL(env: BackupEnv): string {
  const raw = env.BOOMBIGNOSE_PG_PORT ?? ""
  if (env.BOOMBIGNOSE_NATIVE !== "1" || !/^[1-9][0-9]{1,4}$/.test(raw) || Number(raw) > 65535) {
    throw new Error("Native database identity is not configured.")
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

/** Integrity check only: a matching sidecar does not establish a trusted source. */
export function checksumMatches(filename: string, dump: Buffer, sidecar: string): boolean {
  return checksumDigestMatches(filename, sha256Hex(dump), sidecar)
}

export function checksumDigestMatches(filename: string, digest: string, sidecar: string): boolean {
  if (!DUMP_NAME.test(filename)) return false
  const line = sidecar.replace(/\r\n/g, "\n").trim()
  const splitAt = line.indexOf("  ")
  if (splitAt !== 64) return false
  const hex = line.slice(0, splitAt)
  const name = line.slice(splitAt + 2)
  if (name !== filename || !/^[a-f0-9]{64}$/.test(hex)) return false
  const got = digest
  if (hex.length !== got.length) return false
  let diff = 0
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ got.charCodeAt(i)
  return diff === 0
}

export function dumpLooksCustom(bytes: Buffer): boolean {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString("utf8") === "PGDMP"
}

/** Reject wholly ACL-stripped native archives; this is not provenance or a full grant audit. */
export function dumpHasAclMetadata(listing: string): boolean {
  return /^\d+;\s+\d+\s+\d+\s+(?:DEFAULT\s+)?ACL(?:\s|$)/m.test(listing)
}

export class BackupToolUnavailableError extends Error {
  constructor(tool: "psql" | "pg_dump" | "pg_restore") {
    super(`${tool} is unavailable in this native bundle. Install the matching release with all PostgreSQL client tools (psql, pg_dump, pg_restore), then restart. Do not select another installation's tools.`)
  }
}

/** Only the resolved native bundle, never PATH or a separately supplied PG_BIN. */
export async function resolvePgTool(
  env: BackupEnv,
  name: "pg_dump" | "pg_restore" | "psql",
): Promise<string> {
  try {
    const bundle = env.BOOMBIGNOSE_BUNDLE
    if (env.BOOMBIGNOSE_NATIVE !== "1" || !bundle || !path.isAbsolute(bundle) || await realpath(bundle) !== bundle) {
      throw new BackupToolUnavailableError(name)
    }
    const candidate = path.join(bundle, "postgres", "bin", process.platform === "win32" ? `${name}.exe` : name)
    if (await realpath(candidate) !== candidate || !(await lstat(candidate)).isFile()) throw new BackupToolUnavailableError(name)
    await access(candidate, process.platform === "win32" ? constants.F_OK : constants.X_OK)
    return candidate
  } catch { throw new BackupToolUnavailableError(name) }
}
