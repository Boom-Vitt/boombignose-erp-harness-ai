import "server-only"

import { spawn, type ChildProcess } from "node:child_process"
import path from "node:path"
import { OCR_LIMITS } from "./contracts"

export type RasterMetadata = { mime: "image/jpeg" | "image/png" | "image/webp"; width: number; height: number }
export class RasterGuardError extends Error {
  constructor(public readonly kind: "invalid" | "unavailable") {
    super(kind === "invalid" ? "Invalid raster" : "Native raster validator unavailable")
  }
}

const invalidCodes: Record<string, true> = { size: true, unsupported: true, corrupt: true, animated: true, dimensions: true }
const MAX_OUTPUT = 512
const MAX_ACTIVE = 2
let active = 0

/** Parse the entire bounded reply, not a permissive prefix or trusted cast. */
export function parseRasterReply(bytes: Uint8Array): RasterMetadata {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_OUTPUT) throw new RasterGuardError("unavailable")
  let data: unknown
  try { data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) }
  catch { throw new RasterGuardError("unavailable") }
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new RasterGuardError("unavailable")
  const reply = data as Record<string, unknown>
  const keys = Object.keys(reply).sort().join(",")
  if (reply.ok === false && keys === "code,ok" && typeof reply.code === "string") {
    throw new RasterGuardError(Object.hasOwn(invalidCodes, reply.code) ? "invalid" : "unavailable")
  }
  if (reply.ok !== true || keys !== "height,mime,ok,width" || typeof reply.mime !== "string" || !["image/jpeg", "image/png", "image/webp"].includes(reply.mime) ||
    typeof reply.width !== "number" || typeof reply.height !== "number" || !Number.isSafeInteger(reply.width) || !Number.isSafeInteger(reply.height) ||
    reply.width < 1 || reply.height < 1 || Math.max(reply.width, reply.height) > OCR_LIMITS.pageEdge || reply.width * reply.height > OCR_LIMITS.pagePixels) {
    throw new RasterGuardError("unavailable")
  }
  return { mime: reply.mime as RasterMetadata["mime"], width: reply.width, height: reply.height }
}

/** No shell, PATH lookup, inherited secrets, filenames, or image re-encoding.
 * Requests beyond the two live decoders fail immediately: no unbounded queue.
 */
export async function decodeRaster(bytes: Uint8Array, signal?: AbortSignal): Promise<RasterMetadata> {
  signal?.throwIfAborted()
  if (bytes.byteLength === 0 || bytes.byteLength > OCR_LIMITS.pageBytes) throw new RasterGuardError("invalid")
  const override = process.env.BOOMBIGNOSE_RASTER_HELPER
  if (override !== undefined && (!override || !path.isAbsolute(override))) throw new RasterGuardError("unavailable")
  const executable = override ?? path.join(process.cwd(), "boombignose", "bin", process.platform === "win32" ? "boombignose-image.exe" : "boombignose-image")
  if (active >= MAX_ACTIVE) throw new RasterGuardError("unavailable")
  active++
  const { promise, resolve, reject } = Promise.withResolvers<RasterMetadata>()
    const env: NodeJS.ProcessEnv = { NODE_ENV: "production", GOMAXPROCS: "1", GOMEMLIMIT: "96MiB" }
    if (process.platform === "win32" && process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot
    let child: ChildProcess
    try {
      // The packaged helper is an explicit tracing include. An OS-configured
      // external executable is not a dependency tree to snapshot at build time.
      child = spawn(/* turbopackIgnore: true */ executable, [], { shell: false, windowsHide: true, env, stdio: ["pipe", "pipe", "ignore"] })
    } catch {
      active--
      reject(new RasterGuardError("unavailable"))
      return promise
    }
    let settled = false
    const output = Buffer.alloc(MAX_OUTPUT)
    let size = 0
    const finish = (error?: unknown, result?: RasterMetadata) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener("abort", abort)
      child.stdin?.destroy()
      if (error) {
        child.kill("SIGKILL")
        reject(error)
      } else {
        resolve(result!)
      }
    }
    const abort = () => finish(signal?.reason ?? new DOMException("Aborted", "AbortError"))
    const timer = setTimeout(() => finish(new RasterGuardError("unavailable")), 5_000)
    signal?.addEventListener("abort", abort, { once: true })
    child.on("error", () => finish(new RasterGuardError("unavailable")))
    child.stdin?.on("error", () => finish(new RasterGuardError("unavailable")))
    child.stdout?.on("data", (chunk: Buffer) => {
      if (settled) return
      if (chunk.length > MAX_OUTPUT - size) { finish(new RasterGuardError("unavailable")); return }
      chunk.copy(output, size)
      size += chunk.length
    })
    child.on("close", (code, terminationSignal) => {
      active--
      if (settled) return
      if (code !== 0 || terminationSignal) { finish(new RasterGuardError("unavailable")); return }
      try { finish(undefined, parseRasterReply(output.subarray(0, size))) }
      catch (error) { finish(error) }
    })
    if (signal?.aborted) { abort(); return promise }
    const header = Buffer.alloc(8)
    header.writeBigUInt64BE(BigInt(bytes.byteLength))
    // Separate writes preserve the original view without a concatenated copy.
    child.stdin?.write(header)
    child.stdin?.end(bytes)
  return promise
}
