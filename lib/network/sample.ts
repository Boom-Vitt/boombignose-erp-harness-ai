import type { Machine, SshEvent } from "./model"

export const SAMPLE_MACHINES: Machine[] = [
  { id: "sample-mac", name: "Sample Mac", role: "workstation", address: "192.0.2.10", position: [-4, 0, 0] },
  { id: "sample-gateway", name: "Sample gateway", role: "gateway", address: "198.51.100.20", position: [0, 1, 0] },
  { id: "sample-server", name: "Sample server", role: "server", address: "203.0.113.30", position: [4, 0, 0] },
]

export const SAMPLE_SSH_EVENTS: SshEvent[] = [
  ...Array.from({ length: 5 }, (_, index): SshEvent => ({
    id: `sample-failure-${index + 1}`, source: "sample-mac", target: "sample-gateway",
    timestamp: `2026-01-15T03:0${index}:00Z`, port: 22, account: "operator", outcome: "failure",
  })),
  { id: "sample-root", source: "sample-gateway", target: "sample-server", timestamp: "2026-01-15T04:00:00Z", port: 22, account: "root", outcome: "success" },
  { id: "sample-night", source: "sample-mac", target: "sample-server", timestamp: "2026-01-15T15:00:00Z", port: 22, account: "operator", outcome: "success" },
  { id: "sample-ordinary", source: "sample-mac", target: "sample-server", timestamp: "2026-01-15T05:00:00Z", port: 22, account: "operator", outcome: "success" },
  { id: "sample-isolated-failure", source: "sample-gateway", target: "sample-server", timestamp: "2026-01-15T05:01:00Z", port: 22, account: "operator", outcome: "failure" },
]
