"use client"

import { Component, useCallback, useState, useSyncExternalStore, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { usePathname } from "next/navigation"

import { useMode } from "@/components/mode-switch"
import type { Mode } from "@/lib/mode"
import { sectionOf, type Section } from "./sections"

// Three.js and the scene load only in the browser, after the page is usable.
const Scene = dynamic(() => import("./scene"), { ssr: false })

let webglOk: boolean | undefined
function hasWebGL(): boolean {
  if (webglOk === undefined) {
    try {
      const c = document.createElement("canvas")
      webglOk = Boolean(c.getContext("webgl2") ?? c.getContext("webgl"))
    } catch {
      webglOk = false
    }
  }
  return webglOk
}

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const m = window.matchMedia(query)
    m.addEventListener("change", onChange)
    return () => m.removeEventListener("change", onChange)
  }
}
const subscribeMotion = subscribeMedia("(prefers-reduced-motion: reduce)")
const subscribeVisible = (onChange: () => void) => {
  document.addEventListener("visibilitychange", onChange)
  return () => document.removeEventListener("visibilitychange", onChange)
}

class Boundary extends Component<{ onFail: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onFail()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

/**
 * The persistent 3D base behind every authenticated page (and the login). Full-bleed, never
 * takes pointer events, pauses when the tab is hidden, shows one still frame under reduced
 * motion, and falls back to the flat artwork (always painted underneath) when WebGL is
 * missing or the context is lost. Scene follows the operator mode and the current section.
 */
export function StageBackdrop({ mode: forced, section: forcedSection }: { mode?: Mode; section?: Section }) {
  const current = useMode()
  const mode = forced ?? current
  const pathname = usePathname()
  const section = forcedSection ?? sectionOf(pathname)
  const [failed, setFailed] = useState(false)
  const onFail = useCallback(() => setFailed(true), [])
  const gl = useSyncExternalStore(() => () => {}, hasWebGL, () => false)
  const still = useSyncExternalStore(subscribeMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => false)
  const active = useSyncExternalStore(subscribeVisible, () => document.visibilityState === "visible", () => true)

  return (
    <div aria-hidden className="bbn-stage" data-mode={mode} data-section={section} data-3d={gl && !failed ? "on" : "off"}>
      <div className="bbn-stage-flat" />
      {gl && !failed ? (
        <div className="bbn-stage-canvas">
          <Boundary onFail={onFail}>
            <Scene mode={mode} section={section} active={active} still={still} onFail={onFail} />
          </Boundary>
        </div>
      ) : null}
    </div>
  )
}
