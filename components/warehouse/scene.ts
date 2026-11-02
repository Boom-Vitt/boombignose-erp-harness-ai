import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js"

import { buildOffice, type PersonInfo, type ZoneInfo } from "./office"
import { block, canvasTex, chip, curve, cyl, dampAngle, drawCube, ease, easeCubic, flat, G, mat, rng, yawOf } from "./kit"

/** 1 real second = SIM_SPEED simulated seconds (clock, ETAs). */
export const SIM_SPEED = 10
const SIM_START = 9 * 3600 + 40 * 60 // 09:40

export type TruckState = "En route" | "Arriving" | "Loading" | "Unloading" | "Departing" | "Departed"

export interface ForkliftInfo {
  id: string
  kind: "forklift"
  operator: string
  model: string
  status: string
  carrying: string
  moves: number
  battery: number
  speedKmh: number
  charger: string
}

export interface TruckInfo {
  id: string
  kind: "truck"
  carrier: string
  bay: string
  direction: "outbound" | "inbound"
  state: TruckState
  loaded: number
  capacity: number
  /** Simulated seconds until arrival (inbound, en route) — null otherwise. */
  eta: number | null
}

export interface ShipmentInfo {
  no: string
  to: string
  truckId: string
  step: number // 0 confirmed · 1 picked · 2 loading · 3 in transit · 4 delivered
  loaded: number
  capacity: number
  confirmedAt: number
  pickedAt: number
  loadEta: number
}

export type { PersonInfo, ZoneInfo }

export interface Snapshot {
  people: PersonInfo[]
  zones: ZoneInfo[]
  sim: number
  stock: number
  stockDelta: number
  forklifts: ForkliftInfo[]
  trucks: TruckInfo[]
  shipment: ShipmentInfo
}

export interface WarehouseScene {
  zoom(factor: number): void
  rotate(dir: 1 | -1): void
  home(): void
  select(id: string | null, focus?: boolean): void
  dispose(): void
}

function sideTexture(name: string, color: string, sub: string) {
  return canvasTex(1024, 384, (c) => {
    c.fillStyle = "#f8fafc"
    c.fillRect(0, 0, 1024, 384)
    c.fillStyle = color
    c.fillRect(0, 330, 1024, 54)
    drawCube(c, 210, 170, 70, "#f3c79a", color, "#26365f")
    c.fillStyle = color
    c.font = "bold 92px system-ui, sans-serif"
    c.fillText(name, 300, 200)
    c.fillStyle = "#64748b"
    c.font = "500 40px system-ui, sans-serif"
    c.fillText(sub, 304, 260)
  })
}

// ---------------------------------------------------------------- scene

export function createWarehouseScene(
  host: HTMLElement,
  opts: { onSnapshot(s: Snapshot): void; onSelect(id: string | null): void; reducedMotion?: boolean },
): WarehouseScene {
  const M = {
    ground: mat("#0b1222"),
    yard: mat("#16223f"),
    road: mat("#1c2a4b"),
    white: mat("#9fabc2"),
    yellow: mat("#f5c33b"),
    grass: mat("#12302f"),
    blue: mat("#f28a3c"),
    roof: mat("#c96f2d"),
    rib: mat("#a95a22"),
    navy: mat("#26365f"),
    wall: mat("#c9d1e2"),
    concrete: mat("#34456e"),
    door: mat("#283449"),
    dark: mat("#1f2937"),
    glass: mat("#1e293b", { roughness: 0.15, metalness: 0.4 }),
    grey: mat("#94a3b8"),
    carton: mat("#e8c08e"),
    carton2: mat("#ddb07b"),
    wood: mat("#c89460"),
    leaf: mat("#3fbf7f"),
    leaf2: mat("#34a96f"),
    trunk: mat("#a27b58"),
    teal: mat("#14b8a6"),
    fork: mat("#f5b51e"),
    vest: mat("#f97316"),
    skin: mat("#d9a47a"),
    rubber: mat("#111827"),
    beam: mat("#f59e0b"),
    lamp: mat("#fef9c3", { emissive: "#fde68a", emissiveIntensity: 0.6 }),
    select: new THREE.MeshBasicMaterial({ color: "#f6a15a", transparent: true, opacity: 0.55, depthWrite: false }),
  }
  const textures: THREE.Texture[] = []
  const r = rng(7)

  // renderer + camera
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.domElement.style.display = "block"
  renderer.domElement.setAttribute("aria-label", "Interactive 3D warehouse yard. Drag to orbit, scroll to zoom, click a vehicle to inspect it.")
  host.appendChild(renderer.domElement)

  const labels = new CSS2DRenderer()
  labels.domElement.style.position = "absolute"
  labels.domElement.style.inset = "0"
  labels.domElement.style.pointerEvents = "none"
  host.appendChild(labels.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color("#0b1222")
  scene.fog = new THREE.Fog("#0b1222", 200, 380)

  const camera = new THREE.PerspectiveCamera(28, 1, 1, 600)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 18
  controls.maxDistance = 240
  controls.minPolarAngle = 0.25
  controls.maxPolarAngle = 1.22
  controls.screenSpacePanning = false
  controls.autoRotateSpeed = 0.35

  // lights
  scene.add(new THREE.HemisphereLight("#8fa6d8", "#0b1222", 1.25))
  const sun = new THREE.DirectionalLight("#ffd9b0", 1.9)
  sun.target.position.set(24, 0, -6)
  sun.position.set(-2, 52, 24)
  scene.add(sun.target)
  sun.castShadow = true
  sun.shadow.mapSize.set(3072, 3072)
  sun.shadow.bias = -0.0004
  sun.shadow.radius = 3
  sun.shadow.normalBias = 0.02
  Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 60, bottom: -60, near: 1, far: 180 })
  sun.shadow.camera.updateProjectionMatrix()
  scene.add(sun)

  // ground, yard, road
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), M.ground)
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)
  flat(scene, 72, 33, M.yard, 0, -1.5, 0.005)
  flat(scene, 260, 6.4, M.road, 0, 18.6, 0.01)
  flat(scene, 6.4, 46, M.road, 37, -7.5, 0.012)
  for (let x = -120; x < 120; x += 5) flat(scene, 2.2, 0.18, M.white, x, 18.6, 0.02)
  for (let z = -28; z < 14; z += 5) flat(scene, 0.18, 2.2, M.white, 37, z, 0.02)
  // grass patches
  flat(scene, 30, 10, M.grass, -6, -26, 0.006)
  flat(scene, 44, 8, M.grass, 60, -34, 0.006)
  flat(scene, 40, 8, M.grass, 4, 27, 0.006)

  // parking bays (yellow outlines)
  const bayOutline = (cx: number, cz: number, w: number, d: number) => {
    flat(scene, w, 0.14, M.yellow, cx, cz - d / 2, 0.02)
    flat(scene, w, 0.14, M.yellow, cx, cz + d / 2, 0.02)
    flat(scene, 0.14, d, M.yellow, cx - w / 2, cz, 0.02)
    flat(scene, 0.14, d, M.yellow, cx + w / 2, cz, 0.02)
  }
  bayOutline(-3.9, 9.4, 10.8, 3.4)
  bayOutline(-3.9, 13.4, 10.8, 3.4)
  // forklift lane
  for (let x = 2; x < 13; x += 1.6) flat(scene, 0.9, 0.12, M.yellow, x, 6.4, 0.02)
  for (const [txt, z] of [["Bay 1", 9.4], ["Bay 2", 13.4]] as const) {
    const { obj } = chip(`<span class="font-semibold text-[#c9d1e2]">${txt}</span>`, "bg-card/75 px-2 py-0.5 text-[10px]")
    obj.position.set(-10.6, 0.2, z)
    scene.add(obj)
  }

  // ---------------------------------------------------------------- buildings

  function hall(w: number, d: number, h: number, rise: number) {
    const g = new THREE.Group()
    block(g, w + 0.6, 0.3, d + 0.6, M.concrete)
    block(g, w, h, d, M.blue, 0, 0.3, 0)
    block(g, w + 0.02, 0.5, d + 0.02, M.navy, 0, 0.3, 0)
    const half = d / 2 + 0.5
    const slope = Math.hypot(half, rise)
    const ang = Math.atan2(rise, half)
    const slabs: THREE.Group[] = []
    for (const s of [-1, 1]) {
      const slab = new THREE.Group()
      slab.position.set(0, h + 0.3 + rise / 2, (s * half) / 2)
      slab.rotation.x = s * ang
      block(slab, w + 0.8, 0.25, slope, M.roof, 0, -0.125, 0)
      for (let x = -w / 2; x <= w / 2 + 0.01; x += 1.5) block(slab, 0.14, 0.12, slope, M.rib, x, 0.12, 0)
      g.add(slab)
      slabs.push(slab)
    }
    const tri = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(0, rise)])
    const gable = new THREE.Mesh(new THREE.ExtrudeGeometry(tri, { depth: w, bevelEnabled: false }), M.blue)
    gable.rotation.y = -Math.PI / 2
    gable.position.set(w / 2, h + 0.3, 0)
    gable.castShadow = gable.receiveShadow = true
    g.add(gable)
    scene.add(g)
    return { g, front: slabs[1] }
  }

  const main = hall(22, 11, 4.2, 1.7)
  main.g.position.set(0, 0, -7)
  // roof logo
  const logoTex = canvasTex(512, 512, (c) => {
    c.fillStyle = "#ffffff"
    c.beginPath()
    c.ellipse(256, 256, 250, 250, 0, 0, Math.PI * 2)
    c.fill()
    drawCube(c, 256, 230, 120, "#f3c79a", "#f28a3c", "#26365f")
    c.fillStyle = "#26365f"
    c.font = "bold 64px system-ui, sans-serif"
    c.textAlign = "center"
    c.fillText("WH-01", 256, 440)
  })
  textures.push(logoTex)
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshStandardMaterial({ map: logoTex, transparent: true, roughness: 0.6 }))
  logo.rotation.x = -Math.PI / 2
  logo.position.set(2, 0.27, 0)
  main.front.add(logo)
  // dock doors + awning on the front (+z) wall at z = -1.5
  for (const [i, x] of [-7.5, -2.5, 2.5, 7.5].entries()) {
    block(scene, 3.3, 3.4, 0.14, M.white, x, 0.3, -1.45)
    block(scene, 2.8, 2.95, 0.16, M.door, x, 0.3, -1.42)
    for (let k = 0; k < 6; k++) block(scene, 2.8, 0.05, 0.17, M.dark, x, 0.75 + k * 0.45, -1.41)
    const { obj } = chip(`<span class="font-semibold text-primary">D${i + 1}</span>`, "bg-card/90 px-1.5 py-0.5 text-[10px]")
    obj.position.set(x, 4.8, -1.3)
    scene.add(obj)
    block(scene, 0.5, 0.18, 0.2, M.lamp, x, 3.95, -1.35)
  }
  block(scene, 22.6, 0.14, 1.5, M.white, 0, 4.3, -0.8)
  // annex hall, ridge along z
  const annex = hall(10, 9, 5, 1.8)
  annex.g.position.set(-16.2, 0, -9)
  annex.g.rotation.y = Math.PI / 2
  block(scene, 3, 3.2, 0.14, M.white, -16.2, 0.3, -3.95)
  block(scene, 2.5, 2.8, 0.16, M.door, -16.2, 0.3, -3.92)

  // pallets ---------------------------------------------------------
  function pallet(parent: THREE.Object3D, x: number, z: number, o: { blue?: boolean; layers?: number; rot?: number } = {}) {
    const g = new THREE.Group()
    g.position.set(x, 0, z)
    g.rotation.y = o.rot ?? 0
    block(g, 1.3, 0.16, 1.1, o.blue ? M.navy : M.wood)
    for (let l = 0; l < (o.layers ?? 2); l++)
      for (const i of [-1, 1])
        for (const j of [-1, 1]) {
          const m = o.blue ? M.blue : r() > 0.5 ? M.carton : M.carton2
          const c = block(g, 0.6, 0.44, 0.52, m, i * 0.32 + (r() - 0.5) * 0.03, 0.16 + l * 0.45, j * 0.27 + (r() - 0.5) * 0.03, G.carton)
          c.rotation.y = (r() - 0.5) * 0.06
        }
    parent.add(g)
    return g
  }
  // staging row in front of the docks (FL-01 picks the one at x = 8)
  const staging = new Map<number, THREE.Group>()
  for (const x of [3.2, 4.8, 6.4, 8, 9.6]) staging.set(x, pallet(scene, x, 2.6, { layers: x === 8 ? 2 : 1 + Math.round(r()) }))
  for (const [x, z] of [[-7.5, -0.4], [2.5, -0.4], [-9.2, 3.2], [-7.6, 3.2], [-9.2, 4.6]]) pallet(scene, x, z, { layers: 2 })
  for (const [x, z] of [[25.2, 0.2], [25.2, 1.8], [26.8, 0.2], [26.8, 1.8], [25.2, 5.6], [26.8, 5.6]]) pallet(scene, x, z, { blue: true, layers: 2 })
  for (const [x, z] of [[14.5, -12], [16.1, -12], [14.5, -13.6]]) pallet(scene, x, z, { blue: true, layers: 3 })
  const pal1026 = chip(`<b class="text-[#f4efe4]">PAL-1026</b> Event kits`)
  pal1026.obj.position.set(-8.4, 1.9, 3.9)
  scene.add(pal1026.obj)

  // rack (two bays, three levels)
  {
    const g = new THREE.Group()
    g.position.set(17, 0, -2)
    for (const x of [-3, 0, 3]) for (const z of [-0.75, 0.75]) block(g, 0.14, 4.6, 0.14, M.blue, x, 0, z)
    for (const y of [0.15, 1.65, 3.15])
      for (const z of [-0.75, 0.75]) block(g, 6.2, 0.14, 0.12, M.beam, 0, y + 0.1, z)
    for (const y of [0.25, 1.75, 3.25]) for (const x of [-1.5, 1.5]) if (r() > 0.15) pallet(g, x, 0, { layers: 2 }).position.y = y
    scene.add(g)
  }

  // container
  const stripes = canvasTex(512, 128, (c) => {
    c.fillStyle = "#14b8a6"
    c.fillRect(0, 0, 512, 128)
    for (let x = 0; x < 512; x += 16) {
      c.fillStyle = "rgba(0,0,0,0.12)"
      c.fillRect(x, 0, 6, 128)
    }
  })
  stripes.wrapS = THREE.RepeatWrapping
  stripes.repeat.set(3, 1)
  textures.push(stripes)
  const container = block(scene, 12, 2.9, 2.6, new THREE.MeshStandardMaterial({ map: stripes, roughness: 0.7 }), -25, 0, 4)
  container.rotation.y = 0.32

  // trees + light poles
  const trees: [number, number, number][] = [
    [-30, -14, 1.2], [-24, -20, 1], [-17, -22, 1.3], [-9, -21, 0.9], [-2, -23, 1.2], [6, -21, 1], [13, -22, 1.3], [21, -19, 1.1],
    [28, -16, 1], [31, -6, 1.2], [31, 4, 0.9], [50, -32, 1.1], [62, -33, 1.2], [74, -32, 1], [81, -24, 1.2], [82, -10, 1], [81, 4, 1.1], [80, 12, 0.9], [-33, -2, 1.1], [-34, 8, 1], [-31, 9, 0.9],
    [14, 9, 0.8], [17, 10.5, 0.9], [-14, 26, 1.1], [10, 27, 1], [24, 26, 1.2], [-38, 24, 1],
  ]
  for (const [x, z, s] of trees) {
    cyl(scene, 0.16 * s, 1.4 * s, M.trunk, x, 0.7 * s, z)
    const crown = new THREE.Mesh(G.sphere, r() > 0.5 ? M.leaf : M.leaf2)
    crown.scale.set(1.05 * s, 1.6 * s, 1.05 * s)
    crown.position.set(x, 2.6 * s, z)
    crown.castShadow = true
    scene.add(crown)
  }
  for (const x of [-20, -8, 4, 16, 28]) {
    cyl(scene, 0.08, 6, M.grey, x, 3, 22.8)
    block(scene, 0.3, 0.12, 0.9, M.lamp, x, 6, 22.4)
  }

  // map pins
  const pins: THREE.Group[] = []
  for (const [x, z] of [[-7.5, -0.4], [2.5, -0.4], [26, 1]]) {
    const p = new THREE.Group()
    p.position.set(x, 3, z)
    const head = new THREE.Mesh(G.sphere, M.blue)
    head.scale.setScalar(0.5)
    head.position.y = 0.75
    const tip = new THREE.Mesh(G.cone, M.blue)
    tip.scale.set(0.36, 0.9, 0.36)
    tip.rotation.x = Math.PI
    tip.position.y = 0.2
    const dot = new THREE.Mesh(G.sphere, M.white)
    dot.scale.setScalar(0.2)
    dot.position.set(0.24, 0.8, 0.24)
    p.add(head, tip, dot)
    p.traverse((o) => (o.castShadow = true))
    scene.add(p)
    pins.push(p)
  }

  // ---------------------------------------------------------------- vehicles

  /** ring = selection-ring scale (0 hides it), focus = camera distance when flying to it. */
  const entities = new Map<string, { root: THREE.Object3D; ring: number; focus: number }>()
  const pickables: THREE.Object3D[] = []
  function register(id: string, root: THREE.Object3D, ring = 1, focus = 46) {
    root.userData.entityId = id
    entities.set(id, { root, ring, focus })
    pickables.push(root)
  }

  function forkliftModel() {
    const g = new THREE.Group()
    block(g, 1.5, 0.75, 1.1, M.fork, -0.15, 0.25, 0)
    block(g, 0.35, 0.8, 1.12, M.dark, -0.95, 0.2, 0)
    block(g, 0.5, 0.35, 0.9, M.dark, -0.35, 1.0, 0) // seat
    for (const [x, z] of [[-0.75, -0.48], [-0.75, 0.48], [0.45, -0.48], [0.45, 0.48]]) block(g, 0.07, 1.15, 0.07, M.dark, x, 1.0, z)
    block(g, 1.35, 0.07, 1.06, M.dark, -0.15, 2.15, 0)
    // driver
    cyl(g, 0.22, 0.55, M.vest, -0.3, 1.6, 0)
    const head = new THREE.Mesh(G.sphere, M.skin)
    head.scale.setScalar(0.16)
    head.position.set(-0.28, 2.0, 0)
    const helmet = new THREE.Mesh(G.sphere, M.fork)
    helmet.scale.set(0.18, 0.1, 0.18)
    helmet.position.set(-0.28, 2.08, 0)
    g.add(head, helmet)
    // wheels
    for (const [x, z] of [[0.35, -0.56], [0.35, 0.56], [-0.75, -0.56], [-0.75, 0.56]]) cyl(g, 0.27, 0.22, M.rubber, x, 0.27, z, true)
    // mast + carriage
    for (const z of [-0.36, 0.36]) block(g, 0.09, 2.3, 0.09, M.grey, 0.67, 0.1, z)
    const carriage = new THREE.Group()
    carriage.position.set(0.75, 0.15, 0)
    block(carriage, 0.06, 0.75, 0.95, M.dark, 0.02, 0, 0)
    for (const z of [-0.28, 0.28]) block(carriage, 1.15, 0.05, 0.12, M.grey, 0.6, 0, z)
    const load = pallet(carriage, 0.6, 0, { layers: 2, rot: Math.PI / 2 })
    load.position.y = 0.05
    load.visible = false
    g.add(carriage)
    g.traverse((o) => (o.castShadow = true))
    scene.add(g)
    return { root: g, carriage, load }
  }

  function truckModel(cab: THREE.Material, logo: THREE.Texture) {
    textures.push(logo)
    const g = new THREE.Group()
    const side = new THREE.MeshStandardMaterial({ map: logo, roughness: 0.6 })
    block(g, 9.4, 0.35, 1.6, M.dark, 0.85, 0.55, 0)
    block(g, 7, 2.9, 2.5, [M.white, M.white, M.white, M.white, side, side], -0.4, 0.95, 0)
    block(g, 2.3, 2.1, 2.4, cab, 4.35, 0.75, 0)
    block(g, 1.3, 0.55, 2.3, cab, 3.95, 2.85, 0)
    block(g, 0.05, 0.85, 2.1, M.glass, 5.51, 1.8, 0)
    block(g, 0.85, 0.7, 2.42, M.glass, 4.75, 1.85, 0)
    block(g, 0.25, 0.35, 2.45, M.dark, 5.55, 0.5, 0)
    for (const z of [-0.85, 0.85]) block(g, 0.06, 0.18, 0.4, M.lamp, 5.53, 1.0, z)
    for (const x of [4.6, -2.4, -3.35]) for (const z of [-1.08, 1.08]) cyl(g, 0.5, 0.36, M.rubber, x, 0.5, z, true)
    g.traverse((o) => (o.castShadow = true))
    scene.add(g)
    return g
  }

  // ---- forklifts: scripted step loops (drive / fork / hold)
  type Step =
    | { kind: "drive"; path: THREE.CatmullRomCurve3; reverse?: boolean; speed: number; label: string }
    | { kind: "fork"; to: number; dur: number; label: string; event?: "pick" | "drop" }
    | { kind: "hold"; dur?: number; until?: () => boolean; label: string }

  interface Lift {
    info: ForkliftInfo
    root: THREE.Group
    carriage: THREE.Group
    load: THREE.Group
    tag: { obj: CSS2DObject; el: HTMLElement }
    steps: Step[]
    i: number
    t: number
    from: number
    last: THREE.Vector3
    onEvent?: (e: "pick" | "drop") => void
  }

  const lifts: Lift[] = []
  function makeLift(info: Omit<ForkliftInfo, "kind" | "status" | "carrying" | "speedKmh">, steps: Step[], onEvent?: Lift["onEvent"]) {
    const m = forkliftModel()
    const tag = chip("")
    tag.obj.position.set(0, 2.9, 0)
    m.root.add(tag.obj)
    const first = steps[0] as Extract<Step, { kind: "drive" }>
    const p0 = first.path.getPointAt(0)
    const t0 = first.path.getTangentAt(0)
    m.root.position.copy(p0)
    m.root.rotation.y = yawOf(t0.x, t0.z)
    const lift: Lift = {
      info: { ...info, kind: "forklift", status: "", carrying: "Empty", speedKmh: 0 },
      ...m,
      tag,
      steps,
      i: 0,
      t: 0,
      from: m.carriage.position.y,
      last: p0.clone(),
      onEvent,
    }
    register(info.id, m.root)
    lifts.push(lift)
    return lift
  }

  function stepLift(l: Lift, dt: number) {
    const s = l.steps[l.i]
    l.t += dt
    let done = false
    if (s.kind === "drive") {
      const dur = (s.path.getLength() / s.speed) * 1.3
      const k = ease(l.t / dur)
      const p = s.path.getPointAt(k)
      const tan = s.path.getTangentAt(Math.min(Math.max(k, 0.001), 0.999))
      l.root.position.copy(p)
      const yaw = yawOf(tan.x, tan.z) + (s.reverse ? Math.PI : 0)
      l.root.rotation.y = dampAngle(l.root.rotation.y, yaw, 7, dt)
      done = l.t >= dur
    } else if (s.kind === "fork") {
      l.carriage.position.y = THREE.MathUtils.lerp(l.from, s.to, ease(l.t / s.dur))
      done = l.t >= s.dur
      if (done && s.event) {
        l.load.visible = s.event === "pick"
        l.info.carrying = s.event === "pick" ? `PAL-${1027 + l.info.moves}` : "Empty"
        if (s.event === "drop") l.info.moves++
        l.onEvent?.(s.event)
      }
    } else {
      done = s.until ? s.until() : l.t >= (s.dur ?? 0)
    }
    // telemetry
    const v = (l.root.position.distanceTo(l.last) / Math.max(dt, 1e-3)) * 3.6
    l.info.speedKmh = THREE.MathUtils.lerp(l.info.speedKmh, v, 1 - Math.exp(-dt * 4))
    l.last.copy(l.root.position)
    if (v > 0.5) l.info.battery = Math.max(5, l.info.battery - dt * 0.012)
    if (done) {
      l.i = (l.i + 1) % l.steps.length
      l.t = 0
      l.from = l.carriage.position.y
    }
    const label = l.steps[l.i].label
    if (label !== l.info.status) {
      l.info.status = label
      l.tag.el.innerHTML = `<b class="text-primary">${l.info.id}</b> ${label}`
    }
  }

  // ---- trucks: per-bay state machines
  interface TruckActor {
    info: TruckInfo
    root: THREE.Group
    tag: { obj: CSS2DObject; el: HTMLElement }
    arrive: THREE.CatmullRomCurve3
    depart: THREE.CatmullRomCurve3
    t: number
    timer: number
  }

  function makeTruck(info: Omit<TruckInfo, "kind">, cab: THREE.Material, logo: THREE.Texture, arrive: THREE.CatmullRomCurve3, depart: THREE.CatmullRomCurve3) {
    const root = truckModel(cab, logo)
    const tag = chip("")
    tag.obj.position.set(1, 4.3, 0)
    root.add(tag.obj)
    const a: TruckActor = { info: { ...info, kind: "truck" }, root, tag, arrive, depart, t: 0, timer: 0 }
    register(info.id, root, 2.6)
    return a
  }

  function placeOn(a: TruckActor, path: THREE.CatmullRomCurve3, k: number) {
    const p = path.getPointAt(k)
    const tan = path.getTangentAt(Math.min(Math.max(k, 0.001), 0.999))
    a.root.position.copy(p)
    a.root.rotation.y = yawOf(tan.x, tan.z)
  }

  function setTruckId(a: TruckActor, id: string) {
    entities.delete(a.info.id)
    a.info.id = id
    a.root.userData.entityId = id
    entities.set(id, { root: a.root, ring: 2.6, focus: 46 })
  }

  /** Advances a truck along a path; returns true when the path is finished. */
  function driveTruck(a: TruckActor, path: THREE.CatmullRomCurve3, dt: number, speed: number) {
    const dur = (path.getLength() / speed) * 1.25
    a.t += dt
    const k = ease(a.t / dur)
    placeOn(a, path, k)
    return a.t >= dur
  }

  const ROAD = 16.9
  const out = makeTruck(
    { id: "TRK-2051", carrier: "BoomBigNose", bay: "Bay 1", direction: "outbound", state: "Loading", loaded: 2, capacity: 6, eta: null },
    M.blue,
    sideTexture("BoomBigNose", "#f28a3c", "Logistics · Bangkok"),
    curve([[80, ROAD], [30, ROAD], [14, 14.6], [5, 9.9], [-3, 9.4]]),
    curve([[-3, 9.4], [-14, 9.5], [-24, 12.6], [-34, ROAD], [-90, ROAD]]),
  )
  placeOn(out, out.arrive, 1)

  const inb = makeTruck(
    { id: "TRK-2287", carrier: "Rattana Freight", bay: "Bay 2", direction: "inbound", state: "En route", loaded: 6, capacity: 6, eta: 120 },
    M.white,
    sideTexture("Rattana", "#0d9488", "Freight & distribution"),
    curve([[80, ROAD], [28, ROAD], [12, 15.6], [4, 13.6], [-3, 13.4]]),
    curve([[-3, 13.4], [-14, 13.5], [-26, ROAD], [-90, ROAD]]),
  )
  inb.root.visible = false
  inb.timer = 120 / SIM_SPEED

  // ambient traffic on the far lane (not selectable)
  const passer = truckModel(M.teal, sideTexture("Rattana", "#0d9488", "Freight & distribution"))
  passer.scale.setScalar(0.85)
  let passerX = -60

  // ---- simulation state
  let sim = SIM_START
  let stock = 1412
  const stock0 = stock
  let truckSeq = 2051
  let inboundSeq = 2287
  let shipSeq = 78442
  const cities = ["Chonburi", "Ayutthaya", "Chiang Mai", "Khon Kaen", "Hat Yai"]
  let cycle = 13 // seconds per pallet cycle (EMA of measured drops)
  let lastDrop = 0
  let clockT = 0
  const shipment: ShipmentInfo = {
    no: "#SHP-78442",
    to: cities[0],
    truckId: out.info.id,
    step: 2,
    loaded: 2,
    capacity: 6,
    confirmedAt: SIM_START - (2 * 3600 + 51 * 60),
    pickedAt: SIM_START - (60 * 80),
    loadEta: 0,
  }

  const bay1Ready = () => out.info.state === "Loading" && out.info.loaded < out.info.capacity

  // FL-01 shuttles pallets from the staging row into the truck at Bay 1.
  const fl01 = makeLift(
    { id: "FL-01", operator: "Somchai K.", model: "EV-18 electric", moves: 27, battery: 75, charger: "C1" },
    [
      { kind: "drive", path: curve([[5.2, 11.0], [4.9, 8.4], [6.6, 6.6], [7.9, 5.6], [8, 3.95]]), speed: 2.4, label: "Returning to staging" },
      { kind: "fork", to: 0.12, dur: 0.5, label: "Picking pallet" },
      { kind: "fork", to: 0.5, dur: 0.8, label: "Picking pallet", event: "pick" },
      { kind: "drive", path: curve([[8, 3.95], [8.2, 6.0], [9.2, 7.3], [10.6, 7.7]]), reverse: true, speed: 1.6, label: "Picking pallet" },
      { kind: "hold", until: bay1Ready, label: "Waiting for truck" },
      { kind: "drive", path: curve([[10.6, 7.7], [6.5, 8.9], [4.2, 9.4], [1.65, 9.4]]), speed: 2.4, label: "Loading truck" },
      { kind: "fork", to: 1.1, dur: 0.7, label: "Loading truck" },
      { kind: "fork", to: 1.0, dur: 0.3, label: "Loading truck", event: "drop" },
      { kind: "drive", path: curve([[1.65, 9.4], [4.0, 9.7], [5.2, 11.0]]), reverse: true, speed: 1.6, label: "Returning to staging" },
      { kind: "fork", to: 0.3, dur: 0.6, label: "Returning to staging" },
    ],
    (e) => {
      const slot = staging.get(8)!
      if (e === "pick") slot.visible = false
      if (e !== "drop") return
      slot.visible = true
      out.info.loaded++
      shipment.loaded = out.info.loaded
      stock--
      const now = clockT
      if (lastDrop) cycle = THREE.MathUtils.lerp(cycle, now - lastDrop, 0.4)
      lastDrop = now
    },
  )
  fl01.carriage.position.y = 0.3
  fl01.from = 0.3

  // FL-02 runs a cycle-count loop around the rack.
  makeLift(
    { id: "FL-02", operator: "Wan P.", model: "EV-20 electric", moves: 14, battery: 58, charger: "C2" },
    [
      { kind: "drive", path: curve([[12.8, 2.4], [18, 2.6], [22, 1.6], [22.6, -2.2]]), speed: 2.2, label: "Cycle count · Rack A" },
      { kind: "fork", to: 1.7, dur: 1.4, label: "Scanning Rack A" },
      { kind: "hold", dur: 1.2, label: "Scanning Rack A" },
      { kind: "fork", to: 0.2, dur: 1.2, label: "Scanning Rack A" },
      { kind: "drive", path: curve([[22.6, -2.2], [20, -4.8], [14.5, -5.0], [12.3, -2.2], [12.8, 2.4]]), speed: 2.2, label: "Cycle count · Rack A" },
      { kind: "hold", dur: 1.5, label: "Idle" },
    ],
  )

  function updateTrucks(dt: number) {
    // outbound at Bay 1
    const o = out.info
    if (o.state === "Arriving" && driveTruck(out, out.arrive, dt, 7)) o.state = "Loading"
    else if (o.state === "Loading" && o.loaded >= o.capacity) {
      out.timer += dt
      if (out.timer > 1.5) {
        o.state = "Departing"
        out.t = 0
        shipment.step = 3
      }
    } else if (o.state === "Departing" && driveTruck(out, out.depart, dt, 7)) {
      o.state = "Departed"
      out.root.visible = false
      out.timer = 0
    } else if (o.state === "Departed") {
      out.timer += dt
      if (out.timer > 4) {
        setTruckId(out, `TRK-${++truckSeq}`)
        Object.assign(o, { state: "Arriving", loaded: 0 })
        Object.assign(shipment, {
          no: `#SHP-${++shipSeq}`,
          to: cities[(shipSeq - 78442) % cities.length],
          truckId: o.id,
          step: 2,
          loaded: 0,
          confirmedAt: sim - (2 * 3600 + 51 * 60),
          pickedAt: sim - 60 * 80,
        })
        out.t = 0
        out.timer = 0
        out.root.visible = true
      }
    }
    if (o.state === "Loading" || o.state === "Arriving")
      shipment.loadEta = sim + (o.capacity - o.loaded) * cycle * SIM_SPEED

    // inbound at Bay 2
    const n = inb.info
    if (n.state === "En route") {
      inb.timer -= dt
      n.eta = Math.max(0, inb.timer * SIM_SPEED)
      if (inb.timer <= 0) {
        n.state = "Arriving"
        n.eta = null
        inb.t = 0
        inb.root.visible = true
      }
    } else if (n.state === "Arriving" && driveTruck(inb, inb.arrive, dt, 7)) {
      n.state = "Unloading"
      inb.timer = 10
    } else if (n.state === "Unloading") {
      inb.timer -= dt
      const left = Math.ceil(Math.max(inb.timer, 0) / (10 / n.capacity))
      if (left < n.loaded) {
        stock += 2 * (n.loaded - left)
        n.loaded = left
      }
      if (inb.timer <= 0) {
        n.state = "Departing"
        inb.t = 0
      }
    } else if (n.state === "Departing" && driveTruck(inb, inb.depart, dt, 7)) {
      inb.root.visible = false
      setTruckId(inb, `TRK-${++inboundSeq}`)
      Object.assign(n, { state: "En route", loaded: n.capacity })
      inb.timer = 26
      n.eta = inb.timer * SIM_SPEED
    }
    for (const a of [out, inb]) {
      const html = `<b class="text-[#f4efe4]">${a.info.id}</b> ${a.info.state}`
      if (a.tag.el.innerHTML !== html) a.tag.el.innerHTML = html
    }

    passerX += dt * 9
    if (passerX > 90) passerX = -90
    passer.position.set(passerX, 0, 20.3)
  }

  const office = buildOffice({
    scene,
    textures,
    simSpeed: SIM_SPEED,
    register,
    onZoneClick: (id) => {
      api.select(id, true)
      opts.onSelect(id)
    },
  })

  // ---------------------------------------------------------------- camera motion

  interface View { target: THREE.Vector3; radius: number; phi: number; theta: number }
  const homeView = (): View => ({
    target: new THREE.Vector3(34, 0, -9),
    radius: camera.aspect < 1 ? 230 : 132,
    phi: 0.93,
    theta: Math.PI / 4,
  })
  const sph = new THREE.Spherical()
  function currentView(): View {
    sph.setFromVector3(camera.position.clone().sub(controls.target))
    return { target: controls.target.clone(), radius: sph.radius, phi: sph.phi, theta: sph.theta }
  }
  function applyView(v: View) {
    controls.target.copy(v.target)
    camera.position.copy(v.target).add(new THREE.Vector3().setFromSphericalCoords(v.radius, v.phi, v.theta))
  }
  let tween: { from: View; to: View; t: number; dur: number } | null = null
  function flyTo(to: Partial<View>, dur = 1.2) {
    const from = currentView()
    const goal = { ...from, ...to }
    goal.theta = from.theta + Math.atan2(Math.sin(goal.theta - from.theta), Math.cos(goal.theta - from.theta))
    tween = { from, to: goal, t: 0, dur }
  }

  let followId: string | null = null
  let selectedId: string | null = null
  let lastInput = performance.now()
  const ring = new THREE.Mesh(G.ring, M.select)
  ring.rotation.x = -Math.PI / 2
  ring.visible = false
  scene.add(ring)

  controls.addEventListener("start", () => {
    tween = null
    followId = null
    controls.autoRotate = false
    lastInput = performance.now()
  })

  // intro: swoop down from a high, rotated vantage
  const resize = () => {
    const w = host.clientWidth
    const h = host.clientHeight
    renderer.setSize(w, h)
    labels.setSize(w, h)
    camera.aspect = w / Math.max(h, 1)
    camera.updateProjectionMatrix()
  }
  resize()
  const ro = new ResizeObserver(resize)
  ro.observe(host)
  if (opts.reducedMotion) applyView(homeView())
  else {
    const h = homeView()
    applyView({ ...h, radius: h.radius * 2, phi: 0.3, theta: h.theta - 1.4 })
    flyTo(h, 3.2)
  }

  // picking
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  function pick(ev: PointerEvent): string | null {
    const rect = renderer.domElement.getBoundingClientRect()
    ndc.set(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    let o: THREE.Object3D | null = ray.intersectObjects(pickables, true)[0]?.object ?? null
    while (o && !o.userData.entityId) o = o.parent
    return o && o.visible ? (o.userData.entityId as string) : null
  }
  let down: { x: number; y: number } | null = null
  const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY })
  const onUp = (e: PointerEvent) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return
    const id = pick(e)
    if (id) {
      api.select(id, true)
      opts.onSelect(id)
    }
  }
  const onMove = (e: PointerEvent) => {
    if (e.buttons) return
    renderer.domElement.style.cursor = pick(e) ? "pointer" : "grab"
  }
  renderer.domElement.addEventListener("pointerdown", onDown)
  renderer.domElement.addEventListener("pointerup", onUp)
  renderer.domElement.addEventListener("pointermove", onMove)

  // ---------------------------------------------------------------- loop

  let last = performance.now()
  let raf = 0
  let snapT = 0
  const tmp = new THREE.Vector3()
  function frame(now = performance.now()) {
    raf = requestAnimationFrame(frame)
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    clockT += dt
    sim += dt * SIM_SPEED

    for (const l of lifts) stepLift(l, dt)
    updateTrucks(dt)
    office.update(dt, clockT, sim)
    pins.forEach((p, i) => (p.position.y = 2.9 + Math.sin(clockT * 2.2 + i) * 0.25))

    if (tween) {
      tween.t += dt
      const k = easeCubic(Math.min(tween.t / tween.dur, 1))
      const { from: a, to: b } = tween
      applyView({
        target: a.target.clone().lerp(b.target, k),
        radius: THREE.MathUtils.lerp(a.radius, b.radius, k),
        phi: THREE.MathUtils.lerp(a.phi, b.phi, k),
        theta: THREE.MathUtils.lerp(a.theta, b.theta, k),
      })
      if (k >= 1) tween = null
    } else if (followId) {
      const e = entities.get(followId)
      if (e?.root.visible) {
        tmp.copy(e.root.position).setY(0).sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 4))
        controls.target.add(tmp)
        camera.position.add(tmp)
      }
    } else if (!opts.reducedMotion && performance.now() - lastInput > 25000) controls.autoRotate = true

    const sel = selectedId ? entities.get(selectedId) : null
    ring.visible = !!sel?.ring && sel.root.visible
    if (sel) {
      ring.position.set(sel.root.position.x, sel.root.position.y + 0.04, sel.root.position.z)
      ring.scale.setScalar(sel.ring * (1 + Math.sin(clockT * 4) * 0.06))
    }

    controls.update(dt)
    renderer.render(scene, camera)
    labels.render(scene, camera)

    snapT += dt
    if (snapT > 0.2) {
      snapT = 0
      opts.onSnapshot({
        ...office.snapshot(),
        sim,
        stock,
        stockDelta: stock - stock0,
        forklifts: lifts.map((l) => ({ ...l.info, battery: Math.round(l.info.battery), speedKmh: Math.round(l.info.speedKmh * 10) / 10 })),
        trucks: [out, inb].map((a) => ({ ...a.info })),
        shipment: { ...shipment },
      })
    }
  }
  frame()

  const api: WarehouseScene = {
    zoom(f) {
      const v = currentView()
      flyTo({ radius: THREE.MathUtils.clamp(v.radius * f, controls.minDistance, controls.maxDistance) }, 0.5)
    },
    rotate(dir) {
      flyTo({ theta: currentView().theta + (dir * Math.PI) / 4 }, 0.9)
    },
    home() {
      followId = null
      flyTo(homeView(), 1.4)
    },
    select(id, focus = false) {
      selectedId = id
      office.highlight(id)
      lastInput = performance.now()
      controls.autoRotate = false
      const e = id ? entities.get(id) : null
      if (!e || !focus) return
      followId = id
      flyTo({ target: e.root.position.clone().setY(0), radius: Math.min(currentView().radius, e.focus) }, 1.1)
    },
    dispose() {
      cancelAnimationFrame(raf)
      ro.disconnect()
      renderer.domElement.removeEventListener("pointerdown", onDown)
      renderer.domElement.removeEventListener("pointerup", onUp)
      renderer.domElement.removeEventListener("pointermove", onMove)
      controls.dispose()
      const geos = new Set<THREE.BufferGeometry>()
      const mats = new Set<THREE.Material>()
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          geos.add(o.geometry)
          for (const m of [o.material].flat()) mats.add(m)
        }
        if (o instanceof CSS2DObject) o.element.remove()
      })
      // G is module-level and shared across mounts — keep it.
      const shared = new Set<THREE.BufferGeometry>(Object.values(G))
      geos.forEach((g) => !shared.has(g) && g.dispose())
      mats.forEach((m) => m.dispose())
      textures.forEach((t) => t.dispose())
      renderer.dispose()
      renderer.domElement.remove()
      labels.domElement.remove()
    },
  }
  return api
}
