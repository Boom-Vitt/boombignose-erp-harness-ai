import type { ReactNode } from "react"

/** A Thai/English string pair. Only the active language of the nearest <LangScope> shows. */
export function Bi({ th, en }: { th: ReactNode; en: ReactNode }) {
  return (
    <>
      <span lang="th" className="group-data-[lang=en]/lang:hidden">{th}</span>
      <span lang="en" className="group-data-[lang=th]/lang:hidden">{en}</span>
    </>
  )
}
