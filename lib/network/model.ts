export type Machine = {
  id: string
  name: string
  role: "workstation" | "gateway" | "server" | "database"
  address: string
  position: [number, number, number]
}

export type SshEvent = {
  id: string
  source: string
  target: string
  timestamp: string
  port: number
  account: string
  outcome: "success" | "failure"
}
export type SshConnection = { id: string; source: string; target: string; events: SshEvent[] }
export type SignalRule = "failed_burst" | "root_login" | "off_hours" | "outside_policy" | "coverage_gap"
export type ReviewSignal = {
  id: string
  rule: SignalRule
  connectionId: string
  eventIds: string[]
  status: "pending_review"
}

/** Metadata allowlist. No payloads, arguments, environment, or raw log fields. */
export type Observation = {
  id: string
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  protocol: "tcp"
  process: string
  pid: number
}
export type CollectorReport = {
  capturedAt: string
  coverage: "current_user_tcp_snapshot"
  observations: Observation[]
  truncated: boolean
}
export type NetworkDevice = {
  id: string
  name: string
  createdAt: string
  lastSeenAt: string | null
  revokedAt: string | null
  report: CollectorReport | null
}
export type NetworkPolicy = { allowedCidrs: string[] }
export type NetworkSnapshot = {
  devices: NetworkDevice[]
  policy: NetworkPolicy
  serverTime: string
}
export const FRESHNESS_MS = 120_000
export const REPORT_INTERVAL_MS = 30_000

export function connectionId(source: string, target: string): string {
  return JSON.stringify([source, target])
}

/** Explicit projection keeps extra fields out of event details. */
export function eventDetails(event: SshEvent): SshEvent {
  return {
    id: event.id, source: event.source, target: event.target,
    timestamp: event.timestamp, port: event.port,
    account: event.account, outcome: event.outcome,
  }
}

export function buildConnections(events: readonly SshEvent[]): SshConnection[] {
  const connections = new Map<string, SshConnection>()
  for (const event of events) {
    const id = connectionId(event.source, event.target)
    let connection = connections.get(id)
    if (!connection) {
      connection = { id, source: event.source, target: event.target, events: [] }
      connections.set(id, connection)
    }
    connection.events.push(eventDetails(event))
  }
  for (const connection of connections.values()) {
    connection.events.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp) || a.id.localeCompare(b.id))
  }
  return [...connections.values()]
}
export type TopologyNode = { id: string; label: string; kind: "erp" | "device" | "peer"; position: [number, number, number] }
export type TopologyEdge = { id: string; source: string; target: string; kind: "report" | "enrollment" | "tcp" | "ssh"; review: boolean }
