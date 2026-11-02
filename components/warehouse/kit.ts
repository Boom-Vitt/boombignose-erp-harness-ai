import * as THREE from "three"
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js"

/** Shared helpers for the radial campus scene: layout constants, materials, polar paths. */

// ---------------------------------------------------------------- layout (world units ≈ metres)

export const LAY = {
  /** Deck height of every elevated surface (plinths, walkways, podium). */
  deck: 3,
  podium: 11.5,
  tower: 6.2,
  /** Elevated ring walkway (centre radius, half width). */
  ring: 19.1,
  ringHalf: 1.1,
  pavilion: 31,
  plinth: 8.6,
  /** Logistics loop: lane radii. Outbound runs counter-clockwise on the outer lane, inbound clockwise on the inner. */
  laneOut: 53.5,
  laneIn: 49.5,
  roadIn: 47.2,
  roadOut: 55.8,
  /** Stacker service lane between road and vault. */
  service: 58.6,
  vaultIn: 60,
  tier: 6,
  tierRise: 1.8,
  vaultCenter: (130 * Math.PI) / 180,
  vaultSpan: (150 * Math.PI) / 180,
  gateA: (105 * Math.PI) / 180,
  gateB: (150 * Math.PI) / 180,
  portalIn: (40 * Math.PI) / 180,
  portalOut: (215 * Math.PI) / 180,
}

export const COLOR = {
  bg: "#0B1222",
  navy: "#16213d",
  navyDeep: "#101a31",
  slate: "#22305a",
  slateLite: "#33477e",
  gold: "#f5b941",
  orange: "#ff8a3d",
  ice: "#cfdcff",
  mint: "#5ee0a8",
}

// ---------------------------------------------------------------- materials

export const std = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0.1, ...extra })

export const glass = (tint = "#4a6bb8") =>
  new THREE.MeshStandardMaterial({
    color: tint,
    emissive: "#1d3263",
    emissiveIntensity: 0.35,
    roughness: 0.12,
    metalness: 0.55,
    transparent: true,
    opacity: 0.26,
    depthWrite: false,
    side: THREE.DoubleSide,
  })

export const glow = (color: THREE.ColorRepresentation, opacity = 1, additive = false) =>
  new THREE.MeshBasicMaterial({
    color,
    transparent: opacity < 1 || additive,
    opacity,
    depthWrite: !additive && opacity >= 1,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    fog: !additive,
  })

export const lineMat = (color: THREE.ColorRepresentation, opacity = 0.9) =>
  new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false })

// ---------------------------------------------------------------- geometry helpers

/** Add the sharp-edge outline of `mesh` as emissive line work. */
export function edges(mesh: THREE.Mesh, material: THREE.LineBasicMaterial, angle = 28) {
  const l = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry, angle), material)
  mesh.add(l)
  return l
}

/** Thin flat ring line lying on y; an arc of `arc` radians starting at scene angle `a0`. */
export function ringLine(parent: THREE.Object3D, r: number, y: number, m: THREE.Material, tube = 0.07, arc = Math.PI * 2, a0 = 0) {
  const t = new THREE.Mesh(new THREE.TorusGeometry(r, tube, 6, Math.max(24, Math.round(r * arc * 0.7)), arc), m)
  t.rotation.x = Math.PI / 2
  t.rotation.z = a0
  t.position.y = y
  parent.add(t)
  return t
}

/** Flat annulus lying on y, optionally an arc starting at scene angle `a0` (counter-clockwise from +x). */
export function annulus(parent: THREE.Object3D, r0: number, r1: number, y: number, m: THREE.Material, a0 = 0, span = Math.PI * 2) {
  // the mesh is laid flat by rotating -90° about x, which mirrors the ring angle: scene α = -φ
  const g = new THREE.RingGeometry(r0, r1, Math.max(24, Math.round(span * r1 * 0.6)), 1, -(a0 + span), span)
  const mesh = new THREE.Mesh(g, m)
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  parent.add(mesh)
  return mesh
}

// ---------------------------------------------------------------- builder context

/** Hooks the scene gives each builder. */
export interface BuildCtx {
  root: THREE.Group
  /** Make `obj` selectable as `id`. `anchor` overrides the focus point; `mobile` entities win click ties. */
  register(id: string, obj: THREE.Object3D, o: { ring: number; focus: number; mobile?: boolean; anchor?: THREE.Vector3 }): void
  /** Re-key a registered entity (a shuttle that is replaced by the next one). */
  rekey(oldId: string, newId: string): void
  pin(id: string, index: string, name: string, pos: THREE.Vector3): void
}

// ---------------------------------------------------------------- polar maths

export const polar = (r: number, a: number, y = 0) => new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a))

export const TAU = Math.PI * 2
export const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(x, 0), 1))
export const easeCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
/** Shortest signed difference b - a, in (-π, π]. */
export const angDiff = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a))
/** Yaw (about +Y) that turns a model's local +x onto world direction (dx, dz). */
export const yawOf = (dx: number, dz: number) => Math.atan2(-dz, dx)

export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Expand a list of [radius, angle] corners into a dense polyline at height `y`.
 * Same-radius legs follow the circle (shorter way round); others are straight.
 */
export function expand(corners: [number, number][], y: number, stepDeg = 5): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  corners.forEach(([r, a], i) => {
    if (i === 0) return void out.push(polar(r, a, y))
    const [r0, a0] = corners[i - 1]
    if (Math.abs(r - r0) < 1e-3 && Math.abs(angDiff(a0, a)) > 1e-4) {
      const d = angDiff(a0, a)
      const n = Math.max(1, Math.ceil(Math.abs(d) / ((stepDeg * Math.PI) / 180)))
      for (let k = 1; k <= n; k++) out.push(polar(r, a0 + (d * k) / n, y))
    } else out.push(polar(r, a, y))
  })
  return out
}

export interface Walk {
  pts: THREE.Vector3[]
  cum: number[]
  len: number
}

export function walk(pts: THREE.Vector3[]): Walk {
  const cum = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]))
  return { pts, cum, len: cum[cum.length - 1] }
}

/** Position at distance `s` along a walk (clamped). Writes into `out`; returns heading in `dir`. */
export function sampleWalk(w: Walk, s: number, out: THREE.Vector3, dir?: THREE.Vector3) {
  const d = Math.min(Math.max(s, 0), w.len)
  let i = 1
  while (i < w.pts.length - 1 && w.cum[i] < d) i++
  const seg = w.cum[i] - w.cum[i - 1] || 1
  const k = (d - w.cum[i - 1]) / seg
  out.lerpVectors(w.pts[i - 1], w.pts[i], k)
  if (dir) dir.subVectors(w.pts[i], w.pts[i - 1]).normalize()
  return out
}

// ---------------------------------------------------------------- labels

/** Numbered beacon pinned above a district or gate; its name shows on hover / selection. */
export function beacon(index: string, name: string, onClick: () => void) {
  const el = document.createElement("button")
  el.type = "button"
  el.tabIndex = -1
  el.setAttribute("aria-hidden", "true")
  el.className =
    "pointer-events-auto flex cursor-pointer select-none items-center gap-1.5 whitespace-nowrap font-mono text-[10px] font-semibold tracking-wider"
  const num = document.createElement("span")
  num.className =
    "grid size-5 place-items-center rounded-full border border-[#f5b941]/70 bg-[#0B1222]/85 text-[#f5b941] shadow-[0_0_12px_rgba(245,185,65,0.45)]"
  num.textContent = index
  const txt = document.createElement("span")
  txt.className = "hidden border-l border-[#f5b941]/60 bg-[#0B1222]/85 px-1.5 py-0.5 text-[#e9eefc] uppercase"
  txt.textContent = name
  el.append(num, txt)
  el.addEventListener("click", onClick)
  const obj = new CSS2DObject(el)
  return {
    obj,
    /** state: 0 idle · 1 show name */
    show(on: boolean) {
      txt.classList.toggle("hidden", !on)
      num.classList.toggle("bg-[#f5b941]", on)
      num.classList.toggle("text-[#0B1222]", on)
      el.style.zIndex = on ? "5" : "0"
    },
  }
}

// ---------------------------------------------------------------- disposal

/** Dispose every geometry, material and texture under `root`. */
export function disposeTree(root: THREE.Object3D) {
  const geos = new Set<THREE.BufferGeometry>()
  const mats = new Set<THREE.Material>()
  root.traverse((o) => {
    if (o instanceof CSS2DObject) o.element.remove()
    const g = (o as THREE.Mesh).geometry
    if (g) geos.add(g)
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
    if (m) for (const x of Array.isArray(m) ? m : [m]) mats.add(x)
    if (o instanceof THREE.InstancedMesh) o.dispose()
  })
  geos.forEach((g) => g.dispose())
  mats.forEach((m) => {
    for (const v of Object.values(m)) if (v instanceof THREE.Texture) v.dispose()
    m.dispose()
  })
}
