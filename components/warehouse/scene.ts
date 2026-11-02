import * as THREE from "three"
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js"
import { CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js"

import { buildDistricts } from "./districts"
import { COLOR, LAY, TAU, angDiff, beacon, disposeTree, easeCubic, glow, lineMat, ringLine, rng, std, type BuildCtx } from "./kit"
import { buildLoop } from "./loop"
import type { CampusScene, Snapshot } from "./types"

/** 1 real second = SIM_SPEED simulated seconds (clock, ETAs). */
export const SIM_SPEED = 10
const SIM_START = 9 * 3600 + 40 * 60 // 09:40

interface Ent {
  id: string
  root: THREE.Object3D
  ring: number
  focus: number
  mobile: boolean
  anchor?: THREE.Vector3
}

interface View {
  target: THREE.Vector3
  radius: number
  phi: number
  theta: number
}

export type { CampusScene, Snapshot }

export function createCampusScene(
  host: HTMLElement,
  opts: { onSnapshot(s: Snapshot): void; onSelect(id: string | null): void; reducedMotion?: boolean },
): CampusScene {
  // ------------------------------------------------------------ renderer, camera, controls
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.domElement.style.display = "block"
  renderer.domElement.setAttribute("role", "img")
  renderer.domElement.setAttribute("aria-label", "Interactive 3D campus: a central atrium, ring of pavilions and a logistics loop. Drag to orbit, scroll to zoom, click a district or vehicle to inspect it.")
  host.appendChild(renderer.domElement)

  const labels = new CSS2DRenderer()
  labels.domElement.style.position = "absolute"
  labels.domElement.style.inset = "0"
  labels.domElement.style.pointerEvents = "none"
  host.appendChild(labels.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(COLOR.bg)
  scene.fog = new THREE.Fog(COLOR.bg, 260, 560)

  const camera = new THREE.PerspectiveCamera(34, 1, 2, 900)
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.07
  controls.minDistance = 24
  controls.maxDistance = 420
  controls.minPolarAngle = 0.2
  controls.maxPolarAngle = 1.38
  controls.screenSpacePanning = false
  controls.autoRotateSpeed = 0.28

  // ------------------------------------------------------------ light: moon, warm rim, gold core
  scene.add(new THREE.HemisphereLight("#7d93d6", COLOR.bg, 1.0))
  const moon = new THREE.DirectionalLight("#b8c8ff", 1.5)
  moon.position.set(-70, 110, 60)
  scene.add(moon)
  const rim = new THREE.DirectionalLight("#ff9a4d", 0.8)
  rim.position.set(90, 30, -70)
  scene.add(rim)
  const coreLight = new THREE.PointLight(COLOR.gold, 2200, 110, 2)
  coreLight.position.set(0, 26, 0)
  scene.add(coreLight)

  // ------------------------------------------------------------ sky dome, ground, ambient dust
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(700, 24, 12),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: { top: { value: new THREE.Color(COLOR.bg) }, low: { value: new THREE.Color("#1a2a52") } },
      vertexShader: "varying float h; void main(){ h = normalize(position).y; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
      fragmentShader: "uniform vec3 top; uniform vec3 low; varying float h; void main(){ float k = smoothstep(0.0, 0.55, h); gl_FragColor = vec4(mix(low, top, k), 1.0); }",
    }),
  )
  scene.add(sky)

  const ground = new THREE.Mesh(new THREE.CircleGeometry(190, 96), std("#0c1529", { roughness: 0.95 }))
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)
  const lawn = new THREE.Mesh(new THREE.RingGeometry(14, 46.5, 96), std("#0f1c3a", { roughness: 0.95 }))
  lawn.rotation.x = -Math.PI / 2
  lawn.position.y = 0.02
  scene.add(lawn)
  const faint = glow(COLOR.slateLite, 0.45)
  ;[26, 38.5, 46.5, 88, 108, 130, 156].forEach((r, i) => ringLine(scene, r, 0.06, i < 3 ? faint : glow(COLOR.slateLite, 0.22), 0.07))
  const spokes: number[] = []
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * TAU
    spokes.push(Math.cos(a) * 14, 0.05, Math.sin(a) * 14, Math.cos(a) * 46.5, 0.05, Math.sin(a) * 46.5)
  }
  const spokeGeo = new THREE.BufferGeometry()
  spokeGeo.setAttribute("position", new THREE.Float32BufferAttribute(spokes, 3))
  scene.add(new THREE.LineSegments(spokeGeo, lineMat(COLOR.slateLite, 0.28)))

  const dustR = rng(5)
  const dustPos = new Float32Array(420 * 3)
  for (let i = 0; i < 420; i++) {
    const a = dustR() * TAU
    const r = 15 + dustR() * 150
    dustPos.set([Math.cos(a) * r, 2 + dustR() * 70, Math.sin(a) * r], i * 3)
  }
  const dustGeo = new THREE.BufferGeometry()
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3))
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: "#ffd9a0", size: 0.8, sizeAttenuation: true, transparent: true, opacity: 0.5, depthWrite: false }))
  scene.add(dust)

  // ------------------------------------------------------------ entity registry + beacons
  const ents = new Map<string, Ent>()
  const pins = new Map<string, ReturnType<typeof beacon>>()
  let selectedId: string | null = null
  let hoverId: string | null = null
  let followId: string | null = null

  const content = new THREE.Group()
  scene.add(content)
  const ctx: BuildCtx = {
    root: content,
    register(id, obj, o) {
      const e: Ent = { id, root: obj, ring: o.ring, focus: o.focus, mobile: !!o.mobile, anchor: o.anchor }
      ents.set(id, e)
      obj.traverse((m) => {
        if (m instanceof THREE.Mesh && !(m instanceof THREE.InstancedMesh)) m.userData.ent = e
      })
    },
    rekey(oldId, newId) {
      const e = ents.get(oldId)
      if (!e) return
      ents.delete(oldId)
      e.id = newId
      ents.set(newId, e)
      if (selectedId === oldId) {
        selectedId = newId
        if (followId === oldId) followId = newId
        opts.onSelect(newId)
      }
    },
    pin(id, index, name, pos) {
      const b = beacon(index, name, () => opts.onSelect(id))
      b.obj.position.copy(pos)
      content.add(b.obj)
      pins.set(id, b)
    },
  }

  const districts = buildDistricts(ctx, SIM_SPEED)
  const loop = buildLoop(ctx, SIM_SPEED, SIM_START)

  const pickables: THREE.Mesh[] = []
  content.traverse((o) => {
    if (o instanceof THREE.Mesh && o.userData.ent) pickables.push(o)
  })

  // selection marker: ground ring + a thin needle so small figures stay findable
  const ringMat = glow(COLOR.gold, 0.95)
  const ringMesh = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), ringMat)
  ringMesh.rotation.x = -Math.PI / 2
  ringMesh.visible = false
  scene.add(ringMesh)
  const needle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 14, 6, 1, true), glow(COLOR.gold, 0.7, true))
  needle.visible = false
  scene.add(needle)

  // ------------------------------------------------------------ camera moves
  const home = (): View => ({ target: new THREE.Vector3(0, 2, 0), radius: 158 * Math.max(1, 1.5 / camera.aspect), phi: 1.1, theta: 2.45 })
  const sph = new THREE.Spherical()
  const off = new THREE.Vector3()
  const current = (): View => {
    off.copy(camera.position).sub(controls.target)
    sph.setFromVector3(off)
    return { target: controls.target.clone(), radius: sph.radius, phi: sph.phi, theta: sph.theta }
  }
  const apply = (v: View) => {
    controls.target.copy(v.target)
    sph.set(v.radius, v.phi, v.theta)
    camera.position.setFromSpherical(sph).add(v.target)
  }
  let tween: { from: View; to: View; t: number; dur: number } | null = null
  function flyTo(to: Partial<View>, dur: number) {
    const from = current()
    const full: View = { ...from, ...to }
    // take the short way round
    full.theta = from.theta + angDiff(from.theta, full.theta)
    tween = { from, to: full, t: 0, dur: opts.reducedMotion ? 0.001 : dur }
  }
  apply(home())
  let lastInput = performance.now()
  let autoOrbit = !opts.reducedMotion
  controls.addEventListener("start", () => {
    tween = null
    lastInput = performance.now()
    controls.autoRotate = false
  })

  // ------------------------------------------------------------ resize + insets (HUD overlap)
  const insets = { left: 0, right: 0, bottom: 0 }
  function fit() {
    const w = host.clientWidth || 1
    const h = host.clientHeight || 1
    renderer.setSize(w, h)
    labels.setSize(w, h)
    camera.aspect = w / h
    // shift the projection centre so the scene sits in the free space between HUD panels
    const dx = (insets.left - insets.right) / 2
    const dy = insets.bottom / 2
    if (dx || dy) camera.setViewOffset(w, h, -dx, dy, w, h)
    else camera.clearViewOffset()
    camera.updateProjectionMatrix()
  }
  const ro = new ResizeObserver(fit)
  ro.observe(host)
  fit()

  // ------------------------------------------------------------ picking
  const ray = new THREE.Raycaster()
  const ndc = new THREE.Vector2()
  const shown = (o: THREE.Object3D | null) => {
    for (let p = o; p; p = p.parent) if (!p.visible) return false
    return true
  }
  function pickAt(clientX: number, clientY: number): Ent | null {
    const r = renderer.domElement.getBoundingClientRect()
    ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    const hits = ray.intersectObjects(pickables, false).filter((h) => shown(h.object))
    if (!hits.length) return null
    // small moving things win over the glass shell around them
    const mobile = hits.find((h) => (h.object.userData.ent as Ent).mobile && h.distance - hits[0].distance < 24)
    return ((mobile ?? hits[0]).object.userData.ent as Ent) ?? null
  }

  let down: { x: number; y: number; t: number } | null = null
  const onDown = (e: PointerEvent) => (down = { x: e.clientX, y: e.clientY, t: performance.now() })
  const onUp = (e: PointerEvent) => {
    const d = down
    down = null
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6 || performance.now() - d.t > 600) return
    const hit = pickAt(e.clientX, e.clientY)
    opts.onSelect(hit ? hit.id : null)
  }
  let moveQueued = false
  const onMove = (e: PointerEvent) => {
    if (e.buttons || moveQueued) return
    moveQueued = true
    requestAnimationFrame(() => {
      moveQueued = false
      const hit = pickAt(e.clientX, e.clientY)
      const id = hit?.id ?? null
      renderer.domElement.style.cursor = id ? "pointer" : "grab"
      if (id !== hoverId) setHover(id)
    })
  }
  const onLeave = () => setHover(null)
  renderer.domElement.addEventListener("pointerdown", onDown)
  renderer.domElement.addEventListener("pointerup", onUp)
  renderer.domElement.addEventListener("pointermove", onMove)
  renderer.domElement.addEventListener("pointerleave", onLeave)

  function setHover(id: string | null) {
    pins.get(hoverId ?? "")?.show(hoverId === selectedId)
    hoverId = id
    pins.get(id ?? "")?.show(true)
    districts.hover(id)
  }

  // ------------------------------------------------------------ frame loop
  const wp = new THREE.Vector3()
  const delta = new THREE.Vector3()
  const posOf = (e: Ent, out: THREE.Vector3) => (e.anchor ? out.copy(e.anchor) : e.root.getWorldPosition(out))
  let sim = SIM_START
  let clock = 0
  let snapT = 1
  let last = performance.now()
  let raf = 0

  function frame(now: number) {
    raf = requestAnimationFrame(frame)
    const dt = Math.min((now - last) / 1000, 0.05)
    last = now
    clock += dt
    sim += dt * SIM_SPEED

    districts.update(dt, clock, sim)
    loop.update(dt, clock, sim)
    dust.rotation.y += dt * 0.004
    coreLight.intensity = 2200 + Math.sin(clock * 1.7) * 160

    if (tween) {
      tween.t += dt
      const k = easeCubic(Math.min(tween.t / tween.dur, 1))
      const { from: a, to: b } = tween
      apply({
        target: a.target.clone().lerp(b.target, k),
        radius: THREE.MathUtils.lerp(a.radius, b.radius, k),
        phi: THREE.MathUtils.lerp(a.phi, b.phi, k),
        theta: THREE.MathUtils.lerp(a.theta, b.theta, k),
      })
      if (k >= 1) tween = null
    } else if (followId) {
      const e = ents.get(followId)
      if (e && shown(e.root)) {
        posOf(e, wp)
        delta.copy(wp).sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 4))
        controls.target.add(delta)
        camera.position.add(delta)
      }
    }
    controls.autoRotate = autoOrbit && !tween && !selectedId && performance.now() - lastInput > 6000

    const sel = selectedId ? ents.get(selectedId) : null
    if (sel && shown(sel.root) && sel.ring > 0) {
      sel.root.getWorldPosition(wp)
      const y = sel.mobile ? wp.y + 0.12 : LAY.deck + 0.12
      ringMesh.visible = true
      ringMesh.position.set(wp.x, y, wp.z)
      ringMesh.scale.setScalar(sel.ring * (1 + Math.sin(clock * 4) * 0.05))
      needle.visible = sel.mobile
      needle.position.set(wp.x, y + 7, wp.z)
    } else ringMesh.visible = needle.visible = false

    controls.update(dt)
    renderer.render(scene, camera)
    labels.render(scene, camera)

    snapT += dt
    if (snapT > 0.25) {
      snapT = 0
      const d = districts.snapshot()
      const l = loop.snapshot()
      opts.onSnapshot({
        zones: [...d.zones, l.vault],
        people: d.people,
        stackers: l.stackers,
        shuttles: l.shuttles,
        shipment: l.shipment,
        sim,
        stock: l.stock,
        stockCap: l.stockCap,
        stockDelta: l.stockDelta,
      })
    }
  }
  const start = () => {
    cancelAnimationFrame(raf)
    last = performance.now()
    raf = requestAnimationFrame(frame)
  }
  const onVis = () => (document.hidden ? cancelAnimationFrame(raf) : start())
  document.addEventListener("visibilitychange", onVis)
  start()

  // ------------------------------------------------------------ public api
  const api: CampusScene = {
    zoom(f) {
      flyTo({ radius: THREE.MathUtils.clamp(current().radius * f, controls.minDistance, controls.maxDistance) }, 0.5)
    },
    orbit(dir) {
      flyTo({ theta: current().theta + (dir * Math.PI) / 5 }, 0.9)
    },
    home() {
      followId = null
      flyTo(home(), 1.5)
    },
    select(id, focus = false) {
      pins.get(selectedId ?? "")?.show(selectedId === hoverId)
      selectedId = id
      pins.get(id ?? "")?.show(true)
      districts.highlight(id)
      lastInput = performance.now()
      const e = id ? ents.get(id) : null
      if (!e) {
        followId = null
        return
      }
      if (!focus) return
      followId = e.mobile ? id : null
      const v = current()
      const to: Partial<View> = { target: posOf(e, new THREE.Vector3()), radius: Math.min(v.radius, e.focus), phi: THREE.MathUtils.clamp(v.phi, 0.8, 1.2) }
      const p = e.anchor ?? e.root.position
      const zoneAngle = p.lengthSq() > 1 ? Math.atan2(p.z, p.x) : null
      // face a district from outside the ring (the vault from inside, so its terraces face the lens)
      if (!e.mobile && zoneAngle !== null) to.theta = Math.PI / 2 - (e.id === "vault" ? zoneAngle + Math.PI : zoneAngle)
      flyTo(to, 1.2)
    },
    setAutoOrbit(on) {
      autoOrbit = on && !opts.reducedMotion
    },
    setStarters: (ids) => districts.setStarters(ids),
    setInsets(i) {
      Object.assign(insets, i)
      fit()
    },
    dispose() {
      cancelAnimationFrame(raf)
      document.removeEventListener("visibilitychange", onVis)
      ro.disconnect()
      renderer.domElement.removeEventListener("pointerdown", onDown)
      renderer.domElement.removeEventListener("pointerup", onUp)
      renderer.domElement.removeEventListener("pointermove", onMove)
      renderer.domElement.removeEventListener("pointerleave", onLeave)
      controls.dispose()
      disposeTree(scene)
      renderer.dispose()
      renderer.forceContextLoss()
      renderer.domElement.remove()
      labels.domElement.remove()
    },
  }
  return api
}
