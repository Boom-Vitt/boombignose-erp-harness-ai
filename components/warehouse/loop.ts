import * as THREE from "three"

import {
  COLOR,
  LAY,
  TAU,
  annulus,
  edges,
  glow,
  lineMat,
  polar,
  ringLine,
  rng,
  std,
  yawOf,
  type BuildCtx,
} from "./kit"
import type { ShipmentInfo, ShuttleInfo, ShuttleState, StackerInfo, ZoneInfo } from "./types"

const CAPACITY = 6
const STOCK_CAP = 1800
const CARGO_GAP = 5.2

/** Tangent yaw for a model travelling counter-clockwise (dir = 1) or clockwise (dir = -1) at scene angle `a`. */
const tangentYaw = (a: number, dir: number) => yawOf(-dir * Math.sin(a), dir * Math.cos(a))

interface Shuttle {
  info: ShuttleInfo
  holder: THREE.Group
  cars: THREE.Group[]
  slots: THREE.Mesh[]
  dir: 1 | -1
  r: number
  a: number
  v: number
  timer: number
}

interface Stacker {
  info: StackerInfo
  root: THREE.Group
  carriage: THREE.Group
  cube: THREE.Mesh
  beam: THREE.Mesh
  a: number
  v: number
  lift: number
  reach: number
  step: number
  timer: number
}

export function buildLoop(ctx: BuildCtx, simSpeed: number, simStart: number) {
  const rand = rng(23)
  const g = new THREE.Group()
  ctx.root.add(g)

  const M = {
    road: std("#0e172c", { roughness: 0.95 }),
    deep: std(COLOR.navyDeep),
    navy: std(COLOR.navy),
    wall: std("#1a2748", { side: THREE.DoubleSide }),
    slate: std(COLOR.slate, { roughness: 0.6, metalness: 0.25 }),
    gold: glow(COLOR.gold),
    orange: glow(COLOR.orange),
    padOut: glow(COLOR.orange, 0.3, true),
    padIn: glow(COLOR.gold, 0.25, true),
    pallet: std("#ffffff", { roughness: 0.65 }),
    cargo: std("#e9a24a", { emissive: "#7a3a08", emissiveIntensity: 0.55, roughness: 0.6 }),
    shuttle: std("#4a63a8", { roughness: 0.45, metalness: 0.25, emissive: "#16264d", emissiveIntensity: 0.5 }),
    cab: std("#9bb4ff", { emissive: "#4a6bb8", emissiveIntensity: 0.8, roughness: 0.2, side: THREE.DoubleSide }),
    stackerBody: std("#3a539a", { roughness: 0.5, metalness: 0.25, emissive: "#16264d", emissiveIntensity: 0.4 }),
    edge: lineMat("#9bb4ff", 0.75),
    gold_l: lineMat(COLOR.gold, 1),
    scan: glow(COLOR.gold, 0.28, true),
  }
  const cargoGeo = new THREE.BoxGeometry(1.25, 1.05, 1.25)

  // ------------------------------------------------------------ road with two lanes of flow
  annulus(g, LAY.roadIn, LAY.roadOut, 0.05, M.road)
  ringLine(g, LAY.roadIn, 0.12, M.gold, 0.12)
  ringLine(g, LAY.roadOut, 0.12, M.gold, 0.12)
  ringLine(g, (LAY.laneIn + LAY.laneOut) / 2, 0.1, glow(COLOR.orange, 0.35), 0.05)

  const flow = (r: number, n: number, color: string) => {
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2.6, 0.05, 0.2), glow(color, 0.8), n)
    mesh.raycast = () => {}
    const d = new THREE.Object3D()
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU
      d.position.copy(polar(r, a, 0.12))
      d.rotation.y = tangentYaw(a, 1)
      d.updateMatrix()
      mesh.setMatrixAt(i, d.matrix)
    }
    const holder = new THREE.Group()
    holder.add(mesh)
    g.add(holder)
    return holder
  }
  const flowOut = flow(LAY.laneOut, 90, COLOR.orange)
  const flowIn = flow(LAY.laneIn, 90, COLOR.gold)

  // lamp posts
  const lampCount = 36
  const posts = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.1, 0.12, 2.6, 6), M.deep, lampCount)
  const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.28, 8, 6), glow(COLOR.gold), lampCount)
  posts.raycast = bulbs.raycast = () => {}
  const dm = new THREE.Object3D()
  for (let i = 0; i < lampCount; i++) {
    const p = polar(LAY.roadOut + 0.7, ((i + 0.5) / lampCount) * TAU)
    dm.position.set(p.x, 1.3, p.z)
    dm.updateMatrix()
    posts.setMatrixAt(i, dm.matrix)
    dm.position.y = 2.7
    dm.updateMatrix()
    bulbs.setMatrixAt(i, dm.matrix)
  }
  g.add(posts, bulbs)

  // ------------------------------------------------------------ the vault: stock on terraces
  const a0 = LAY.vaultCenter - LAY.vaultSpan / 2
  const vault = new THREE.Group()
  g.add(vault)
  const rows: [number, number][] = [] // radius, height
  for (let i = 0; i < 3; i++) {
    const r0 = LAY.vaultIn + i * LAY.tier
    const h = (i + 1) * LAY.tierRise
    // cylinder theta runs from +z towards +x, so scene angle α maps to θ = π/2 - α
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(r0, r0, h, 72, 1, true, Math.PI / 2 - a0 - LAY.vaultSpan, LAY.vaultSpan), M.wall)
    wall.position.y = h / 2
    vault.add(wall)
    annulus(vault, r0, r0 + LAY.tier, h, M.slate, a0, LAY.vaultSpan)
    ringLine(vault, r0, h + 0.04, M.gold, 0.1, LAY.vaultSpan, a0)
    // end caps keep the arc readable from the side
    for (const a of [a0, a0 + LAY.vaultSpan]) {
      const cap = new THREE.Mesh(new THREE.BoxGeometry(LAY.tier, h, 0.4), M.navy)
      cap.position.copy(polar(r0 + LAY.tier / 2, a, h / 2))
      cap.rotation.y = -a
      vault.add(cap)
    }
    rows.push([r0 + 1.5, h], [r0 + 4.5, h])
  }
  ringLine(vault, LAY.vaultIn + 3 * LAY.tier, 5.45, M.orange, 0.1, LAY.vaultSpan, a0)

  const slots: THREE.Matrix4[] = []
  const dummy = new THREE.Object3D()
  for (const [r, h] of rows) {
    const n = Math.floor((LAY.vaultSpan * r) / 2.1)
    for (let i = 0; i < n; i++) {
      const a = a0 + ((i + 0.5) / n) * LAY.vaultSpan
      dummy.position.copy(polar(r, a, h + 0.55))
      dummy.rotation.y = tangentYaw(a, 1)
      dummy.scale.set(1, 0.9 + rand() * 0.25, 1)
      dummy.updateMatrix()
      slots.push(dummy.matrix.clone())
    }
  }
  // fixed shuffle so stock thins out evenly instead of emptying one end first
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[slots[i], slots[j]] = [slots[j], slots[i]]
  }
  const palette = ["#f0a24a", "#c76f2b", "#2f4580", "#3d5aa3", "#e8c070"].map((c) => new THREE.Color(c))
  const pallets = new THREE.InstancedMesh(new THREE.BoxGeometry(1.5, 1.1, 1.5), M.pallet, slots.length)
  slots.forEach((m, i) => {
    pallets.setMatrixAt(i, m)
    pallets.setColorAt(i, palette[Math.floor(rand() * palette.length)])
  })
  pallets.raycast = () => {}
  vault.add(pallets)
  const vaultAnchor = polar(LAY.vaultIn + 9, LAY.vaultCenter, 2)
  ctx.register("vault", vault, { ring: 0, focus: 100, anchor: vaultAnchor })
  ctx.pin("vault", "08", "Vault", polar(LAY.vaultIn + 9, LAY.vaultCenter, 14))

  // ------------------------------------------------------------ gates and portals
  const gate = (a: number, lane: number, pad: THREE.Material) => {
    const grp = new THREE.Group()
    grp.position.copy(polar((LAY.roadIn + LAY.roadOut) / 2, a))
    grp.rotation.y = -a
    for (const s of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6.4, 0.6), M.slate)
      post.position.set(s * 5.1, 3.2, 0)
      edges(post, M.gold_l)
      grp.add(post)
    }
    const lintel = new THREE.Mesh(new THREE.BoxGeometry(10.9, 0.55, 0.7), M.slate)
    lintel.position.y = 6.4
    edges(lintel, M.gold_l)
    grp.add(lintel)
    const strip = new THREE.Mesh(new THREE.BoxGeometry(9.6, 0.1, 0.12), M.orange)
    strip.position.y = 6.05
    grp.add(strip)
    g.add(grp)
    const padMesh = annulus(g, lane - 1.4, lane + 1.4, 0.14, pad, a - 0.1, 0.2)
    padMesh.raycast = () => {}
  }
  gate(LAY.gateA, LAY.laneOut, M.padOut)
  gate(LAY.gateB, LAY.laneIn, M.padIn)

  const portal = (a: number) => {
    const grp = new THREE.Group()
    grp.position.copy(polar((LAY.roadIn + LAY.roadOut) / 2, a))
    grp.rotation.y = -a
    const roof = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.6, 22), M.navy)
    roof.position.y = 4.2
    edges(roof, M.edge)
    grp.add(roof)
    for (const s of [-1, 1]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.6, 4.2, 22), M.navy)
      wall.position.set(s * 5.1, 2.1, 0)
      grp.add(wall)
    }
    for (const s of [-1, 1]) {
      const seam = new THREE.Mesh(new THREE.BoxGeometry(10.4, 0.1, 0.1), M.orange)
      seam.position.set(0, 3.9, s * 11)
      grp.add(seam)
    }
    g.add(grp)
  }
  portal(LAY.portalIn)
  portal(LAY.portalOut)

  // ------------------------------------------------------------ shuttles
  function buildShuttle(id: string, carrier: string, dir: 1 | -1, state: ShuttleState, loaded: number): Shuttle {
    const r = dir === 1 ? LAY.laneOut : LAY.laneIn
    const holder = new THREE.Group()
    g.add(holder)
    const cars: THREE.Group[] = []
    const slotsM: THREE.Mesh[] = []
    for (let i = 0; i < 3; i++) {
      const car = new THREE.Group()
      if (i === 2) {
        // locomotive: capsule body + glass cab + orange stripe
        const body = new THREE.Mesh(new THREE.CapsuleGeometry(1.0, 3.1, 4, 14), M.shuttle)
        body.rotation.z = Math.PI / 2
        body.scale.set(1, 1, 0.9)
        body.position.y = 1.15
        car.add(body)
        const cab = new THREE.Mesh(new THREE.SphereGeometry(0.85, 14, 8, 0, TAU, 0, Math.PI / 2), M.cab)
        cab.position.set(1.4, 1.55, 0)
        cab.scale.set(1.3, 0.8, 0.95)
        car.add(cab)
      } else {
        const deck = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.45, 2.3), M.shuttle)
        deck.position.y = 0.55
        edges(deck, M.edge)
        car.add(deck)
        for (let k = 0; k < 3; k++) {
          const c = new THREE.Mesh(cargoGeo, M.cargo)
          c.position.set((k - 1) * 1.45, 1.3, 0)
          car.add(c)
          slotsM.push(c)
        }
      }
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.1, 2.35), M.orange)
      stripe.position.y = i === 2 ? 0.75 : 0.35
      car.add(stripe)
      cars.push(car)
      holder.add(car)
    }
    const info: ShuttleInfo = { id, kind: "shuttle", carrier, gate: dir === 1 ? "Gate A" : "Gate B", direction: dir === 1 ? "outbound" : "inbound", state, loaded, capacity: CAPACITY, eta: null }
    ctx.register(id, holder, { ring: 6.5, focus: 62, mobile: true })
    return { info, holder, cars, slots: slotsM, dir, r, a: 0, v: 0, timer: 0 }
  }

  /** Lay the three cars along the lane at arc position `sh.a`; the holder sits on the middle car. */
  function place(sh: Shuttle) {
    const d = CARGO_GAP / sh.r
    const mid = polar(sh.r, sh.a, 0.15)
    sh.holder.position.copy(mid)
    sh.cars.forEach((car, i) => {
      const ca = sh.a + sh.dir * (i - 1) * d // tail, middle, head
      const p = polar(sh.r, ca, 0.15)
      car.position.set(p.x - mid.x, 0, p.z - mid.z)
      car.rotation.y = tangentYaw(ca, sh.dir)
    })
    // slots are stored tail deck first; stackers fill the middle deck first
    sh.slots.forEach((s, j) => (s.visible = (j < 3 ? j + 3 : j - 3) < sh.info.loaded))
  }

  const out = buildShuttle("SH-2051", "BBN Freight", 1, "Loading", 2)
  out.a = LAY.gateA
  const inb = buildShuttle("SH-2287", "Siam Cargo", -1, "En route", CAPACITY)
  inb.info.eta = 20 * simSpeed
  inb.timer = 20
  inb.holder.visible = false
  inb.a = LAY.portalOut
  let outSeq = 2051
  let inSeq = 2287

  function drive(sh: Shuttle, target: number, vmax: number, brake: boolean, dt: number) {
    const remaining = (target - sh.a) * sh.dir * sh.r
    const vt = brake ? Math.min(vmax, Math.sqrt(2 * 2.4 * Math.max(remaining, 0)) + 0.5) : vmax
    sh.v += THREE.MathUtils.clamp(vt - sh.v, -5 * dt, 2.6 * dt)
    sh.a += (sh.dir * sh.v * dt) / sh.r
    if ((target - sh.a) * sh.dir <= (brake ? 0.002 : 0)) {
      if (brake) sh.a = target
      sh.v = brake ? 0 : sh.v
      return true
    }
    return false
  }

  // ------------------------------------------------------------ stock + shipment
  let stock = 1412
  const stock0 = stock
  const day = { received: 96, shipped: 128 }
  let shipSeq = 78442
  const cities = ["Chonburi", "Ayutthaya", "Chiang Mai", "Khon Kaen", "Hat Yai"]
  let cycle = 8
  let lastDrop = 0
  let clockT = 0
  const shipment: ShipmentInfo = {
    no: "#SHP-78442",
    to: cities[0],
    shuttleId: out.info.id,
    step: 2,
    loaded: 2,
    capacity: CAPACITY,
    confirmedAt: simStart - (2 * 3600 + 51 * 60),
    pickedAt: simStart - 80 * 60,
    loadEta: 0,
  }

  // ------------------------------------------------------------ stackers
  function buildStacker(info: StackerInfo, a: number): Stacker {
    const root = new THREE.Group()
    const body = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.95, 1.5), M.stackerBody)
    body.position.y = 0.7
    edges(body, M.edge)
    root.add(body)
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.3), M.orange)
    bar.position.set(-0.1, 1.25, -0.35)
    root.add(bar)
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.16, 3.2, 1.0), M.slate)
    mast.position.set(0, 1.6, 0.95)
    root.add(mast)
    const carriage = new THREE.Group()
    const plate = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.1, 1.5), M.gold)
    carriage.add(plate)
    const cube = new THREE.Mesh(cargoGeo, M.cargo)
    cube.position.y = 0.6
    cube.visible = false
    carriage.add(cube)
    root.add(carriage)
    const beam = new THREE.Mesh(new THREE.BoxGeometry(0.06, 3.6, 7), M.scan)
    beam.position.set(0, 2.2, 4.4)
    beam.visible = false
    root.add(beam)
    g.add(root)
    ctx.register(info.id, root, { ring: 2.4, focus: 40, mobile: true })
    return { info, root, carriage, cube, beam, a, v: 0, lift: 0.3, reach: 0, step: 0, timer: 0 }
  }
  const st1 = buildStacker({ id: "ST-01", kind: "stacker", operator: "Somchai K.", model: "EV-18 side loader", status: "Picking pallet", carrying: "Empty", moves: 27, battery: 75, speedKmh: 0, charger: "C1" }, LAY.gateA + 0.28)
  const st2 = buildStacker({ id: "ST-02", kind: "stacker", operator: "Wan P.", model: "EV-20 scanner", status: "Cycle count · Tier A", carrying: "Empty", moves: 14, battery: 58, speedKmh: 0, charger: "C2" }, LAY.vaultCenter - 0.6)
  const stackers = [st1, st2]

  function placeStacker(s: Stacker) {
    const p = polar(LAY.service, s.a, 0.1)
    s.root.position.copy(p)
    s.root.rotation.y = tangentYaw(s.a, 1)
    // side-loader: the carriage reaches towards the road (local +z is inward when facing counter-clockwise)
    s.carriage.position.set(0, s.lift, 0.95 + s.reach * 3.9)
  }

  function driveStacker(s: Stacker, target: number, vmax: number, dt: number) {
    const remaining = Math.abs(target - s.a) * LAY.service
    const vt = Math.min(vmax, Math.sqrt(2 * 2 * remaining) + 0.4)
    s.v += THREE.MathUtils.clamp(vt - s.v, -4 * dt, 3 * dt)
    const dir = Math.sign(target - s.a)
    s.a += (dir * s.v * dt) / LAY.service
    if (Math.abs(target - s.a) < 0.002) {
      s.a = target
      s.v = 0
      return true
    }
    return false
  }

  const slotAngle = (k: number) => {
    // cars: [tail, mid, head=loco]; slots 0-2 on the middle deck, 3-5 on the tail deck
    const d = CARGO_GAP / out.r
    const carA = out.a + (k < 3 ? 0 : -d)
    return carA + ((k % 3) - 1) * (1.45 / out.r)
  }
  const stage = LAY.gateA + 0.28
  const ready = () => out.info.state === "Loading" && out.info.loaded < CAPACITY && out.v < 0.05

  /** Move `key` towards `to` at `speed` units/s; true once there. */
  const approach = (s: Stacker, key: "lift" | "reach", to: number, speed: number, dt: number) => {
    s[key] += Math.sign(to - s[key]) * Math.min(Math.abs(to - s[key]), speed * dt)
    return Math.abs(s[key] - to) < 1e-3
  }

  function stepStacker1(dt: number) {
    const s = st1
    switch (s.step) {
      case 0: // back to the vault front
        if (!s.cube.visible) approach(s, "lift", 0.3, 2, dt)
        if (driveStacker(s, stage, 4.4, dt)) {
          s.info.status = "Picking pallet"
          s.step = 1
        }
        break
      case 1:
        if (approach(s, "lift", 1.3, 1.5, dt)) {
          s.cube.visible = true
          s.info.carrying = `1 pallet · SKU-${4100 + (s.info.moves % 40)}`
          s.step = 2
        }
        break
      case 2:
        s.info.status = "Waiting for shuttle"
        if (ready()) s.step = 3
        break
      case 3:
        s.info.status = "Loading shuttle"
        if (driveStacker(s, slotAngle(out.info.loaded), 4.4, dt)) s.step = 4
        break
      case 4:
        if (approach(s, "reach", 1, 1.3, dt)) s.step = 5
        break
      case 5:
        if (approach(s, "lift", 1.05, 0.7, dt)) {
          s.cube.visible = false
          out.info.loaded++
          shipment.loaded = out.info.loaded
          stock--
          day.shipped++
          s.info.moves++
          s.info.carrying = "Empty"
          if (lastDrop) cycle = THREE.MathUtils.lerp(cycle, clockT - lastDrop, 0.4)
          lastDrop = clockT
          s.step = 6
        }
        break
      default:
        if (approach(s, "reach", 0, 1.5, dt)) {
          s.info.status = "Returning to vault"
          s.step = 0
        }
    }
    s.info.speedKmh = s.v * 1.6
  }

  // ST-02 patrols the vault front, pausing to scan at each end (step = which end it heads for)
  const patrol = [LAY.vaultCenter - LAY.vaultSpan / 2 + 0.12, LAY.vaultCenter + LAY.vaultSpan / 2 - 0.12]
  function stepStacker2(dt: number) {
    const s = st2
    if (s.timer > 0) {
      s.timer -= dt
      s.beam.visible = true
      s.lift = 0.8 + Math.sin(clockT * 3) * 0.4
      s.info.status = `Scanning tier ${s.timer > 1.5 ? "A" : "B"}`
      if (s.timer <= 0) {
        s.beam.visible = false
        s.lift = 0.3
        s.step = 1 - s.step
      }
    } else {
      s.info.status = "Cycle count · Vault"
      if (driveStacker(s, patrol[s.step], 3.6, dt)) s.timer = 3
    }
    s.info.speedKmh = s.v * 1.6
  }
  st2.step = 1

  // ------------------------------------------------------------ shuttle state machines
  const setState = (sh: Shuttle, state: ShuttleState) => (sh.info.state = state)
  function updateShuttles(dt: number, sim: number) {
    // outbound
    const o = out.info
    if (o.state === "Arriving") {
      if (drive(out, LAY.gateA, 14, true, dt)) setState(out, "Loading")
    } else if (o.state === "Loading") {
      if (o.loaded >= CAPACITY) {
        out.timer += dt
        if (out.timer > 1.5) {
          setState(out, "Departing")
          shipment.step = 3
        }
      }
      shipment.loadEta = sim + (CAPACITY - o.loaded) * cycle * simSpeed
    } else if (o.state === "Departing") {
      // keep going until the whole train is inside the exit tunnel
      if (drive(out, LAY.portalOut + 8 / out.r, 15, false, dt)) {
        out.holder.visible = false
        setState(out, "Departed")
        out.timer = 0
      }
    } else if (o.state === "Departed") {
      out.timer += dt
      if (out.timer > 4) {
        o.id = `SH-${++outSeq}`
        ctx.rekey(`SH-${outSeq - 1}`, o.id)
        o.loaded = 0
        setState(out, "Arriving")
        Object.assign(shipment, {
          no: `#SHP-${++shipSeq}`,
          to: cities[(shipSeq - 78442) % cities.length],
          shuttleId: o.id,
          step: 2,
          loaded: 0,
          confirmedAt: sim - (2 * 3600 + 51 * 60),
          pickedAt: sim - 80 * 60,
        })
        out.a = LAY.portalIn
        out.v = 0
        out.timer = 0
        out.holder.visible = true
      }
    }
    if (o.state === "Arriving") shipment.loadEta = sim + (CAPACITY - o.loaded) * cycle * simSpeed + 8 * simSpeed

    // inbound
    const n = inb.info
    if (n.state === "En route") {
      inb.timer -= dt
      n.eta = Math.max(0, inb.timer * simSpeed)
      if (inb.timer <= 0) {
        n.eta = null
        setState(inb, "Arriving")
        inb.a = LAY.portalOut
        inb.v = 0
        inb.holder.visible = true
      }
    } else if (n.state === "Arriving") {
      if (drive(inb, LAY.gateB, 14, true, dt)) {
        setState(inb, "Unloading")
        inb.timer = 10
      }
    } else if (n.state === "Unloading") {
      inb.timer -= dt
      const left = Math.ceil(Math.max(inb.timer, 0) / (10 / CAPACITY))
      if (left < n.loaded) {
        stock += 2 * (n.loaded - left)
        day.received += 2 * (n.loaded - left)
        n.loaded = left
      }
      if (inb.timer <= 0) setState(inb, "Departing")
    } else if (n.state === "Departing") {
      if (drive(inb, LAY.portalIn - 8 / inb.r, 15, false, dt)) {
        inb.holder.visible = false
        n.id = `SH-${++inSeq}`
        ctx.rekey(`SH-${inSeq - 1}`, n.id)
        n.loaded = CAPACITY
        n.eta = 24 * simSpeed
        inb.timer = 24 + rand() * 12
        setState(inb, "En route")
      }
    }
  }

  // ------------------------------------------------------------ frame update
  function update(dt: number, t: number, sim: number) {
    clockT = t
    flowOut.rotation.y -= dt * (6 / LAY.laneOut) // scene angle grows counter-clockwise = negative rotation.y
    flowIn.rotation.y += dt * (6 / LAY.laneIn)
    stepStacker1(dt)
    stepStacker2(dt)
    updateShuttles(dt, sim)
    place(out)
    place(inb)
    stackers.forEach(placeStacker)
    st1.info.battery = Math.max(18, st1.info.battery - dt * 0.02)
    st2.info.battery = Math.max(18, st2.info.battery - dt * 0.015)
    pallets.count = Math.min(slots.length, Math.round((stock / STOCK_CAP) * slots.length))
  }

  function vaultInfo(): ZoneInfo {
    const pct = Math.round((stock / STOCK_CAP) * 100)
    return {
      id: "vault",
      kind: "zone",
      index: 8,
      name: "Vault",
      sub: "Stock & Warehouses",
      status: `${pct}% full`,
      stats: [
        ["Stock on hand", `${stock.toLocaleString()} pallets`],
        ["Capacity used", `${pct}%`],
        ["Received today", String(day.received)],
        ["Shipped today", String(day.shipped)],
      ],
      links: [["Inventory", "/inventory"], ["Warehouses", "/inventory/warehouses"]],
    }
  }

  const snapStacker = (s: Stacker): StackerInfo => ({ ...s.info, battery: Math.round(s.info.battery), speedKmh: Math.round(s.info.speedKmh * 10) / 10 })
  return {
    update,
    snapshot: () => ({
      vault: vaultInfo(),
      stackers: stackers.map(snapStacker),
      shuttles: [out.info, inb.info].map((s) => ({ ...s })),
      shipment: { ...shipment },
      stock,
      stockCap: STOCK_CAP,
      stockDelta: stock - stock0,
    }),
  }
}
