import { connectionId, FRESHNESS_MS, type NetworkSnapshot, type ReviewSignal, type SshEvent } from "./model"

const WINDOW_MS = 5 * 60_000

export function evaluateSshSignals(events: readonly SshEvent[]): ReviewSignal[] {
  const ordered = events.filter(event => Number.isFinite(Date.parse(event.timestamp)))
    .slice().sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id))
  const signals: ReviewSignal[] = []
  const failures = new Map<string, SshEvent[]>()
  for (const event of ordered) {
    const pair = connectionId(event.source, event.target)
    if (event.outcome === "failure") {
      const group = failures.get(pair) ?? []
      group.push(event)
      failures.set(pair, group)
      continue
    }
    if (event.outcome !== "success") continue
    const bangkokHour = new Date(Date.parse(event.timestamp) + 7 * 60 * 60_000).getUTCHours()
    for (const rule of [
      ...(event.account === "root" ? ["root_login" as const] : []),
      ...(bangkokHour < 6 || bangkokHour >= 22 ? ["off_hours" as const] : []),
    ]) {
      signals.push({ id: JSON.stringify([rule, event.id]), rule, connectionId: pair, eventIds: [event.id], status: "pending_review" })
    }
  }
  for (const [pair, group] of failures) {
    const matching = new Set<string>()
    let start = 0
    for (let end = 0; end < group.length; end++) {
      while (Date.parse(group[end].timestamp) - Date.parse(group[start].timestamp) > WINDOW_MS) start++
      if (end - start + 1 >= 5) {
        for (let index = start; index <= end; index++) matching.add(group[index].id)
      }
    }
    if (matching.size) signals.push({ id: JSON.stringify(["failed_burst", pair]), rule: "failed_burst", connectionId: pair, eventIds: [...matching], status: "pending_review" })
  }
  return signals
}

type Address = { bytes: number[]; mapped: boolean }
function ipv4(value: string): number[] | null {
  const parts = value.split(".")
  if (parts.length !== 4 || parts.some(part => !/^(0|[1-9]\d{0,2})$/.test(part) || Number(part) > 255)) return null
  return parts.map(Number)
}
function parseAddress(value: string): Address | null {
  const four = ipv4(value)
  if (four) return { bytes: four, mapped: false }
  if (!value.includes(":") || /[^0-9a-fA-F:.]/.test(value)) return null
  let text = value
  if (text.includes(".")) {
    const colon = text.lastIndexOf(":")
    const tail = ipv4(text.slice(colon + 1))
    if (!tail) return null
    text = text.slice(0, colon + 1) + ((tail[0] << 8) | tail[1]).toString(16) + ":" + ((tail[2] << 8) | tail[3]).toString(16)
  }
  const halves = text.split("::")
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(":") : []
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  if ([...left, ...right].some(part => !/^[0-9a-fA-F]{1,4}$/.test(part))) return null
  const missing = 8 - left.length - right.length
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null
  const words = [...left, ...Array.from({ length: missing }, () => "0"), ...right]
  const bytes = words.flatMap(word => [parseInt(word, 16) >> 8, parseInt(word, 16) & 255])
  const mapped = bytes.slice(0, 10).every(byte => byte === 0) && bytes[10] === 255 && bytes[11] === 255
  return { bytes, mapped }
}
function parseCidr(value: string): { bytes: number[]; prefix: number } | null {
  const parts = value.split("/")
  if (parts.length !== 2 || !/^(0|[1-9]\d{0,2})$/.test(parts[1])) return null
  const address = parseAddress(parts[0])
  let prefix = Number(parts[1])
  if (!address || prefix > address.bytes.length * 8) return null
  let bytes = address.bytes
  if (address.mapped && prefix >= 96) { bytes = bytes.slice(12); prefix -= 96 }
  return { bytes, prefix }
}

export function isValidCidr(cidr: string): boolean { return parseCidr(cidr) !== null }

export function classifyAddress(address: string, allowedCidrs: readonly string[]): "allowed" | "outside_policy" | "unknown" {
  const parsed = parseAddress(address)
  const policies = allowedCidrs.map(parseCidr)
  if (!parsed || !policies.length || policies.some(policy => !policy)) return "unknown"
  const normalized = parsed.mapped ? parsed.bytes.slice(12) : parsed.bytes
  for (const policy of policies) {
    if (!policy) continue
    // IPv4-mapped addresses denote the same host in either spelling.
    const bytes = policy.bytes.length === 16 && normalized.length === 4
      ? [...Array<number>(10).fill(0), 255, 255, ...normalized]
      : normalized
    if (policy.bytes.length !== bytes.length) continue
    let matches = true
    for (let bit = 0; bit < policy.prefix; bit++) {
      const mask = 1 << (7 - bit % 8)
      if ((bytes[Math.floor(bit / 8)] & mask) !== (policy.bytes[Math.floor(bit / 8)] & mask)) { matches = false; break }
    }
    if (matches) return "allowed"
  }
  return "outside_policy"
}

export function evaluateNetworkSignals(snapshot: NetworkSnapshot, nowMs: number): ReviewSignal[] {
  const signals: ReviewSignal[] = []
  const fresh = (timestamp: string | null | undefined) => {
    const time = timestamp ? Date.parse(timestamp) : NaN
    return Number.isFinite(nowMs) && Number.isFinite(time) && time <= nowMs && nowMs - time <= FRESHNESS_MS
  }
  for (const device of snapshot.devices) {
    if (device.revokedAt !== null) continue
    if (!device.report || device.report.truncated || !fresh(device.report.capturedAt) || !fresh(device.lastSeenAt)) {
      signals.push({ id: JSON.stringify(["coverage_gap", device.id]), rule: "coverage_gap", connectionId: connectionId(device.id, "erp"), eventIds: [], status: "pending_review" })
    }
    for (const observation of device.report?.observations ?? []) {
      if (classifyAddress(observation.remoteAddress, snapshot.policy.allowedCidrs) !== "outside_policy") continue
      signals.push({ id: JSON.stringify(["outside_policy", device.id, observation.id]), rule: "outside_policy", connectionId: connectionId(device.id, observation.remoteAddress), eventIds: [observation.id], status: "pending_review" })
    }
  }
  return signals
}
