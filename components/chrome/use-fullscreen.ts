"use client"

import { useCallback, useEffect, useState } from "react"

type WindowState = { desktop?: boolean; fullscreen?: boolean }

async function windowCall(init?: RequestInit): Promise<WindowState | null> {
  try {
    const response = await fetch("/api/desktop-window", init)
    return response.ok ? ((await response.json()) as WindowState) : null
  } catch {
    return null
  }
}

/** Desktop: the Wails window through the ERP server. Browser (no helper): the Fullscreen API on the document. */
export function useFullscreen() {
  const [desktop, setDesktop] = useState(false)
  const [on, setOn] = useState(false)

  const sync = useCallback(() => {
    void windowCall().then(state => {
      if (!state?.desktop) return
      setDesktop(true)
      setOn(state.fullscreen === true)
    })
  }, [])

  useEffect(() => {
    sync()
    const onDocument = () => setOn(Boolean(document.fullscreenElement))
    document.addEventListener("fullscreenchange", onDocument)
    // The user can leave desktop fullscreen with the window controls: re-read on resize.
    window.addEventListener("resize", sync)
    return () => {
      document.removeEventListener("fullscreenchange", onDocument)
      window.removeEventListener("resize", sync)
    }
  }, [sync])

  const toggle = useCallback(async () => {
    if (desktop) {
      const state = await windowCall({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullscreen: !on }) })
      if (state?.desktop) setOn(state.fullscreen === true)
      return
    }
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      // The browser refused (no user gesture or policy). Nothing to recover.
    }
  }, [desktop, on])

  return { on, toggle }
}
