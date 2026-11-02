"use client"

import { useEffect, useMemo, useRef } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Edges, Float } from "@react-three/drei"
import type { Group } from "three"

import type { Mode } from "@/lib/mode"
import type { Section } from "./sections"

const GOLD = "#e8b84b"
const ORANGE = "#f28a3c"
const NAVY = "#1d2f5c"
const NAVY_DEEP = "#162650"
const GROUND = "#101d3c"
const ROAD = "#263a6b"

/** Per-mode feel: speed of motion and how far the camera leans toward the pointer. */
const FEEL: Record<Mode, { speed: number; lean: number }> = {
  sme: { speed: 0.4, lean: 0.3 },
  startup: { speed: 0.85, lean: 0.45 },
  individual: { speed: 0.25, lean: 0.55 },
}

// Pointer in -1..1. The canvas ignores pointer events, so read it from the window.
const pointer = { x: 0, y: 0 }

/** Slow orbit around the campus, leaning a little toward the pointer. */
function Rig({ mode, still }: { mode: Mode; still: boolean }) {
  const invalidate = useThree((s) => s.invalidate)
  useEffect(() => {
    const move = (e: PointerEvent) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.y = (e.clientY / window.innerHeight) * 2 - 1
    }
    window.addEventListener("pointermove", move, { passive: true })
    return () => window.removeEventListener("pointermove", move)
  }, [])
  // Reduced motion: one frame, re-rendered only when the mode changes.
  useEffect(() => {
    if (still) invalidate()
  }, [mode, still, invalidate])
  useFrame(({ camera, clock }) => {
    const { speed, lean } = FEEL[mode]
    const a = still ? 0.5 : 0.5 + Math.sin(clock.elapsedTime * speed * 0.18) * 0.45 + pointer.x * lean * 0.25
    const r = 18
    camera.position.set(Math.sin(a) * r, 8.5 - pointer.y * lean * 0.8, Math.cos(a) * r)
    camera.lookAt(0.8, 1.2, 0)
  })
  return null
}

function Block({ p, s, color = NAVY, edge = GOLD, glow = 0 }: { p: [number, number, number]; s: [number, number, number]; color?: string; edge?: string; glow?: number }) {
  return (
    <mesh position={[p[0], p[1] + s[1] / 2, p[2]]}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={color} roughness={0.6} metalness={0.2} emissive={glow ? edge : "#000"} emissiveIntensity={glow} />
      <Edges color={edge} threshold={15} />
    </mesh>
  )
}

/** Ground, yard grid, road ring and a truck that drives it: the "campus" every page sits on. */
function Yard({ speed }: { speed: number }) {
  const truck = useRef<Group>(null)
  useFrame(({ clock }) => {
    const g = truck.current
    if (!g) return
    // Rounded-rectangle loop on the road, 1 unit of perimeter parameter per lap.
    const t = (clock.elapsedTime * speed * 0.06) % 1
    const w = 9
    const d = 6
    const per = 2 * (w + d)
    const k = t * per
    const [x, z, yaw] =
      k < w
        ? [-w / 2 + k, d / 2, Math.PI / 2]
        : k < w + d
          ? [w / 2, d / 2 - (k - w), Math.PI]
          : k < 2 * w + d
            ? [w / 2 - (k - w - d), -d / 2, -Math.PI / 2]
            : [-w / 2, -d / 2 + (k - 2 * w - d), 0]
    g.position.set(x, 0, z)
    g.rotation.y = yaw
  })
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[22, 64]} />
        <meshStandardMaterial color={GROUND} roughness={1} />
      </mesh>
      <gridHelper args={[44, 44, "#4d68ab", "#26396a"]} position={[0, 0.005, 0]} />
      {[
        [0, 3, 9.6, 0.5],
        [0, -3, 9.6, 0.5],
        [4.5, 0, 0.5, 6.5],
        [-4.5, 0, 0.5, 6.5],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[x, 0.012, z]}>
          <planeGeometry args={[w, d]} />
          <meshStandardMaterial color={ROAD} roughness={0.9} />
        </mesh>
      ))}
      <group ref={truck}>
        <Block p={[0, 0.08, 0]} s={[0.42, 0.36, 0.85]} color={NAVY_DEEP} edge={ORANGE} glow={0.35} />
        <Block p={[0, 0.08, 0.5]} s={[0.4, 0.28, 0.28]} color={NAVY} edge={GOLD} />
      </group>
    </group>
  )
}

/** Quiet silhouette of sheds and an office. `scale` thins it out for the personal mode. */
const SKYLINE: [number, number, number, number][] = [
  [-9, -8, 1.6, 4.2],
  [-6.5, -9, 1.4, 6.2],
  [-3.6, -8.5, 1.8, 3.6],
  [-0.5, -9.5, 1.5, 7.4],
  [2.6, -8.5, 1.7, 4.6],
  [5.8, -9, 1.5, 5.8],
  [8.8, -8, 1.8, 3.4],
]

function Skyline({ count }: { count: number }) {
  return (
    <group>
      {SKYLINE.slice(0, count).map(([x, z, w, h], i) => (
        <Block key={i} p={[x, 0, z]} s={[w, h, w]} color={NAVY_DEEP} edge={i % 3 === 1 ? ORANGE : GOLD} glow={i % 3 === 1 ? 0.18 : 0.05} />
      ))}
    </group>
  )
}

function Buildings({ mode }: { mode: Mode }) {
  if (mode === "individual") {
    return (
      <>
        <Skyline count={3} />
        <IndividualHouse />
      </>
    )
  }
  return (
    <>
      <Skyline count={7} />
      <Campus mode={mode} />
    </>
  )
}

function IndividualHouse() {
  return (
    <group position={[-1.5, 0, -0.5]}>
      <Block p={[0, 0, 0]} s={[2.6, 1.3, 1.8]} />
      <Block p={[0.9, 1.3, 0]} s={[0.7, 0.45, 0.7]} edge={ORANGE} glow={0.2} />
      <Block p={[-3.4, 0, 1.2]} s={[1.2, 0.7, 1]} color={NAVY_DEEP} />
    </group>
  )
}

function Campus({ mode }: { mode: Mode }) {
  return (
    <group position={[-1.5, 0, 0]}>
      <Block p={[-3.4, 0, -1.6]} s={[4.2, 1.5, 1.8]} />
      <Block p={[-3.4, 0, 1.4]} s={[4.2, 1.1, 1.6]} color={NAVY_DEEP} />
      <Block p={[1.4, 0, -1.8]} s={[1.5, 2.3, 1.5]} edge={ORANGE} glow={mode === "startup" ? 0.2 : 0.1} />
      <Block p={[1.2, 0, 1.6]} s={[2.2, 0.8, 1.2]} />
    </group>
  )
}

/** Small-business motif: stock crates breathing beside the dock. */
function Crates({ speed }: { speed: number }) {
  const group = useRef<Group>(null)
  const items = useMemo(() => {
    const out: { x: number; z: number; s: number }[] = []
    for (let r = 0; r < 3; r++) for (let c = 0; c < 5; c++) out.push({ x: (c - 2) * 0.75, z: (r - 1) * 0.8, s: 0.35 + ((c * 7 + r * 3) % 4) * 0.1 })
    return out
  }, [])
  useFrame(({ clock }) => {
    group.current?.children.forEach((child, i) => {
      child.position.y = items[i].s / 2 + 0.05 + Math.max(0, Math.sin(clock.elapsedTime * speed + i * 0.8)) * 0.18
    })
  })
  return (
    <group ref={group} position={[5.2, 0, 0.2]}>
      {items.map((it, i) => (
        <mesh key={i} position={[it.x, it.s / 2, it.z]} scale={[1, it.s, 1]}>
          <boxGeometry args={[0.6, 1, 0.6]} />
          <meshStandardMaterial color={NAVY} roughness={0.6} metalness={0.2} />
          <Edges color={i % 5 === 0 ? ORANGE : GOLD} threshold={15} />
        </mesh>
      ))}
    </group>
  )
}

/** Startup motif: a staircase of growth towers with a ring of sparks circling it. */
function Ascent({ speed }: { speed: number }) {
  const bars = useRef<Group>(null)
  const ring = useRef<Group>(null)
  const sparks = useMemo(() => {
    const n = 110
    const a = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2
      const r = 3.4 + ((i * 37) % 10) * 0.05
      a.set([Math.cos(t) * r, ((i * 13) % 10) * 0.12 + 0.2, Math.sin(t) * r], i * 3)
    }
    return a
  }, [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * speed
    if (ring.current) ring.current.rotation.y = t * 0.5
    bars.current?.children.forEach((c, i) => {
      c.scale.y = 1 + Math.sin(t * 1.4 + i * 0.7) * 0.05
    })
  })
  return (
    <group position={[5, 0, 0]} rotation={[0, -0.5, 0]}>
      <group ref={bars}>
        {Array.from({ length: 7 }, (_, i) => {
          const h = 0.5 + i * 0.42
          return (
            <mesh key={i} position={[(i - 3) * 0.62, h / 2, 0]}>
              <boxGeometry args={[0.45, h, 0.45]} />
              <meshStandardMaterial color={i >= 5 ? ORANGE : NAVY} roughness={0.5} metalness={0.25} emissive={i >= 5 ? ORANGE : "#000"} emissiveIntensity={i >= 5 ? 0.3 : 0} />
              <Edges color={GOLD} threshold={15} />
            </mesh>
          )
        })}
      </group>
      <group ref={ring}>
        <points>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[sparks, 3]} />
          </bufferGeometry>
          <pointsMaterial color={GOLD} size={0.08} sizeAttenuation transparent opacity={0.9} />
        </points>
      </group>
    </group>
  )
}

/** Personal motif: one calm wireframe form that floats, with slow dust. */
function Orbit({ speed }: { speed: number }) {
  const ring = useRef<Group>(null)
  const dust = useMemo(() => {
    const n = 70
    const a = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) a.set([(((i * 53) % 100) / 100) * 12 - 6, (((i * 29) % 100) / 100) * 4 + 0.2, (((i * 71) % 100) / 100) * 10 - 5], i * 3)
    return a
  }, [])
  useFrame(({ clock }) => {
    if (ring.current) {
      ring.current.rotation.x = 1.1 + Math.sin(clock.elapsedTime * speed) * 0.15
      ring.current.rotation.z = clock.elapsedTime * speed * 0.5
    }
  })
  return (
    <group position={[4.4, 1.9, 0]}>
      <Float speed={speed * 4} rotationIntensity={0.6} floatIntensity={0.8}>
        <mesh>
          <icosahedronGeometry args={[1.1, 1]} />
          <meshStandardMaterial color={NAVY_DEEP} roughness={0.4} metalness={0.3} flatShading />
          <Edges color={GOLD} threshold={1} />
        </mesh>
        <group ref={ring}>
          <mesh>
            <torusGeometry args={[1.9, 0.015, 8, 96]} />
            <meshBasicMaterial color={ORANGE} />
          </mesh>
        </group>
      </Float>
      <points position={[-4.4, -1.9, 0]}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dust, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#9fabc2" size={0.05} sizeAttenuation transparent opacity={0.6} />
      </points>
    </group>
  )
}

/** One landmark per app section, parked at the front of the yard. Remounts when the section changes. */
function Landmark({ section, speed }: { section: Section; speed: number }) {
  const spin = useRef<Group>(null)
  useFrame(({ clock }, dt) => {
    const g = spin.current
    if (!g) return
    if (section === "dashboard") g.rotation.y += dt * speed * 0.9
    else if (section === "settings") g.rotation.z += dt * speed * 0.6
    else if (section === "finance") g.rotation.y += dt * speed * 0.4
    else if (section === "deals") g.position.x = Math.sin(clock.elapsedTime * speed) * 0.25
    else g.rotation.y += dt * speed * 0.3
  })
  const mat = <meshStandardMaterial color={NAVY} roughness={0.5} metalness={0.25} />
  let body: React.ReactNode
  switch (section) {
    case "dashboard": // radar disc with a sweep arm
      body = (
        <group ref={spin} position={[0, 0.05, 0]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.9, 1, 48]} />
            <meshBasicMaterial color={GOLD} />
          </mesh>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.45, 0.5, 48]} />
            <meshBasicMaterial color={GOLD} transparent opacity={0.5} />
          </mesh>
          <mesh position={[0.5, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[1, 0.06]} />
            <meshBasicMaterial color={ORANGE} />
          </mesh>
        </group>
      )
      break
    case "deals": // pipeline chevrons
      body = (
        <group ref={spin}>
          {[0, 1, 2, 3].map((i) => (
            <mesh key={i} position={[(i - 1.5) * 0.55, 0.3 + i * 0.12, 0]} rotation={[0, 0, -Math.PI / 2]}>
              <coneGeometry args={[0.28, 0.4, 4]} />
              <meshStandardMaterial color={i === 3 ? ORANGE : NAVY} emissive={i === 3 ? ORANGE : "#000"} emissiveIntensity={0.3} />
              <Edges color={GOLD} threshold={15} />
            </mesh>
          ))}
        </group>
      )
      break
    case "clients": // people pins
      body = (
        <group ref={spin}>
          {[0, 1, 2, 3, 4].map((i) => (
            <Float key={i} speed={2 + i * 0.4} floatIntensity={0.5} rotationIntensity={0}>
              <group position={[Math.cos(i * 1.26) * 0.8, 0.3, Math.sin(i * 1.26) * 0.8]}>
                <mesh position={[0, 0.32, 0]}>
                  <sphereGeometry args={[0.13, 12, 12]} />
                  <meshStandardMaterial color={i === 0 ? ORANGE : GOLD} emissive={i === 0 ? ORANGE : GOLD} emissiveIntensity={0.25} />
                </mesh>
                <mesh position={[0, 0.08, 0]}>
                  <coneGeometry args={[0.15, 0.4, 12]} />
                  {mat}
                  <Edges color={GOLD} threshold={20} />
                </mesh>
              </group>
            </Float>
          ))}
        </group>
      )
      break
    case "inventory": // rack of pallets
      body = (
        <group ref={spin}>
          {[0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => ({ r, c }))).map(({ r, c }) => (
            <Block key={`${r}${c}`} p={[(c - 1) * 0.6 - 0.0, r * 0.4, 0]} s={[0.5, 0.32, 0.5]} edge={r === 2 && c === 1 ? ORANGE : GOLD} glow={r === 2 && c === 1 ? 0.3 : 0} />
          ))}
        </group>
      )
      break
    case "finance": // coin stacks
      body = (
        <group ref={spin}>
          {[3, 5, 4, 2].map((n, i) => (
            <group key={i} position={[(i - 1.5) * 0.5, 0, (i % 2) * 0.25]}>
              {Array.from({ length: n }, (_, k) => (
                <mesh key={k} position={[0, 0.06 + k * 0.1, 0]}>
                  <cylinderGeometry args={[0.2, 0.2, 0.08, 24]} />
                  <meshStandardMaterial color={k === n - 1 ? ORANGE : GOLD} emissive={k === n - 1 ? ORANGE : GOLD} emissiveIntensity={0.15} metalness={0.5} roughness={0.4} />
                </mesh>
              ))}
            </group>
          ))}
        </group>
      )
      break
    case "settings": // gear
      body = (
        <group position={[0, 0.9, 0]} rotation={[Math.PI / 2.4, 0, 0]}>
          <group ref={spin}>
            <mesh>
              <torusGeometry args={[0.5, 0.12, 8, 24]} />
              {mat}
              <Edges color={GOLD} threshold={20} />
            </mesh>
            {Array.from({ length: 8 }, (_, i) => (
              <mesh key={i} position={[Math.cos((i / 8) * Math.PI * 2) * 0.72, Math.sin((i / 8) * Math.PI * 2) * 0.72, 0]} rotation={[0, 0, (i / 8) * Math.PI * 2]}>
                <boxGeometry args={[0.2, 0.16, 0.24]} />
                <meshStandardMaterial color={ORANGE} emissive={ORANGE} emissiveIntensity={0.2} />
              </mesh>
            ))}
          </group>
        </group>
      )
      break
    default: // other: a floating cut gem
      body = (
        <group position={[0, 0.7, 0]}>
          <Float speed={2} floatIntensity={0.6}>
            <group ref={spin}>
              <mesh>
                <octahedronGeometry args={[0.5, 0]} />
                {mat}
                <Edges color={GOLD} threshold={1} />
              </mesh>
            </group>
          </Float>
        </group>
      )
  }
  return <group position={[2.4, 0, 3.8]} scale={1.5}>{body}</group>
}

/**
 * The persistent 3D base: transparent canvas over the page background, lit like the Campus
 * scene. `active` pauses rendering; `still` renders a single frame (reduced motion).
 */
export default function BaseScene({
  mode,
  section,
  active,
  still,
  onFail,
}: {
  mode: Mode
  section: Section
  active: boolean
  still: boolean
  onFail: () => void
}) {
  const { speed } = FEEL[mode]
  return (
    <Canvas
      frameloop={still ? "demand" : active ? "always" : "never"}
      dpr={[1, 1.5]}
      camera={{ position: [6, 5.6, 11], fov: 42 }}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0)
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault()
          onFail()
        })
      }}
    >
      <fog attach="fog" args={["#0b1222", 18, 36]} />
      <ambientLight intensity={1.3} />
      <directionalLight position={[5, 8, 4]} intensity={2.2} color={GOLD} />
      <pointLight position={[-6, 3, 5]} intensity={26} color={ORANGE} />
      <Rig mode={mode} still={still} />
      <Yard speed={speed} />
      <Buildings mode={mode} />
      {mode === "startup" ? <Ascent speed={speed} /> : mode === "individual" ? <Orbit speed={speed} /> : <Crates speed={speed} />}
      <Landmark key={section} section={section} speed={speed} />
    </Canvas>
  )
}
