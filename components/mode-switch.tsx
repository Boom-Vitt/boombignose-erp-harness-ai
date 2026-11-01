"use client"

import { useSyncExternalStore } from "react"

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
    <div role="radiogroup" aria-label="โหมดการใช้งาน / Operator mode" className="bbn-sketch flex min-w-0 shrink items-center gap-0.5 sm:gap-1">
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
          <span className="hidden lg:inline">{MODE_COPY[m].th} · </span>
          {MODE_COPY[m].en}
        </button>
      ))}
    </div>
  )
}

export function ModeTip() {
  const mode = useMode()
  const copy = MODE_COPY[mode]
  return (
    <p className="bbn-sketch bbn-sticky !m-0 text-sm" data-testid="mode-tip">
      <strong>{copy.th} / {copy.en}</strong> · {copy.tipTh} / {copy.tipEn}
    </p>
  )
}
