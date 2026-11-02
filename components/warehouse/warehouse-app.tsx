"use client"

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import {
  Bell,
  ArrowLeft,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Clock,
  Crosshair,
  Forklift,
  House,
  Minus,
  MapPin,
  Package,
  PackageCheck,
  Plus,
  RotateCcw,
  RotateCw,
  Search,
  Truck,
  User,
  Users,
  X,
  ArrowRight,
  ArrowUp,
  ArrowDown,
} from "lucide-react"

import { cn } from "@/lib/utils"
import {
  createWarehouseScene,
  type ForkliftInfo,
  type PersonInfo,
  type Snapshot,
  type TruckInfo,
  type WarehouseScene,
  type ZoneInfo,
} from "./scene"

type Entity = ForkliftInfo | TruckInfo | PersonInfo | ZoneInfo

const hhmm = (sec: number) => {
  const m = Math.floor(sec / 60) % (24 * 60)
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}
const card = "pointer-events-auto rounded-2xl bg-card/90 shadow-[0_8px_30px_rgba(0,0,0,0.45)] ring-1 ring-border backdrop-blur"

const STATE_STYLE: Record<string, string> = {
  Loading: "bg-emerald-400/15 text-emerald-300",
  Unloading: "bg-emerald-400/15 text-emerald-300",
  Arriving: "bg-amber-400/15 text-amber-300",
  Departing: "bg-amber-400/15 text-amber-300",
  "En route": "bg-sky-400/15 text-sky-300",
  Departed: "bg-accent text-muted-foreground",
  Available: "bg-accent text-muted-foreground",
}

export function WarehouseApp() {
  const host = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<WarehouseScene | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [sel, setSel] = useState<{ id: string | null; focus: boolean; n: number }>({ id: "FL-01", focus: false, n: 0 })
  const selected = sel.id
  const [query, setQuery] = useState("")
  const [miss, setMiss] = useState(false)
  const [tab, setTab] = useState<"docks" | "forklifts" | "trucks" | "team">("docks")

  useEffect(() => {
    const s = createWarehouseScene(host.current!, {
      onSnapshot: setSnap,
      onSelect: (id) => setSel((p) => ({ id, focus: false, n: p.n + 1 })),
      reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    })
    sceneRef.current = s
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchRef.current) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("keydown", onKey)
      s.dispose()
      sceneRef.current = null
    }
  }, [])

  useEffect(() => sceneRef.current?.select(sel.id, sel.focus), [sel])
  const select = (id: string | null, focus = true) => setSel((p) => ({ id, focus, n: p.n + 1 }))

  const entities: Entity[] = snap ? [...snap.zones, ...snap.people, ...snap.forklifts, ...snap.trucks] : []
  const current = entities.find((e) => e.id === selected) ?? null

  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim().toLowerCase()
    const hit = q && entities.find((x) => `${x.id} ${searchText(x)}`.toLowerCase().includes(q))
    setMiss(!hit)
    if (hit) select(hit.id)
  }

  const trucks = snap?.trucks ?? []
  const onSite = trucks.filter((t) => t.state !== "En route" && t.state !== "Departed")
  const inbound = trucks.filter((t) => t.state === "En route")

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
      {/* isolate: CSS2D label z-indexes must not climb over the HUD */}
      <div ref={host} className="absolute inset-0 isolate" />

      {/* header */}
      <header className="absolute inset-x-0 top-0 z-20 flex h-16 items-center gap-3 border-b border-border bg-card/90 px-4 backdrop-blur md:gap-6 md:px-6">
        <Link href="/dashboard" prefetch={false} aria-label="กลับสู่แอป / Back to app" title="กลับสู่แอป / Back to app" className="text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring grid size-9 shrink-0 place-items-center rounded-lg focus-visible:ring-2 focus-visible:outline-none">
          <ArrowLeft className="size-4" aria-hidden />
        </Link>
        <div className="flex items-center gap-2">
          <Box className="size-7 fill-primary text-gold" aria-hidden />
          <span className="text-lg font-bold tracking-tight">BoomBigNose</span>
          <span className="hidden rounded-md bg-primary/15 px-1.5 py-0.5 text-[11px] font-semibold text-primary sm:inline">Campus</span>
        </div>
        {/* form-submit: implicit (single search input, Enter submits) */}
        <form onSubmit={onSearch} className="relative hidden max-w-md flex-1 md:block">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-[#7d8aa6]" aria-hidden />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setMiss(false)
            }}
            placeholder="Search people, rooms, forklifts, trucks… (Enter)"
            aria-label="Search people, rooms, forklifts and trucks"
            className={cn(
              "h-10 w-full rounded-xl border bg-card pr-10 pl-9 text-sm text-foreground outline-none placeholder:text-[#7d8aa6] focus:border-ring focus:ring-2 focus:ring-ring/30",
              miss ? "border-rose-400/70" : "border-border",
            )}
          />
          <kbd className="absolute top-1/2 right-3 -translate-y-1/2 rounded border border-border px-1.5 text-[11px] text-[#7d8aa6]">/</kbd>
        </form>
        <div className="ml-auto flex items-center gap-2 md:gap-3">
          <div className="hidden items-center gap-2 rounded-xl border border-border bg-card py-1.5 pr-3 pl-1.5 lg:flex">
            <span className="rounded-lg bg-primary px-2 py-1 text-xs font-bold text-primary-foreground">WH-01</span>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Bangna Hub</div>
              <div className="text-[11px] text-muted-foreground">
                78% full · {onSite.length}/2 docked
              </div>
            </div>
            <ChevronDown className="size-4 text-[#7d8aa6]" aria-hidden />
          </div>
          <div className="flex items-center gap-1.5 rounded-full bg-emerald-400/15 px-3 py-1.5 text-sm font-semibold text-emerald-300">
            <span className="relative flex size-2">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
            </span>
            Live <span className="tabular-nums">{snap ? hhmm(snap.sim) : "09:40"}</span>
          </div>
          <button type="button" aria-label="Notifications" className="relative rounded-lg p-2 text-muted-foreground hover:bg-accent">
            <Bell className="size-5" />
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-rose-500" />
          </button>
          <div className="hidden items-center gap-2 border-l border-border pl-3 sm:flex">
            <div className="grid size-9 place-items-center rounded-full bg-gradient-to-br from-primary to-gold text-sm font-semibold text-primary-foreground">BB</div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">Ops Control</div>
              <div className="text-[11px] text-muted-foreground">BoomBigNose</div>
            </div>
          </div>
        </div>
      </header>

      {/* KPIs */}
      <div className="pointer-events-none absolute top-20 left-4 z-10 flex gap-3 md:left-6">
        <Kpi icon={<Package className="size-5" />} label="Stock on hand" value={(snap?.stock ?? 1412).toLocaleString()} delta={snap?.stockDelta} sub="pallets · WH-01" />
        <Kpi
          icon={<Truck className="size-5" />}
          label="Trucks on site"
          value={String(onSite.length)}
          sub={`${inbound.length} inbound · WH-01`}
          className="hidden sm:flex"
        />
        <Kpi icon={<Clock className="size-5" />} label="On-time delivery" value="96.6%" delta={0.4} unit="%" sub="last 30 days · WH-01" className="hidden lg:flex" />
        <Kpi
          icon={<Users className="size-5" />}
          label="Team at desks"
          value={snap ? `${snap.people.filter((p) => /^(At desk|On a call)$/.test(p.status)).length}/${snap.people.length}` : "–"}
          sub={snap?.zones.find((z) => z.id === "meeting")?.status ?? "HQ office"}
          className="hidden xl:flex"
        />
      </div>

      {/* zone quick-nav */}
      {snap && (
        <nav aria-label="Campus zones" className="pointer-events-none absolute top-[10.5rem] left-4 z-10 hidden max-w-[calc(100%-30rem)] flex-wrap gap-1.5 md:flex md:left-6">
          {snap.zones.map((z) => (
            <button
              key={z.id}
              type="button"
              onClick={() => select(z.id)}
              className={cn(
                "pointer-events-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold shadow-sm ring-1 backdrop-blur",
                selected === z.id ? "bg-primary text-primary-foreground ring-primary" : "bg-card/90 text-[#c9d1e2] ring-border hover:bg-accent",
              )}
            >
              <MapPin className="size-3.5" aria-hidden />
              {z.name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => select("FL-01")}
            className="pointer-events-auto flex items-center gap-1.5 rounded-full bg-card/90 px-3 py-1.5 text-xs font-semibold text-[#c9d1e2] shadow-sm ring-1 ring-border hover:bg-accent"
          >
            <Forklift className="size-3.5" aria-hidden />
            Warehouse yard
          </button>
        </nav>
      )}

      {/* camera controls */}
      <div className={cn(card, "absolute top-20 right-4 z-10 flex flex-col p-1 md:right-[25rem]")}>
        <CtrlBtn label="Zoom in" onClick={() => sceneRef.current?.zoom(0.75)}><Plus /></CtrlBtn>
        <CtrlBtn label="Zoom out" onClick={() => sceneRef.current?.zoom(1.33)}><Minus /></CtrlBtn>
        <div className="mx-2 my-1 h-px bg-border" />
        <CtrlBtn label="Rotate left" onClick={() => sceneRef.current?.rotate(-1)}><RotateCcw /></CtrlBtn>
        <CtrlBtn label="Rotate right" onClick={() => sceneRef.current?.rotate(1)}><RotateCw /></CtrlBtn>
        <CtrlBtn label="Reset view" onClick={() => sceneRef.current?.home()}><House /></CtrlBtn>
      </div>

      {/* detail panel */}
      {current && (
        <aside className={cn(card, "absolute top-20 right-4 z-10 hidden w-[23rem] p-4 md:block")} aria-label={`${current.id} details`}>
          <div className="flex items-start gap-3">
            <div className="grid size-12 place-items-center rounded-xl bg-secondary text-primary ring-1 ring-border">
              {{ forklift: <Forklift className="size-6" />, truck: <Truck className="size-6" />, person: <User className="size-6" />, zone: <MapPin className="size-6" /> }[current.kind]}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold tracking-wide text-primary uppercase">
                {current.kind === "person" ? `Team · ${current.zone}` : current.kind === "zone" ? "Zone · HQ office" : `${current.kind} · WH-01`}
              </div>
              <div className="text-lg leading-tight font-bold">{current.kind === "zone" ? current.name : current.id}</div>
              <div className="truncate text-xs text-muted-foreground">{subtitle(current)}</div>
            </div>
            <CtrlBtn label="Follow on map" onClick={() => select(current.id)}><Crosshair /></CtrlBtn>
            <CtrlBtn label="Close details" onClick={() => select(null, false)}><X /></CtrlBtn>
          </div>
          <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
            <span className="rounded-md bg-emerald-400/15 px-2 py-1 text-xs font-semibold text-emerald-300">
              {current.kind === "truck" ? current.state : current.status}
            </span>
            <span className="truncate text-xs text-muted-foreground">{caption(current)}</span>
          </div>
          {current.kind === "zone" ? (
            <>
              <dl className="mt-2 text-sm">
                {current.stats.map(([k, v]) => (
                  <Row key={k} k={k} v={v} />
                ))}
              </dl>
              <div className="mt-3 flex gap-2">
                {current.links.map(([label, href]) => (
                  <Link key={href} href={href} className="flex-1 rounded-lg bg-primary px-3 py-2 text-center text-sm font-semibold text-primary-foreground hover:bg-primary/90">
                    Open {label} <ArrowRight className="inline size-3.5" aria-hidden />
                  </Link>
                ))}
              </div>
            </>
          ) : current.kind === "person" ? (
            <dl className="mt-2 text-sm">
              <Row k="Role" v={current.role} />
              <Row k="Zone" v={current.zone} />
              <Row k="Activity" v={current.status} />
              <Row k="Tasks done today" v={current.tasks} />
              <Row k="Site" v="BoomBigNose HQ" />
            </dl>
          ) : current.kind === "forklift" ? (
            <>
              <Meter value={current.battery} label={`Battery ${current.battery}%`} />
              <dl className="mt-2 text-sm">
                <Row k="Carrying" v={current.carrying} />
                <Row k="Moves today" v={current.moves} />
                <Row k="Speed" v={`${current.speedKmh.toFixed(1)} km/h`} />
                <Row k="Charger" v={<span className="text-primary">{current.charger}</span>} />
                <Row k="Site" v="Bangna Hub" />
              </dl>
            </>
          ) : (
            <>
              <Meter value={(current.loaded / current.capacity) * 100} label={`${current.loaded}/${current.capacity} pallets`} />
              <dl className="mt-2 text-sm">
                <Row k="Carrier" v={current.carrier} />
                <Row k="Direction" v={current.direction === "outbound" ? "Outbound" : "Inbound"} />
                <Row k="Dock" v={current.bay} />
                <Row k="ETA" v={current.eta != null ? `${Math.ceil(current.eta / 60)} min` : "On site"} />
                <Row k="Site" v="Bangna Hub" />
              </dl>
            </>
          )}
        </aside>
      )}

      {/* bottom: shipment tracking + docks */}
      {snap && (
        <div className="pointer-events-none absolute inset-x-4 bottom-4 z-10 hidden items-end gap-4 md:inset-x-6 md:flex">
          <Shipment snap={snap} onOpen={() => select(snap.shipment.truckId)} />
          <section className={cn(card, "ml-auto w-[30rem] p-3")} aria-label="Yard board">
            <div className="flex items-center gap-1 rounded-xl bg-secondary p-1" role="tablist">
              {(
                [
                  ["docks", "Docks", `${onSite.length}/2`],
                  ["forklifts", "Forklifts", `${snap.forklifts.filter((f) => f.speedKmh > 0.5).length}/2`],
                  ["trucks", "Trucks", String(trucks.length)],
                  ["team", "Team", String(snap.people.length)],
                ] as const
              ).map(([k, label, n]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-semibold",
                    tab === k ? "bg-accent text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label} <span className="font-medium text-[#7d8aa6]">{n}</span>
                </button>
              ))}
            </div>
            <ul className="mt-1 max-h-48 divide-y divide-border overflow-y-auto text-sm">
              {tab === "docks" &&
                (["Bay 1", "Bay 2"] as const).map((bay) => {
                  const t = onSite.find((x) => x.bay === bay)
                  return t ? (
                    <BoardRow key={bay} title={bay} sub="WH-01" name={`${t.id} · ${t.carrier}`} state={t.state} right={`${t.loaded}/${t.capacity}`} progress={t.loaded / t.capacity} onClick={() => select(t.id)} />
                  ) : (
                    <BoardRow key={bay} title={bay} sub="WH-01" name="No truck assigned" state="Available" />
                  )
                })}
              {tab === "docks" &&
                inbound.map((t) => (
                  <BoardRow key={t.id} title="Inbound" sub="WH-01" name={`${t.id} · ${t.carrier}`} state="En route" right={`${Math.max(1, Math.ceil((t.eta ?? 0) / 60))} min`} />
                ))}
              {tab === "forklifts" &&
                snap.forklifts.map((f) => (
                  <BoardRow key={f.id} title={f.id} sub={f.charger} name={f.status} state={f.speedKmh > 0.5 ? "Loading" : "Available"} stateLabel={f.speedKmh > 0.5 ? "Moving" : "Stopped"} right={`${f.battery}%`} onClick={() => select(f.id)} />
                ))}
              {tab === "team" &&
                snap.people.map((p) => (
                  <BoardRow
                    key={p.id}
                    title={p.name}
                    sub={p.zone}
                    name={p.status}
                    state={/^(At desk|On a call)$/.test(p.status) ? "Loading" : p.status.startsWith("In meeting") ? "En route" : "Arriving"}
                    stateLabel={/^(At desk|On a call)$/.test(p.status) ? "At desk" : p.status.startsWith("In meeting") ? "Meeting" : "Away"}
                    right={`${p.tasks} tasks`}
                    onClick={() => select(p.id)}
                  />
                ))}
              {tab === "trucks" &&
                trucks.map((t) => (
                  <BoardRow key={t.id} title={t.id} sub={t.direction} name={t.carrier} state={t.state} right={t.bay} onClick={t.state === "En route" || t.state === "Departed" ? undefined : () => select(t.id)} />
                ))}
            </ul>
          </section>
        </div>
      )}
    </div>
  )
}

function searchText(e: Entity) {
  if (e.kind === "truck") return e.carrier
  if (e.kind === "forklift") return e.operator
  if (e.kind === "person") return `${e.name} ${e.role} ${e.zone}`
  return `${e.name} ${e.sub}`
}

function subtitle(e: Entity) {
  if (e.kind === "forklift") return `${e.operator} · ${e.model}`
  if (e.kind === "truck") return `${e.carrier} · ${e.bay}`
  if (e.kind === "person") return e.role
  return e.sub
}

function caption(e: Entity) {
  if (e.kind === "forklift") return e.carrying === "Empty" ? "Forks empty" : `Carrying ${e.carrying}`
  if (e.kind === "truck") return e.direction === "outbound" ? `Outbound · ${e.loaded}/${e.capacity} loaded` : `Inbound · ${e.loaded}/${e.capacity} pallets aboard`
  if (e.kind === "person") return e.zone
  return "Live · simulated"
}

function Kpi({ icon, label, value, sub, delta, unit = "", className }: { icon: React.ReactNode; label: string; value: string; sub: string; delta?: number; unit?: string; className?: string }) {
  return (
    <div className={cn(card, "flex w-56 items-center gap-3 px-4 py-3", className)}>
      <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-primary/15 text-primary">{icon}</div>
      <div className="min-w-0">
        <div className="text-xs font-medium text-[#c9d1e2]">{label}</div>
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-bold tabular-nums">{value}</span>
          {delta != null && delta !== 0 && (
            <span className={cn("text-xs font-semibold tabular-nums", delta > 0 ? "text-emerald-300" : "text-rose-300")}>
              {delta > 0 ? <ArrowUp className="inline size-3" aria-hidden /> : <ArrowDown className="inline size-3" aria-hidden />} {delta > 0 ? "+" : ""}
              {delta}
              {unit}
            </span>
          )}
        </div>
        <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
      </div>
    </div>
  )
}

function CtrlBtn({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="grid size-9 place-items-center rounded-lg text-[#c9d1e2] hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&>svg]:size-4"
    >
      {children}
    </button>
  )
}

function Meter({ value, label }: { value: number; label: string }) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-accent">
        <div className="h-full rounded-full bg-emerald-500 transition-[width] duration-500" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
      <span className="text-xs text-muted-foreground tabular-nums">{label}</span>
    </div>
  )
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between border-b border-border py-2 last:border-0">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="truncate pl-4 font-medium tabular-nums">{v}</dd>
    </div>
  )
}

function BoardRow(p: { title: string; sub: string; name: string; state: string; stateLabel?: string; right?: string; progress?: number; onClick?: () => void }) {
  const body = (
    <>
      <div className="w-16 shrink-0 leading-tight">
        <div className="font-semibold">{p.title}</div>
        <div className="text-[11px] text-[#7d8aa6] capitalize">{p.sub}</div>
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-2 truncate">
        {p.state !== "Available" && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
        <span className={cn("truncate", p.state === "Available" && "text-muted-foreground")}>{p.name}</span>
      </div>
      <span className={cn("w-24 shrink-0 rounded-md px-2 py-1 text-center text-xs font-semibold", STATE_STYLE[p.state] ?? STATE_STYLE.Available)}>{p.stateLabel ?? p.state}</span>
      <div className="w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
        {p.progress != null && (
          <div className="mb-1 h-1 overflow-hidden rounded-full bg-accent">
            <div className="h-full bg-emerald-500" style={{ width: `${p.progress * 100}%` }} />
          </div>
        )}
        {p.right}
      </div>
      <ChevronRight className={cn("size-4 shrink-0", p.onClick ? "text-[#7d8aa6]" : "text-transparent")} aria-hidden />
    </>
  )
  return (
    <li>
      {p.onClick ? (
        <button type="button" onClick={p.onClick} className="flex w-full items-center gap-3 rounded-lg px-1 py-2 text-left hover:bg-accent">
          {body}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-1 py-2">{body}</div>
      )}
    </li>
  )
}

function Shipment({ snap, onOpen }: { snap: Snapshot; onOpen: () => void }) {
  const s = snap.shipment
  const transitEta = s.loadEta + 8 * 60
  const steps = [
    { icon: ClipboardCheck, label: "Order Confirmed", time: hhmm(s.confirmedAt) },
    { icon: Package, label: "Picked", time: hhmm(s.pickedAt) },
    { icon: PackageCheck, label: `Loading ${s.loaded}/${s.capacity}`, time: `ETA ${hhmm(s.loadEta)}` },
    { icon: Truck, label: "In Transit", time: `ETA ${hhmm(transitEta)}` },
    { icon: Check, label: "Delivered", time: `ETA ${hhmm(transitEta + 32 * 60)}` },
  ]
  const minsLeft = Math.max(0, Math.round((s.loadEta - snap.sim) / 60))
  return (
    <section className={cn(card, "flex min-w-0 flex-1 items-center gap-4 p-4")} aria-label="Shipment tracking">
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <Truck className="size-4 text-primary" aria-hidden /> Shipment Tracking
          </h2>
          <span className="text-xs text-muted-foreground">{s.truckId} · BoomBigNose Logistics</span>
        </div>
        <ol className="flex items-start">
          {steps.map((st, i) => {
            const done = i < s.step
            const active = i === s.step
            return (
              <li key={st.label} className="relative flex flex-1 flex-col items-center text-center">
                {i > 0 && <span className={cn("absolute top-4 right-1/2 h-0.5 w-full -translate-y-1/2", i <= s.step ? "bg-primary" : "bg-border")} />}
                <span
                  className={cn(
                    "relative grid size-8 place-items-center rounded-full",
                    done && "bg-primary text-primary-foreground",
                    active && "bg-primary text-primary-foreground ring-4 ring-primary/25",
                    !done && !active && "bg-accent text-[#7d8aa6]",
                  )}
                >
                  <st.icon className="size-4" aria-hidden />
                </span>
                <span className={cn("mt-1.5 text-xs font-medium whitespace-nowrap", !done && !active && "text-muted-foreground")}>{st.label}</span>
                <span className="text-[11px] text-[#7d8aa6] tabular-nums">{st.time}</span>
              </li>
            )
          })}
        </ol>
      </div>
      <button type="button" onClick={onOpen} className="hidden w-64 shrink-0 items-center gap-3 rounded-xl bg-secondary p-3 text-left ring-1 ring-border hover:bg-accent xl:flex">
        <Truck className="size-10 shrink-0 text-primary" aria-hidden />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="font-bold">{s.no}</div>
          <div className="truncate text-xs text-muted-foreground">To: {s.to}</div>
          <span className="mt-1 inline-block rounded-md bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
            {s.step === 2 ? "Loading" : "In Transit"}
          </span>
          <div className="mt-1 text-[11px] text-muted-foreground">WH-01 · Bay 1 · {s.step === 2 ? `${minsLeft} min left` : "departed"}</div>
        </div>
        <ChevronRight className="size-4 text-[#7d8aa6]" aria-hidden />
      </button>
    </section>
  )
}
