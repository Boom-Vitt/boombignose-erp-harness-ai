"use client"

import { useEffect, useRef, type ComponentRef } from "react"
import { Canvas, useThree } from "@react-three/fiber"
import { Edges, OrbitControls } from "@react-three/drei"
import { PerspectiveCamera } from "three"
import type { WorkloadModule } from "./types"
import { CanvasLabel } from "@/components/three/canvas-label"

export type OrganizationSceneProps = {
  modules: WorkloadModule[]
  selected: string | null
  onSelect: (id: string) => void
  resetKey: number
  orbit: boolean
  active: boolean
  reducedMotion: boolean
  lang: "th" | "en"
  onFailure: () => void
}

function Controls({ resetKey, orbit, active, reducedMotion }: Pick<OrganizationSceneProps, "resetKey" | "orbit" | "active" | "reducedMotion">) {
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height))
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const get = useThree((state) => state.get)
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    const camera = get().camera
    if (!(camera instanceof PerspectiveCamera)) return
    const verticalFov = camera.fov * Math.PI / 180
    const fitFov = Math.min(verticalFov, 2 * Math.atan(Math.tan(verticalFov / 2) * aspect))
    const distance = 7.5 / Math.sin(fitFov / 2) * 1.1
    camera.position.set(distance * 0.5, distance * 0.55, distance * 0.74)
    controls.current?.target.set(0, 0, 0)
    controls.current?.update()
    invalidate()
  }, [get, invalidate, resetKey, aspect])
  return <OrbitControls ref={controls} makeDefault enabled={active} enableDamping={false} autoRotate={orbit && active && !reducedMotion} autoRotateSpeed={0.6} minDistance={6} maxDistance={64} maxPolarAngle={Math.PI / 2.15} />
}

function ContextGuard({ onFailure }: { onFailure: () => void }) {
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    const lost = (event: Event) => { event.preventDefault(); onFailure() }
    gl.domElement.addEventListener("webglcontextlost", lost)
    return () => gl.domElement.removeEventListener("webglcontextlost", lost)
  }, [gl, onFailure])
  return null
}


export default function OrganizationScene({ modules, selected, onSelect, resetKey, orbit, active, reducedMotion, lang, onFailure }: OrganizationSceneProps) {
  return (
    <Canvas aria-label={lang === "th" ? "แผนที่โมดูลและภาระงานองค์กร" : "Organization module workload map"} role="img"
      frameloop={!active ? "never" : orbit && !reducedMotion ? "always" : "demand"} dpr={[1, 1.5]}
      camera={{ position: [9, 10, 13], fov: 45 }} gl={{ antialias: true, alpha: false, powerPreference: "low-power" }}
      fallback={<p className="p-6">3D unavailable / ใช้รายการโมดูลด้านล่าง</p>} onError={onFailure}>
      <color attach="background" args={["#0d1017"]} />
      <ambientLight intensity={1.2} />
      <directionalLight position={[5, 9, 6]} intensity={2} />
      <gridHelper args={[18, 18, "#5d4c31", "#242731"]} position={[0, -0.02, 0]} />
      {modules.map((module, index) => {
        const height = Math.max(0.25, Math.min(4, Math.log2(module.workload + 1)))
        const x = (index % 3 - 1) * 4
        const z = (Math.floor(index / 3) - 0.5) * 5
        const current = module.id === selected
        const attention = module.metrics.some((metric) => metric.attention)
        return (
          <group key={module.id} position={[x, 0, z]}>
            <mesh position={[0, height / 2, 0]} onClick={(event) => { event.stopPropagation(); if (event.delta <= 5) onSelect(module.id) }}>
              <boxGeometry args={[2, height, 2]} />
              <meshStandardMaterial color={current ? "#b1843a" : "#34313a"} metalness={0.25} roughness={0.65} />
              <Edges color={current ? "#fff0c5" : attention ? "#f5b941" : "#9a8867"} />
            </mesh>
            {current && <CanvasLabel title={module[lang]} detail={module.workload.toLocaleString()} position={[0, height + 0.9, 0]} />}
          </group>
        )
      })}
      <ContextGuard onFailure={onFailure} />
      <Controls resetKey={resetKey} orbit={orbit} active={active} reducedMotion={reducedMotion} />
    </Canvas>
  )
}
