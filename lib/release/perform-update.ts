import { createHash, timingSafeEqual } from "node:crypto"
import { mkdir, open, rename, rm } from "node:fs/promises"
import path from "node:path"

import { interpretRelease } from "@/lib/release/update-check"
import {
  DEFERRED_MESSAGE,
  MACOS_ARM64_ASSET,
  SHA256SUMS,
  WINDOW_MESSAGE,
  helperConfigured,
  initialDownloadURL,
  parseSHA256SUMS,
  redirectAllowed,
  releaseDownloadURL,
  updateCapability,
  type UpdateCapability,
} from "@/lib/release/update-plan"

const RELEASE_API = "https://api.github.com/repos/Boom-Vitt/boombignose-erp-harness-ai/releases/latest"
const MAX_BYTES = 2 * 1024 * 1024 * 1024 - 1
const USER_AGENT = "BoomBigNose"

export class UpdateFlowError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "UpdateFlowError"
  }
}

export type UpdateEvent =
  | { phase: "sums" }
  | { phase: "download"; received: number; total: number | null }
  | { phase: "verify" }
  | { phase: "apply" }
  | { phase: "restart" }
  | { phase: "error"; message: string }

export function capabilityMessage(capability: UpdateCapability): string | null {
  if (capability === "deferred") return DEFERRED_MESSAGE
  if (capability === "needs-window") return WINDOW_MESSAGE
  return null
}

export function stagedPath(dir: string, file: string): string | null {
  if (!dir || file !== path.basename(file) || file.includes("..")) return null
  const root = path.resolve(dir)
  const full = path.resolve(root, file)
  if (full !== path.join(root, file)) return null
  return full
}

function hashesMatch(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"))
}

async function fetchChecked(url: string, fetchImpl: typeof fetch, accept: string): Promise<Response> {
  if (!initialDownloadURL(url)) throw new UpdateFlowError("The update address was refused.")
  let current = new URL(url)
  for (let hop = 0; hop < 5; hop += 1) {
    const response = await fetchImpl(current, {
      redirect: "manual",
      headers: { Accept: accept, "User-Agent": USER_AGENT },
      cache: "no-store",
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      const next = location ? redirectAllowed(current, location) : null
      if (!next) throw new UpdateFlowError("The update download was refused.")
      current = next
      continue
    }
    if (!response.ok) throw new UpdateFlowError("The update download did not respond.")
    return response
  }
  throw new UpdateFlowError("The update download was refused.")
}

async function writeVerified(dir: string, file: string, response: Response, expected: string, onBytes: (received: number, total: number | null) => void): Promise<void> {
  const finalPath = stagedPath(dir, file)
  const partial = stagedPath(dir, `${file}.partial`)
  if (!finalPath || !partial) throw new UpdateFlowError("The update file was refused.")
  const lengthHeader = response.headers.get("content-length")
  const total = lengthHeader && /^\d+$/.test(lengthHeader) ? Number(lengthHeader) : null
  if (total !== null && total > MAX_BYTES) throw new UpdateFlowError("The update file is larger than this app accepts.")
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const handle = await open(partial, "w", 0o600)
  const hash = createHash("sha256")
  let received = 0
  try {
    if (!response.body) throw new UpdateFlowError("The update file was empty.")
    const reader = response.body.getReader()
    for (;;) {
      const step = await reader.read()
      if (step.done) break
      received += step.value.byteLength
      if (received > MAX_BYTES) throw new UpdateFlowError("The update file is larger than this app accepts.")
      hash.update(step.value)
      let offset = 0
      while (offset < step.value.byteLength) {
        const wrote = await handle.write(step.value, offset, step.value.byteLength - offset, null)
        if (wrote.bytesWritten <= 0) throw new UpdateFlowError("The update file could not be stored.")
        offset += wrote.bytesWritten
      }
      onBytes(received, total)
    }
  } catch (error) {
    await handle.close().catch(() => undefined)
    await rm(partial, { force: true })
    throw error
  }
  await handle.close()
  const actual = hash.digest("hex")
  if (!hashesMatch(actual, expected)) {
    await rm(partial, { force: true })
    throw new UpdateFlowError("The update file did not match SHA256SUMS.")
  }
  await rename(partial, finalPath)
}

export async function applyWithHelper(version: string, file: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const raw = process.env.BOOMBIGNOSE_UPDATE_URL?.trim() ?? ""
  const token = process.env.BOOMBIGNOSE_UPDATE_TOKEN?.trim() ?? ""
  if (!helperConfigured(raw, token)) throw new UpdateFlowError(WINDOW_MESSAGE)
  if (file !== MACOS_ARM64_ASSET) throw new UpdateFlowError(DEFERRED_MESSAGE)
  const endpoint = new URL("v1/apply", raw.endsWith("/") ? raw : `${raw}/`)
  const response = await fetchImpl(endpoint, {
    method: "POST",
    redirect: "error",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ version, file }),
    signal: AbortSignal.timeout(10 * 60 * 1000),
  })
  if (response.ok) return
  const data = (await response.json().catch(() => null)) as { error?: unknown } | null
  if (data?.error === "deferred") throw new UpdateFlowError(DEFERRED_MESSAGE)
  throw new UpdateFlowError("The desktop helper did not install the update.")
}

export async function performDesktopUpdate(input: {
  platform: string
  arch: string
  currentVersion: string
  helperConfigured: boolean
  fetchImpl: typeof fetch
  stageDir: string
  onEvent?: (event: UpdateEvent) => void
  apply?: (version: string, file: string) => Promise<void>
}): Promise<void> {
  const send = input.onEvent ?? (() => undefined)
  const capability = updateCapability(input.platform, input.arch, input.helperConfigured)
  const blocked = capabilityMessage(capability)
  if (blocked) throw new UpdateFlowError(blocked)
  if (!input.stageDir) throw new UpdateFlowError("No local folder is available for the update.")

  const release = await input.fetchImpl(RELEASE_API, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": USER_AGENT },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  })
  if (!release.ok) throw new UpdateFlowError("The release page did not respond.")
  const interpreted = interpretRelease(await release.json(), input.currentVersion)
  if (interpreted.state === "unavailable") throw new UpdateFlowError(interpreted.message)
  if (interpreted.state !== "available") throw new UpdateFlowError("This install matches the published release.")

  send({ phase: "sums" })
  const sumsURL = releaseDownloadURL(interpreted.version, SHA256SUMS)
  const fileURL = releaseDownloadURL(interpreted.version, MACOS_ARM64_ASSET)
  if (!sumsURL || !fileURL) throw new UpdateFlowError("The update address was refused.")
  const sumsResponse = await fetchChecked(sumsURL, input.fetchImpl, "text/plain")
  const expected = parseSHA256SUMS(await sumsResponse.text(), MACOS_ARM64_ASSET)
  if (!expected) throw new UpdateFlowError("SHA256SUMS did not list the macOS installer.")

  send({ phase: "download", received: 0, total: null })
  const fileResponse = await fetchChecked(fileURL, input.fetchImpl, "application/octet-stream")
  await writeVerified(input.stageDir, MACOS_ARM64_ASSET, fileResponse, expected, (received, total) => {
    send({ phase: "download", received, total })
  })
  send({ phase: "verify" })
  send({ phase: "restart" })
  send({ phase: "apply" })
  await (input.apply ?? ((version, file) => applyWithHelper(version, file, input.fetchImpl)))(interpreted.version, MACOS_ARM64_ASSET)
}
