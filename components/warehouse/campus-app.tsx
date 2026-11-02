"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Crosshair,
  House,
  ListTree,
  Orbit,
  RotateCcw,
  RotateCw,
  Search,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react"

import { useMode } from "@/components/mode-switch"
import { cn } from "@/lib/utils"
import { MODE_COPY } from "@/lib/mode"
import { createCampusScene } from "./scene"
import type { CampusScene, Entity, PersonInfo, ShipmentInfo, ShuttleInfo, Snapshot } from "./types"

const hhmm = (sec: number) => {
  const m = Math.floor(sec / 60) % (24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

const RAIL_PX = 304
const DOCK_PX = 140
const DOCK_STACKED_PX = 200

type Tone = "mint" | "gold" | "ice" | "mute"
const TONE: Record<Tone, string> = {
  mint: "bg-[#5ee0a8]/10 text-[#5ee0a8]",
  gold: "bg-[#f5b941]/10 text-[#f5b941]",
  ice: "bg-[#9bb4ff]/10 text-[#9bb4ff]",
  mute: "bg-white/5 text-slate-400",
}
const DOT: Record<Tone, string> = { mint: "bg-[#5ee0a8]", gold: "bg-[#f5b941]", ice: "bg-[#9bb4ff]", mute: "bg-slate-500" }
const shuttleTone = (s: ShuttleInfo["state"]): Tone => (s === "Loading" || s === "Unloading" ? "mint" : s === "Arriving" || s === "Departing" ? "gold" : s === "En route" ? "ice" : "mute")
const presenceTone = (p: PersonInfo["presence"]): Tone => (p === "desk" ? "mint" : p === "meeting" ? "gold" : "ice")

const SHELL = "border border-white/10 bg-[#0B1222]/85 backdrop-blur-md"

export function CampusApp() {
  const host = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<CampusScene | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [sel, setSel] = useState<{ id: string | null; focus: boolean }>({ id: null, focus: false })
  const [query, setQuery] = useState("")
  const [miss, setMiss] = useState(false)
  const [tab, setTab] = useState<"districts" | "crew" | "loop">("districts")
  const [railOpen, setRailOpen] = useState(false)
  const [orbitOn, setOrbitOn] = useState(true)
  const mode = useMode()
  const selected = sel.id

  useEffect(() => {
    const s = createCampusScene(host.current!, {
      onSnapshot: setSnap,
      onSelect: (id) => setSel({ id, focus: id !== null }),
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    })
    sceneRef.current = s
    const fit = () => {
      const wide = window.innerWidth >= 768
      s.setInsets({ left: wide ? RAIL_PX : 0, right: 0, bottom: wide ? (window.innerWidth >= 1280 ? DOCK_PX : DOCK_STACKED_PX) : 0 })
    }
    fit()
    window.addEventListener("resize", fit)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault()
        searchRef.current?.focus()
      } else if (e.key === "Escape" && document.activeElement !== searchRef.current) setSel({ id: null, focus: false })
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("resize", fit)
      window.removeEventListener("keydown", onKey)
      s.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => sceneRef.current?.select(sel.id, sel.focus), [sel])
  useEffect(() => sceneRef.current?.setAutoOrbit(orbitOn), [orbitOn])

  // districts whose pages are the current mode's starting points
  const hasZones = !!snap
  const starters = useMemo(() => {
    const first = new Set(MODE_COPY[mode].first)
    return (snap?.zones ?? []).filter((z) => z.links.some(([, href]) => first.has(href))).map((z) => z.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zone links never change; only recompute when the first snapshot lands or the mode changes
  }, [mode, hasZones])
  useEffect(() => sceneRef.current?.setStarters(starters), [starters])

  const select = (id: string | null, focus = true) => {
    setSel({ id, focus })
    setRailOpen(false)
  }

  const entities: Entity[] = snap ? [...snap.zones, ...snap.people, ...snap.stackers, ...snap.shuttles] : []
  const current = entities.find((e) => e.id === selected) ?? null

  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim().toLowerCase()
    const hit = q && entities.find((x) => `${x.id} ${searchText(x)}`.toLowerCase().includes(q))
    setMiss(!hit)
    if (hit) select(hit.id)
  }

  const shuttles = snap?.shuttles ?? []
  const docked = shuttles.filter((t) => t.state === "Loading" || t.state === "Unloading")
  const inbound = shuttles.filter((t) => t.state === "En route")
  const copy = MODE_COPY[mode]

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#0B1222] font-sans text-slate-100">
      {/* isolate: label z-indexes must not climb over the HUD */}
      <div ref={host} className="absolute inset-0 isolate" />

      {/* ---------------------------------------------------------------- compact bar (phones) */}
      <header className={cn(SHELL, "absolute inset-x-0 top-0 z-20 flex h-12 items-center gap-2 border-x-0 border-t-0 px-3 md:hidden")}>
        <IconBtn label="Open organization index" onClick={() => setRailOpen((v) => !v)}>
          <ListTree />
        </IconBtn>
        <Wordmark />
        <Clock snap={snap} className="ml-auto" />
        <Link href="/dashboard" prefetch={false} aria-label="กลับสู่แอป / Back to app" className="grid size-9 place-items-center text-slate-300 hover:text-white">
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
      </header>

      {/* ---------------------------------------------------------------- index rail */}
      <nav
        aria-label="Organization index"
        className={cn(
          SHELL,
          "absolute inset-y-0 left-0 z-30 flex w-[19rem] max-w-[88vw] flex-col border-y-0 border-l-0 border-r-[#f5b941]/20 transition-transform duration-300 md:translate-x-0",
          railOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 border-b border-white/10 px-4 pt-4 pb-3">
          <Link
            href="/dashboard"
            prefetch={false}
            aria-label="กลับสู่แอป / Back to app"
            title="กลับสู่แอป / Back to app"
            className="grid size-8 shrink-0 place-items-center border border-white/15 text-slate-300 hover:border-[#f5b941]/60 hover:text-white focus-visible:ring-2 focus-visible:ring-[#f5b941] focus-visible:outline-none"
          >
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
          <Wordmark />
          <Clock snap={snap} className="ml-auto hidden md:flex" />
          <button type="button" aria-label="Close index" onClick={() => setRailOpen(false)} className="ml-auto grid size-8 place-items-center text-slate-300 md:hidden">
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <div className="border-b border-white/10 px-4 py-3">
          <div className="border-l-2 border-[#f5b941] pl-2.5 leading-tight">
            <div className="font-mono text-[10px] tracking-[0.2em] text-slate-400 uppercase">Mode</div>
            <div className="text-sm font-semibold">
              {copy.th} <span className="font-normal text-slate-400">/ {copy.en}</span>
            </div>
          </div>
          {/* form-submit: implicit (single search input, Enter submits) */}
          <form onSubmit={onSearch} className="relative mt-3">
            <Search className="absolute top-1/2 left-0 size-3.5 -translate-y-1/2 text-slate-500" aria-hidden />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setMiss(false)
              }}
              placeholder="Find a district, person, vehicle"
              aria-label="Search districts, people, stackers and shuttles"
              className={cn(
                "h-9 w-full border-0 border-b bg-transparent pr-7 pl-6 text-sm text-white outline-none placeholder:text-slate-500 focus:border-[#f5b941]",
                miss ? "border-rose-400/70" : "border-white/15",
              )}
            />
            <kbd className="absolute top-1/2 right-0 -translate-y-1/2 border border-white/15 px-1.5 font-mono text-[10px] text-slate-500">/</kbd>
          </form>
        </div>

        <div role="tablist" aria-label="Index sections" className="flex border-b border-white/10 px-2">
          {(
            [
              ["districts", "Districts", snap?.zones.length ?? 0],
              ["crew", "Crew", snap?.people.length ?? 0],
              ["loop", "Loop", snap ? snap.stackers.length + snap.shuttles.length : 0],
            ] as const
          ).map(([k, label, n]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={tab === k}
              onClick={() => setTab(k)}
              className={cn(
                "relative flex-1 px-1 py-2.5 font-mono text-[10px] tracking-[0.08em] whitespace-nowrap uppercase focus-visible:ring-2 focus-visible:ring-[#f5b941] focus-visible:outline-none",
                tab === k ? "text-white after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:bg-[#ff8a3d]" : "text-slate-500 hover:text-slate-300",
              )}
            >
              {label} <span className="text-slate-500">{n}</span>
            </button>
          ))}
        </div>

        <ul className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          {snap && tab === "districts" &&
            snap.zones.map((z) => (
              <Row key={z.id} active={selected === z.id} onClick={() => select(z.id)} lead={String(z.index).padStart(2, "0")} title={z.name} sub={z.status} trail={starters.includes(z.id) ? "START" : undefined} />
            ))}
          {snap && tab === "crew" &&
            snap.people.map((p) => (
              <Row key={p.id} active={selected === p.id} onClick={() => select(p.id)} dot={DOT[presenceTone(p.presence)]} title={p.name} sub={`${p.role} · ${p.status}`} trail={`${p.tasks}`} />
            ))}
          {snap && tab === "loop" && (
            <>
              <Row active={selected === "vault"} onClick={() => select("vault")} lead="08" title="Vault" sub={snap.zones[snap.zones.length - 1].status} />
              {snap.shuttles.map((t) => (
                <Row
                  key={t.id}
                  active={selected === t.id}
                  onClick={t.state === "En route" || t.state === "Departed" ? undefined : () => select(t.id)}
                  dot={DOT[shuttleTone(t.state)]}
                  title={`${t.gate} · ${t.id}`}
                  sub={`${t.carrier} · ${t.state}${t.state === "En route" && t.eta != null ? ` · ${Math.max(1, Math.ceil(t.eta / 60))} min` : ""}`}
                  trail={`${t.loaded}/${t.capacity}`}
                />
              ))}
              {snap.stackers.map((f) => (
                <Row key={f.id} active={selected === f.id} onClick={() => select(f.id)} dot={f.speedKmh > 0.5 ? DOT.mint : DOT.mute} title={f.id} sub={f.status} trail={`${f.battery}%`} />
              ))}
            </>
          )}
        </ul>

        <div className="grid grid-cols-6 border-t border-white/10">
          <CtrlBtn label="Zoom in" onClick={() => sceneRef.current?.zoom(0.72)}><ZoomIn /></CtrlBtn>
          <CtrlBtn label="Zoom out" onClick={() => sceneRef.current?.zoom(1.38)}><ZoomOut /></CtrlBtn>
          <CtrlBtn label="Orbit left" onClick={() => sceneRef.current?.orbit(-1)}><RotateCcw /></CtrlBtn>
          <CtrlBtn label="Orbit right" onClick={() => sceneRef.current?.orbit(1)}><RotateCw /></CtrlBtn>
          <CtrlBtn label={orbitOn ? "Pause idle orbit" : "Resume idle orbit"} pressed={orbitOn} onClick={() => setOrbitOn((v) => !v)}><Orbit /></CtrlBtn>
          <CtrlBtn
            label="Reset view"
            onClick={() => {
              setSel({ id: null, focus: false })
              sceneRef.current?.home()
            }}
          >
            <House />
          </CtrlBtn>
        </div>
      </nav>

      {/* ---------------------------------------------------------------- inspector */}
      {current && (
        <aside
          aria-label={`${current.id} details`}
          className={cn(SHELL, "absolute inset-x-2 bottom-2 z-20 max-h-[56dvh] overflow-y-auto border-[#f5b941]/25 md:inset-x-auto md:top-4 md:right-4 md:bottom-auto md:max-h-[calc(100dvh-11rem)] md:w-[21rem]")}
        >
          <Ticks />
          <Inspector item={current} onFollow={() => select(current.id)} onClose={() => select(null, false)} />
        </aside>
      )}

      {/* ---------------------------------------------------------------- ledger dock */}
      {snap && (
        <section
          aria-label="Organization ledger"
          className={cn(SHELL, "absolute right-2 bottom-2 left-2 z-10 md:right-4 md:bottom-4 md:left-[19.75rem]", current && "hidden md:block")}
        >
          <Ticks />
          <div className="flex flex-col xl:flex-row">
            <dl className="grid shrink-0 grid-cols-2 divide-x divide-white/10 border-b border-white/10 sm:grid-cols-4 xl:border-r xl:border-b-0">
              <Cell label="Stock on hand" value={snap.stock.toLocaleString()} unit="pallets" delta={snap.stockDelta} sub={`${Math.round((snap.stock / snap.stockCap) * 100)}% of vault`} />
              <Cell label="Freight at gates" value={String(docked.length)} unit="/2" sub={`${inbound.length} inbound en route`} />
              <Cell label="On-time" value="—" sub="no shipments yet" className="hidden sm:block" />
              <Cell label="Districts" value="Ready" sub="no activity yet" className="hidden sm:block" />
            </dl>
            {snap.shipment ? (
              <Shipment s={snap.shipment} sim={snap.sim} onOpen={() => select(snap.shipment!.shuttleId)} />
            ) : (
              <div className="min-w-0 flex-1 px-4 py-3">
                <h2 className="font-mono text-[10px] tracking-[0.16em] text-slate-400 uppercase">Shipment</h2>
                <p className="mt-3 text-sm text-slate-300">No active shipment</p>
                <p className="mt-0.5 text-[11px] text-slate-500">Confirmed orders will appear here.</p>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ pieces

function Wordmark() {
  return (
    <div className="flex items-center gap-2.5 leading-none">
      <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden>
        <circle cx="12" cy="12" r="10.5" fill="none" stroke="#f5b941" strokeOpacity="0.5" />
        <circle cx="12" cy="12" r="6.5" fill="none" stroke="#ff8a3d" strokeWidth="1.2" />
        <circle cx="12" cy="12" r="2.4" fill="#f5b941" />
        <circle cx="21.5" cy="12" r="1.4" fill="#f5b941" />
      </svg>
      <div>
        <div className="font-mono text-xs font-semibold tracking-[0.3em] text-white">ORG</div>
        <div className="mt-1 text-[10px] text-slate-400">BoomBigNose</div>
      </div>
    </div>
  )
}

function Clock({ snap, className }: { snap: Snapshot | null; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2 font-mono text-xs", className)}>
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#5ee0a8] opacity-70" />
        <span className="relative inline-flex size-1.5 rounded-full bg-[#5ee0a8]" />
      </span>
      <span className="text-slate-400">LIVE</span>
      <span className="font-semibold text-[#f5b941] tabular-nums">{snap ? hhmm(snap.sim) : "09:40"}</span>
    </div>
  )
}

/** Gold corner brackets — the ledger-sheet frame. */
function Ticks() {
  const t = "pointer-events-none absolute size-2 border-[#f5b941]"
  return (
    <>
      <span aria-hidden className={cn(t, "-top-px -left-px border-t border-l")} />
      <span aria-hidden className={cn(t, "-top-px -right-px border-t border-r")} />
      <span aria-hidden className={cn(t, "-bottom-px -left-px border-b border-l")} />
      <span aria-hidden className={cn(t, "-right-px -bottom-px border-r border-b")} />
    </>
  )
}

function IconBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} onClick={onClick} className="grid size-9 place-items-center text-slate-300 hover:text-white focus-visible:ring-2 focus-visible:ring-[#f5b941] focus-visible:outline-none [&>svg]:size-4">
      {children}
    </button>
  )
}

function CtrlBtn({ label, onClick, pressed, children }: { label: string; onClick: () => void; pressed?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        "grid h-11 place-items-center border-r border-white/5 last:border-r-0 hover:bg-white/5 hover:text-white focus-visible:ring-2 focus-visible:ring-[#f5b941] focus-visible:outline-none focus-visible:ring-inset [&>svg]:size-4",
        pressed ? "text-[#f5b941]" : "text-slate-400",
      )}
    >
      {children}
    </button>
  )
}

function Row({ active, onClick, lead, dot, title, sub, trail }: { active: boolean; onClick?: () => void; lead?: string; dot?: string; title: string; sub: string; trail?: string }) {
  const body = (
    <>
      {lead ? <span className="w-6 font-mono text-[11px] text-[#f5b941]">{lead}</span> : <span className={cn("mx-1.5 size-1.5 rounded-full", dot)} aria-hidden />}
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-medium text-slate-100">{title}</span>
        <span className="block truncate text-[11px] text-slate-400">{sub}</span>
      </span>
      {trail && <span className="font-mono text-[10px] tracking-wider text-slate-400 tabular-nums">{trail}</span>}
    </>
  )
  const base = "flex w-full items-center gap-2.5 border-b border-l-2 border-b-white/5 px-4 py-2.5 text-left"
  return (
    <li>
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          aria-current={active || undefined}
          className={cn(base, "hover:bg-white/5 focus-visible:ring-2 focus-visible:ring-[#f5b941] focus-visible:outline-none focus-visible:ring-inset", active ? "border-l-[#ff8a3d] bg-[#ff8a3d]/10" : "border-l-transparent")}
        >
          {body}
        </button>
      ) : (
        <div className={cn(base, "border-l-transparent opacity-60")}>{body}</div>
      )}
    </li>
  )
}

function Cell({ label, value, unit, sub, delta, className }: { label: string; value: string; unit?: string; sub: string; delta?: number; className?: string }) {
  return (
    <div className={cn("min-w-0 px-4 py-3 xl:w-36", className)}>
      <dt className="font-mono text-[10px] tracking-[0.16em] text-slate-400 uppercase">{label}</dt>
      <dd className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold text-white tabular-nums">{value}</span>
        {unit && <span className="text-xs text-slate-400">{unit}</span>}
        {delta != null && delta !== 0 && (
          <span className={cn("ml-auto font-mono text-[11px] tabular-nums", delta > 0 ? "text-[#5ee0a8]" : "text-rose-300")}>
            {delta > 0 ? "+" : ""}
            {delta}
          </span>
        )}
      </dd>
      <div className="mt-0.5 truncate text-[11px] text-slate-500">{sub}</div>
    </div>
  )
}

function Shipment({ s, sim, onOpen }: { s: ShipmentInfo; sim: number; onOpen: () => void }) {
  const transitEta = s.loadEta + 8 * 60
  const steps = [
    { label: "Confirmed", time: hhmm(s.confirmedAt) },
    { label: "Picked", time: hhmm(s.pickedAt) },
    { label: `Loading ${s.loaded}/${s.capacity}`, time: `ETA ${hhmm(s.loadEta)}` },
    { label: "In transit", time: `ETA ${hhmm(transitEta)}` },
    { label: "Delivered", time: `ETA ${hhmm(transitEta + 32 * 60)}` },
  ]
  const minsLeft = Math.max(0, Math.round((s.loadEta - sim) / 60))
  return (
    <div className="min-w-0 flex-1 px-4 py-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="truncate font-mono text-[10px] tracking-[0.16em] whitespace-nowrap text-slate-400 uppercase">
          Shipment <span className="text-[#f5b941]">{s.no}</span> <ArrowRight className="mx-0.5 inline size-3" aria-hidden /> {s.to}
        </h2>
        <button type="button" onClick={onOpen} className="flex shrink-0 items-center gap-1 font-mono text-[10px] tracking-wider text-[#ff8a3d] uppercase hover:text-[#ffb27a] focus-visible:ring-2 focus-visible:ring-[#f5b941] focus-visible:outline-none">
          {s.shuttleId} {s.step === 2 ? `· ${minsLeft} min left` : "· departed"} <ArrowUpRight className="size-3" aria-hidden />
        </button>
      </div>
      <ol className="relative mt-3 grid grid-cols-5">
        <span aria-hidden className="absolute top-[7px] right-[10%] left-[10%] h-px bg-white/15" />
        <span aria-hidden className="absolute top-[7px] left-[10%] h-px bg-[#ff8a3d] transition-[width] duration-700" style={{ width: `${(s.step / 4) * 80}%` }} />
        {steps.map((st, i) => {
          const done = i < s.step
          const active = i === s.step
          return (
            <li key={st.label} className="relative flex flex-col items-center text-center">
              <span
                aria-hidden
                className={cn("size-3.5 rotate-45 border", done && "border-[#ff8a3d] bg-[#ff8a3d]", active && "border-[#f5b941] bg-[#f5b941] shadow-[0_0_14px_rgba(245,185,65,0.7)]", !done && !active && "border-white/25 bg-[#0B1222]")}
              />
              <span className={cn("mt-2 text-[11px] font-medium whitespace-nowrap", done || active ? "text-slate-100" : "text-slate-500")}>{st.label}</span>
              <span className="font-mono text-[10px] text-slate-500 tabular-nums">{st.time}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function Inspector({ item, onFollow, onClose }: { item: Entity; onFollow: () => void; onClose: () => void }) {
  const tone: Tone = item.kind === "zone" ? "mint" : item.kind === "person" ? presenceTone(item.presence) : item.kind === "shuttle" ? shuttleTone(item.state) : item.speedKmh > 0.5 ? "mint" : "mute"
  const status = item.kind === "shuttle" ? item.state : item.kind === "stacker" ? (item.speedKmh > 0.5 ? "Moving" : "Holding") : item.status
  return (
    <div className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[10px] tracking-[0.2em] text-[#f5b941] uppercase">{eyebrow(item)}</div>
          <h2 className="mt-1 text-xl leading-tight font-semibold">{item.kind === "zone" ? item.name : item.kind === "person" ? item.name : item.id}</h2>
          <div className="mt-0.5 truncate text-xs text-slate-400">{subtitle(item)}</div>
        </div>
        <button type="button" aria-label="Centre camera on this" title="Centre camera on this" onClick={onFollow} className="grid size-8 place-items-center border border-white/15 text-slate-300 hover:border-[#f5b941]/60 hover:text-white focus-visible:ring-2 focus-visible:ring-[#f5b941] focus-visible:outline-none">
          <Crosshair className="size-4" aria-hidden />
        </button>
        <button type="button" aria-label="Close details" title="Close details" onClick={onClose} className="grid size-8 place-items-center border border-white/15 text-slate-300 hover:border-[#f5b941]/60 hover:text-white focus-visible:ring-2 focus-visible:ring-[#f5b941] focus-visible:outline-none">
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="mt-3 flex items-center gap-2 border-t border-white/10 pt-3">
        <span className={cn("inline-flex items-center gap-1.5 px-2 py-1 font-mono text-[11px] tracking-wider uppercase", TONE[tone])}>
          <span className={cn("size-1.5", DOT[tone])} aria-hidden />
          {status}
        </span>
        <span className="truncate text-xs text-slate-400">{caption(item)}</span>
      </div>

      {item.kind === "stacker" && <Segments value={item.battery} label={`Battery ${item.battery}%`} />}
      {item.kind === "shuttle" && <Segments value={(item.loaded / item.capacity) * 100} label={`${item.loaded}/${item.capacity} pallets`} />}

      <dl className="mt-2 text-sm">
        {item.kind === "zone" && item.stats.map(([k, v]) => <Fact key={k} k={k} v={v} />)}
        {item.kind === "person" && (
          <>
            <Fact k="Role" v={item.role} />
            <Fact k="District" v={item.zone} />
            <Fact k="Activity" v={item.status} />
            <Fact k="Tasks done today" v={item.tasks} />
            <Fact k="Site" v="BoomBigNose HQ" />
          </>
        )}
        {item.kind === "stacker" && (
          <>
            <Fact k="Carrying" v={item.carrying} />
            <Fact k="Moves today" v={item.moves} />
            <Fact k="Speed" v={`${item.speedKmh.toFixed(1)} km/h`} />
            <Fact k="Charger" v={<span className="text-[#ff8a3d]">{item.charger}</span>} />
            <Fact k="Site" v="Vault · Bangna Hub" />
          </>
        )}
        {item.kind === "shuttle" && (
          <>
            <Fact k="Carrier" v={item.carrier} />
            <Fact k="Direction" v={item.direction === "outbound" ? "Outbound" : "Inbound"} />
            <Fact k="Gate" v={item.gate} />
            <Fact k="ETA" v={item.eta != null ? `${Math.max(1, Math.ceil(item.eta / 60))} min` : "On site"} />
            <Fact k="Site" v="Bangna Hub" />
          </>
        )}
      </dl>

      {item.kind === "zone" && item.links.length > 0 && (
        <div className="mt-3 flex gap-2">
          {item.links.map(([label, href]) => (
            <Link key={href} href={href} className="flex flex-1 items-center justify-center gap-1.5 border border-[#ff8a3d]/70 bg-[#ff8a3d]/10 px-3 py-2 text-sm font-semibold text-[#ffb27a] hover:bg-[#ff8a3d] hover:text-[#0B1222] focus-visible:ring-2 focus-visible:ring-[#f5b941] focus-visible:outline-none">
              {label} <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

function Segments({ value, label }: { value: number; label: string }) {
  const on = Math.round((Math.min(100, value) / 100) * 20)
  return (
    <div className="mt-3 flex items-center gap-3">
      <div className="flex flex-1 gap-0.5" aria-hidden>
        {Array.from({ length: 20 }, (_, i) => (
          <span key={i} className={cn("h-2 flex-1", i < on ? "bg-[#ff8a3d]" : "bg-white/10")} />
        ))}
      </div>
      <span className="font-mono text-[11px] text-slate-400 tabular-nums">{label}</span>
    </div>
  )
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2 border-b border-dashed border-white/10 py-2 last:border-0">
      <dt className="text-slate-400">{k}</dt>
      <dd className="ml-auto truncate pl-4 font-medium tabular-nums">{v}</dd>
    </div>
  )
}

function searchText(e: Entity) {
  if (e.kind === "shuttle") return `${e.carrier} ${e.gate}`
  if (e.kind === "stacker") return `${e.operator} ${e.model}`
  if (e.kind === "person") return `${e.name} ${e.role} ${e.zone}`
  return `${e.name} ${e.sub}`
}

function eyebrow(e: Entity) {
  if (e.kind === "zone") return `District ${String(e.index).padStart(2, "0")}`
  if (e.kind === "person") return `Crew · ${e.zone}`
  if (e.kind === "stacker") return "Stacker · Vault"
  return `Freight shuttle · ${e.gate}`
}

function subtitle(e: Entity) {
  if (e.kind === "stacker") return `${e.operator} · ${e.model}`
  if (e.kind === "shuttle") return `${e.carrier} · ${e.gate}`
  if (e.kind === "person") return e.role
  return e.sub
}

function caption(e: Entity) {
  if (e.kind === "stacker") return e.status
  if (e.kind === "shuttle") return e.direction === "outbound" ? `${e.loaded}/${e.capacity} loaded` : `${e.loaded}/${e.capacity} aboard`
  if (e.kind === "person") return e.zone
  return e.status
}
