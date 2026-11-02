import * as THREE from "three"

import {
  COLOR,
  type BuildCtx,
  LAY,
  TAU,
  edges,
  expand,
  glass,
  glow,
  lineMat,
  polar,
  ringLine,
  rng,
  sampleWalk,
  std,
  walk,
  type Walk,
} from "./kit"
import type { PersonInfo, Presence, ZoneInfo } from "./types"

interface ZoneDef {
  id: string
  name: string
  sub: string
  /** Scene angle (counter-clockwise from +x). The atrium sits at the centre. */
  angle: number | null
  floor: string
  pinY: number
  links: [string, string][]
}

const deg = (d: number) => (d * Math.PI) / 180

const ZONES: ZoneDef[] = [
  { id: "founder", name: "Atrium", sub: "Dashboard & Reports", angle: null, floor: "#1d2c58", pinY: 27, links: [["Dashboard", "/dashboard"], ["Reports", "/reports"]] },
  { id: "sales", name: "Deal Hall", sub: "Clients & Deals", angle: deg(30), floor: "#1b2a52", pinY: 14, links: [["Deals", "/deals"], ["Clients", "/clients"]] },
  { id: "studio", name: "Studio", sub: "Projects & Timesheets", angle: deg(90), floor: "#1c2c55", pinY: 13, links: [["Projects", "/projects"], ["Timesheets", "/timesheets"]] },
  { id: "reception", name: "Gatehouse", sub: "Client intake", angle: deg(330), floor: "#1a2a50", pinY: 12, links: [["Intake", "/intake"]] },
  { id: "servers", name: "Signal Core", sub: "Automations", angle: deg(270), floor: "#18264a", pinY: 15, links: [["Automation", "/automation"]] },
  { id: "meeting", name: "Forum", sub: "Calendar", angle: deg(210), floor: "#1d2b57", pinY: 10, links: [["Calendar", "/calendar"]] },
  { id: "finance", name: "Ledger House", sub: "Invoices & Quotes", angle: deg(150), floor: "#1b2b52", pinY: 14, links: [["Finance", "/finance"], ["Quotes", "/quotes"]] },
]

const thb = (v: number) => (v >= 1e6 ? `฿${(v / 1e6).toFixed(2)}M` : `฿${Math.round(v / 1000)}K`)
const hhmm = (sec: number) => {
  const m = Math.floor(sec / 60) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

interface Act {
  zone: string
  spot: THREE.Vector3
  wait: number
  status: string
  presence: Presence
}

interface Person {
  info: PersonInfo
  root: THREE.Group
  home: Act
  errands: string[]
  queue: Act[]
  act: Act | null
  state: "walk" | "stay"
  path: Walk | null
  s: number
  timer: number
  at: THREE.Vector3
  zoneId: string
  phase: number
  speed: number
}

/** No ERP feed is wired into the sim yet: with LIVE off the crew stays seated and every counter reads zero. */
const LIVE = false

const MEETING_TITLES = ["Pipeline review", "Sprint planning", "Cash forecast", "Client kickoff"]

export function buildDistricts(ctx: BuildCtx, simSpeed: number) {
  const rand = rng(11)
  const D = LAY.deck
  const g = new THREE.Group()
  ctx.root.add(g)

  const M = {
    navy: std("#1c2b52"),
    deep: std(COLOR.navyDeep),
    mono: std("#2a3b6e", { roughness: 0.5, metalness: 0.3 }),
    slate: std(COLOR.slate, { roughness: 0.6, metalness: 0.25 }),
    gold: glow(COLOR.gold),
    orange: glow(COLOR.orange),
    goldLine: lineMat(COLOR.gold, 1),
    core: glow(COLOR.orange, 0.5, true),
    beam: glow(COLOR.gold, 0.1, true),
    person: std("#dbe6ff", { emissive: "#4a6bb8", emissiveIntensity: 0.55, roughness: 0.5 }),
    head: std("#ffd18a", { emissive: "#ff9a3d", emissiveIntensity: 0.6, roughness: 0.5 }),
    ledOn: new THREE.Color(COLOR.mint),
    ledAmber: new THREE.Color(COLOR.gold),
    ledOff: new THREE.Color("#2a3a66"),
  }

  // ------------------------------------------------------------ per-district surfaces that react to highlight
  interface Skin {
    floor: THREE.MeshStandardMaterial
    glass: THREE.MeshStandardMaterial
    edge: THREE.LineBasicMaterial
    rim: THREE.LineBasicMaterial
    ring: THREE.MeshBasicMaterial
  }
  const skins = new Map<string, Skin>()
  const centers = new Map<string, THREE.Vector3>()
  const defOf = new Map(ZONES.map((z) => [z.id, z]))

  function makeSkin(z: ZoneDef): Skin {
    const s: Skin = {
      floor: std(z.floor, { roughness: 0.55, metalness: 0.2, emissive: COLOR.orange, emissiveIntensity: 0 }),
      glass: glass(),
      edge: lineMat("#9bb4ff", 0.7),
      rim: lineMat(COLOR.orange, 0.55),
      ring: glow(COLOR.orange, 0.55),
    }
    skins.set(z.id, s)
    return s
  }

  // ------------------------------------------------------------ atrium (hub tower)
  const hub = new THREE.Group()
  g.add(hub)
  const hubZone = ZONES[0]
  const hubSkin = makeSkin(hubZone)
  centers.set("founder", new THREE.Vector3(0, 0, 0))

  const podium = new THREE.Mesh(new THREE.CylinderGeometry(LAY.podium, LAY.podium + 0.8, D, 56), M.navy)
  podium.position.y = D / 2
  hub.add(podium)
  const podiumTop = new THREE.Mesh(new THREE.CircleGeometry(LAY.podium - 0.2, 56), hubSkin.floor)
  podiumTop.rotation.x = -Math.PI / 2
  podiumTop.position.y = D + 0.02
  hub.add(podiumTop)
  ringLine(hub, LAY.podium - 0.2, D + 0.05, M.gold, 0.09)
  ringLine(hub, 9.6, D + 0.05, M.orange, 0.05)
  ringLine(hub, 8.4, D + 0.05, M.orange, 0.03)

  const tiers: [number, number][] = [[LAY.tower, 4.4], [5.2, 4.2], [4.1, 3.8]]
  let ty = D
  tiers.forEach(([r, h], i) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r + 0.15, h, 40, 1), hubSkin.glass)
    m.position.y = ty + h / 2
    edges(m, hubSkin.edge, 40)
    hub.add(m)
    ringLine(hub, r + 0.1, ty + h, i === 2 ? M.gold : M.orange, 0.07)
    ty += h
  })
  const core = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, ty - D + 4, 16), M.core)
  core.position.y = D + (ty - D + 4) / 2
  hub.add(core)
  const crown = ringLine(hub, 4.6, ty + 0.6, M.gold, 0.12)
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 3.4, 60, 24, 1, true), M.beam)
  beam.position.y = ty + 30
  hub.add(beam)

  // gyro: three tilted rings with small satellites — the orbit the pavilions echo
  const gyro = new THREE.Group()
  gyro.position.y = ty + 1.5
  hub.add(gyro)
  const gyroRings: { g: THREE.Group; speed: number; sat: THREE.Mesh }[] = []
  ;[[9.5, 0.35, 0.18], [12.2, -0.55, -0.12], [15, 0.9, 0.08]].forEach(([r, tilt, speed], i) => {
    const holder = new THREE.Group()
    holder.rotation.x = tilt
    const spin = new THREE.Group()
    holder.add(spin)
    ringLine(spin, r, 0, i === 1 ? M.orange : M.gold, 0.05)
    const sat = new THREE.Mesh(new THREE.SphereGeometry(0.55, 12, 8), M.gold)
    sat.position.set(r, 0, 0)
    spin.add(sat)
    gyro.add(holder)
    gyroRings.push({ g: spin, speed, sat })
  })
  ctx.register("founder", hub, { ring: 15, focus: 78 })
  ctx.pin("founder", "01", hubZone.name, new THREE.Vector3(0, hubZone.pinY, 0))

  // ------------------------------------------------------------ elevated walkways
  const bridge = (r0: number, r1: number, a: number, w: number) => {
    const len = r1 - r0
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(len, 0.35, w), M.slate)
    const p = polar((r0 + r1) / 2, a, D - 0.18)
    mesh.position.copy(p)
    mesh.rotation.y = -a
    for (const side of [-1, 1]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(len, 0.08, 0.1), M.gold)
      strip.position.set(0, 0.2, (side * w) / 2)
      mesh.add(strip)
    }
    g.add(mesh)
  }
  const ringIn = LAY.ring - LAY.ringHalf
  const ringOut = LAY.ring + LAY.ringHalf
  const deckProfile = [new THREE.Vector2(ringIn, D - 0.35), new THREE.Vector2(ringOut, D - 0.35), new THREE.Vector2(ringOut, D), new THREE.Vector2(ringIn, D), new THREE.Vector2(ringIn, D - 0.35)]
  g.add(new THREE.Mesh(new THREE.LatheGeometry(deckProfile, 96), std(COLOR.slate, { side: THREE.DoubleSide, roughness: 0.6 })))
  ringLine(g, ringIn, D + 0.03, M.gold, 0.06)
  ringLine(g, ringOut, D + 0.03, M.gold, 0.06)
  ringLine(g, LAY.ring, D - 0.4, M.orange, 0.05)
  for (let i = 0; i < 12; i++) {
    const p = polar(LAY.ring, (i / 12) * TAU + 0.26, D / 2 - 0.2)
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.4, D - 0.35, 8), M.deep)
    col.position.copy(p)
    g.add(col)
  }

  // meeting-room table glow and server LEDs are animated below
  let tableMat: THREE.MeshBasicMaterial | null = null
  let leds: THREE.InstancedMesh | null = null

  // ------------------------------------------------------------ pavilions
  const doorR = LAY.pavilion - LAY.plinth + 0.3
  const pav = ZONES.slice(1)
  for (const z of pav) {
    const a = z.angle!
    const skin = makeSkin(z)
    const root = new THREE.Group()
    root.position.copy(polar(LAY.pavilion, a))
    root.rotation.y = -a // local +x points outward, so the doorway at -x faces the atrium
    g.add(root)
    centers.set(z.id, root.position.clone())

    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(LAY.plinth, LAY.plinth + 0.7, D, 48), M.navy)
    plinth.position.y = D / 2
    root.add(plinth)
    const floor = new THREE.Mesh(new THREE.CircleGeometry(LAY.plinth - 0.35, 48), skin.floor)
    floor.rotation.x = -Math.PI / 2
    floor.position.y = D + 0.02
    root.add(floor)
    ringLine(root, LAY.plinth - 0.3, D + 0.05, skin.ring, 0.08)
    ringLine(root, LAY.plinth - 1.2, D + 0.04, skin.ring, 0.03)

    // doorway: two posts + lintel facing the atrium
    const door = new THREE.Group()
    door.position.set(-(LAY.plinth - 0.9), D, 0)
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, 0.3), M.gold)
      post.position.set(0, 1.6, s * 1.4)
      door.add(post)
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 3.2), M.gold)
    lintel.position.y = 3.2
    door.add(lintel)
    root.add(door)

    const shell = new THREE.Group()
    shell.position.y = D
    root.add(shell)
    buildShell(z.id, shell, skin)
    ctx.register(z.id, root, { ring: LAY.plinth + 1.2, focus: 80 })
    ctx.pin(z.id, String(ZONES.indexOf(z) + 1).padStart(2, "0"), z.name, new THREE.Vector3(root.position.x, z.pinY, root.position.z))
    bridge(ringOut, LAY.pavilion - LAY.plinth + 0.5, a, 2.6)
    bridge(LAY.podium - 0.5, ringIn, a, 2.6)
  }

  function buildShell(id: string, s: THREE.Group, skin: Skin) {
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, edge: THREE.LineBasicMaterial | null = skin.edge, angle = 30) => {
      const mesh = new THREE.Mesh(geo, m)
      mesh.position.set(x, y, z)
      if (edge) edges(mesh, edge, angle)
      s.add(mesh)
      return mesh
    }
    if (id === "sales") {
      ;[[6.4, 2.2], [5, 2.2], [3.6, 2.2]].forEach(([r, h], i) => {
        add(new THREE.CylinderGeometry(r, r, h, 36), skin.glass, 0, i * 2.2 + h / 2, 0, skin.edge, 40)
        ringLine(s, r + 0.05, (i + 1) * 2.2, i === 2 ? M.gold : M.orange, 0.07)
      })
      add(new THREE.CylinderGeometry(0.1, 0.1, 3.4, 6), M.gold, 0, 6.6 + 1.7, 0, null)
    } else if (id === "studio") {
      add(new THREE.CylinderGeometry(6, 6, 4.6, 6), skin.glass, 0, 2.3, 0, skin.edge, 20)
      ;[-2.8, 0, 2.8].forEach((z, i) => {
        const blade = add(new THREE.BoxGeometry(9.4, 0.22, 2.4), M.slate, 0, 5 + i * 0.5, z, skin.rim)
        blade.rotation.z = -0.32
      })
    } else if (id === "reception") {
      const dome = new THREE.SphereGeometry(5.2, 14, 7, 0, TAU, 0, Math.PI / 2)
      const m = add(dome, skin.glass, 0, 0, 0, null)
      m.add(new THREE.LineSegments(new THREE.WireframeGeometry(dome), skin.edge))
      ringLine(s, 5.2, 0.05, M.gold, 0.09)
      add(new THREE.SphereGeometry(0.5, 12, 8), M.gold, 0, 5.6, 0, null)
    } else if (id === "servers") {
      const hs = [5, 7.2, 9.4, 6.4, 8.2, 5.6]
      const mono = new THREE.BoxGeometry(1.8, 1, 1.8)
      hs.forEach((h, i) => {
        const a = (i / hs.length) * TAU + 0.3
        const m = add(mono, M.mono, Math.cos(a) * 3.6, h / 2, Math.sin(a) * 3.6, skin.edge)
        m.scale.y = h
      })
      const count = hs.length * 5
      leds = new THREE.InstancedMesh(new THREE.BoxGeometry(0.9, 0.12, 0.06), new THREE.MeshBasicMaterial(), count)
      const dummy = new THREE.Object3D()
      let k = 0
      hs.forEach((h, i) => {
        const a = (i / hs.length) * TAU + 0.3
        for (let j = 0; j < 5; j++) {
          dummy.position.set(Math.cos(a) * 3.6, 1 + (j * (h - 1.6)) / 4, Math.sin(a) * 3.6)
          // lead face turned toward the centre of the pavilion
          dummy.position.x -= Math.cos(a) * 0.93
          dummy.position.z -= Math.sin(a) * 0.93
          dummy.rotation.y = -a + Math.PI / 2
          dummy.updateMatrix()
          leds!.setMatrixAt(k, dummy.matrix)
          leds!.setColorAt(k, rand() > 0.35 ? M.ledOn : M.ledOff)
          k++
        }
      })
      leds.raycast = () => {}
      s.add(leds)
    } else if (id === "meeting") {
      add(new THREE.CylinderGeometry(6.2, 6.2, 3.2, 40, 1, true), skin.glass, 0, 1.6, 0, skin.edge, 40)
      ;[5.4, 4.3, 3.2].forEach((r) => ringLine(s, r, 0.08, M.orange, 0.04))
      tableMat = new THREE.MeshBasicMaterial({ color: COLOR.gold, transparent: true, opacity: 0.25 })
      const t = new THREE.Mesh(new THREE.CircleGeometry(1.9, 32), tableMat)
      t.rotation.x = -Math.PI / 2
      t.position.y = 0.1
      s.add(t)
    } else if (id === "finance") {
      ;[[9, 1.8], [6.9, 1.8], [4.8, 1.8], [2.8, 2]].forEach(([w, h], i) => {
        add(new THREE.BoxGeometry(w, h, w), skin.glass, 0, i * 1.8 + h / 2, 0, i % 2 ? skin.edge : skin.rim, 30)
      })
      add(new THREE.CylinderGeometry(0.08, 0.14, 4.6, 6), M.gold, 0, 7.4 + 2.3, 0, null)
    }
  }

  // ------------------------------------------------------------ crew
  const personGeo = { body: new THREE.CapsuleGeometry(0.36, 0.85, 4, 10), head: new THREE.SphereGeometry(0.3, 12, 8) }
  const seatAt = (zoneId: string, k: number, n: number): THREE.Vector3 => {
    const c = centers.get(zoneId)!
    if (zoneId === "founder") return polar(9.2, deg(-50), D)
    const r = zoneId === "sales" ? 4.2 : 3.4
    const a = (k / Math.max(n, 1)) * TAU + 0.5
    return new THREE.Vector3(c.x + Math.cos(a) * r, D, c.z + Math.sin(a) * r)
  }
  const visitSpot = (zoneId: string): THREE.Vector3 => {
    const c = centers.get(zoneId)!
    if (zoneId === "founder") return polar(9.6, rand() * TAU, D)
    const a = rand() * TAU
    const r = zoneId === "servers" ? 1.6 : 1.4 + rand() * 1.8
    return new THREE.Vector3(c.x + Math.cos(a) * r, D, c.z + Math.sin(a) * r)
  }
  const meetingSeats = Array.from({ length: 5 }, (_, i) => {
    const c = centers.get("meeting")!
    const a = (i / 5) * TAU + 0.4
    return new THREE.Vector3(c.x + Math.cos(a) * 3.4, D, c.z + Math.sin(a) * 3.4)
  })

  const CREW: [string, string, string, string[]][] = [
    ["Ploy", "Account Executive", "sales", ["finance", "reception", "meeting"]],
    ["Nat", "Sales Lead", "sales", ["founder", "meeting"]],
    ["Mint", "BD Manager", "sales", ["reception", "studio"]],
    ["Bank", "Account Executive", "sales", ["finance", "meeting"]],
    ["Fern", "Customer Success", "sales", ["reception", "studio"]],
    ["Tong", "Sales Development", "sales", ["reception", "meeting"]],
    ["Beam", "Project Lead", "studio", ["founder", "meeting"]],
    ["Pim", "Designer", "studio", ["sales", "meeting"]],
    ["Arm", "Developer", "studio", ["servers"]],
    ["Ice", "Developer", "studio", ["servers", "meeting"]],
    ["Jay", "Project Manager", "studio", ["finance", "sales"]],
    ["Kai", "Finance Lead", "finance", ["founder", "meeting"]],
    ["Mew", "Accountant", "finance", ["sales", "studio"]],
    ["Founder", "CEO", "founder", ["finance", "sales", "reception"]],
    ["Fah", "Receptionist", "reception", ["sales", "finance"]],
  ]
  const perZone = new Map<string, number>()
  CREW.forEach(([, , z]) => perZone.set(z, (perZone.get(z) ?? 0) + 1))
  const seen = new Map<string, number>()
  const zoneName = (id: string) => defOf.get(id)!.name

  const people: Person[] = CREW.map(([name, role, zoneId, errands], i) => {
    const k = seen.get(zoneId) ?? 0
    seen.set(zoneId, k + 1)
    const seat = seatAt(zoneId, k, perZone.get(zoneId)!)
    const root = new THREE.Group()
    const body = new THREE.Mesh(personGeo.body, M.person)
    body.position.y = 0.9
    const head = new THREE.Mesh(personGeo.head, M.head)
    head.position.y = 1.95
    root.add(body, head)
    root.position.copy(seat)
    g.add(root)
    const id = `P-${String(i + 1).padStart(2, "0")}`
    ctx.register(id, root, { ring: 1.3, focus: 24, mobile: true })
    const home: Act = { zone: zoneId, spot: seat, wait: 8, status: "At desk", presence: "desk" }
    return {
      info: { id, kind: "person", name, role, zone: zoneName(zoneId), zoneId, status: "At desk", presence: "desk", tasks: 2 + Math.floor(rand() * 9) },
      root,
      home,
      errands,
      queue: [],
      act: home,
      state: "stay",
      path: null,
      s: 0,
      timer: 2 + rand() * 12,
      at: seat.clone(),
      zoneId,
      phase: rand() * TAU,
      speed: 2.6 + rand() * 0.8,
    }
  })

  function route(fromZ: string, toZ: string, from: THREE.Vector3, to: THREE.Vector3): Walk {
    const pts = [from.clone()]
    const aF = defOf.get(fromZ)!.angle
    const aT = defOf.get(toZ)!.angle
    if (fromZ !== toZ) {
      let corners: [number, number][] = []
      if (aF !== null && aT !== null) corners = [[doorR, aF], [LAY.ring, aF], [LAY.ring, aT], [doorR, aT]]
      else if (aT !== null) corners = [[LAY.podium, aT], [LAY.ring, aT], [doorR, aT]]
      else if (aF !== null) corners = [[doorR, aF], [LAY.ring, aF], [LAY.podium, aF]]
      pts.push(...expand(corners, D))
    }
    pts.push(to.clone())
    return walk(pts)
  }

  const startAct = (p: Person, a: Act) => {
    p.act = a
    p.path = route(p.zoneId, a.zone, p.at, a.spot)
    p.s = 0
    p.state = "walk"
    p.info.status = a.zone === p.zoneId && p.path.len < 0.5 ? a.status : `Heading to ${zoneName(a.zone)}`
    p.info.presence = "away"
  }

  // ------------------------------------------------------------ simulated activity counters
  const stats = {
    openDeals: 0,
    pipeline: 0,
    calls: 0,
    tasks: 0,
    hours: 0,
    visitors: 0,
    leads: 0,
    autoRuns: 0,
    revenue: 0,
    invoicesDue: 0,
    paidToday: 0,
    meetingsToday: 0,
    lastCron: 0,
  }
  let meetingTitle = ""
  let meetingEnd = 0
  let nextMeeting = 14
  let statT = 0
  let ledT = 0
  let titleSeq = 0

  function update(dt: number, t: number, sim: number) {
    gyroRings.forEach((r, i) => {
      r.g.rotation.y += dt * r.speed * (i % 2 ? -1 : 1) * 3
    })
    crown.rotation.z += dt * 0.2
    beam.rotation.y += dt * 0.3

    for (const p of people) {
      if (p.state === "walk" && p.path) {
        p.s += p.speed * dt
        sampleWalk(p.path, p.s, p.at)
        if (p.s >= p.path.len) {
          const a = p.act!
          p.zoneId = a.zone
          p.state = "stay"
          p.timer = a.wait
          p.info.zone = zoneName(a.zone)
          p.info.zoneId = a.zone
          p.info.status = a.status
          p.info.presence = a.presence
          if (a === p.home) p.info.tasks += rand() > 0.6 ? 1 : 0
        }
      } else if (LIVE) {
        p.timer -= dt
        if (p.timer <= 0) {
          const next = p.queue.shift()
          if (next) startAct(p, next)
          else if (p.act === p.home || p.zoneId === p.home.zone) {
            // back at the desk: stay, take a call, or go on an errand
            const roll = rand()
            if (roll < 0.45) {
              const call = p.info.status !== "On a call"
              p.info.status = call ? "On a call" : "At desk"
              p.timer = 6 + rand() * 12
              if (call) stats.calls++
            } else {
              const to = p.errands[Math.floor(rand() * p.errands.length)]
              p.queue.push({ zone: p.home.zone, spot: p.home.spot, wait: 6 + rand() * 10, status: "At desk", presence: "desk" })
              startAct(p, { zone: to, spot: visitSpot(to), wait: 5 + rand() * 6, status: `Visiting ${zoneName(to)}`, presence: "away" })
            }
          } else startAct(p, p.home)
        }
      }
      const bob = p.state === "walk" ? Math.abs(Math.sin(t * 9 + p.phase)) * 0.12 : 0
      p.root.position.set(p.at.x, p.at.y + bob, p.at.z)
    }

    // meetings
    if (LIVE && !meetingTitle && sim > nextMeeting) {
      const pool = people.filter((p) => p.info.presence !== "meeting" && p.queue.length === 0)
      const crew = pool.sort(() => rand() - 0.5).slice(0, 5)
      if (crew.length >= 3) {
        meetingTitle = MEETING_TITLES[titleSeq++ % MEETING_TITLES.length]
        meetingEnd = sim + 22 * simSpeed
        stats.meetingsToday++
        crew.forEach((p, i) => {
          p.queue = [{ zone: "meeting", spot: meetingSeats[i], wait: 24, status: `In meeting · ${meetingTitle}`, presence: "meeting" }, { zone: p.home.zone, spot: p.home.spot, wait: 8, status: "At desk", presence: "desk" }]
          if (p.state === "stay") p.timer = 0
        })
      } else nextMeeting = sim + 5 * simSpeed
    } else if (meetingTitle && sim > meetingEnd) {
      meetingTitle = ""
      nextMeeting = sim + (50 + rand() * 30) * simSpeed
    }
    if (tableMat) tableMat.opacity = THREE.MathUtils.lerp(tableMat.opacity, meetingTitle ? 0.75 : 0.18, 1 - Math.exp(-dt * 3))

    statT += dt
    if (LIVE && statT > 1) {
      statT = 0
      if (rand() > 0.7) stats.openDeals += rand() > 0.5 ? 1 : -1
      stats.pipeline += Math.round((rand() - 0.4) * 40_000)
      stats.tasks += rand() > 0.6 ? 1 : 0
      stats.hours += 0.1
      stats.autoRuns += Math.floor(rand() * 4)
      if (rand() > 0.9) {
        stats.paidToday += 12_000 + Math.round(rand() * 20_000)
        stats.revenue += 12_000
        stats.lastCron = sim
      }
      if (rand() > 0.96) stats.visitors++
    }

    ledT += dt
    if (leds && ledT > 0.14) {
      ledT = 0
      for (let i = 0; i < 4; i++) {
        const x = rand()
        leds.setColorAt(Math.floor(rand() * leds.count), x > 0.9 ? M.ledAmber : x > 0.35 ? M.ledOn : M.ledOff)
      }
      if (leds.instanceColor) leds.instanceColor.needsUpdate = true
    }
  }

  const atDesk = (p: Person) => p.info.presence === "desk"
  function zoneInfo(z: ZoneDef, index: number): ZoneInfo {
    const homes = people.filter((p) => p.home.zone === z.id)
    const desks: [string, string] = ["Team at desks", `${homes.filter(atDesk).length}/${homes.length}`]
    const seated = people.filter((p) => p.info.presence === "meeting" && p.info.zoneId === "meeting").length
    const who = (zone: string) => people.find((p) => p.home.zone === zone)!.info.status
    const rows: Record<string, [string, string][]> = {
      sales: [["Open deals", String(stats.openDeals)], ["Pipeline", thb(stats.pipeline)], ["Calls today", String(stats.calls)], desks],
      studio: [["Active projects", "0"], ["Tasks done today", String(stats.tasks)], ["Hours logged", stats.hours.toFixed(1)], desks],
      reception: [["Visitors today", String(stats.visitors)], ["New intake leads", String(stats.leads)], ["Receptionist", who("reception")]],
      servers: [["Automations run", Math.floor(stats.autoRuns).toLocaleString()], ["Webhooks", "—"], ["Uptime", "—"], ["Last cron", stats.lastCron ? hhmm(stats.lastCron) : "—"]],
      meeting: [["Now", meetingTitle || "Free"], ["Seated", String(seated)], ["Meetings today", String(stats.meetingsToday)], ["Next", meetingTitle ? "After this one" : LIVE ? hhmm(nextMeeting) : "—"]],
      founder: [["Revenue MTD", thb(stats.revenue)], ["Pipeline", thb(stats.pipeline)], ["Cash runway", "—"], ["Founder", who("founder")]],
      finance: [["Invoices due", String(stats.invoicesDue)], ["Paid today", thb(stats.paidToday)], ["Revenue MTD", thb(stats.revenue)], desks],
    }
    const status =
      z.id === "meeting" ? (meetingTitle ? `In use · ${meetingTitle}` : "Available") : LIVE ? (z.id === "servers" ? "All systems normal" : z.id === "founder" ? "Dashboard live" : `${desks[1]} at desks`) : "Ready"
    return { id: z.id, kind: "zone", index, name: z.name, sub: z.sub, status, stats: LIVE ? rows[z.id] : rows[z.id].filter((r) => r !== desks), links: z.links }
  }

  // ------------------------------------------------------------ highlight + mode starters
  const sel = { id: null as string | null, hover: null as string | null }
  const paint = () => {
    for (const [id, s] of skins) {
      const k = sel.id === id ? 1 : sel.hover === id ? 0.5 : 0
      s.floor.emissiveIntensity = 0.28 * k
      s.glass.emissiveIntensity = 0.35 + 0.7 * k
      s.glass.opacity = 0.26 + 0.1 * k
    }
  }
  const baseEdge = new THREE.Color("#9bb4ff")
  const starterEdge = new THREE.Color(COLOR.gold)

  return {
    update,
    snapshot: () => ({
      people: people.map((p) => ({ ...p.info })),
      zones: ZONES.map((z, i) => zoneInfo(z, i + 1)),
    }),
    highlight(id: string | null) {
      sel.id = id
      paint()
    },
    hover(id: string | null) {
      sel.hover = id
      paint()
    },
    setStarters(ids: string[]) {
      for (const [id, s] of skins) {
        const on = ids.includes(id)
        s.edge.color.copy(on ? starterEdge : baseEdge)
        s.edge.opacity = on ? 1 : 0.7
        s.rim.color.set(on ? COLOR.gold : COLOR.orange)
        s.rim.opacity = on ? 1 : 0.55
        s.ring.color.set(on ? COLOR.gold : COLOR.orange)
        s.ring.opacity = on ? 1 : 0.55
      }
    },
  }
}
