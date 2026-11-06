import { describe, expect, it } from "vitest"

import {
  isCaptureTimeAllowed, isDeviceId, MAX_BODY_BYTES, MAX_FUTURE_MS,
  MAX_REPORT_AGE_MS, parseCollectorReport, readNetworkJson, requireSameOrigin,
} from "./validation"

const capturedAt = "2026-11-06T12:00:00.000Z"
const socket = {
  id: "socket_abc", localAddress: "192.0.2.10", localPort: 51234,
  remoteAddress: "2001:db8::1", remotePort: 443, protocol: "tcp", process: "Google_Chrome", pid: 42,
}
const report = () => ({ capturedAt, coverage: "current_user_tcp_snapshot", truncated: false, observations: [{ ...socket }] })
const jsonRequest = (body: string, headers: Record<string, string> = {}) => new Request("https://erp.example/api/network/telemetry", {
  method: "POST", headers: { "content-type": "application/json", ...headers }, body,
})

describe("network metadata allowlist", () => {
  it("retains only known metadata fields at both levels", () => {
    const result = parseCollectorReport({ ...report(), deviceToken: "discard", rawLogs: "discard",
      observations: [{ ...socket, args: "discard", password: "discard", payload: "discard", bytes: 123 }],
    })
    expect(result).toEqual(report())
    expect(JSON.stringify(result)).not.toContain("discard")
  })

  it("accepts empty heartbeats without inventing observations", () => {
    expect(parseCollectorReport({ ...report(), observations: [] })?.observations).toEqual([])
  })

  it("accepts native Go RFC3339Nano capture times and normalizes to storage milliseconds", () => {
    const result = parseCollectorReport({ ...report(), capturedAt: "2026-11-06T12:00:00.123456789Z" })
    expect(result?.capturedAt).toBe("2026-11-06T12:00:00.123Z")
    expect(parseCollectorReport({ ...report(), capturedAt: "2026-11-06T12:00:00.1234567890Z" })).toBeNull()
  })

  it("accepts exactly 500 sockets and rejects 501", () => {
    const observations = Array.from({ length: 500 }, (_, index) => ({ ...socket, id: `socket_${index}` }))
    expect(parseCollectorReport({ ...report(), observations })?.observations).toHaveLength(500)
    expect(parseCollectorReport({ ...report(), observations: [...observations, { ...socket, id: "extra" }] })).toBeNull()
  })

  it.each([
    { process: "/usr/bin/curl" }, { process: "curl --password secret" }, { process: "curl\nsecret" },
    { process: "a".repeat(81) }, { pid: 0 }, { pid: 2147483648 }, { pid: 1.5 },
    { localPort: 0 }, { remotePort: 65536 }, { remotePort: "443" },
    { protocol: "udp" }, { remoteAddress: "example.org" }, { localAddress: "999.0.0.1" },
    { remoteAddress: "fe80::1%en0" }, { id: "socket unsafe" },
  ])("rejects unsafe or unsupported socket metadata %j", (patch) => {
    expect(parseCollectorReport({ ...report(), observations: [{ ...socket, ...patch }] })).toBeNull()
  })

  it("rejects duplicate evidence ids, malformed timestamps and unsupported coverage", () => {
    expect(parseCollectorReport({ ...report(), observations: [socket, socket] })).toBeNull()
    expect(parseCollectorReport({ ...report(), capturedAt: "yesterday" })).toBeNull()
    expect(parseCollectorReport({ ...report(), capturedAt: "2026-11-06" })).toBeNull()
    expect(parseCollectorReport({ ...report(), coverage: "whole_machine" })).toBeNull()
    expect(parseCollectorReport({ ...report(), truncated: "false" })).toBeNull()
  })

  it("requires registered UUID syntax", () => {
    expect(isDeviceId("c1800000-0000-4000-8000-000000000001")).toBe(true)
    expect(isDeviceId("../other-workspace")).toBe(false)
  })
})

describe("capture-time boundaries", () => {
  const now = Date.parse(capturedAt)
  it("accepts exact age and clock-skew boundaries", () => {
    expect(isCaptureTimeAllowed(new Date(now - MAX_REPORT_AGE_MS).toISOString(), now)).toBe(true)
    expect(isCaptureTimeAllowed(new Date(now + MAX_FUTURE_MS).toISOString(), now)).toBe(true)
  })
  it("rejects one millisecond beyond either boundary and invalid times", () => {
    expect(isCaptureTimeAllowed(new Date(now - MAX_REPORT_AGE_MS - 1).toISOString(), now)).toBe(false)
    expect(isCaptureTimeAllowed(new Date(now + MAX_FUTURE_MS + 1).toISOString(), now)).toBe(false)
    expect(isCaptureTimeAllowed("invalid", now)).toBe(false)
  })
})

describe("bounded JSON body", () => {
  it("accepts exactly 256 KiB, counting UTF-8 bytes", async () => {
    const value = "é".repeat((MAX_BODY_BYTES - 2) / 2)
    expect(await readNetworkJson(jsonRequest(JSON.stringify(value)))).toBe(value)
  })
  it("rejects streamed excess even with a forged small content length", async () => {
    await expect(readNetworkJson(jsonRequest(JSON.stringify("x".repeat(MAX_BODY_BYTES)), { "content-length": "1" })))
      .rejects.toMatchObject({ status: 413 })
  })
  it("rejects claimed excess before reading", async () => {
    await expect(readNetworkJson(jsonRequest("{}", { "content-length": String(MAX_BODY_BYTES + 1) })))
      .rejects.toMatchObject({ status: 413 })
  })
  it("rejects non-JSON, malformed JSON, and empty bodies", async () => {
    await expect(readNetworkJson(jsonRequest("{}", { "content-type": "text/plain" }))).rejects.toMatchObject({ status: 415 })
    await expect(readNetworkJson(jsonRequest("{"))).rejects.toMatchObject({ status: 400 })
    await expect(readNetworkJson(jsonRequest(""))).rejects.toMatchObject({ status: 400 })
  })
})

describe("session mutation origin protection", () => {
  const request = (headers: Record<string, string>) => new Request("https://erp.example/api/network/devices", { method: "POST", headers })
  it("uses the configured public origin behind an internal localhost server without trusting forwarded hosts", () => {
    const internal = new Request("http://localhost:3100/api/network/devices", {
      method: "POST", headers: { origin: "http://127.0.0.1:3100", "sec-fetch-site": "same-origin" },
    })
    expect(() => requireSameOrigin(internal, "http://127.0.0.1:3100")).not.toThrow()
    expect(() => requireSameOrigin(internal)).toThrow("Same-origin request required.")
    const forged = new Request(internal.url, {
      method: "POST", headers: { origin: "https://evil.example", "x-forwarded-host": "evil.example" },
    })
    expect(() => requireSameOrigin(forged, "http://127.0.0.1:3100")).toThrow("Same-origin request required.")
  })
  it.each([
    {}, { origin: "null" }, { origin: "https://evil.example" },
    { origin: "http://erp.example" }, { origin: "https://erp.example:8443" },
    { origin: "https://erp.example", "sec-fetch-site": "cross-site" },
  ] as Record<string, string>[])("rejects absent or cross-origin requests %j", (headers) => {
    expect(() => requireSameOrigin(request(headers))).toThrow("Same-origin request required.")
  })
})
