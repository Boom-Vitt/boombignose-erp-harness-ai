"use client"

import { useState, useTransition, type ReactNode } from "react"

import { saveLang } from "@/app/(app)/reports/lang-action"
import { Button } from "@/components/ui/button"

type Lang = "th" | "en"

/**
 * Shows one language at a time inside `children`. Thai is the default; the button
 * (สลับ ENG / สลับ ไทย) flips it and saves it on profiles.locale. Strings come from <Bi>.
 */
export function LangScope({ initial, children }: { initial: Lang; children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(initial)
  const [, start] = useTransition()
  const next: Lang = lang === "th" ? "en" : "th"
  return (
    <div data-lang={lang} className="group/lang space-y-6">
      <div className="flex justify-end print:hidden">
        <Button type="button" variant="outline" size="sm" aria-label={lang === "th" ? "Switch to English" : "สลับเป็นภาษาไทย"} onClick={() => { setLang(next); start(() => { void saveLang(next) }) }}>
          {lang === "th" ? "สลับ ENG" : "สลับ ไทย"}
        </Button>
      </div>
      {children}
    </div>
  )
}
