"use client"

import { useState, useTransition } from "react"
import { checkForUpdate, type UpdateStatus } from "@/app/(app)/settings/local-actions"

const INSTALL_FAILED = "ติดตั้งไม่สำเร็จ / The update did not install."

/** One update flow for the Settings card and the version dock: check, then install through /api/desktop-update. */
export function useUpdate(canUpdate: boolean) {
  const [checking, startCheck] = useTransition()
  const [installing, setInstalling] = useState(false)
  const [result, setResult] = useState<UpdateStatus | null>(null)
  const [progress, setProgress] = useState("")
  const [error, setError] = useState("")

  function check() {
    startCheck(async () => {
      setError("")
      setResult(await checkForUpdate())
    })
  }

  async function install() {
    setError("")
    setInstalling(true)
    setProgress("กำลังดาวน์โหลด / Downloading…")
    let sawRestart = false
    try {
      const response = await fetch("/api/desktop-update", { method: "POST" })
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setError(data?.error || INSTALL_FAILED)
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let pendingText = ""
      for (;;) {
        const step = await reader.read()
        if (step.done) break
        pendingText += decoder.decode(step.value, { stream: true })
        const lines = pendingText.split("\n")
        pendingText = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line) as { phase?: string; message?: string; received?: number; total?: number | null }
          if (event.phase === "error") setError(event.message || INSTALL_FAILED)
          if (event.phase === "download" && event.total) setProgress(`${Math.min(100, Math.round(((event.received ?? 0) / event.total) * 100))}%`)
          if (event.phase === "sums" || event.phase === "verify") setProgress("กำลังตรวจ SHA256 / Checking SHA256…")
          if (event.phase === "restart" || event.phase === "apply") {
            sawRestart = true
            setProgress("กำลังเปิดใหม่ / Restarting…")
          }
        }
      }
    } catch {
      if (!sawRestart) setError(INSTALL_FAILED)
    } finally {
      setInstalling(false)
    }
  }

  const showInstall = result?.state === "available" && result.capability === "apply" && canUpdate
  return { checking, installing, result, progress, error, showInstall, check, install }
}
