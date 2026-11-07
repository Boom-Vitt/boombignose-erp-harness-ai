import "server-only"

import { createHash } from "node:crypto"
import { spawn } from "node:child_process"
import { chmod, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import path from "node:path"

import { localDataDir } from "@/lib/install/logs"
import {
  ASR_MODEL,
  allowedDownloadHost,
  asrArchive,
  asrArgs,
  audioKind,
  pinnedUrl,
  unpackTarGz,
  unpackZip,
  type AsrArchive,
} from "@/lib/ai/asr-runtime"

const ARCHIVE_CAP = 20_000_000
const MODEL_CAP = 90_000_000
const AUDIO_CAP = 4_000_000

export function asrRoot(): string | null {
  const data = localDataDir()
  if (!data) return null
  return path.join(path.dirname(path.resolve(data)), "asr")
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex")
}

async function readBody(res: Response, cap: number): Promise<Buffer> {
  if (!res.body) throw new Error("The download was empty.")
  const reader = res.body.getReader()
  const chunks: Buffer[] = []
  let size = 0
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    size += step.value.byteLength
    if (size > cap) throw new Error("The download is larger than this app accepts.")
    chunks.push(Buffer.from(step.value))
  }
  return Buffer.concat(chunks)
}

export async function downloadPinned(url: string, sha: string, cap: number, fetchImpl: typeof fetch = fetch): Promise<Buffer> {
  if (!pinnedUrl(url)) throw new Error("That download is not in this build.")
  let current = url
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetchImpl(current, { redirect: "manual" })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) throw new Error("The download redirect was empty.")
      const next = new URL(location, current)
      if (next.protocol !== "https:" || !allowedDownloadHost(next.hostname)) throw new Error("The download host is not allowed.")
      current = next.toString()
      continue
    }
    if (!response.ok) throw new Error(`The download returned HTTP ${response.status}.`)
    const bytes = await readBody(response, cap)
    if (sha256(bytes) !== sha) throw new Error("The download checksum did not match.")
    return bytes
  }
  throw new Error("The download redirected too many times.")
}

function runtimeDir(root: string): string {
  return path.join(root, "runtime")
}

export async function asrInstalled(root: string, archive: AsrArchive): Promise<boolean> {
  try {
    const binary = path.join(runtimeDir(root), archive.binary)
    const model = path.join(root, ASR_MODEL.file)
    const [bin, stamp, info] = await Promise.all([
      stat(binary),
      readFile(path.join(root, `${ASR_MODEL.file}.sha256`), "utf8"),
      stat(model),
    ])
    return bin.isFile() && bin.size > 32 && info.isFile() && info.size === ASR_MODEL.bytes && stamp.trim() === ASR_MODEL.sha256
  } catch {
    return false
  }
}

export async function asrCard(platform: NodeJS.Platform, arch: string): Promise<{ offered: boolean; installed: boolean }> {
  const archive = asrArchive(platform, arch)
  if (!archive) return { offered: false, installed: false }
  const root = asrRoot()
  if (!root) return { offered: true, installed: false }
  return { offered: true, installed: await asrInstalled(root, archive) }
}

export async function installAsr(platform: NodeJS.Platform, arch: string, fetchImpl: typeof fetch = fetch): Promise<{ ok: true } | { error: string }> {
  const archive = asrArchive(platform, arch)
  const root = asrRoot()
  if (!archive) return { error: "Speech to text is not available on this computer in this build." }
  if (!root) return { error: "No local data directory yet." }
  try {
    const packed = await downloadPinned(archive.url, archive.sha256, ARCHIVE_CAP, fetchImpl)
    const files = archive.url.endsWith(".zip") ? unpackZip(packed) : unpackTarGz(packed)
    if (!files.some((file) => file.name === archive.binary)) return { error: "The archive did not contain the speech program." }
    const dest = runtimeDir(root)
    await rm(dest, { recursive: true, force: true })
    await mkdir(dest, { recursive: true })
    for (const file of files) {
      const target = path.resolve(dest, file.name)
      if (!target.startsWith(dest + path.sep)) return { error: "The archive path is refused." }
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, file.data)
    }
    await chmod(path.join(dest, archive.binary), 0o755)
    const model = await downloadPinned(ASR_MODEL.url, ASR_MODEL.sha256, MODEL_CAP, fetchImpl)
    // Downloaded runtime data lives outside the installer; never snapshot its
    // operator-selected directory as application source during compilation.
    await writeFile(path.join(/* turbopackIgnore: true */ root, ASR_MODEL.file), model)
    await writeFile(path.join(/* turbopackIgnore: true */ root, `${ASR_MODEL.file}.sha256`), ASR_MODEL.sha256)
    return { ok: true }
  } catch (err) {
    const message = err instanceof Error ? err.message : "The download failed."
    return { error: message.slice(0, 200) }
  }
}

export async function removeAsr(): Promise<void> {
  const root = asrRoot()
  if (!root) return
  await rm(runtimeDir(root), { recursive: true, force: true })
  await rm(path.join(/* turbopackIgnore: true */ root, ASR_MODEL.file), { force: true })
  await rm(path.join(/* turbopackIgnore: true */ root, `${ASR_MODEL.file}.sha256`), { force: true })
}

function childEnv(libraryDir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: process.env.NODE_ENV ?? "production" }
  for (const key of ["PATH", "HOME", "TMPDIR", "LANG", "TEMP", "TMP", "SystemRoot", "USERPROFILE"]) {
    if (process.env[key]) env[key] = process.env[key]
  }
  env.LD_LIBRARY_PATH = libraryDir
  return env
}

export async function transcribeLocalAudio(audio: Buffer, platform: NodeJS.Platform, arch: string): Promise<{ text: string } | { error: string; status: number }> {
  const archive = asrArchive(platform, arch)
  const root = asrRoot()
  if (!archive || !root) return { error: "Speech to text is not available on this computer in this build.", status: 409 }
  if (!(await asrInstalled(root, archive))) return { error: "Install speech to text on this computer first.", status: 409 }
  if (audio.byteLength < 16 || audio.byteLength > AUDIO_CAP || !audioKind(audio)) {
    return { error: "Use a WAV, MP3, FLAC, or Ogg file under 4 MB.", status: 400 }
  }
  const binary = path.join(runtimeDir(root), archive.binary)
  const model = path.join(/* turbopackIgnore: true */ root, ASR_MODEL.file)
  const input = path.join(root, "inbox.audio")
  await writeFile(input, audio)
  try {
    const text = await runBinary(binary, asrArgs(model, input), path.dirname(binary))
    if (!text.trim()) return { error: "The recording had no words.", status: 502 }
    return { text: text.trim().slice(0, 8000) }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Speech to text failed."
    return { error: message.slice(0, 200), status: 502 }
  } finally {
    await rm(input, { force: true })
  }
}

function runBinary(binary: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd, env: childEnv(cwd), shell: false, stdio: ["ignore", "pipe", "pipe"] })
    const out: Buffer[] = []
    const err: Buffer[] = []
    let outSize = 0
    child.stdout.on("data", (chunk: Buffer) => {
      outSize += chunk.byteLength
      if (outSize <= 64_000) out.push(chunk)
    })
    child.stderr.on("data", (chunk: Buffer) => {
      if (err.reduce((sum, item) => sum + item.byteLength, 0) < 4_000) err.push(chunk)
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error("Speech to text took too long."))
    }, 120_000)
    child.on("error", () => {
      clearTimeout(timer)
      reject(new Error("The speech program could not start."))
    })
    child.on("close", (code) => {
      clearTimeout(timer)
      if (code !== 0) reject(new Error(Buffer.concat(err).toString("utf8").replace(/\s+/g, " ").trim().slice(0, 200) || "Speech to text failed."))
      else resolve(Buffer.concat(out).toString("utf8"))
    })
  })
}
