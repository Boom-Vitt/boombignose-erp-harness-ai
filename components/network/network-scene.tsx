"use client"

import { useEffect, useMemo, useRef, type ComponentRef } from "react"
import { Canvas, useThree } from "@react-three/fiber"
import { Edges, Line, OrbitControls } from "@react-three/drei"
import { PerspectiveCamera, Quaternion, Vector3 } from "three"

import type { TopologyEdge, TopologyNode } from "@/lib/network/model"
import { CanvasLabel } from "@/components/three/canvas-label"

const GOLD = "#d5ad62"
const BRIGHT = "#fff0c5"
const BACKGROUND = "#0d1017"
const CAMERA_LABEL = "3D network topology — ERP, registered computers, and observed network peers"

export type NetworkSceneProps = {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  selectedEdgeId: string | null
  onSelectEdge: (id: string) => void
  resetKey: number
  onFailure: () => void
}

type Bounds = { x: number; y: number; z: number; radius: number }

function sceneBounds(nodes: TopologyNode[]): Bounds {
  if (!nodes.length) return { x: 0, y: 0, z: 0, radius: 4 }
  let minX = Infinity, minY = Infinity, minZ = Infinity
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
  for (const { position: [x, y, z] } of nodes) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
    z: (minZ + maxZ) / 2,
    radius: Math.max(3, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2 + 1.6),
  }
}

function CameraControls({ bounds, resetKey }: { bounds: Bounds; resetKey: number }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null)
  const get = useThree((state) => state.get)
  const invalidate = useThree((state) => state.invalidate)
  const aspect = useThree((state) => state.size.width / Math.max(1, state.size.height))
  const { x, y, z, radius } = bounds

  useEffect(() => {
    const camera = get().camera
    const orbit = controls.current
    if (!orbit || !(camera instanceof PerspectiveCamera)) return
    const verticalFov = camera.fov * Math.PI / 180
    const fitFov = Math.min(verticalFov, 2 * Math.atan(Math.tan(verticalFov / 2) * aspect))
    const distance = radius / Math.sin(fitFov / 2) * 1.15
    camera.position.set(x + distance * 0.5, y + distance * 0.45, z + distance * 0.74)
    camera.near = Math.max(0.01, radius / 1000)
    camera.far = Math.max(1000, distance * 20)
    camera.updateProjectionMatrix()
    orbit.target.set(x, y, z)
    orbit.update()
    orbit.saveState()
    invalidate()
  }, [get, invalidate, resetKey, aspect, x, y, z, radius])

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping={false}
      enableRotate
      enablePan
      enableZoom
      minDistance={Math.max(1, radius * 0.15)}
      maxDistance={Math.max(100, radius * 15)}
    />
  )
}

function ContextGuard({ onFailure }: { onFailure: () => void }) {
  const gl = useThree((state) => state.gl)
  useEffect(() => {
    const canvas = gl.domElement
    canvas.setAttribute("aria-label", CAMERA_LABEL)
    canvas.setAttribute("role", "img")
    const lost = (event: Event) => {
      event.preventDefault()
      onFailure()
    }
    canvas.addEventListener("webglcontextlost", lost)
    return () => canvas.removeEventListener("webglcontextlost", lost)
  }, [gl, onFailure])
  return null
}


function MachineNode({ node }: { node: TopologyNode }) {
  const color = node.kind === "erp" ? BRIGHT : GOLD
  return (
    <group position={node.position}>
      {node.kind === "erp" ? (
        <group>
          <mesh>
            <boxGeometry args={[1.15, 1.5, 0.8]} />
            <meshStandardMaterial color="#3a3023" metalness={0.45} roughness={0.65} />
            <Edges color={color} />
          </mesh>
          {[-0.42, 0, 0.42].map((y) => (
            <mesh key={y} position={[0, y, 0.415]}>
              <boxGeometry args={[0.83, 0.07, 0.035]} />
              <meshBasicMaterial color={GOLD} />
            </mesh>
          ))}
        </group>
      ) : node.kind === "device" ? (
        <group>
          <mesh position={[0, 0.14, 0]}>
            <boxGeometry args={[1.3, 0.85, 0.15]} />
            <meshStandardMaterial color="#202b38" metalness={0.25} roughness={0.75} />
            <Edges color={color} />
          </mesh>
          <mesh position={[0, -0.45, 0]}>
            <boxGeometry args={[0.13, 0.35, 0.13]} />
            <meshStandardMaterial color={GOLD} roughness={0.8} />
          </mesh>
          <mesh position={[0, -0.65, 0.1]}>
            <boxGeometry args={[0.65, 0.08, 0.4]} />
            <meshStandardMaterial color="#665332" roughness={0.8} />
          </mesh>
        </group>
      ) : (
        <mesh>
          <octahedronGeometry args={[0.67, 0]} />
          <meshStandardMaterial color="#293039" metalness={0.3} roughness={0.7} />
          <Edges color={color} />
        </mesh>
      )}
      <CanvasLabel title={node.label} detail={node.detail} width={2.8} position={[0, 1.4, 0]} />
    </group>
  )
}

function ConnectionEdge({ edge, source, target, selected, onSelect }: {
  edge: TopologyEdge
  source: TopologyNode
  target: TopologyNode
  selected: boolean
  onSelect: (id: string) => void
}) {
  // Compute geometry only when endpoint positions change, never on a frame loop.
  const [sx, sy, sz] = source.position
  const [tx, ty, tz] = target.position
  const geometry = useMemo(() => {
    const start = new Vector3(sx, sy, sz)
    const end = new Vector3(tx, ty, tz)
    const direction = end.clone().sub(start)
    const length = direction.length()
    const rotation = new Quaternion()
    if (length > 0) rotation.setFromUnitVectors(new Vector3(0, 1, 0), direction.divideScalar(length))
    return {
      length,
      rotation,
      points: [start, end],
      midpoint: start.clone().lerp(end, 0.5),
      arrow: start.clone().lerp(end, 0.7),
    }
  }, [sx, sy, sz, tx, ty, tz])
  const color = selected ? BRIGHT : edge.review ? "#efaa69" : edge.kind === "report" ? "#9b855c" : GOLD
  if (geometry.length < 0.001) return null

  return (
    <group>
      <Line
        points={geometry.points}
        color={color}
        lineWidth={selected ? 3.5 : 1.7}
        dashed={edge.kind === "report" || edge.kind === "enrollment"}
        dashSize={0.22}
        gapSize={0.16}
      />
      {/* The invisible widened mesh provides a real edge raycast target. */}
      <mesh
        position={geometry.midpoint}
        quaternion={geometry.rotation}
        onClick={(event) => {
          event.stopPropagation()
          if (event.delta <= 5) onSelect(edge.id)
        }}
      >
        <cylinderGeometry args={[0.16, 0.16, geometry.length, 6, 1, true]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      {(edge.kind === "report" || edge.kind === "ssh") && (
        <mesh position={geometry.arrow} quaternion={geometry.rotation}>
          <coneGeometry args={[selected ? 0.17 : 0.13, 0.36, 8]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )}
    </group>
  )
}

export default function NetworkScene({
  nodes, edges, selectedEdgeId, onSelectEdge, resetKey, onFailure,
}: NetworkSceneProps) {
  const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes])
  const bounds = useMemo(() => sceneBounds(nodes), [nodes])

  return (
    <Canvas
      aria-label={CAMERA_LABEL}
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ position: [10, 9, 15], fov: 42 }}
      gl={{ antialias: true, alpha: false, powerPreference: "low-power" }}
      fallback={<p>3D unavailable. Use the connection list to inspect evidence.</p>}
      style={{ width: "100%", height: "100%", background: BACKGROUND }}
    >
      <color attach="background" args={[BACKGROUND]} />
      <ambientLight intensity={1.3} />
      <directionalLight position={[5, 9, 6]} color="#ffe0a1" intensity={2} />
      <CameraControls bounds={bounds} resetKey={resetKey} />
      <ContextGuard onFailure={onFailure} />
      {edges.map((edge) => {
        const source = nodeById.get(edge.source)
        const target = nodeById.get(edge.target)
        return source && target ? (
          <ConnectionEdge
            key={edge.id}
            edge={edge}
            source={source}
            target={target}
            selected={selectedEdgeId === edge.id}
            onSelect={onSelectEdge}
          />
        ) : null
      })}
      {nodes.map((node) => <MachineNode key={node.id} node={node} />)}
    </Canvas>
  )
}
