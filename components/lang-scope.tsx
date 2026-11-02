"use client"

import { createContext, useContext, useEffect, useState, useTransition, type ReactNode } from "react"

import { saveLang } from "@/app/(app)/reports/lang-action"
import { Button } from "@/components/ui/button"

type Lang = "th" | "en"
type LangState = { lang: Lang; toggle: () => void }

const ShellLang = createContext<LangState | null>(null)
/** The language of the nearest LangShell/LangScope; null outside both. */
const ActiveLang = createContext<Lang | null>(null)

/** Current UI language ("th" default). <Bi> and nav labels read this, so no CSS group trick is needed. */
export function useLang(): Lang {
  return useContext(ActiveLang) ?? "th"
}

function useLangState(initial: Lang): LangState {
  const [lang, setLang] = useState<Lang>(initial)
  const [, start] = useTransition()
  const toggle = () => {
    const next: Lang = lang === "th" ? "en" : "th"
    setLang(next)
    start(() => { void saveLang(next) })
  }
  return { lang, toggle }
}

function LangButton({ lang, toggle }: LangState) {
  return (
    <Button type="button" variant="outline" size="sm" aria-label={lang === "th" ? "Switch to English" : "สลับเป็นภาษาไทย"} onClick={toggle}>
      {lang === "th" ? "สลับ ENG" : "สลับ ไทย"}
    </Button>
  )
}

/**
 * App-wide language for the authenticated shell: every <Bi> below it follows one state.
 * Put <LangToggle /> in the header; page-level <LangScope> then reuses this state.
 */
export function LangShell({ initial, children }: { initial: Lang; children: ReactNode }) {
  const state = useLangState(initial)
  useEffect(() => { document.documentElement.lang = state.lang }, [state.lang])
  return (
    <ShellLang.Provider value={state}>
      <ActiveLang.Provider value={state.lang}>
        <div data-lang={state.lang} lang={state.lang} className="group/lang flex min-h-svh w-full flex-col">{children}</div>
      </ActiveLang.Provider>
    </ShellLang.Provider>
  )
}

export function LangToggle() {
  const state = useContext(ShellLang)
  return state ? <span className="print:hidden"><LangButton {...state} /></span> : null
}

/**
 * Shows one language at a time inside `children`. Thai is the default; the button
 * (สลับ ENG / สลับ ไทย) flips it and saves it on profiles.locale. Strings come from <Bi>.
 * Inside <LangShell> it follows the header toggle and shows no button of its own.
 */
export function LangScope({ initial, children }: { initial: Lang; children: ReactNode }) {
  const shell = useContext(ShellLang)
  const own = useLangState(initial)
  if (shell) return <div className="space-y-6">{children}</div>
  return (
    <ActiveLang.Provider value={own.lang}>
      <div data-lang={own.lang} lang={own.lang} className="group/lang space-y-6">
        <div className="flex justify-end print:hidden"><LangButton {...own} /></div>
        {children}
      </div>
    </ActiveLang.Provider>
  )
}
