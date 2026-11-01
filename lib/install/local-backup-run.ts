import { spawn } from "node:child_process"
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { getOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import {
  backupFileName,
  checksumLine,
  checksumMatches,
  dumpLooksCustom,
  loopbackBackupURL,
  resolvePgTool,
  sha256Hex,
} from "@/lib/install/local-backup"

const MAX_DUMP = 512 * 1024 * 1024

function denied(): Promise<Response | null> {
  return getOrgContext().then((ctx) => {
    if (!ctx) return Response.json({ error: "Sign in required." }, { status: 401 })
    if (!can(ctx.role, "settings:manage")) {
      return Response.json({ error: "Only owners and admins can back up this database." }, { status: 403 })
    }
    return null
  })
}

function localPort(): string {
  const url = new URL(loopbackBackupURL(process.env))
  if (url.hostname !== "127.0.0.1" || !url.port) throw new Error("Local database port is not allowed.")
  return url.port
}

function runTool(bin: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      shell: false,
      stdio: "ignore",
      env: {
        NODE_ENV: process.env.NODE_ENV,
        LC_ALL: "C",
        PATH: process.env.PATH ?? "",
      },
    })
    child.on("error", () => reject(new Error("backup tool failed")))
    child.on("close", (code) => {
      if (code === 0) resolve()
      else reject(new Error("backup tool failed"))
    })
  })
}

/** Dumps the local cluster to a custom file and returns it with a sha256 header. */
export async function exportLocalBackup(): Promise<Response> {
  const block = await denied()
  if (block) return block
  let dir = ""
  try {
    const bin = await resolvePgTool(process.env, "pg_dump")
    const port = localPort()
    dir = await mkdtemp(path.join(tmpdir(), "bbn-backup-"))
    const name = backupFileName(new Date())
    const file = path.join(dir, name)
    await runTool(bin, [
      "--format=custom",
      "--no-password",
      "--no-owner",
      "--no-acl",
      "--host=127.0.0.1",
      `--port=${port}`,
      "--username=boombignose",
      "--dbname=boombignose",
      `--file=${file}`,
    ])
    const bytes = await readFile(file)
    if (!dumpLooksCustom(bytes)) throw new Error("backup is not a postgres custom dump")
    const hex = sha256Hex(bytes)
    checksumLine(name, hex)
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${name}"`,
        "X-Backup-Sha256": hex,
        "X-Backup-Name": name,
        "Cache-Control": "no-store",
      },
    })
  } catch {
    return Response.json({ error: "The local backup could not be written. Nothing was uploaded." }, { status: 500 })
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true })
  }
}

/** Restores a custom dump only after its sidecar matches the bytes. */
export async function restoreLocalBackup(dump: File, sidecar: File): Promise<Response> {
  const block = await denied()
  if (block) return block
  if (dump.size > MAX_DUMP || sidecar.size > 512) {
    return Response.json({ error: "That backup is too large for this screen. Use boombignose backup restore." }, { status: 413 })
  }
  const name = dump.name
  const bytes = Buffer.from(await dump.arrayBuffer())
  if (!checksumMatches(name, bytes, await sidecar.text()) || !dumpLooksCustom(bytes)) {
    return Response.json({ error: "Backup checksum does not match. Nothing was restored." }, { status: 400 })
  }
  let dir = ""
  try {
    const bin = await resolvePgTool(process.env, "pg_restore")
    const port = localPort()
    dir = await mkdtemp(path.join(tmpdir(), "bbn-restore-"))
    const file = path.join(dir, name)
    await writeFile(file, bytes)
    await runTool(bin, [
      "--no-password",
      "--no-owner",
      "--no-acl",
      "--clean",
      "--if-exists",
      "--exit-on-error",
      "--single-transaction",
      "--host=127.0.0.1",
      `--port=${port}`,
      "--username=boombignose",
      "--dbname=boombignose",
      file,
    ])
    return Response.json({ ok: true })
  } catch {
    return Response.json({ error: "Restore failed. The checksum matched. Postgres rolls a failed restore back when it can." }, { status: 500 })
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true })
  }
}
