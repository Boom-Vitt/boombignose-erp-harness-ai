import { describe, expect, it } from "vitest"
import { buildConnections, connectionId, eventDetails, FRESHNESS_MS, type NetworkDevice, type NetworkSnapshot, type SshEvent } from "./model"
import { classifyAddress, evaluateNetworkSignals, evaluateSshSignals, isValidCidr } from "./signals"
import { SAMPLE_MACHINES, SAMPLE_SSH_EVENTS } from "./sample"

const epoch = Date.parse("2026-01-15T03:00:00Z")
const event = (id: string, offset = 0, overrides: Partial<SshEvent> = {}): SshEvent => ({ id, source: "a", target: "b", timestamp: new Date(epoch + offset).toISOString(), port: 22, account: "operator", outcome: "failure", ...overrides })
const failures = (count: number, spacing: number) => Array.from({ length: count }, (_, i) => event(`f${i}`, i * spacing))
const rules = (events: SshEvent[]) => evaluateSshSignals(events).map(signal => signal.rule)

describe("SSH evidence rules", () => {
  it("includes the fifth failure and inclusive five-minute boundary without mutating input", () => {
    const events = failures(5, 75_000).reverse()
    const before = events.map(item => item.id)
    expect(evaluateSshSignals(events)).toEqual([{ id: JSON.stringify(["failed_burst", connectionId("a", "b")]), rule: "failed_burst", connectionId: connectionId("a", "b"), eventIds: ["f0", "f1", "f2", "f3", "f4"], status: "pending_review" }])
    expect(events.map(item => item.id)).toEqual(before)
    expect(rules(failures(4, 1))).not.toContain("failed_burst")
    expect(rules(failures(5, 75_001))).not.toContain("failed_burst")
  })
  it("uses sliding windows, excludes unrelated old failures, and emits once per pair", () => {
    const events = [event("old", -900_000), ...failures(7, 50_000)]
    const result = evaluateSshSignals(events)
    expect(result).toHaveLength(1)
    expect(result[0].eventIds).toEqual(failures(7, 50_000).map(item => item.id))
    expect(rules([...failures(4, 1), event("other-source", 0, { source: "c" }), event("other-target", 0, { target: "c" }), event("reverse", 0, { source: "b", target: "a" }), event("success", 0, { outcome: "success" })])).not.toContain("failed_burst")
  })
  it("requires exact root success and produces one signal per event", () => {
    expect(evaluateSshSignals([event("root1", 0, { account: "root", outcome: "success" }), event("root2", 1, { account: "root", outcome: "success" })]).filter(item => item.rule === "root_login").map(item => item.eventIds)).toEqual([["root1"], ["root2"]])
    expect(rules([event("failed-root", 0, { account: "root" }), event("case", 0, { account: "Root", outcome: "success" }), event("space", 0, { account: "root ", outcome: "success" })])).not.toContain("root_login")
  })
  it.each([
    ["2026-01-14T22:59:59.999Z", true], // 05:59:59.999 Bangkok
    ["2026-01-14T23:00:00Z", false],
    ["2026-01-15T14:59:59.999Z", false],
    ["2026-01-15T15:00:00Z", true],
    ["2026-01-15T18:00:00Z", true],
    ["2026-01-15T22:00:00+07:00", true],
  ])("evaluates Bangkok off-hours at %s", (timestamp, expected) => {
    expect(rules([event("time", 0, { timestamp, outcome: "success" })]).includes("off_hours")).toBe(expected)
    expect(rules([event("time", 0, { timestamp })])).not.toContain("off_hours")
  })
  it("does not manufacture evidence from invalid times", () => {
    expect(evaluateSshSignals([event("invalid", 0, { timestamp: "invalid", account: "root", outcome: "success" }), ...failures(4, 1), event("invalid-failure", 0, { timestamp: "" })])).toEqual([])
  })
  it("keeps all sample signals pending review and ordinary examples unflagged", () => {
    const result = evaluateSshSignals(SAMPLE_SSH_EVENTS)
    expect(new Set(result.map(item => item.rule))).toEqual(new Set(["root_login", "off_hours", "failed_burst"]))
    expect(result.every(item => item.status === "pending_review")).toBe(true)
    expect(result.flatMap(item => item.eventIds)).not.toContain("sample-ordinary")
    expect(SAMPLE_MACHINES.every(machine => /^(192\.0\.2|198\.51\.100|203\.0\.113)\./.test(machine.address))).toBe(true)
  })
})

describe("explicit CIDR policy", () => {
  it.each(["0.0.0.0/0", "255.255.255.255/32", "192.0.2.123/24", "::/0", "::1/128", "2001:db8::/32", "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff/128", "::ffff:192.0.2.0/120"])("accepts %s", cidr => expect(isValidCidr(cidr)).toBe(true))
  it.each(["", "192.0.2.1", "192.0.2.0/-1", "192.0.2.0/33", "256.0.0.0/8", "01.0.0.0/8", "192.0.2.0/24/1", "::/129", "1::2::3/64", "1:2:3/64", "1:2:3:4:5:6:7:8:9/64", "gg::/64", "fe80::1%en0/64", "::ffff:999.1.1.1/128", " ::/0"])("rejects %s", cidr => expect(isValidCidr(cidr)).toBe(false))
  it.each([
    ["192.0.2.0", "192.0.2.0/24", "allowed"], ["192.0.2.255", "192.0.2.0/24", "allowed"], ["192.0.3.0", "192.0.2.0/24", "outside_policy"], ["192.0.1.255", "192.0.2.0/24", "outside_policy"],
    ["203.0.113.255", "0.0.0.0/0", "allowed"], ["192.0.2.2", "192.0.2.1/32", "outside_policy"], ["192.0.2.1", "192.0.2.1/32", "allowed"],
    ["2001:db8:ffff:ffff:ffff:ffff:ffff:ffff", "2001:db8::/32", "allowed"], ["2001:db9::", "2001:db8::/32", "outside_policy"], ["::1", "::1/128", "allowed"], ["::2", "::1/128", "outside_policy"], ["ffff::1", "::/0", "allowed"],
    ["::ffff:192.0.2.9", "192.0.2.0/24", "allowed"], ["192.0.2.9", "::ffff:c000:200/120", "allowed"], ["::ffff:c000:309", "192.0.2.0/24", "outside_policy"],
  ])("classifies %s against %s", (address, cidr, expected) => expect(classifyAddress(address, [cidr])).toBe(expected))
  it("does not imply private addresses are allowed, or apply invalid policy", () => {
    expect(classifyAddress("10.0.0.1", [])).toBe("unknown")
    expect(classifyAddress("10.0.0.1", ["192.0.2.0/24"])).toBe("outside_policy")
    expect(classifyAddress("192.0.2.1", ["192.0.2.0/24", "bad"])).toBe("unknown")
    expect(classifyAddress("not-an-address", ["0.0.0.0/0"])).toBe("unknown")
    expect(classifyAddress("203.0.113.1", ["192.0.2.0/24", "203.0.113.0/24"])).toBe("allowed")
  })
  it("honors non-byte prefix boundaries in both address families", () => {
    expect(classifyAddress("192.0.2.1", ["192.0.2.0/31"])).toBe("allowed")
    expect(classifyAddress("192.0.2.2", ["192.0.2.0/31"])).toBe("outside_policy")
    expect(classifyAddress("2001:db8::1", ["2001:db8::/127"])).toBe("allowed")
    expect(classifyAddress("2001:db8::2", ["2001:db8::/127"])).toBe("outside_policy")
    expect(classifyAddress("192.0.2.255", ["::ffff:192.0.2.0/120"])).toBe("allowed")
    expect(classifyAddress("192.0.3.0", ["::ffff:192.0.2.0/120"])).toBe("outside_policy")
  })
  it("matches mapped IPv4 consistently against broad IPv6 policies", () => {
    for (const address of ["192.0.2.1", "::ffff:192.0.2.1", "::ffff:c000:201"]) {
      expect(classifyAddress(address, ["::/0"])).toBe("allowed")
      expect(classifyAddress(address, ["::ffff:0:0/80"])).toBe("allowed")
      expect(classifyAddress(address, ["2001:db8::/32"])).toBe("outside_policy")
    }
  })
})

const now = Date.parse("2026-01-15T12:00:00Z")
const iso = (offset = 0) => new Date(now + offset).toISOString()
const device = (): NetworkDevice => ({ id: "mac", name: "Mac", createdAt: iso(-86_400_000), lastSeenAt: iso(), revokedAt: null, report: { capturedAt: iso(), coverage: "current_user_tcp_snapshot", truncated: false, observations: [{ id: "socket", localAddress: "192.0.2.1", localPort: 12345, remoteAddress: "203.0.113.1", remotePort: 443, protocol: "tcp", process: "Browser", pid: 42 }] } })
const snapshot = (devices = [device()], allowedCidrs = ["192.0.2.0/24"]): NetworkSnapshot => ({ devices, policy: { allowedCidrs }, serverTime: iso() })

describe("network evidence and freshness", () => {
  it("references the observed socket and never derives SSH auth from port 22", () => {
    const mac = device()
    mac.report!.observations[0].remotePort = 22
    expect(evaluateNetworkSignals(snapshot([mac]), now)).toEqual([{ id: JSON.stringify(["outside_policy", "mac", "socket"]), rule: "outside_policy", connectionId: JSON.stringify(["mac", "203.0.113.1"]), eventIds: ["socket"], status: "pending_review" }])
    expect(evaluateNetworkSignals(snapshot([mac], ["203.0.113.0/24"]), now)).toEqual([])
    expect(evaluateNetworkSignals(snapshot([mac], []), now)).toEqual([])
  })
  it.each(["capturedAt", "lastSeenAt"])("handles freshness boundaries and missing/invalid/future %s", field => {
    for (const [timestamp, gap] of [[iso(-FRESHNESS_MS), false], [iso(-FRESHNESS_MS - 1), true], [iso(1), true], ["bad", true], ["", true], [null, true], [undefined, true]] as const) {
      const mac = device()
      if (field === "capturedAt") Object.assign(mac.report!, { capturedAt: timestamp })
      else Object.assign(mac, { lastSeenAt: timestamp })
      expect(evaluateNetworkSignals(snapshot([mac], []), now).some(item => item.rule === "coverage_gap")).toBe(gap)
    }
  })
  it("reports missing telemetry, excludes revoked devices, and keeps gaps independent of policy", () => {
    const mac = device()
    mac.report = null
    expect(evaluateNetworkSignals(snapshot([mac], []), now)).toEqual([{ id: JSON.stringify(["coverage_gap", "mac"]), rule: "coverage_gap", connectionId: connectionId("mac", "erp"), eventIds: [], status: "pending_review" }])
    mac.revokedAt = iso()
    expect(evaluateNetworkSignals(snapshot([mac]), now)).toEqual([])
    expect(evaluateNetworkSignals(snapshot([]), now)).toEqual([])
  })
  it("preserves old socket evidence alongside coverage gaps, one signal per observation", () => {
    const mac = device()
    mac.report!.capturedAt = iso(-FRESHNESS_MS - 1)
    mac.report!.observations.push({ ...mac.report!.observations[0], id: "second" })
    const result = evaluateNetworkSignals(snapshot([mac]), now)
    expect(result.map(item => item.rule)).toEqual(["coverage_gap", "outside_policy", "outside_policy"])
    expect(result.slice(1).map(item => item.eventIds)).toEqual([["socket"], ["second"]])
    expect(result.every(item => item.status === "pending_review")).toBe(true)
    expect(evaluateNetworkSignals(snapshot([device()], []), NaN).map(item => item.rule)).toEqual(["coverage_gap"])
  })
  it("flags truncated fresh reports while preserving observed evidence", () => {
    const mac = device()
    mac.report!.truncated = true
    const result = evaluateNetworkSignals(snapshot([mac]), now)
    expect(result.map(signal => signal.rule)).toEqual(["coverage_gap", "outside_policy"])
    expect(result[0]).toMatchObject({ connectionId: connectionId("mac", "erp"), eventIds: [], status: "pending_review" })
    expect(result[1].eventIds).toEqual(["socket"])
    mac.report!.truncated = false
    expect(evaluateNetworkSignals(snapshot([mac]), now).map(signal => signal.rule)).toEqual(["outside_policy"])
  })
})

describe("event metadata projection", () => {
  it("strips secret-bearing extra properties from details and connection events", () => {
    const extra = { ...event("first"), password: "secret-password", token: "secret-token", payload: "secret-payload", commandArguments: ["secret-argument"], rawLog: "secret-log", credential: "secret-credential" }
    expect(Object.keys(eventDetails(extra)).sort()).toEqual(["account", "id", "outcome", "port", "source", "target", "timestamp"])
    const connections = buildConnections([extra, event("later", 1000), event("other", 0, { target: "c" })])
    expect(connections).toHaveLength(2)
    expect(connections[0].events.map(item => item.id)).toEqual(["later", "first"])
    expect(JSON.stringify(connections)).not.toContain("secret-")
    expect(connections[0].events[1]).not.toBe(extra)
    expect(extra.password).toBe("secret-password")
  })
})
