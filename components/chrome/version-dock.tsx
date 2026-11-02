"use client"

import { Maximize2, Minimize2 } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { APP_VERSION } from "@/lib/release/version"
import { DEFERRED_MESSAGE, WINDOW_MESSAGE } from "@/lib/release/update-plan"
import { useFullscreen } from "./use-fullscreen"
import { useUpdate } from "./use-update"

/** Bottom-right strip on every signed-in page: installed version (opens the update check) and fullscreen. */
export function VersionDock({ canUpdate }: { canUpdate: boolean }) {
  const { checking, installing, result, progress, error, showInstall, check, install } = useUpdate(canUpdate)
  const { on, toggle } = useFullscreen()
  const fullscreenLabel = on ? "ออกจากเต็มจอ / Exit fullscreen" : "เต็มจอ / Fullscreen"
  const Icon = on ? Minimize2 : Maximize2
  const dot = result?.state === "available" || installing

  return (
    <div className="bbn-chip fixed right-3 bottom-3 z-40 gap-1 !bg-background/80 py-0.5 pr-1 pl-2 text-xs backdrop-blur-md print:hidden">
      <Popover>
        <PopoverTrigger
          render={<button type="button" />}
          aria-label={`รุ่น ${APP_VERSION} ตรวจอัปเดต / Version ${APP_VERSION}, check for updates`}
          className="inline-flex items-center gap-1.5 tabular-nums"
        >
          v{APP_VERSION}
          {dot ? <span aria-hidden className="size-1.5 rounded-full bg-current" /> : null}
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-80 max-w-[calc(100vw-1.5rem)]">
          <p className="tabular-nums">ติดตั้งอยู่รุ่น {APP_VERSION} / Installed version {APP_VERSION}</p>
          <Button type="button" size="sm" disabled={checking || installing} onClick={check}>{checking ? "กำลังตรวจ…" : "ตรวจอัปเดต / Check for updates"}</Button>
          {result?.state === "available" ? <p>รุ่น {result.version} พร้อมแล้ว / Version {result.version} is published. <a className="underline" href={result.url} target="_blank" rel="noopener noreferrer">เปิดหน้า release / Open the release page</a></p> : null}
          {result?.state === "current" ? <p>รุ่นนี้ตรงกับที่เผยแพร่ / This install matches the published release. <a className="underline" href={result.url} target="_blank" rel="noopener noreferrer">เปิดหน้า release / Open the release page</a></p> : null}
          {result?.state === "unavailable" ? <p role="alert">{result.message}</p> : null}
          {result?.state === "available" && result.capability === "deferred" ? <p>{DEFERRED_MESSAGE}</p> : null}
          {result?.state === "available" && result.capability === "needs-window" ? <p>{WINDOW_MESSAGE}</p> : null}
          {result?.state === "available" && result.capability === "apply" && !canUpdate ? <p>เฉพาะเจ้าของหรือผู้ดูแลติดตั้งอัปเดตได้ / Only an owner or admin can install an update.</p> : null}
          {showInstall ? <Button type="button" size="sm" disabled={installing} onClick={() => void install()}>{installing ? "กำลังอัปเดต…" : "อัปเดตทั้งหมด / Update everything"}</Button> : null}
          {showInstall ? <p className="text-muted-foreground text-xs">อัปเดตแอป เซิร์ฟเวอร์ และฐานข้อมูลในเครื่อง ไม่ต้องใช้ Docker / Updates the app, server and local database. No Docker.</p> : null}
          {progress ? <p className="tabular-nums" aria-live="polite">{progress}</p> : null}
          {error ? <p role="alert">{error}</p> : null}
        </PopoverContent>
      </Popover>
      <button type="button" onClick={() => void toggle()} aria-pressed={on} aria-label={fullscreenLabel} title={fullscreenLabel} className="inline-flex size-6 items-center justify-center rounded-full hover:bg-foreground/10">
        <Icon className="size-3.5" aria-hidden />
      </button>
    </div>
  )
}
