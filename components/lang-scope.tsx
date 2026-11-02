"use client"

import { createContext, useContext, useState, useTransition, type ReactNode } from "react"

import { saveLang } from "@/app/(app)/reports/lang-action"
import { Button } from "@/components/ui/button"

type Lang = "th" | "en"
type LangState = { lang: Lang; toggle: () => void }

const ShellLang = createContext<LangState | null>(null)

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
  return (
    <ShellLang.Provider value={state}>
      <div data-lang={state.lang} className="group/lang contents">{children}</div>
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
    <div data-lang={own.lang} className="group/lang space-y-6">
      <div className="flex justify-end print:hidden"><LangButton {...own} /></div>
      {children}
    </div>
  )
}
