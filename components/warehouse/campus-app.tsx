"use client"

import dynamic from "next/dynamic"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Component, useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition, type ReactNode } from "react"
import { ArrowLeft, Orbit, RefreshCw, RotateCcw } from "lucide-react"

import { LangToggle, useLang } from "@/components/lang-scope"
import { ModeSwitch, ModeTip, useMode } from "@/components/mode-switch"
import { MODE_COPY } from "@/lib/mode"
import type { OrganizationSnapshot } from "./types"

const OrganizationScene = dynamic(() => import("./scene"), { ssr: false })
const subscribeMotion = (change: () => void) => {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)")
  media.addEventListener("change", change)
  return () => media.removeEventListener("change", change)
}
const subscribeVisibility = (change: () => void) => {
  document.addEventListener("visibilitychange", change)
  return () => document.removeEventListener("visibilitychange", change)
}
const emptySubscribe = () => () => {}
let webglSupported: boolean | undefined
function supportsWebGL() {
  if (webglSupported === undefined) {
    try { const canvas = document.createElement("canvas"); webglSupported = !!(canvas.getContext("webgl2") || canvas.getContext("webgl")) } catch { webglSupported = false }
  }
  return webglSupported
}
class SceneBoundary extends Component<{ children: ReactNode; onFailure: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFailure() }
  render() { return this.state.failed ? null : this.props.children }
}

export function CampusApp({ snapshot }: { snapshot: OrganizationSnapshot }) {
  const lang = useLang()
  const mode = useMode()
  const router = useRouter()
  const [pending, refresh] = useTransition()
  const [selectedId, select] = useState<string | null>(snapshot.modules[0]?.id ?? null)
  const [resetKey, reset] = useState(0)
  const [orbit, setOrbit] = useState(false)
  const [failed, setFailed] = useState(false)
  const [inView, setInView] = useState(false)
  const host = useRef<HTMLDivElement>(null)
  const onFailure = useCallback(() => setFailed(true), [])
  const webgl = useSyncExternalStore(emptySubscribe, supportsWebGL, () => false)
  const reducedMotion = useSyncExternalStore(subscribeMotion, () => window.matchMedia("(prefers-reduced-motion: reduce)").matches, () => true)
  const visible = useSyncExternalStore(subscribeVisibility, () => document.visibilityState === "visible", () => true)
  useEffect(() => {
    const element = host.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const selected = snapshot.modules.find((module) => module.id === selectedId) ?? snapshot.modules[0]
  const focus = new Set(MODE_COPY[mode].first)
  const button = "inline-flex min-h-9 items-center justify-center gap-2 rounded-md border px-3 py-2 text-xs hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
  return (
    <main id="content" className="mx-auto w-full max-w-[1480px] space-y-5 p-4 sm:p-6" data-testid="organization-overview" data-role={snapshot.role}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href="/dashboard" prefetch={false} className="mb-2 inline-flex items-center gap-2 text-sm text-muted-foreground"><ArrowLeft className="size-4" aria-hidden />{lang === "th" ? "กลับสู่ ERP" : "Back to ERP"}</Link>
          <h1 className="text-2xl font-semibold">{lang === "th" ? "ภาพรวมองค์กร" : "Organization overview"}</h1>
          <p className="break-words text-sm text-muted-foreground">{snapshot.orgName}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2"><LangToggle /><ModeSwitch /></div>
      </header>
      <ModeTip />
      <section className="space-y-2 text-sm" aria-label={lang === "th" ? "ขอบเขตข้อมูล" : "Data scope"}>
        <p>{lang === "th" ? "แผนที่โมดูลจากข้อมูล ERP จริงของพื้นที่ทำงานที่คุณเข้าถึงได้ ไม่ใช่แผนผังบุคลากร แผนก หรือสถานะการออนไลน์" : "A module map of real ERP records authorized for this workspace, not an employee, department or online-presence chart."}</p>
        <p className="text-muted-foreground">{lang === "th" ? "Blueprint แสดงกระบวนการทำงาน ส่วน Network แสดงอุปกรณ์และการเชื่อมต่อที่สังเกตได้ หน้านี้แสดงภาระงานเอกสารและงานส่งมอบ" : "Blueprint maps workflows. Network shows observed devices and connections. This page shows record workload and delivery tasks."} <Link href="/blueprint" className="underline">Blueprint</Link></p>
        {snapshot.limited && <p role="note" className="rounded-md border border-amber-500/30 p-3" data-testid="organization-limited">{lang === "th" ? "แสดงข้อมูลตามบทบาท: ซ่อนยอดจัดการจัดซื้อ สต็อก หรือการเงินที่ไม่มีสิทธิ์ งานและใบเสนอราคาของสมาชิกแสดงเฉพาะที่รับผิดชอบ ค่าใช้จ่ายแสดงของตนเองหากไม่ใช่ผู้อนุมัติ ข้อมูลที่ซ่อนไม่ได้หมายถึงศูนย์" : "Role-limited view: management purchasing, stock or finance counts are omitted where not permitted. Members see their assigned tasks and owned projects/quotes; non-approvers see only their own claims. Hidden data does not mean zero."}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">{lang === "th" ? "อ่านข้อมูลเมื่อ" : "Read at"} <time dateTime={snapshot.capturedAt}>{new Date(snapshot.capturedAt).toLocaleString(lang === "th" ? "th-TH" : "en-GB", { timeZone: "Asia/Bangkok" })}</time> · Asia/Bangkok · {lang === "th" ? "ภาพ ณ เวลาที่อ่าน ไม่ใช่ข้อมูลสด" : "Request-time snapshot, not live telemetry"}</p>
          <button type="button" className={button} disabled={pending} onClick={() => refresh(() => router.refresh())}><RefreshCw className="size-3.5" aria-hidden />{pending ? (lang === "th" ? "กำลังอ่าน…" : "Refreshing…") : (lang === "th" ? "อ่านข้อมูลใหม่" : "Refresh data")}</button>
        </div>
      </section>
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section className="min-w-0 overflow-hidden rounded-xl border" aria-label={lang === "th" ? "แผนที่ภาระงาน 3D" : "3D workload map"}>
          <div className="flex flex-wrap items-center justify-between gap-2 border-b p-3">
            <p className="text-xs text-muted-foreground">{lang === "th" ? "เลือกอาคารโมดูล · ลากเพื่อหมุน · เลื่อนเพื่อซูม" : "Select a module tower · Drag to orbit · Scroll to zoom"}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className={button} onClick={() => reset((key) => key + 1)} disabled={!webgl || failed}><RotateCcw className="size-3.5" aria-hidden />{lang === "th" ? "รีเซ็ตกล้อง" : "Reset camera"}</button>
              <button type="button" className={button} aria-pressed={orbit && !reducedMotion} disabled={!webgl || failed || reducedMotion} onClick={() => setOrbit((value) => !value)}><Orbit className="size-3.5" aria-hidden />{lang === "th" ? "หมุนอัตโนมัติ" : "Auto orbit"}</button>
            </div>
          </div>
          <div ref={host} className="relative isolate h-[320px] sm:h-[460px]" data-testid="organization-scene" data-rendering={inView && visible ? "active" : "paused"}>
            {webgl && !failed ? <SceneBoundary onFailure={onFailure}><OrganizationScene modules={snapshot.modules} selected={selected?.id ?? null} onSelect={select} resetKey={resetKey} orbit={orbit} active={inView && visible} reducedMotion={reducedMotion} lang={lang} onFailure={onFailure} /></SceneBoundary> : <div role="status" className="grid h-full place-content-center p-6 text-center text-sm text-muted-foreground">{lang === "th" ? "3D ใช้งานไม่ได้ — เลือกโมดูลและตรวจหลักฐานจากรายการด้านล่างได้ครบถ้วน" : "3D unavailable — select modules and inspect all evidence in the list below."}</div>}
          </div>
          <p className="border-t p-3 text-xs text-muted-foreground">{lang === "th" ? "ความสูงใช้จำนวนในหัวข้อหลักแบบลอการิทึม จำกัดช่วงเพื่อให้อ่านง่าย หน่วยต่างกันในแต่ละโมดูล จึงไม่ใช่คะแนนประสิทธิภาพหรือปริมาณสต็อกจริง" : "Tower height uses the headline count on a capped logarithmic scale. Units differ by module: this is not a productivity score or physical stock quantity."} {reducedMotion && (lang === "th" ? "ลดการเคลื่อนไหว: ปิดการหมุนอัตโนมัติ" : "Reduced motion: automatic orbit disabled.")}</p>
        </section>
        <aside className="min-w-0 rounded-xl border p-4" aria-label={lang === "th" ? "หลักฐานโมดูลที่เลือก" : "Selected module evidence"} data-testid="organization-inspector" aria-live="polite">
          {selected && <>
            <h2 className="text-lg font-semibold">{selected[lang]}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{selected.scope === "mine" ? (lang === "th" ? "เฉพาะของฉัน" : "My records only") : (lang === "th" ? "พื้นที่ทำงาน (ตามสิทธิ์)" : "Workspace (authorized scope)")}</p>
            <dl className="mt-4 space-y-3">{selected.metrics.map((metric) => <div key={metric.en} className="flex items-start justify-between gap-3 border-b pb-3"><dt><Link className="text-sm underline underline-offset-4" href={metric.href} prefetch={false}>{metric[lang]}</Link></dt><dd className={metric.attention ? "font-mono font-semibold text-amber-400" : "font-mono font-semibold"}>{metric.count.toLocaleString()}</dd></div>)}</dl>
            {selected.workload === 0 && <p className="mt-3 text-sm text-muted-foreground">{lang === "th" ? "ไม่มีรายการในหัวข้อหลักของโมดูลนี้ ณ เวลาที่อ่าน ไม่ได้ยืนยันว่าทั้งองค์กรไม่มีงาน" : "No records in this module’s headline metric at read time; this does not mean the whole organization has no work."}</p>}
            <Link href={selected.href} prefetch={false} className={`${button} mt-4`}>{lang === "th" ? "เปิดงาน ERP จริง" : "Open real ERP tasks"} →</Link>
          </>}
        </aside>
      </div>
      <section aria-labelledby="organization-modules-title" className="space-y-3">
        <h2 id="organization-modules-title" className="text-lg font-semibold">{lang === "th" ? "โมดูลและหลักฐาน (ใช้แทน 3D ได้)" : "Modules and evidence (complete 3D alternative)"}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{snapshot.modules.map((module) => <article key={module.id} className={`min-w-0 rounded-xl border p-4 ${selected?.id === module.id ? "border-amber-400/70" : ""}`} data-testid={`organization-module-${module.id}`}>
          <button type="button" aria-pressed={selected?.id === module.id} className="mb-2 w-full text-left font-semibold underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring" onClick={() => select(module.id)}>{module[lang]} <span className="float-right font-mono">{module.workload.toLocaleString()}</span></button>
          <p className="mb-2 text-xs text-muted-foreground">{module.unit[lang]}</p>
          <p className="mb-2 text-xs text-muted-foreground">{module.scope === "mine" ? (lang === "th" ? "ของฉัน" : "My records") : (lang === "th" ? "พื้นที่ทำงาน" : "Workspace")} {focus.has(module.href.split("?")[0]) && (lang === "th" ? "· โมดูลหลักของโปรไฟล์" : "· Profile focus")}</p>
          <ul className="space-y-2 text-sm">{module.metrics.map((metric) => <li key={metric.en} className="flex justify-between gap-3"><Link href={metric.href} prefetch={false} className="underline underline-offset-4">{metric[lang]}</Link><span className={metric.attention ? "font-mono text-amber-400" : "font-mono"}>{metric.count.toLocaleString()}</span></li>)}</ul>
        </article>)}</div>
      </section>
      <section className="rounded-xl border p-4" aria-labelledby="organization-tasks-title">
        <h2 id="organization-tasks-title" className="font-semibold">{lang === "th" ? "งานที่ยังไม่เสร็จ เรียงกำหนดส่ง (สูงสุด 8 งาน)" : "Open tasks, earliest due first (up to 8)"}</h2>
        {snapshot.tasks.length ? <ul className="mt-3 divide-y">{snapshot.tasks.map((task) => <li key={task.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm"><Link href={task.href} prefetch={false} className="min-w-0 break-words underline underline-offset-4">{task.title}</Link><span className="text-xs text-muted-foreground">{task.status === "in_progress" ? (lang === "th" ? "กำลังทำ" : "In progress") : (lang === "th" ? "รอทำ" : "To do")} · {task.dueDate ?? (lang === "th" ? "ไม่มีกำหนดส่ง" : "No due date")}</span></li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">{lang === "th" ? "ไม่พบงานที่ยังไม่เสร็จในขอบเขตที่คุณมีสิทธิ์ดู เปิดโปรเจกต์เพื่อจัดการงานจริง" : "No open tasks in your authorized scope. Open Projects to manage real work."} <Link href="/projects" className="underline">{lang === "th" ? "เปิดโปรเจกต์" : "Open Projects"}</Link></p>}
      </section>
    </main>
  )
}
