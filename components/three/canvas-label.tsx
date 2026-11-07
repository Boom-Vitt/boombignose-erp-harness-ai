"use client"

import { useEffect, useRef } from "react"
import { useThree } from "@react-three/fiber"
import { CanvasTexture, Sprite, SpriteMaterial, SRGBColorSpace } from "three"
import type { Vector3Tuple } from "three"

/** A texture in the existing scene, not a nested React DOM root or remote font. */
export function CanvasLabel({ title, detail, position, width = 3.2 }: { title: string; detail: string; position: Vector3Tuple; width?: number }) {
  const sprite = useRef<Sprite>(null)
  const invalidate = useThree((state) => state.invalidate)
  useEffect(() => {
    const material = sprite.current?.material
    if (!(material instanceof SpriteMaterial)) return
    const canvas = document.createElement("canvas")
    canvas.width = 384
    canvas.height = 144
    const context = canvas.getContext("2d")
    if (!context) return
    context.fillStyle = "#0d1017"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.strokeStyle = "#b1843a"
    context.strokeRect(2, 2, canvas.width - 4, canvas.height - 4)
    context.textAlign = "center"
    function line(text: string, size: number, y: number, color: string) {
      if (!context) return
      context.font = `600 ${size}px sans-serif`
      const width = context.measureText(text).width
      if (width > 356) context.font = `600 ${Math.floor(size * 356 / width)}px sans-serif`
      context.fillStyle = color
      context.fillText(text, 192, y)
    }
    line(title, 42, 58, "#f5b941")
    line(detail, 34, 118, "#ffffff")
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    material.map = texture
    material.needsUpdate = true
    invalidate()
    return () => {
      if (material.map === texture) material.map = null
      texture.dispose()
      canvas.width = 0
      canvas.height = 0
    }
  }, [title, detail, invalidate])
  return <sprite ref={sprite} position={position} scale={[width, width * 0.375, 1]}>
    <spriteMaterial transparent depthTest={false} />
  </sprite>
}
