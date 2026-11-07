import { spawn } from "node:child_process"
import { createHash, randomBytes } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { open, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"
import { getVerifiedApiContext, machineOperatorDenied } from "@/lib/auth"
import { BackupToolUnavailableError, backupFileName, checksumDigestMatches, dumpHasAclMetadata, dumpLooksCustom, resolvePgTool } from "./local-backup"
import { nativeBackupSession, type NativeBackupSession } from "./local-backup-native"

export const MAX_BACKUP_BYTES = 512 * 1024 * 1024
const MAX_UPLOAD_BYTES = MAX_BACKUP_BYTES + 64 * 1024
const TOOL_TIMEOUT_MS = 15 * 60 * 1000
const RECOVERY_ROLE_TIMEOUT_MS = 15_000
const CONFIRMATION = "RESTORE ALL WORKSPACES"
let busy = false

class SizeLimitError extends Error {}
const json = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } })

async function denied(request: Request, mutation: boolean): Promise<Response | null> {
  const auth = await getVerifiedApiContext(request, { roles: ["owner", "admin"], mutation })
  if (auth.response) return auth.response
  return machineOperatorDenied(auth.ctx.userId)
}

/** Called only with a private passfile; no inherited libpq/service/password settings. */
async function runTool(session: NativeBackupSession, tool: "psql" | "pg_dump" | "pg_restore", args: string[], options: { output?: string; capture?: boolean; limit?: number; signal?: AbortSignal; pgpass?: string; timeoutMs?: number } = {}): Promise<string> {
  const bin = await resolvePgTool(process.env, tool)
  const timeoutMs = options.timeoutMs ?? TOOL_TIMEOUT_MS
  const child = spawn(bin, args, {
    shell: false, windowsHide: true, stdio: ["ignore", "pipe", "ignore"],
    env: {
      NODE_ENV: "production",
      SystemRoot: process.env.SystemRoot,
      LC_ALL: "C", PGPASSFILE: options.pgpass ?? session.pgpass, PGCONNECT_TIMEOUT: "10",
      PGOPTIONS: `-c search_path=pg_catalog -c statement_timeout=${timeoutMs} -c lock_timeout=10000`,
      // Windows libpq uses APPDATA to locate pgpass; PGPASSFILE remains explicit.
    },
  })
  const stop = () => { child.kill("SIGKILL") }
  const timer = setTimeout(stop, timeoutMs)
  const signal = options.signal
  signal?.addEventListener("abort", stop, { once: true })
  if (signal?.aborted) stop()
  const { promise: exited, resolve, reject } = Promise.withResolvers<void>()
  child.once("error", () => reject(new Error("Native database tool failed.")))
  child.once("close", (code) => code === 0 ? resolve() : reject(new Error("Native database tool failed.")))
  let count = 0
  const chunks: Buffer[] = []
  const bounded = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    count += chunk.length
    if (count > (options.limit ?? 8 * 1024 * 1024)) return callback(new SizeLimitError())
    if (options.capture) chunks.push(Buffer.from(chunk))
    callback(null, options.output ? chunk : undefined)
  } })
  const destination = options.output ? createWriteStream(options.output, { flags: "wx", mode: 0o600 }) : new Transform({ transform(_chunk, _encoding, callback) { callback() } })
  const streamed = pipeline(child.stdout!, bounded, destination).catch((error) => { stop(); throw error })
  try {
    const [completed, output] = await Promise.allSettled([exited, streamed])
    // Closing oversized stdout can also fail the child; keep the causal error.
    if (output.status === "rejected") throw output.reason
    if (completed.status === "rejected") throw completed.reason
    if (signal?.aborted) throw new Error("Backup cancelled.")
    return Buffer.concat(chunks).toString("utf8").trim()
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener("abort", stop)
    stop()
  }
}

function connection(session: NativeBackupSession): string[] {
  return ["--no-password", "--host=127.0.0.1", `--port=${session.port}`, "--username=boombignose", "--dbname=boombignose"]
}

const quoteIdentifier = (value: string) => `"${value.replaceAll('"', '""')}"`
const quoteLiteral = (value: string) => `'${value.replaceAll("'", "''")}'`

async function createRecoveryRole(session: NativeBackupSession, role: string): Promise<void> {
  // A fresh NOLOGIN role has no default ACLs. Restoring as the administrator (or
  // an original owner) can silently add their default grants to archived ACLs.
  // The marker commits atomically with CREATE so an uncertain tool exit can be
  // cleaned without ever adopting a pre-existing role on a name collision.
  const sql = `BEGIN; CREATE ROLE ${quoteIdentifier(role)} NOLOGIN SUPERUSER; COMMENT ON ROLE ${quoteIdentifier(role)} IS ${quoteLiteral(role)}; COMMIT;`
  await runTool(session, "psql", [...connection(session), "--no-psqlrc", "--set=ON_ERROR_STOP=1", `--command=${sql}`], { timeoutMs: RECOVERY_ROLE_TIMEOUT_MS })
}

async function dropRecoveryRole(session: NativeBackupSession, role: string): Promise<void> {
  // Always use the original administrative login and an independent deadline,
  // never the cancelled HTTP signal. Some objects (notably extensions) have no
  // archive OWNER command, so reassign remaining ownership before dropping.
  const sql = `DO $recovery$ BEGIN
    IF EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = ${quoteLiteral(role)}) THEN
      IF (SELECT pg_catalog.shobj_description(oid, 'pg_authid') FROM pg_catalog.pg_roles WHERE rolname = ${quoteLiteral(role)}) IS DISTINCT FROM ${quoteLiteral(role)} THEN
        RAISE EXCEPTION 'Recovery role identity mismatch';
      END IF;
      REASSIGN OWNED BY ${quoteIdentifier(role)} TO CURRENT_USER;
      DROP ROLE ${quoteIdentifier(role)};
    END IF;
  END; $recovery$;`
  await runTool(session, "psql", [...connection(session), "--no-psqlrc", "--set=ON_ERROR_STOP=1", `--command=${sql}`], { timeoutMs: RECOVERY_ROLE_TIMEOUT_MS })
}

async function verifyServer(session: NativeBackupSession, signal: AbortSignal): Promise<void> {
  // pg_hba_file_rules describes the on-disk policy, not necessarily a successful
  // reload. Prove this live endpoint rejects a wrong password before trusting it.
  const probe = path.join(session.directory, "auth-probe")
  await writeFile(probe, `127.0.0.1:${session.port}:boombignose:boombignose:invalid-backup-authentication-probe\n`, { flag: "wx", mode: 0o600 })
  let rejectsWrongPassword = false
  try {
    await runTool(session, "psql", [...connection(session), "--no-psqlrc", "--set=ON_ERROR_STOP=1", "--command=SELECT 1"], { pgpass: probe, signal })
  } catch { rejectsWrongPassword = true } finally { await rm(probe, { force: true }) }
  if (!rejectsWrongPassword) throw new Error("Native PostgreSQL must require password authentication.")
  const query = "SELECT pg_catalog.json_build_object('data',current_setting('data_directory'),'port',current_setting('port'),'scram',COALESCE((SELECT bool_and(error IS NULL AND auth_method IN ('scram-sha-256','reject')) FROM pg_catalog.pg_hba_file_rules),false),'credential',COALESCE((SELECT rolpassword LIKE 'SCRAM-SHA-256$%' FROM pg_catalog.pg_authid WHERE rolname=current_user),false))::text"
  const output = await runTool(session, "psql", [...connection(session), "--no-psqlrc", "--tuples-only", "--no-align", "--set=ON_ERROR_STOP=1", `--command=${query}`], { capture: true, limit: 4096, signal })
  const identity = JSON.parse(output) as { data?: string; port?: string; scram?: boolean; credential?: boolean }
  if (identity.data !== session.data || identity.port !== session.port || identity.scram !== true || identity.credential !== true) throw new Error("The authenticated native cluster does not match or requires SCRAM migration.")
}

type InspectedDump = { digest: string; size: number }

async function inspectDump(file: string): Promise<InspectedDump> {
  const hash = createHash("sha256")
  let size = 0
  const handle = await open(file, "r")
  try {
    const header = Buffer.alloc(5)
    await handle.read(header, 0, header.length, 0)
    if (!dumpLooksCustom(header)) throw new Error("Invalid PostgreSQL archive.")
    for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) {
      size += chunk.length
      if (size > MAX_BACKUP_BYTES) throw new SizeLimitError()
      hash.update(chunk)
    }
    return { digest: hash.digest("hex"), size }
  } finally { await handle.close() }
}

/** GET reveals scope/availability only, never the dump, paths, or credentials. */
export async function localBackupStatus(request: Request): Promise<Response> {
  const block = await denied(request, false)
  if (block) return block
  return Response.json({ scope: "database-only", allWorkspaces: true, maxBytes: MAX_BACKUP_BYTES, confirmation: CONFIRMATION }, { headers: { "Cache-Control": "no-store" } })
}

export async function exportLocalBackup(request: Request): Promise<Response> {
  const block = await denied(request, true)
  if (block) return block
  if (busy) return json("Another database backup or restore is in progress. Try again when it finishes.", 409)
  busy = true
  let session: NativeBackupSession | undefined
  let streaming = false
  try {
    session = await nativeBackupSession(process.env)
    await verifyServer(session, request.signal)
    const name = backupFileName(new Date())
    const file = path.join(session.directory, name)
    await runTool(session, "pg_dump", [...connection(session), "--format=custom"], { output: file, limit: MAX_BACKUP_BYTES, signal: request.signal })
    const { digest, size } = await inspectDump(file)
    // The database tool is finished; never retain a credential through a download.
    await rm(session.pgpass, { force: true })
    const stream = createReadStream(file)
    const owned = session
    let cleaned = false
    const cleanup = async () => {
      if (cleaned) return
      cleaned = true
      clearTimeout(timer)
      request.signal.removeEventListener("abort", cancel)
      try { await owned.close() } finally { busy = false }
    }
    const cancel = () => stream.destroy(new Error("Backup download cancelled."))
    const timer = setTimeout(cancel, TOOL_TIMEOUT_MS)
    stream.once("close", () => { void cleanup() })
    request.signal.addEventListener("abort", cancel, { once: true })
    if (request.signal.aborted) cancel()
    streaming = true
    return new Response(Readable.toWeb(stream, { strategy: { highWaterMark: 64 * 1024, size: (chunk: Uint8Array) => chunk.byteLength } }) as ReadableStream<Uint8Array>, { headers: {
      "Content-Type": "application/octet-stream", "Content-Length": String(size),
      "Content-Disposition": `attachment; filename="${name}"`, "X-Backup-Sha256": digest,
      "X-Backup-Name": name, "X-Backup-Scope": "database-only-all-workspaces", "Cache-Control": "no-store",
    } })
  } catch (error) {
    if (error instanceof BackupToolUnavailableError) return json(error.message, 503)
    return error instanceof SizeLimitError
      ? json("The database dump exceeds the 512 MiB export limit. No backup was exported.", 413)
      : json("Backup failed. Check this native install's private credentials, resolved bundle/data/port, and SCRAM configuration. Nothing was exported.", 503)
  } finally {
    if (!streaming) { try { await session?.close() } finally { busy = false } }
  }
}

/** Bound even chunked requests before invoking the multipart parser. */
async function boundedForm(request: Request): Promise<FormData> {
  const length = request.headers.get("content-length")
  if (length && (!/^[0-9]+$/.test(length) || Number(length) > MAX_UPLOAD_BYTES)) throw new SizeLimitError()
  if (!request.body) throw new Error("Missing backup files.")
  let size = 0
  const bounded = request.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform(chunk, controller) {
    size += chunk.byteLength
    if (size > MAX_UPLOAD_BYTES) throw new SizeLimitError()
    controller.enqueue(chunk)
  } }), { signal: AbortSignal.any([request.signal, AbortSignal.timeout(TOOL_TIMEOUT_MS)]) })
  try {
    return await new Response(bounded, { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData()
  } catch (error) {
    if (size > MAX_UPLOAD_BYTES) throw new SizeLimitError()
    throw error
  }
}

export async function restoreLocalBackup(request: Request): Promise<Response> {
  const block = await denied(request, true)
  if (block) return block
  if (busy) return json("Another database backup or restore is in progress. Try again when it finishes.", 409)
  busy = true
  let session: NativeBackupSession | undefined
  let recoveryRole: string | undefined
  let outcome: "not-started" | "uncertain" | "applied" = "not-started"
  let cleanupFailed = false
  try {
    // Fail native-install/credential checks before accepting a large upload.
    session = await nativeBackupSession(process.env)
    let form: FormData
    try { form = await boundedForm(request) } catch (error) {
      if (error instanceof SizeLimitError) throw error
      return json("Invalid or incomplete multipart backup upload. Nothing was restored.", 400)
    }
    const dump = form.get("dump")
    const sidecar = form.get("checksum")
    if (!(dump instanceof File) || !(sidecar instanceof File)) return json("Choose the dump and its checksum file.", 400)
    if (form.get("confirmation") !== CONFIRMATION || form.get("trustedSource") !== "yes") return json("Restore requires a trusted source and explicit RESTORE ALL WORKSPACES confirmation.", 400)
    if (dump.size > MAX_BACKUP_BYTES || sidecar.size > 512) throw new SizeLimitError()
    const file = path.join(session.directory, "restore.dump")
    await pipeline(Readable.fromWeb(dump.stream() as NodeReadableStream<Uint8Array>), createWriteStream(file, { flags: "wx", mode: 0o600 }), { signal: request.signal })
    let inspected: InspectedDump
    try { inspected = await inspectDump(file) } catch (error) {
      if (error instanceof SizeLimitError) throw error
      return json("Invalid PostgreSQL custom archive. Nothing was restored.", 400)
    }
    if (!checksumDigestMatches(dump.name, inspected.digest, await sidecar.text())) return json("Backup checksum does not match. Nothing was restored.", 400)
    let listing: string
    try {
      listing = await runTool(session, "pg_restore", ["--list", file], { capture: true, signal: request.signal })
    } catch (error) {
      if (error instanceof BackupToolUnavailableError) throw error
      return json("Invalid or unsupported PostgreSQL archive. Nothing was restored.", 400)
    }
    if (!dumpHasAclMetadata(listing)) return json("Backup has no ACL metadata. Re-export from the trusted original database with owners and grants preserved. Nothing was restored.", 400)
    await verifyServer(session, request.signal)
    request.signal.throwIfAborted()
    recoveryRole = `boombignose_recovery_${randomBytes(16).toString("hex")}`
    // Record the candidate before allocation: even a failed tool exit may have
    // committed CREATE ROLE. Allocation is bounded but not request-cancellable.
    await createRecoveryRole(session, recoveryRole)
    request.signal.throwIfAborted()
    outcome = "uncertain"
    await runTool(session, "pg_restore", [...connection(session), `--role=${recoveryRole}`, "--clean", "--if-exists", "--exit-on-error", "--single-transaction", file], { signal: request.signal })
    outcome = "applied"
    return Response.json({ ok: true, scope: "database-only", reloadRequired: true }, { headers: { "Cache-Control": "no-store" } })
  } catch (error) {
    if (error instanceof BackupToolUnavailableError) return json(error.message, 503)
    if (error instanceof SizeLimitError) return json("Backup exceeds the 512 MiB dump or 512-byte checksum limit. Nothing was restored.", 413)
    return json(outcome === "uncertain"
      ? "Restore did not complete successfully; its transaction outcome is uncertain. Inspect the database before retrying. No attachment or native secret files were restored."
      : "Restore did not start. Check the files, native install's private credentials, resolved bundle/data/port, SCRAM configuration, and administrator permission to create a recovery role.", outcome === "uncertain" ? 500 : 503)
  } finally {
    try {
      if (session && recoveryRole) await dropRecoveryRole(session, recoveryRole)
    } catch { cleanupFailed = true }
    try { await session?.close() } catch { cleanupFailed = true } finally { busy = false }
    if (cleanupFailed) {
      const error = outcome === "applied"
        ? "Restore was applied, but recovery role or private staging cleanup failed. Reload the application and have the native administrator complete cleanup before another recovery."
        : outcome === "uncertain"
          ? "Restore transaction outcome is uncertain, and recovery role or private staging cleanup failed. Have the native administrator inspect the database and complete cleanup before retrying."
          : "Restore did not start, but recovery role or private staging cleanup failed. Have the native administrator complete cleanup before retrying."
      // Cleanup failure must override even a committed restore's success result.
      return Response.json({ error, reloadRequired: outcome !== "not-started" }, { status: 500, headers: { "Cache-Control": "no-store" } })
    }
  }
}
