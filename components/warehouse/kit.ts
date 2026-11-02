import * as THREE from "three"
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js"
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js"

/** Shared low-poly building blocks for the campus scene. */

// ---------------------------------------------------------------- materials

export const mat = (color: THREE.ColorRepresentation, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...extra })

export function canvasTex(w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement("canvas")
  cv.width = w
  cv.height = h
  draw(cv.getContext("2d")!)
  const t = new THREE.CanvasTexture(cv)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  return t
}

/** Isometric cube logo. */
export function drawCube(c: CanvasRenderingContext2D, x: number, y: number, s: number, top: string, left: string, right: string) {
  const face = (pts: number[][], fill: string) => {
    c.beginPath()
    pts.forEach(([px, py], i) => (i ? c.lineTo(x + px * s, y + py * s) : c.moveTo(x + px * s, y + py * s)))
    c.closePath()
    c.fillStyle = fill
    c.fill()
  }
  face([[0, -1], [0.87, -0.5], [0, 0], [-0.87, -0.5]], top)
  face([[-0.87, -0.5], [0, 0], [0, 1], [-0.87, 0.5]], left)
  face([[0.87, -0.5], [0, 0], [0, 1], [0.87, 0.5]], right)
}

// ---------------------------------------------------------------- geometry helpers

export const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  carton: new RoundedBoxGeometry(1, 1, 1, 2, 0.06),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 20),
  sphere: new THREE.SphereGeometry(1, 24, 16),
  cone: new THREE.ConeGeometry(1, 1, 20),
  ring: new THREE.RingGeometry(1.6, 2, 48),
}

export type Mat = THREE.Material | THREE.Material[]

/** Box with its bottom face at `y`. */
export function block(parent: THREE.Object3D, w: number, h: number, d: number, m: Mat, x = 0, y = 0, z = 0, geo: THREE.BufferGeometry = G.box) {
  const mesh = new THREE.Mesh(geo, m)
  mesh.scale.set(w, h, d)
  mesh.position.set(x, y + h / 2, z)
  mesh.castShadow = mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

/** Flat ground marking (no shadow casting). */
export function flat(parent: THREE.Object3D, w: number, d: number, m: Mat, x: number, z: number, y = 0.01) {
  const mesh = block(parent, w, 0.01, d, m, x, y, z)
  mesh.castShadow = false
  return mesh
}

export function cyl(parent: THREE.Object3D, r: number, h: number, m: Mat, x: number, y: number, z: number, alongZ = false) {
  const mesh = new THREE.Mesh(G.cyl, m)
  mesh.scale.set(r, h, r)
  mesh.position.set(x, y, z)
  if (alongZ) mesh.rotation.x = Math.PI / 2
  mesh.castShadow = mesh.receiveShadow = true
  parent.add(mesh)
  return mesh
}

export function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const ease = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(x, 0), 1))
export const easeCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2)
export const yawOf = (dx: number, dz: number) => Math.atan2(-dz, dx) // models face local +x
export function dampAngle(a: number, b: number, rate: number, dt: number) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a))
  return a + d * (1 - Math.exp(-rate * dt))
}
export const curve = (pts: [number, number][]) =>
  new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, "centripetal")

export function chip(html: string, cls = "bg-card/90 px-2 py-0.5 text-[11px]") {
  const el = document.createElement("div")
  el.className = `pointer-events-none select-none whitespace-nowrap rounded-md font-medium text-[#c9d1e2] shadow-md ring-1 ring-border backdrop-blur-sm ${cls}`
  el.innerHTML = html
  return { obj: new CSS2DObject(el), el }
}
