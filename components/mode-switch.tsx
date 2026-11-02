"use client"

import Link from "next/link"
import { Boxes, Cpu } from "lucide-react"
import { useSyncExternalStore } from "react"

import { MODE_ICON } from "@/components/nav"
import { MODES, MODE_COPY, MODE_KEY, parseMode, type Mode } from "@/lib/mode"

const EVENT = "bbn-mode-change"

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange)
  window.addEventListener("storage", onChange)
  return () => {
    window.removeEventListener(EVENT, onChange)
    window.removeEventListener("storage", onChange)
  }
}

/** Operator mode, kept in localStorage. Server render and first paint use the default. */
export function useMode(): Mode {
  return useSyncExternalStore(
    subscribe,
    () => parseMode(window.localStorage.getItem(MODE_KEY)),
    () => parseMode(null),
  )
}

function setMode(mode: Mode) {
  window.localStorage.setItem(MODE_KEY, mode)
  window.dispatchEvent(new Event(EVENT))
}

export function ModeSwitch() {
  const mode = useMode()
  return (
    <div
      role="radiogroup"
      aria-label="โหมดการใช้งาน / Operator mode"
      className="bbn-mode bbn-sketch"
      style={{ "--i": MODES.indexOf(mode) } as React.CSSProperties}
    >
      <span aria-hidden className="bbn-mode-thumb" />
      {MODES.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={mode === m}
          data-mode={m}
          onClick={() => setMode(m)}
          className="bbn-mode-pill"
          title={`${MODE_COPY[m].th} / ${MODE_COPY[m].en}`}
        >
          <span className="hidden xl:inline">{MODE_COPY[m].th} · </span>
          {MODE_COPY[m].en}
        </button>
      ))}
    </div>
  )
}

export function ModeTip() {
  const mode = useMode()
  const copy = MODE_COPY[mode]
  const Icon = MODE_ICON[mode]
  return (
    <p className="bbn-sticky !m-0 items-center text-sm" data-testid="mode-tip">
      <Icon className="text-gold size-4 shrink-0 self-center" aria-hidden />
      <strong>{copy.th} / {copy.en}</strong>
      <span>{copy.tipTh} / {copy.tipEn}</span>
      <span className="ml-auto flex flex-wrap items-center gap-2">
        {mode === "individual" ? (
          <Link href="/settings#local-models" prefetch={false} className="bbn-chip no-underline">
            <Cpu className="size-3" aria-hidden />
            AI บนเครื่อง / Local AI
          </Link>
        ) : null}
        <Link href="/warehouse" prefetch={false} className="bbn-chip no-underline" data-testid="open-campus-3d">
          <Boxes className="size-3" aria-hidden />
          เปิด Campus 3D / Open Campus 3D
        </Link>
      </span>
    </p>
  )
}
