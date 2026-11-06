import { isIP } from "node:net"

import type { CollectorReport, Observation } from "@/lib/network/model"

export const MAX_BODY_BYTES = 256 * 1024
export const MAX_OBSERVATIONS = 500
export const MAX_REPORT_AGE_MS = 5 * 60_000
export const MAX_FUTURE_MS = 60_000

export class NetworkRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message)
  }
}

export function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function isDeviceId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}

function port(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535
}

function address(value: unknown): value is string {
  return typeof value === "string" && value.length <= 45 && !value.includes("%") && isIP(value) !== 0
}

/** Explicit projection is used both when persisting and when returning saved metadata. */
export function parseCollectorReport(value: unknown): CollectorReport | null {
  if (!record(value) || value.coverage !== "current_user_tcp_snapshot"
    || typeof value.capturedAt !== "string" || value.capturedAt.length > 40
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value.capturedAt)
    || !Number.isFinite(Date.parse(value.capturedAt))
    || typeof value.truncated !== "boolean" || !Array.isArray(value.observations)
    || value.observations.length > MAX_OBSERVATIONS) return null

  const observations: Observation[] = []
  const ids = new Set<string>()
  for (const item of value.observations) {
    if (!record(item) || typeof item.id !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(item.id)
      || ids.has(item.id) || item.protocol !== "tcp"
      || !address(item.localAddress) || !address(item.remoteAddress)
      || !port(item.localPort) || !port(item.remotePort)
      || typeof item.process !== "string" || !/^[A-Za-z0-9_.+-]{1,80}$/.test(item.process)
      || typeof item.pid !== "number" || !Number.isInteger(item.pid) || item.pid < 1 || item.pid > 2147483647) return null
    ids.add(item.id)
    observations.push({
      id: item.id, localAddress: item.localAddress, localPort: item.localPort,
      remoteAddress: item.remoteAddress, remotePort: item.remotePort,
      protocol: "tcp", process: item.process, pid: item.pid,
    })
  }
  return {
    capturedAt: new Date(value.capturedAt).toISOString(), coverage: "current_user_tcp_snapshot",
    observations, truncated: value.truncated,
  }
}

export function isCaptureTimeAllowed(capturedAt: string, now: number): boolean {
  const captured = Date.parse(capturedAt)
  return Number.isFinite(captured) && captured <= now + MAX_FUTURE_MS && captured >= now - MAX_REPORT_AGE_MS
}

/** Browser session mutations must originate at this exact app origin. No permissive CORS. */
export function requireSameOrigin(request: Request, configuredOrigin?: string): void {
  const origin = request.headers.get("origin")
  const site = request.headers.get("sec-fetch-site")
  const trustedOrigin = new URL(configuredOrigin || request.url).origin
  if (!origin || origin !== trustedOrigin || (site && site !== "same-origin" && site !== "none")) {
    throw new NetworkRequestError(403, "Same-origin request required.")
  }
}

/** Enforce a real streamed byte limit, including when Content-Length is absent or false. */
export async function readNetworkJson(request: Request): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
    throw new NetworkRequestError(415, "JSON request required.")
  }
  const length = request.headers.get("content-length")
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) {
    throw new NetworkRequestError(413, "Request body too large.")
  }
  if (!request.body) throw new NetworkRequestError(400, "Invalid JSON request.")
  const reader = request.body.getReader()
  const decoder = new TextDecoder("utf-8", { fatal: true })
  let bytes = 0
  let text = ""
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel()
        throw new NetworkRequestError(413, "Request body too large.")
      }
      text += decoder.decode(chunk.value, { stream: true })
    }
    text += decoder.decode()
    return JSON.parse(text) as unknown
  } catch (error) {
    if (error instanceof NetworkRequestError) throw error
    throw new NetworkRequestError(400, "Invalid JSON request.")
  } finally {
    reader.releaseLock()
  }
}
