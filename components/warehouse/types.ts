/** Data contract between the 3D campus scene and the HUD. */

export type Presence = "desk" | "meeting" | "away"

export interface PersonInfo {
  id: string
  kind: "person"
  name: string
  role: string
  zone: string
  zoneId: string
  status: string
  presence: Presence
  tasks: number
}

/** A district of the campus: the atrium, a pavilion, or the stock vault. */
export interface ZoneInfo {
  id: string
  kind: "zone"
  /** 1-based position in the campus index. */
  index: number
  name: string
  sub: string
  status: string
  stats: [string, string][]
  links: [string, string][]
}

export type ShuttleState = "En route" | "Arriving" | "Loading" | "Unloading" | "Departing" | "Departed"

export interface StackerInfo {
  id: string
  kind: "stacker"
  operator: string
  model: string
  status: string
  carrying: string
  moves: number
  battery: number
  speedKmh: number
  charger: string
}

export interface ShuttleInfo {
  id: string
  kind: "shuttle"
  carrier: string
  gate: string
  direction: "outbound" | "inbound"
  state: ShuttleState
  loaded: number
  capacity: number
  /** Simulated seconds until arrival (inbound, en route) — null otherwise. */
  eta: number | null
}

export interface ShipmentInfo {
  no: string
  to: string
  shuttleId: string
  /** 0 confirmed · 1 picked · 2 loading · 3 in transit · 4 delivered */
  step: number
  loaded: number
  capacity: number
  confirmedAt: number
  pickedAt: number
  loadEta: number
}

export type Entity = ZoneInfo | PersonInfo | StackerInfo | ShuttleInfo

export interface Snapshot {
  zones: ZoneInfo[]
  people: PersonInfo[]
  stackers: StackerInfo[]
  shuttles: ShuttleInfo[]
  shipment: ShipmentInfo
  /** Simulated seconds since midnight. */
  sim: number
  stock: number
  stockCap: number
  stockDelta: number
}

export interface CampusScene {
  zoom(factor: number): void
  orbit(dir: 1 | -1): void
  home(): void
  select(id: string | null, focus?: boolean): void
  setAutoOrbit(on: boolean): void
  /** Districts to mark as the current mode's starting points. */
  setStarters(ids: string[]): void
  /** Pixels of HUD covering each edge; the scene recentres in the free space. */
  setInsets(i: { left: number; right: number; bottom: number }): void
  dispose(): void
}
