"use client"

import type { ReactNode } from "react"

import { useLang } from "@/components/lang-scope"

/**
 * A Thai/English string pair. Renders only the active language of the nearest
 * <LangShell>/<LangScope> (Thai when there is none). React state drives it, so it
 * works regardless of wrapper display or Tailwind group names.
 */
export function Bi({ th, en }: { th: ReactNode; en: ReactNode }) {
  const lang = useLang()
  return lang === "en" ? <span lang="en">{en}</span> : <span lang="th">{th}</span>
}
