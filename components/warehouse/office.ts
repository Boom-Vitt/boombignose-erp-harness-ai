import * as THREE from "three"
import type { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js"

import { block, canvasTex, chip, curve, cyl, dampAngle, flat, G, mat, rng, yawOf } from "./kit"

export interface PersonInfo {
  id: string
  kind: "person"
  name: string
  role: string
  zone: string
  zoneId: string
  status: string
  tasks: number
}

export interface ZoneInfo {
  id: string
  kind: "zone"
  name: string
  sub: string
  status: string
  stats: [string, string][]
  links: [string, string][]
}

export interface OfficeCtx {
  scene: THREE.Scene
  textures: THREE.Texture[]
  simSpeed: number
  register(id: string, root: THREE.Object3D, ring: number, focus: number): void
  onZoneClick(id: string): void
}

const FLOOR = 0.32
const CORR = -8 // corridor centre line
const [OX0, OX1, OZ0, OZ1] = [44, 76, -28, 8]
const FACE_N = yawOf(0, -1)
const FACE_S = yawOf(0, 1)
const FACE_E = yawOf(1, 0)
const FACE_W = yawOf(-1, 0)

interface Room {
  doorX: number
  wallZ: number
  side: 1 | -1 // direction from the corridor wall into the room
}
/** A place a person can stand or sit; `via` = waypoints from the room door (or corridor) to it. */
interface Spot {
  x: number
  z: number
  yaw: number
  room: Room | null
  via: [number, number][]
  sit: boolean
}

interface ZoneDef {
  id: string
  name: string
  sub: string
  rect: [number, number, number, number]
  color: string
  links: [string, string][]
}

const ZONES: ZoneDef[] = [
  { id: "sales", name: "Sales floor", sub: "Clients & Deals", rect: [44, -28, 60, -11], color: "#dbe7fb", links: [["Deals", "/deals"], ["Clients", "/clients"]] },
  { id: "studio", name: "Project studio", sub: "Projects & Timesheets", rect: [60, -28, 76, -11], color: "#f3e8d8", links: [["Projects", "/projects"], ["Timesheets", "/timesheets"]] },
  { id: "reception", name: "Reception", sub: "Client intake", rect: [44, -11, 50, -5], color: "#e3f3ea", links: [["Intake", "/intake"]] },
  { id: "servers", name: "Server room", sub: "Automations", rect: [72, -11, 76, -5], color: "#e2e6ee", links: [["Automation", "/automation"]] },
  { id: "meeting", name: "Meeting room", sub: "Calendar", rect: [44, -5, 54, 8], color: "#ead9c3", links: [["Calendar", "/calendar"]] },
  { id: "founder", name: "Founder office", sub: "Dashboard & Reports", rect: [54, -5, 64, 8], color: "#e4d3bb", links: [["Dashboard", "/dashboard"], ["Reports", "/reports"]] },
  { id: "finance", name: "Finance", sub: "Invoices & Quotes", rect: [64, -5, 76, 8], color: "#dcf2ea", links: [["Finance", "/finance"], ["Quotes", "/quotes"]] },
]

const thb = (v: number) => (v >= 1e6 ? `฿${(v / 1e6).toFixed(2)}M` : `฿${Math.round(v / 1000)}K`)
const hhmm = (sec: number) => {
  const m = Math.floor(sec / 60) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

export function buildOffice(ctx: OfficeCtx) {
  const r = rng(11)
  const g = new THREE.Group()
  ctx.scene.add(g)
  const M = {
    slab: mat("#243556"),
    corridor: mat("#1c2a4b"),
    wall: mat("#c9d1e2"),
    frame: mat("#cbd5e1"),
    glass: mat("#bfdbfe", { transparent: true, opacity: 0.16, roughness: 0.1, depthWrite: false }),
    deskTop: mat("#fafaf9"),
    leg: mat("#94a3b8"),
    dark: mat("#1f2937"),
    keys: mat("#cbd5e1"),
    chair: mat("#334155"),
    pants: mat("#334155"),
    pot: mat("#e2e8f0"),
    leaf: mat("#3fbf7f"),
    sofa: mat("#64748b"),
    wood: mat("#b08968"),
    white: mat("#ffffff"),
    path: mat("#2a3a5e"),
    rack: mat("#111827"),
    bottle: mat("#7dd3fc", { transparent: true, opacity: 0.7 }),
    ledOn: new THREE.MeshBasicMaterial({ color: "#22c55e" }),
    ledAmber: new THREE.MeshBasicMaterial({ color: "#f59e0b" }),
    ledOff: new THREE.MeshBasicMaterial({ color: "#334155" }),
  }

  // ---------------------------------------------------------------- shell
  block(g, OX1 - OX0 + 0.6, 0.3, OZ1 - OZ0 + 0.6, M.slab, (OX0 + OX1) / 2, 0, (OZ0 + OZ1) / 2)
  block(g, 22, 0.02, 6, M.corridor, 61, 0.3, CORR).castShadow = false
  flat(g, 3.8, 3, M.path, 42.1, CORR, 0.015)

  const zoneFloors = new Map<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>>()
  const zoneTags = new Map<string, HTMLElement>()
  for (const z of ZONES) {
    const [x0, z0, x1, z1] = z.rect
    const f = block(g, x1 - x0, 0.02, z1 - z0, mat(z.color), (x0 + x1) / 2, 0.3, (z0 + z1) / 2) as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>
    f.castShadow = false
    zoneFloors.set(z.id, f)
    ctx.register(z.id, f, 0, 42)
    const tag = chip(`<b class="text-[#f4efe4]">${z.name}</b> <span data-s class="text-[#9fabc2]"></span>`)
    tag.el.style.pointerEvents = "auto"
    tag.el.style.cursor = "pointer"
    tag.el.addEventListener("click", () => ctx.onZoneClick(z.id))
    tag.obj.position.set((x0 + x1) / 2, 3.7, (z0 + z1) / 2)
    g.add(tag.obj)
    zoneTags.set(z.id, tag.el.querySelector<HTMLElement>("[data-s]")!)
  }
  const hq = chip(`<b class="text-primary">BoomBigNose HQ</b> Entrance`)
  hq.obj.position.set(42, 3.4, CORR)
  g.add(hq.obj)

  /** Axis-aligned wall: low solid base, glass above, thin top rail. `gaps` = [centre, width] along the wall. */
  function wall(x1: number, z1: number, x2: number, z2: number, gaps: [number, number][] = []) {
    const alongX = z1 === z2
    const a0 = alongX ? Math.min(x1, x2) : Math.min(z1, z2)
    const a1 = alongX ? Math.max(x1, x2) : Math.max(z1, z2)
    let s = a0
    const segs: [number, number][] = []
    for (const [c, w] of [...gaps].sort((p, q) => p[0] - q[0])) {
      if (c - w / 2 > s) segs.push([s, c - w / 2])
      s = Math.max(s, c + w / 2)
    }
    if (a1 > s) segs.push([s, a1])
    for (const [s0, s1] of segs) {
      const len = s1 - s0
      const mid = (s0 + s1) / 2
      const [w, d, x, z] = alongX ? [len, 0.18, mid, z1] : [0.18, len, x1, mid]
      block(g, w, 1.0, d, M.wall, x, FLOOR, z)
      const glass = block(g, alongX ? w : 0.06, 1.9, alongX ? 0.06 : d, M.glass, x, FLOOR + 1.0, z)
      glass.castShadow = glass.receiveShadow = false
      block(g, alongX ? w : 0.16, 0.08, alongX ? 0.16 : d, M.frame, x, FLOOR + 2.9, z)
    }
  }
  wall(OX0, OZ0, OX1, OZ0)
  wall(OX0, OZ1, OX1, OZ1)
  wall(OX0, OZ0, OX0, OZ1, [[CORR, 3]])
  wall(OX1, OZ0, OX1, OZ1)
  wall(OX0, -11, OX1, -11, [[52, 2], [68, 2]])
  wall(60, OZ0, 60, -11)
  wall(OX0, -5, OX1, -5, [[46.5, 2], [56.5, 2], [66.5, 2]])
  wall(54, -5, 54, OZ1)
  wall(64, -5, 64, OZ1)

  // ---------------------------------------------------------------- furniture
  const screen = (draw: (c: CanvasRenderingContext2D) => void, w = 256, h = 160) => {
    const t = canvasTex(w, h, draw)
    ctx.textures.push(t)
    return new THREE.MeshBasicMaterial({ map: t, toneMapped: false })
  }
  const S = {
    crm: screen((c) => {
      c.fillStyle = "#0f172a"
      c.fillRect(0, 0, 256, 160)
      ;["#3b82f6", "#f59e0b", "#10b981"].forEach((col, i) => {
        c.fillStyle = "#1e293b"
        c.fillRect(12 + i * 80, 14, 72, 134)
        c.fillStyle = col
        for (let k = 0; k < 3 - (i % 2); k++) c.fillRect(18 + i * 80, 22 + k * 34, 60, 26)
      })
    }),
    code: screen((c) => {
      c.fillStyle = "#0b1220"
      c.fillRect(0, 0, 256, 160)
      const cols = ["#60a5fa", "#f472b6", "#34d399", "#fbbf24", "#a78bfa"]
      for (let y = 14; y < 150; y += 12) {
        let x = 12 + ((y / 12) % 3) * 12
        while (x < 230) {
          const w = 14 + Math.floor(r() * 40)
          c.fillStyle = cols[Math.floor(r() * cols.length)]
          c.fillRect(x, y, w, 5)
          x += w + 8
          if (r() > 0.75) break
        }
      }
    }),
    sheet: screen((c) => {
      c.fillStyle = "#f8fafc"
      c.fillRect(0, 0, 256, 160)
      c.strokeStyle = "#cbd5e1"
      for (let x = 0; x < 256; x += 42) c.strokeRect(x, 0, 42, 160)
      for (let y = 0; y < 160; y += 16) c.strokeRect(0, y, 256, 16)
      c.fillStyle = "#10b981"
      c.fillRect(170, 90, 16, 60)
      c.fillRect(192, 70, 16, 80)
      c.fillRect(214, 50, 16, 100)
    }),
    form: screen((c) => {
      c.fillStyle = "#f1f5f9"
      c.fillRect(0, 0, 256, 160)
      c.fillStyle = "#2563eb"
      c.fillRect(0, 0, 256, 26)
      c.fillStyle = "#cbd5e1"
      for (let y = 40; y < 130; y += 24) c.fillRect(20, y, 216, 14)
      c.fillStyle = "#10b981"
      c.fillRect(160, 136, 76, 16)
    }),
    slide: screen(
      (c) => {
        c.fillStyle = "#1e3a8a"
        c.fillRect(0, 0, 512, 288)
        c.fillStyle = "#ffffff"
        c.font = "bold 36px system-ui, sans-serif"
        c.fillText("Q4 Pipeline Review", 32, 60)
        ;[0.4, 0.55, 0.5, 0.7, 0.85].forEach((v, i) => {
          c.fillStyle = i === 4 ? "#34d399" : "#93c5fd"
          c.fillRect(40 + i * 90, 260 - v * 160, 56, v * 160)
        })
      },
      512,
      288,
    ),
  }

  function screenPlane(m: THREE.Material, w: number, h: number, x: number, y: number, z: number, yaw = 0) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m)
    p.position.set(x, y, z)
    p.rotation.y = yaw
    g.add(p)
    return p
  }

  /** Desk facing a person who sits on its +z side. */
  function desk(x: number, z: number, scr: THREE.Material, w = 1.6) {
    block(g, w, 0.06, 0.8, M.deskTop, x, FLOOR + 0.72, z)
    for (const s of [-1, 1]) block(g, 0.05, 0.72, 0.72, M.leg, x + s * (w / 2 - 0.05), FLOOR, z)
    block(g, 0.08, 0.25, 0.08, M.dark, x, FLOOR + 0.78, z - 0.22)
    block(g, 0.72, 0.44, 0.04, M.dark, x, FLOOR + 0.98, z - 0.24)
    screenPlane(scr, 0.66, 0.38, x, FLOOR + 1.2, z - 0.215)
    block(g, 0.5, 0.02, 0.16, M.keys, x, FLOOR + 0.78, z + 0.12)
  }
  function chair(x: number, z: number, yaw: number) {
    const c = new THREE.Group()
    c.position.set(x, FLOOR, z)
    c.rotation.y = yaw
    cyl(c, 0.26, 0.05, M.dark, 0, 0.04, 0)
    cyl(c, 0.04, 0.4, M.dark, 0, 0.24, 0)
    block(c, 0.55, 0.08, 0.55, M.chair, 0, 0.42, 0)
    block(c, 0.08, 0.6, 0.5, M.chair, -0.27, 0.5, 0)
    g.add(c)
  }
  function plant(x: number, z: number, s = 1) {
    cyl(g, 0.25 * s, 0.5 * s, M.pot, x, FLOOR + 0.25 * s, z)
    const c = new THREE.Mesh(G.sphere, M.leaf)
    c.scale.set(0.4 * s, 0.65 * s, 0.4 * s)
    c.position.set(x, FLOOR + 0.95 * s, z)
    c.castShadow = true
    g.add(c)
  }

  const ROOM = {
    sales: { doorX: 52, wallZ: -11, side: -1 },
    studio: { doorX: 68, wallZ: -11, side: -1 },
    meeting: { doorX: 46.5, wallZ: -5, side: 1 },
    founder: { doorX: 56.5, wallZ: -5, side: 1 },
    finance: { doorX: 66.5, wallZ: -5, side: 1 },
  } satisfies Record<string, Room>

  function seat(room: Room, x: number, deskZ: number, scr: THREE.Material): Spot {
    desk(x, deskZ, scr)
    chair(x, deskZ + 1, FACE_N)
    const aisle = deskZ + 2.1
    return { x, z: deskZ + 1, yaw: FACE_N, room, via: [[room.doorX, aisle], [x, aisle]], sit: true }
  }

  const salesSeats = [-25, -18].flatMap((z) => [46.5, 49.5, 54.5, 57.5].map((x) => seat(ROOM.sales, x, z, S.crm)))
  const studioSeats = [
    ...[62.5, 65.5, 70.5, 73.5].map((x) => seat(ROOM.studio, x, -25, S.code)),
    ...[62.5, 65.5].map((x) => seat(ROOM.studio, x, -18, S.code)),
  ]
  const financeSeats = [68.5, 71.5, 74.5].map((x) => seat(ROOM.finance, x, -1.5, S.sheet))

  // studio: kanban board + standing table
  block(g, 7, 1.8, 0.05, M.white, 68, FLOOR + 1.3, -27.85)
  const colX = [65.8, 68, 70.2]
  for (const [i, x] of colX.entries()) block(g, 1.9, 0.12, 0.02, [M.leaf, M.ledAmber, M.ledOn][i] as THREE.Material, x, FLOOR + 2.9, -27.8)
  const noteMats = ["#fde68a", "#bfdbfe", "#fecaca", "#bbf7d0"].map((c) => mat(c))
  const notes = Array.from({ length: 9 }, (_, i) => {
    const n = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.42), noteMats[i % 4])
    n.userData.col = i % 3 === 2 ? 1 : 0
    n.userData.row = i
    n.position.set(colX[n.userData.col] + (i % 2 ? 0.35 : -0.35), FLOOR + 2.45 - Math.floor(i / 2) * 0.32, -27.81)
    g.add(n)
    return n
  })
  block(g, 2.2, 0.06, 1.0, M.wood, 72, FLOOR + 1.05, -16.5)
  for (const s of [-1, 1]) block(g, 0.06, 1.05, 0.9, M.leg, 72 + s, FLOOR, -16.5)

  // meeting room
  block(g, 5, 0.08, 1.8, M.wood, 49, FLOOR + 0.72, 2)
  for (const x of [47.4, 50.6]) block(g, 0.3, 0.72, 1.2, M.leg, x, FLOOR, 2)
  for (const x of [47, 49, 51]) chair(x, 3.45, FACE_N)
  chair(45.4, 2, FACE_E)
  const meetChairs: Spot[] = [47, 49, 51].map((x) => {
    chair(x, 0.55, FACE_S)
    return { x, z: 0.55, yaw: FACE_S, room: ROOM.meeting, via: [[x, -0.6]], sit: true }
  })
  chair(52.6, 2, FACE_W)
  meetChairs.push({ x: 52.6, z: 2, yaw: FACE_W, room: ROOM.meeting, via: [[53.1, -0.6], [53.1, 2]], sit: true })
  screenPlane(S.slide, 2.8, 1.58, 44.13, FLOOR + 1.9, 2, Math.PI / 2)

  // founder office: desk, live dashboard wall, sofa
  block(g, 2.2, 0.08, 0.9, M.wood, 60, FLOOR + 0.72, 3.2)
  for (const s of [-1, 1]) block(g, 0.06, 0.72, 0.8, M.leg, 60 + s * 1.05, FLOOR, 3.2)
  for (const x of [59.6, 60.4]) {
    block(g, 0.7, 0.42, 0.04, M.dark, x, FLOOR + 1.0, 2.95)
    screenPlane(S.sheet, 0.64, 0.36, x, FLOOR + 1.21, 2.975)
  }
  chair(60, 4.3, FACE_N)
  const founderSeat: Spot = { x: 60, z: 4.3, yaw: FACE_N, room: ROOM.founder, via: [[56.5, 5.3], [59, 5.3]], sit: true }
  const dashCv = document.createElement("canvas")
  dashCv.width = 1024
  dashCv.height = 512
  const dashTex = new THREE.CanvasTexture(dashCv)
  dashTex.colorSpace = THREE.SRGBColorSpace
  ctx.textures.push(dashTex)
  block(g, 4.6, 2.4, 0.08, M.dark, 61.6, FLOOR + 0.9, -4.88)
  screenPlane(new THREE.MeshBasicMaterial({ map: dashTex, toneMapped: false }), 4.4, 2.2, 61.6, FLOOR + 2.1, -4.83)
  block(g, 2.6, 0.45, 0.9, M.sofa, 62.6, FLOOR, 7.1)
  block(g, 2.6, 0.5, 0.25, M.sofa, 62.6, FLOOR + 0.45, 7.5)
  block(g, 1.2, 0.4, 0.6, M.wood, 62.6, FLOOR, 5.9)

  // finance: cabinets + safe
  for (const z of [2.2, 3.2, 4.2]) block(g, 0.6, 1.3, 0.9, M.leg, 75.5, FLOOR, z)
  block(g, 0.9, 1.0, 0.9, M.dark, 75.3, FLOOR, 6.9)
  cyl(g, 0.15, 0.04, M.leg, 74.83, FLOOR + 0.55, 6.9).rotation.z = Math.PI / 2

  // reception, coffee, water, printer
  block(g, 2.4, 1.05, 0.6, M.white, 47.5, FLOOR, -9.2)
  block(g, 2.5, 0.05, 0.7, M.wood, 47.5, FLOOR + 1.05, -9.2)
  block(g, 0.7, 0.42, 0.04, M.dark, 47.5, FLOOR + 1.1, -9.55)
  screenPlane(S.form, 0.64, 0.36, 47.5, FLOOR + 1.31, -9.575, Math.PI)
  chair(47.5, -10.2, FACE_S)
  const receptionSeat: Spot = { x: 47.5, z: -10.2, yaw: FACE_S, room: null, via: [[45.6, -10.2]], sit: true }
  block(g, 2.6, 0.9, 0.55, M.white, 58, FLOOR, -10.7)
  block(g, 0.45, 0.55, 0.4, M.dark, 57.6, FLOOR + 0.9, -10.72)
  cyl(g, 0.22, 1.0, M.white, 64.5, FLOOR + 0.5, -10.6)
  cyl(g, 0.17, 0.45, M.bottle, 64.5, FLOOR + 1.22, -10.6)
  block(g, 0.9, 0.85, 0.6, M.keys, 62, FLOOR, -5.45)
  block(g, 0.7, 0.12, 0.5, M.dark, 62, FLOOR + 0.85, -5.45)

  // server room
  const leds: THREE.Mesh[] = []
  for (const rz of [-9.4, -6.6]) {
    block(g, 0.9, 2.2, 1.3, M.rack, 75.2, FLOOR, rz)
    for (let row = 0; row < 8; row++)
      for (let col = 0; col < 3; col++) {
        const led = block(g, 0.02, 0.06, 0.14, r() > 0.3 ? M.ledOn : M.ledOff, 74.74, FLOOR + 0.3 + row * 0.22, rz - 0.36 + col * 0.36)
        led.castShadow = false
        leds.push(led)
      }
  }

  for (const [x, z, s] of [[45, -27, 1], [59, -27, 1], [61, -27, 1], [75, -27, 1], [45, 7.2, 1.1], [53.2, 7.2, 1], [75, -12, 0.9], [50.6, -10.5, 0.9], [71, -5.7, 0.8]] as const)
    plant(x, z, s)

  // ---------------------------------------------------------------- people

  const E = {
    coffee: { spot: { x: 58, z: -9.9, yaw: FACE_N, room: null, via: [], sit: false } as Spot, label: "Getting coffee", place: "coffee bar" },
    water: { spot: { x: 64.5, z: -9.9, yaw: FACE_N, room: null, via: [], sit: false } as Spot, label: "Water break", place: "water cooler" },
    printer: { spot: { x: 62, z: -6.3, yaw: FACE_S, room: null, via: [], sit: false } as Spot, label: "At the printer", place: "printer" },
    servers: { spot: { x: 73.7, z: -8, yaw: FACE_E, room: null, via: [], sit: false } as Spot, label: "Checking servers", place: "server room" },
    reception: { spot: { x: 47.5, z: -8, yaw: FACE_N, room: null, via: [], sit: false } as Spot, label: "At reception", place: "reception" },
    founder: { spot: { x: 58.4, z: 3.2, yaw: FACE_E, room: ROOM.founder, via: [[56.5, 3.2]], sit: false } as Spot, label: "Briefing the founder", place: "founder office" },
    finance: { spot: { x: 70, z: 0.9, yaw: FACE_N, room: ROOM.finance, via: [[66.5, 0.9]], sit: false } as Spot, label: "Syncing with finance", place: "finance" },
  }
  type Errand = keyof typeof E

  const doorIn = (rm: Room): [number, number] => [rm.doorX, rm.wallZ + rm.side]
  const entry = (s: Spot): [number, number][] =>
    s.room ? [[s.room.doorX, CORR], doorIn(s.room), ...s.via] : [[s.via[0]?.[0] ?? s.x, CORR], ...s.via]
  function route(a: Spot, b: Spot) {
    const mid = a.room && a.room === b.room ? [...[...a.via].reverse(), ...b.via] : [...entry(a).reverse(), ...entry(b)]
    const out: [number, number][] = []
    for (const p of [[a.x, a.z] as [number, number], ...mid, [b.x, b.z] as [number, number]]) {
      const q = out[out.length - 1]
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.3) out.push(p)
    }
    if (out.length < 2) out.push([b.x + 0.05, b.z])
    return curve(out)
  }

  const SHIRTS = ["#2563eb", "#f97316", "#10b981", "#e11d48", "#8b5cf6", "#0ea5e9", "#f59e0b", "#14b8a6", "#64748b", "#ec4899"]
  const SKIN = ["#f1c7a1", "#d9a47a", "#b97f57", "#8d5a3b"]
  const HAIR = ["#1f2937", "#3f2a1d", "#5b3a24", "#111827"]
  function personModel(i: number) {
    const shirt = mat(SHIRTS[i % SHIRTS.length])
    const skin = mat(SKIN[Math.floor(r() * SKIN.length)])
    const root = new THREE.Group()
    const body = new THREE.Group()
    root.add(body)
    const legs = [-0.11, 0.11].map((z) => {
      const p = new THREE.Group()
      p.position.set(0, 0.8, z)
      block(p, 0.17, 0.8, 0.17, M.pants, 0, -0.8, 0)
      body.add(p)
      return p
    })
    block(body, 0.3, 0.62, 0.46, shirt, 0, 0.78, 0, G.carton)
    const arms = [-0.3, 0.3].map((z) => {
      const p = new THREE.Group()
      p.position.set(0, 1.36, z)
      block(p, 0.12, 0.56, 0.12, shirt, 0, -0.56, 0)
      body.add(p)
      return p
    })
    const head = new THREE.Mesh(G.sphere, skin)
    head.scale.setScalar(0.15)
    head.position.set(0, 1.57, 0)
    const hair = new THREE.Mesh(G.sphere, mat(HAIR[i % HAIR.length]))
    hair.scale.set(0.16, 0.1, 0.16)
    hair.position.set(-0.02, 1.65, 0)
    body.add(head, hair)
    root.traverse((o) => (o.castShadow = true))
    g.add(root)
    return { root, body, legs, arms }
  }

  interface Person {
    info: PersonInfo
    m: ReturnType<typeof personModel>
    home: Spot
    at: Spot
    state: "sit" | "stand" | "walk"
    timer: number
    path: THREE.CatmullRomCurve3 | null
    s: number
    len: number
    dest: Spot
    label: string
    phase: number
    meeting: boolean
    errands: Errand[]
  }

  const CREW: [string, string, string, Spot, Errand[]][] = [
    ["Ploy", "Account Executive", "sales", salesSeats[0], ["coffee", "water", "printer", "reception"]],
    ["Nat", "Sales Lead", "sales", salesSeats[1], ["coffee", "founder", "printer"]],
    ["Mint", "BD Manager", "sales", salesSeats[3], ["coffee", "reception", "water"]],
    ["Bank", "Account Executive", "sales", salesSeats[4], ["coffee", "water", "printer"]],
    ["Fern", "Customer Success", "sales", salesSeats[6], ["reception", "coffee", "finance"]],
    ["Tong", "Sales Development", "sales", salesSeats[7], ["coffee", "water"]],
    ["Beam", "Project Lead", "studio", studioSeats[0], ["coffee", "founder", "printer"]],
    ["Pim", "Designer", "studio", studioSeats[1], ["coffee", "water", "printer"]],
    ["Arm", "Developer", "studio", studioSeats[2], ["servers", "coffee", "water"]],
    ["Ice", "Developer", "studio", studioSeats[3], ["servers", "coffee"]],
    ["Jay", "Project Manager", "studio", studioSeats[4], ["finance", "printer", "coffee"]],
    ["Kai", "Finance Lead", "finance", financeSeats[0], ["founder", "printer", "coffee"]],
    ["Mew", "Accountant", "finance", financeSeats[2], ["printer", "water"]],
    ["Founder", "CEO", "founder", founderSeat, ["coffee", "finance", "reception"]],
    ["Fah", "Receptionist", "reception", receptionSeat, ["printer", "water"]],
  ]
  const zoneName = (id: string) => ZONES.find((z) => z.id === id)!.name
  const people: Person[] = CREW.map(([name, role, zoneId, home, errands], i) => {
    const m = personModel(i)
    m.root.position.set(home.x, FLOOR, home.z)
    m.root.rotation.y = home.yaw
    ctx.register(name, m.root, 0.4, 26)
    return {
      info: { id: name, kind: "person", name, role, zone: zoneName(zoneId), zoneId, status: "At desk", tasks: 2 + Math.floor(r() * 6) },
      m,
      home,
      at: home,
      state: "sit",
      timer: 3 + r() * 60,
      path: null,
      s: 0,
      len: 0,
      dest: home,
      label: "At desk",
      phase: r() * 6,
      meeting: false,
      errands,
    }
  })
  const atDesk = (p: Person) => p.state === "sit" && p.at === p.home

  function go(p: Person, dest: Spot, label: string, place: string) {
    p.path = route(p.at, dest)
    p.len = p.path.getLength()
    p.s = 0
    p.dest = dest
    p.label = label
    p.state = "walk"
    p.info.status = `Walking to ${place}`
  }

  // ---------------------------------------------------------------- live sim
  const stats = {
    calls: 38,
    openDeals: 12,
    pipeline: 4_820_000,
    tasks: 17,
    hours: 41.5,
    visitors: 6,
    leads: 3,
    autoRuns: 1284,
    paidToday: 185_000,
    invoicesDue: 4,
    revenue: 1_920_000,
    meetingsToday: 3,
    lastCron: 0,
  }
  const bars = Array.from({ length: 14 }, () => 0.3 + r() * 0.6)
  function drawDash() {
    const c = dashCv.getContext("2d")!
    c.fillStyle = "#0f172a"
    c.fillRect(0, 0, 1024, 512)
    c.fillStyle = "#e2e8f0"
    c.font = "bold 40px system-ui, sans-serif"
    c.fillText("ERP · Live", 40, 66)
    const kpis: [string, string, string][] = [
      ["Revenue MTD", thb(stats.revenue), "#34d399"],
      ["Pipeline", thb(stats.pipeline), "#60a5fa"],
      ["Automations", Math.floor(stats.autoRuns).toLocaleString(), "#fbbf24"],
    ]
    kpis.forEach(([k, v, col], i) => {
      const x = 40 + i * 320
      c.fillStyle = "#1e293b"
      c.fillRect(x, 96, 290, 120)
      c.fillStyle = "#94a3b8"
      c.font = "28px system-ui, sans-serif"
      c.fillText(k, x + 20, 140)
      c.fillStyle = col
      c.font = "bold 50px system-ui, sans-serif"
      c.fillText(v, x + 20, 196)
    })
    bars.forEach((b, i) => {
      const h = b * 230
      c.fillStyle = i === bars.length - 1 ? "#34d399" : "#3b82f6"
      c.fillRect(40 + i * 68, 486 - h, 46, h)
    })
    dashTex.needsUpdate = true
  }
  drawDash()

  const floaters: { obj: CSS2DObject; el: HTMLElement; t: number }[] = []
  function floatChip(text: string, x: number, z: number) {
    const c = chip(`<span class="font-semibold text-emerald-950">${text}</span>`, "bg-emerald-400 px-2 py-0.5 text-[11px]")
    c.obj.position.set(x, 3, z)
    g.add(c.obj)
    floaters.push({ ...c, t: 0 })
  }

  let meetingTimer = 10
  let meetingEnd = 0
  let meetingTitle = ""
  const TITLES = ["Sprint review", "Pipeline sync", "Client kickoff", "Design crit", "Weekly standup"]
  function startMeeting(clock: number) {
    const pool = people.filter((p) => atDesk(p) && (p.info.zoneId === "sales" || p.info.zoneId === "studio"))
    if (pool.length < 3) return void (meetingTimer = 5)
    meetingTitle = TITLES[stats.meetingsToday % TITLES.length]
    meetingEnd = clock + 34
    pool.sort(() => Math.random() - 0.5)
    pool.slice(0, meetChairs.length).forEach((p, i) => {
      p.meeting = true
      go(p, meetChairs[i], `In meeting · ${meetingTitle}`, "meeting room")
    })
  }

  let ledT = 0
  let dashT = 0
  let tagT = 0
  let nextMeetingAt = 0
  function update(dt: number, clock: number, sim: number) {
    // meetings
    if (!meetingTitle) {
      meetingTimer -= dt
      if (meetingTimer <= 0) startMeeting(clock)
    } else if (clock > meetingEnd) {
      meetingTitle = ""
      meetingTimer = 28
      stats.meetingsToday++
      for (const p of people)
        if (p.meeting) {
          p.meeting = false
          if (p.state !== "walk") p.timer = 0
        }
    }

    for (const p of people) {
      const { m } = p
      if (p.state === "walk" && p.path) {
        p.s += dt * 1.6
        const u = Math.min(p.s / p.len, 1)
        const pt = p.path.getPointAt(u)
        const tan = p.path.getTangentAt(Math.min(Math.max(u, 0.001), 0.999))
        m.root.position.set(pt.x, FLOOR, pt.z)
        m.root.rotation.y = dampAngle(m.root.rotation.y, yawOf(tan.x, tan.z), 10, dt)
        p.phase += dt * 9
        if (u >= 1) {
          p.at = p.dest
          p.state = p.dest.sit ? "sit" : "stand"
          p.info.status = p.dest === p.home ? (p.info.zoneId === "sales" && Math.random() > 0.5 ? "On a call" : "At desk") : p.label
          p.timer = p.meeting ? Infinity : p.dest === p.home ? 30 + Math.random() * 50 : 3.5 + Math.random() * 3
        }
      } else {
        m.root.rotation.y = dampAngle(m.root.rotation.y, p.at.yaw, 6, dt)
        p.timer -= dt
        if (atDesk(p) && Math.random() < dt * 0.04) p.info.tasks++
        if (p.timer <= 0) {
          if (p.at !== p.home) go(p, p.home, "At desk", "desk")
          else {
            const e = E[p.errands[Math.floor(Math.random() * p.errands.length)]]
            go(p, e.spot, e.label, e.place)
          }
        }
      }
      // pose
      const sitting = p.state === "sit"
      const swing = p.state === "walk" ? Math.sin(p.phase) * 0.55 : 0
      const typing = sitting ? 1.15 + Math.sin(clock * 14 + p.phase) * 0.06 : 0
      const k = 1 - Math.exp(-dt * 12)
      m.legs[0].rotation.z += ((sitting ? Math.PI / 2 : swing) - m.legs[0].rotation.z) * k
      m.legs[1].rotation.z += ((sitting ? Math.PI / 2 : -swing) - m.legs[1].rotation.z) * k
      m.arms[0].rotation.z += ((sitting ? typing : -swing * 0.8) - m.arms[0].rotation.z) * k
      m.arms[1].rotation.z += ((sitting ? typing : swing * 0.8) - m.arms[1].rotation.z) * k
      const bob = p.state === "walk" ? Math.abs(Math.cos(p.phase)) * 0.05 : 0
      m.body.position.y += ((sitting ? -0.33 : bob) - m.body.position.y) * k
    }

    // business activity
    const team = (id: string) => people.filter((p) => p.info.zoneId === id)
    if (Math.random() < dt * 0.3 * (team("sales").filter(atDesk).length / 6)) stats.calls++
    if (Math.random() < dt * 0.05) {
      const v = 60_000 + Math.round(Math.random() * 14) * 10_000
      if (Math.random() > 0.5 || stats.openDeals < 6) {
        stats.openDeals++
        stats.pipeline += v
        floatChip(`New deal · ${thb(v)}`, 52, -19)
      } else {
        stats.openDeals--
        stats.pipeline -= v
        stats.revenue += v
        floatChip(`Deal won · ${thb(v)}`, 52, -19)
      }
    }
    if (Math.random() < dt * 0.1) {
      stats.tasks++
      const n = notes.find((x) => x.userData.col < 2 && Math.random() > 0.4) ?? notes.find((x) => x.userData.col < 2)
      if (n) n.userData.col++
      else notes.forEach((x) => (x.userData.col = 0))
    }
    for (const n of notes) n.position.x += (colX[n.userData.col] + (n.userData.row % 2 ? 0.35 : -0.35) - n.position.x) * (1 - Math.exp(-dt * 5))
    stats.hours += (team("studio").filter(atDesk).length * dt * ctx.simSpeed) / 3600
    if (Math.random() < dt * 0.05) {
      const v = 20_000 + Math.round(Math.random() * 15) * 5_000
      stats.paidToday += v
      stats.revenue += v
      stats.invoicesDue = Math.max(0, stats.invoicesDue - 1)
      floatChip(`Invoice paid · ${thb(v)}`, 70, 1.5)
    }
    if (Math.random() < dt * 0.03) stats.invoicesDue++
    if (Math.random() < dt * 0.03) {
      stats.visitors++
      stats.leads++
      floatChip("New intake lead", 47.5, -8)
    }
    stats.autoRuns += dt * 3
    if (Math.random() < dt * 0.1) stats.lastCron = sim

    for (const f of [...floaters]) {
      f.t += dt
      f.obj.position.y = 3 + f.t * 0.9
      f.el.style.opacity = String(Math.max(0, 1 - f.t / 2.6))
      if (f.t > 2.6) {
        g.remove(f.obj)
        f.el.remove()
        floaters.splice(floaters.indexOf(f), 1)
      }
    }

    ledT += dt
    if (ledT > 0.12) {
      ledT = 0
      for (let i = 0; i < 5; i++) {
        const l = leds[Math.floor(Math.random() * leds.length)]
        const x = Math.random()
        l.material = x > 0.9 ? M.ledAmber : x > 0.35 ? M.ledOn : M.ledOff
      }
    }
    dashT += dt
    if (dashT > 0.6) {
      dashT = 0
      for (let i = 0; i < bars.length; i++) bars[i] = Math.min(1, Math.max(0.15, bars[i] + (Math.random() - 0.5) * 0.12))
      drawDash()
    }
    tagT += dt
    if (tagT > 0.5) {
      tagT = 0
      for (const z of ZONES) zoneTags.get(z.id)!.textContent = shortStatus(z.id)
    }
    nextMeetingAt = meetingTitle ? 0 : sim + meetingTimer * ctx.simSpeed
  }

  function shortStatus(id: string) {
    const t = people.filter((p) => p.info.zoneId === id)
    if (id === "meeting") return meetingTitle ? "In use" : "Free"
    if (id === "servers") return "OK"
    return `${t.filter(atDesk).length}/${t.length}`
  }

  function zoneInfo(z: ZoneDef): ZoneInfo {
    const t = people.filter((p) => p.info.zoneId === z.id)
    const desks: [string, string] = ["Team at desks", `${t.filter(atDesk).length}/${t.length}`]
    const inMeeting = people.filter((p) => p.meeting && p.state === "sit").length
    const rows: Record<string, [string, string][]> = {
      sales: [["Open deals", String(stats.openDeals)], ["Pipeline", thb(stats.pipeline)], ["Calls today", String(stats.calls)], desks],
      studio: [["Active projects", "6"], ["Tasks done today", String(stats.tasks)], ["Hours logged", stats.hours.toFixed(1)], desks],
      reception: [["Visitors today", String(stats.visitors)], ["New intake leads", String(stats.leads)], ["Receptionist", people.find((p) => p.info.zoneId === "reception")!.info.status]],
      servers: [["Automations run", Math.floor(stats.autoRuns).toLocaleString()], ["Webhooks", "Healthy"], ["Uptime", "99.98%"], ["Last cron", stats.lastCron ? hhmm(stats.lastCron) : "—"]],
      meeting: [["Now", meetingTitle || "Free"], ["Seated", String(inMeeting)], ["Meetings today", String(stats.meetingsToday)], ["Next", meetingTitle ? "After this one" : hhmm(nextMeetingAt)]],
      founder: [["Revenue MTD", thb(stats.revenue)], ["Pipeline", thb(stats.pipeline)], ["Cash runway", "14 mo"], ["Founder", people.find((p) => p.info.zoneId === "founder")!.info.status]],
      finance: [["Invoices due", String(stats.invoicesDue)], ["Paid today", thb(stats.paidToday)], ["Revenue MTD", thb(stats.revenue)], desks],
    }
    const status = z.id === "meeting" ? (meetingTitle ? `In use · ${meetingTitle}` : "Available") : z.id === "servers" ? "All systems normal" : `${desks[1]} at desks`
    return { id: z.id, kind: "zone", name: z.name, sub: z.sub, status, stats: rows[z.id], links: z.links }
  }

  let lit: string | null = null
  return {
    update,
    snapshot: () => ({ people: people.map((p) => ({ ...p.info })), zones: ZONES.map(zoneInfo) }),
    highlight(id: string | null) {
      if (lit) zoneFloors.get(lit)!.material.emissive.setHex(0)
      lit = id && zoneFloors.has(id) ? id : null
      if (lit) {
        const m = zoneFloors.get(lit)!.material
        m.emissive.set("#f28a3c")
        m.emissiveIntensity = 0.15
      }
    },
  }
}
