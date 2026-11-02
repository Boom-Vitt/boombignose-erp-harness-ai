"use client"

import { useEffect, useMemo, useRef } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { Edges, Float } from "@react-three/drei"
import type { Group } from "three"

import type { Mode } from "@/lib/mode"

const GOLD = "#e8b84b"
const ORANGE = "#f28a3c"
const NAVY = "#16223f"
const NAVY_DEEP = "#101a31"

/** Per-mode feel: speed of motion and how far the camera leans toward the pointer. */
const FEEL: Record<Mode, { speed: number; lean: number }> = {
  sme: { speed: 0.35, lean: 0.25 },
  startup: { speed: 0.8, lean: 0.4 },
  individual: { speed: 0.22, lean: 0.55 },
}

// Pointer in -1..1. The canvas ignores pointer events, so read it from the window.
const pointer = { x: 0, y: 0 }

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
  // Static frame for reduced motion: render once per mode change.
  useEffect(() => {
    if (still) invalidate()
  }, [mode, still, invalidate])
  useFrame(({ camera }) => {
    const { lean } = FEEL[mode]
    camera.position.x += (pointer.x * lean - camera.position.x) * 0.04
    camera.position.y += (1.2 - pointer.y * lean * 0.6 - camera.position.y) * 0.04
    camera.lookAt(0, 0.3, 0)
  })
  return null
}

/** Small-business motif: shelves of crates drifting gently, like a stockroom seen from above. */
function Crates({ speed }: { speed: number }) {
  const group = useRef<Group>(null)
  const items = useMemo(() => {
    const out: { x: number; z: number; y: number; s: number }[] = []
    for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) out.push({ x: (c - 2.5) * 1.35, z: (r - 1) * 1.5 - 0.5, y: 0, s: 0.55 + ((c * 7 + r * 3) % 4) * 0.12 })
    return out
  }, [])
  useFrame(({ clock }) => {
    const g = group.current
    if (!g) return
    g.rotation.y = -0.35 + Math.sin(clock.elapsedTime * speed * 0.4) * 0.12
    g.children.forEach((child, i) => {
      child.position.y = items[i].s / 2 + Math.sin(clock.elapsedTime * speed + i * 0.8) * 0.1
    })
  })
  return (
    <group ref={group} position={[1.8, -0.4, 0]}>
      {items.map((it, i) => (
        <mesh key={i} position={[it.x, it.s / 2, it.z]} scale={[1, it.s, 1]}>
          <boxGeometry args={[0.9, 1, 0.9]} />
          <meshStandardMaterial color={NAVY} roughness={0.6} metalness={0.2} />
          <Edges color={i % 5 === 0 ? ORANGE : GOLD} threshold={15} />
        </mesh>
      ))}
    </group>
  )
}

/** Startup motif: a staircase of growth bars with a ring of sparks circling it. */
function Ascent({ speed }: { speed: number }) {
  const bars = useRef<Group>(null)
  const ring = useRef<Group>(null)
  const sparks = useMemo(() => {
    const n = 90
    const a = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      const t = (i / n) * Math.PI * 2
      const r = 3.2 + ((i * 37) % 10) * 0.05
      a.set([Math.cos(t) * r, ((i * 13) % 10) * 0.06 - 0.3, Math.sin(t) * r], i * 3)
    }
    return a
  }, [])
  useFrame(({ clock }) => {
    const t = clock.elapsedTime * speed
    if (ring.current) ring.current.rotation.y = t * 0.6
    bars.current?.children.forEach((c, i) => {
      c.scale.y = 1 + Math.sin(t * 1.4 + i * 0.7) * 0.07
    })
  })
  return (
    <group position={[1.6, -0.5, 0]} rotation={[0, -0.5, 0]}>
      <group ref={bars}>
        {Array.from({ length: 7 }, (_, i) => {
          const h = 0.5 + i * 0.45
          return (
            <mesh key={i} position={[(i - 3) * 0.8, h / 2, 0]} scale={[1, 1, 1]}>
              <boxGeometry args={[0.55, h, 0.55]} />
              <meshStandardMaterial color={i >= 5 ? ORANGE : NAVY} roughness={0.5} metalness={0.25} emissive={i >= 5 ? ORANGE : "#000"} emissiveIntensity={i >= 5 ? 0.25 : 0} />
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
          <pointsMaterial color={GOLD} size={0.07} sizeAttenuation transparent opacity={0.85} />
        </points>
      </group>
    </group>
  )
}

/** Personal motif: one calm wireframe form that floats, with slow dust. Least busy of the three. */
function Orbit({ speed }: { speed: number }) {
  const ring = useRef<Group>(null)
  const dust = useMemo(() => {
    const n = 60
    const a = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) a.set([((i * 53) % 100) / 100 * 9 - 3, ((i * 29) % 100) / 100 * 4 - 1.8, ((i * 71) % 100) / 100 * 4 - 2.5], i * 3)
    return a
  }, [])
  useFrame(({ clock }) => {
    if (ring.current) {
      ring.current.rotation.x = 1.1 + Math.sin(clock.elapsedTime * speed) * 0.15
      ring.current.rotation.z = clock.elapsedTime * speed * 0.5
    }
  })
  return (
    <group position={[2.4, 0, 0]}>
      <Float speed={speed * 4} rotationIntensity={0.6} floatIntensity={0.8}>
        <mesh>
          <icosahedronGeometry args={[1.25, 1]} />
          <meshStandardMaterial color={NAVY_DEEP} roughness={0.4} metalness={0.3} flatShading />
          <Edges color={GOLD} threshold={1} />
        </mesh>
        <group ref={ring}>
          <mesh>
            <torusGeometry args={[2, 0.015, 8, 96]} />
            <meshBasicMaterial color={ORANGE} />
          </mesh>
        </group>
      </Float>
      <points>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[dust, 3]} />
        </bufferGeometry>
        <pointsMaterial color="#9fabc2" size={0.04} sizeAttenuation transparent opacity={0.6} />
      </points>
    </group>
  )
}

function ModeScene({ mode }: { mode: Mode }) {
  const { speed } = FEEL[mode]
  return mode === "startup" ? <Ascent speed={speed} /> : mode === "individual" ? <Orbit speed={speed} /> : <Crates speed={speed} />
}

/**
 * Reusable 3D stage: transparent canvas, three-point lighting, a leaning camera.
 * `active` pauses rendering; `still` renders a single frame (reduced motion).
 */
export default function Stage3DScene({
  mode,
  active,
  still,
  onFail,
}: {
  mode: Mode
  active: boolean
  still: boolean
  onFail: () => void
}) {
  return (
    <Canvas
      frameloop={still ? "demand" : active ? "always" : "never"}
      dpr={[1, 1.5]}
      camera={{ position: [0, 1.2, 8], fov: 38 }}
      gl={{ alpha: true, antialias: true, powerPreference: "low-power" }}
      onCreated={({ gl }) => {
        gl.setClearColor(0x000000, 0)
        gl.domElement.addEventListener("webglcontextlost", (e) => {
          e.preventDefault()
          onFail()
        })
      }}
    >
      <ambientLight intensity={0.7} />
      <directionalLight position={[4, 5, 3]} intensity={2.2} color={GOLD} />
      <pointLight position={[-4, 1, 4]} intensity={18} color={ORANGE} />
      <Rig mode={mode} still={still} />
      <ModeScene mode={mode} />
    </Canvas>
  )
}
