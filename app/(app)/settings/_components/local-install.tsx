"use client"

import { useState, useTransition } from "react"
import { START_LOGS } from "@/lib/install/log-names"
import { APP_VERSION } from "@/lib/release/version"
import { DEFERRED_MESSAGE, WINDOW_MESSAGE } from "@/lib/release/update-plan"
import { Button } from "@/components/ui/button"
import { checkForUpdate, readLocalLog, type UpdateStatus } from "../local-actions"

export function UpdateCheckButton({ canUpdate = false }: { canUpdate?: boolean }) {
  const [pending, start] = useTransition()
  const [installing, setInstalling] = useState(false)
  const [result, setResult] = useState<UpdateStatus | null>(null)
  const [progress, setProgress] = useState("")
  const [error, setError] = useState("")

  async function install() {
    setError("")
    setInstalling(true)
    setProgress("กำลังดาวน์โหลด / Downloading…")
    let sawRestart = false
    try {
      const response = await fetch("/api/desktop-update", { method: "POST" })
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => null)) as { error?: string } | null
        setError(data?.error || "ติดตั้งไม่สำเร็จ / The update did not install.")
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
          if (event.phase === "error") setError(event.message || "ติดตั้งไม่สำเร็จ / The update did not install.")
          if (event.phase === "download" && event.total) setProgress(`${Math.min(100, Math.round(((event.received ?? 0) / event.total) * 100))}%`)
          if (event.phase === "sums" || event.phase === "verify") setProgress("กำลังตรวจ SHA256 / Checking SHA256…")
          if (event.phase === "restart" || event.phase === "apply") {
            sawRestart = true
            setProgress("กำลังเปิดใหม่ / Restarting…")
          }
        }
      }
    } catch {
      if (!sawRestart) setError("ติดตั้งไม่สำเร็จ / The update did not install.")
    } finally {
      setInstalling(false)
    }
  }

  const showInstall = result?.state === "available" && result.capability === "apply" && canUpdate
  return <div id="app-update" className="bbn-sketch space-y-3">
    <ol className="bbn-sketch-steps" aria-label="ขั้นตอนอัปเดต / Update steps">
      <li><span className="bbn-step-pill">1</span><span>ตรวจเวอร์ชัน / Check the version</span></li>
      <li><span className="bbn-step-pill">2</span><span>ดาวน์โหลดแล้วตรวจ SHA256 / Download and check SHA256</span></li>
      <li><span className="bbn-step-pill">3</span><span>ติดตั้งแล้วเปิดใหม่ / Install and reopen</span></li>
    </ol>
    <p className="text-sm text-muted-foreground">ติดตั้งอยู่รุ่น {APP_VERSION}. กดตรวจเมื่อต้องการ. บน macOS Apple Silicon แอปดาวน์โหลด ตรวจ SHA256 แล้วติดตั้งให้. บน Windows และ Linux รุ่นนี้ยังติดตั้งทับให้อัตโนมัติไม่ได้ / Installed version {APP_VERSION}. The check runs when you ask. On macOS Apple Silicon this app downloads, checks SHA256, and installs. On Windows and Linux this version does not replace the app automatically.</p>
    <Button type="button" disabled={pending || installing} onClick={() => start(async () => { setError(""); setResult(await checkForUpdate()) })}>{pending ? "กำลังตรวจ…" : "ตรวจอัปเดต / Check for updates"}</Button>
    {result?.state === "available" ? <aside className="bbn-sticky text-sm">รุ่น {result.version} พร้อมแล้ว / Version {result.version} is published. <a className="underline" href={result.url} target="_blank" rel="noopener noreferrer">เปิดหน้า release / Open the release page</a></aside> : null}
    {result?.state === "current" ? <p className="text-sm">รุ่นนี้ตรงกับที่เผยแพร่ / This install matches the published release. <a className="underline" href={result.url} target="_blank" rel="noopener noreferrer">เปิดหน้า release / Open the release page</a></p> : null}
    {result?.state === "unavailable" ? <p role="alert" className="text-sm">{result.message}</p> : null}
    {result?.state === "available" && result.capability === "deferred" ? <p className="text-sm">{DEFERRED_MESSAGE}</p> : null}
    {result?.state === "available" && result.capability === "needs-window" ? <p className="text-sm">{WINDOW_MESSAGE}</p> : null}
    {result?.state === "available" && result.capability === "apply" && !canUpdate ? <p className="text-sm">เฉพาะเจ้าของหรือผู้ดูแลติดตั้งอัปเดตได้ / Only an owner or admin can install an update.</p> : null}
    {showInstall ? <Button type="button" disabled={installing} onClick={() => void install()}>{installing ? "กำลังติดตั้ง…" : "ดาวน์โหลดและติดตั้ง / Download and install"}</Button> : null}
    {progress ? <p className="text-sm tabular-nums">{progress}</p> : null}
    {error ? <p role="alert" className="text-sm">{error}</p> : null}
  </div>
}

export function StartLogViewer() {
  const [name, setName] = useState<(typeof START_LOGS)[number]>("server.log")
  const [pending, start] = useTransition()
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState("")
  return <div className="space-y-3">
    <p className="text-sm text-muted-foreground">Postgres, auth, and API start logs from this computer. Database URLs and tokens are hidden. Nothing is sent over the network.</p>
    <label className="block text-sm">Log<select className="mt-1 block h-9 rounded-md border bg-background px-2" value={name} onChange={event => setName(event.target.value as (typeof START_LOGS)[number])}>{START_LOGS.map(log => <option key={log} value={log}>{log}</option>)}</select></label>
    <Button type="button" disabled={pending} onClick={() => start(async () => {
      const result = await readLocalLog(name)
      if ("error" in result) { setError(result.error); setText(null); return }
      setError(""); setText(result.text || "(empty)")
    })}>{pending ? "Reading…" : "Show log"}</Button>
    {error ? <p role="alert" className="text-sm">{error}</p> : null}
    {text !== null ? <pre className="max-h-80 overflow-auto rounded-md border p-3 text-xs whitespace-pre-wrap">{text}</pre> : null}
  </div>
}
