"use client"

import Link from "next/link"
import { useSyncExternalStore } from "react"

import { MODE_ICON } from "@/components/nav"
import { useLang } from "@/components/lang-scope"
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

/** Local view preference only; never changes workspace membership, entity type or data. */
export function useMode(): Mode {
  return useSyncExternalStore(subscribe, () => parseMode(window.localStorage.getItem(MODE_KEY)), () => parseMode(null))
}

function setMode(mode: Mode) {
  window.localStorage.setItem(MODE_KEY, mode)
  window.dispatchEvent(new Event(EVENT))
}

export function ModeSwitch() {
  const mode = useMode()
  const lang = useLang()
  return (
    <>
      <label className="min-w-0 shrink-0 lg:hidden">
        <span className="sr-only">โปรไฟล์งาน / Task profile</span>
        <select aria-label="โปรไฟล์งาน / Task profile" value={mode} onChange={(event) => setMode(parseMode(event.target.value))} className="h-8 w-28 max-w-full rounded-full border bg-background px-2 text-xs">
          {MODES.map((m) => <option key={m} value={m}>{MODE_COPY[m][lang]}</option>)}
        </select>
      </label>
      <div role="radiogroup" aria-label="โปรไฟล์งาน / Task profile" className="bbn-mode hidden! lg:inline-grid!" style={{ "--i": MODES.indexOf(mode) } as React.CSSProperties}>
        <span aria-hidden className="bbn-mode-thumb" />
        {MODES.map((m, index) => (
          <button key={m} type="button" role="radio" aria-checked={mode === m} tabIndex={mode === m ? 0 : -1} data-mode={m} onClick={() => setMode(m)}
            onKeyDown={(event) => {
              const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0
              if (!delta && event.key !== "Home" && event.key !== "End") return
              event.preventDefault()
              const next = event.key === "Home" ? 0 : event.key === "End" ? MODES.length - 1 : (index + delta + MODES.length) % MODES.length
              setMode(MODES[next])
              const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("button")
              buttons?.[next]?.focus()
            }}
            className="bbn-mode-pill" title={`${MODE_COPY[m].th} / ${MODE_COPY[m].en}`}>
            {MODE_COPY[m][lang]}
          </button>
        ))}
      </div>
    </>
  )
}

export function ModeTip() {
  const mode = useMode()
  const lang = useLang()
  const copy = MODE_COPY[mode]
  const Icon = MODE_ICON[mode]
  return (
    <section className="bbn-sticky !m-0 text-sm" data-testid="mode-tip" data-profile={mode} aria-label={lang === "th" ? "งานเริ่มต้นของโปรไฟล์" : "Profile starter tasks"}>
      <div className="flex w-full flex-wrap items-center gap-2">
        <Icon className="text-gold size-4 shrink-0" aria-hidden />
        <strong>{copy[lang]}</strong>
        <span>{lang === "th" ? copy.tipTh : copy.tipEn}</span>
      </div>
      <nav aria-label={lang === "th" ? "งานเริ่มต้น" : "Starter tasks"} className="flex w-full flex-wrap gap-2">
        {copy.tasks.map((task) => <Link key={task.href} href={task.href} prefetch={false} className="bbn-chip no-underline">{task[lang]} →</Link>)}
      </nav>
      <p className="!m-0 text-xs text-muted-foreground">{lang === "th" ? "โปรไฟล์เปลี่ยนเฉพาะมุมมองและงานเริ่มต้น ไม่ใช่รูปแบบนิติบุคคลหรือสิทธิ์เข้าถึง ข้อมูลเดิมยังอยู่ครบ · เปิดโมดูลอื่นได้จากแถบเมนู" : "Profiles change views and starter tasks, not legal entity type or permissions. Existing data stays intact · Find other modules in the sidebar."}</p>
    </section>
  )
}
