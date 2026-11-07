"use client"

import { Component, useEffect, useMemo, useState, type ReactNode } from "react"
import dynamic from "next/dynamic"
import { Download, Network, RotateCcw, ShieldQuestion, RefreshCw } from "lucide-react"
import { useLang } from "@/components/lang-scope"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  buildConnections, connectionId, FRESHNESS_MS,
  type NetworkSnapshot, type ReviewSignal, type TopologyEdge, type TopologyNode,
} from "@/lib/network/model"
import { classifyAddress, evaluateNetworkSignals, evaluateSshSignals } from "@/lib/network/signals"
import { SAMPLE_MACHINES, SAMPLE_SSH_EVENTS } from "@/lib/network/sample"

const Scene = dynamic(() => import("./network-scene"), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-muted-foreground">Loading 3D…</p>,
})

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

const EMPTY: NetworkSnapshot = { devices: [], policy: { allowedCidrs: [] }, serverTime: "2026-01-01T00:00:00.000Z" }
const sampleConnections = buildConnections(SAMPLE_SSH_EVENTS)
const sampleSignals = evaluateSshSignals(SAMPLE_SSH_EVENTS)
const timeFormat = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", dateStyle: "medium", timeStyle: "medium" })
function time(value: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return "unknown"
  return timeFormat.format(new Date(value))
}

function liveTopology(snapshot: NetworkSnapshot, signals: ReviewSignal[]) {
  const nodes: TopologyNode[] = [{ id: "erp", label: "ERP", detail: "Collector reports", kind: "erp", position: [0, 1, 0] }]
  const edges: TopologyEdge[] = []
  const devices = snapshot.devices.filter((device) => !device.revokedAt)
  const flagged = new Set(signals.map((signal) => signal.connectionId))
  devices.forEach((device, index) => {
    const angle = index * Math.PI * 2 / Math.max(devices.length, 1)
    nodes.push({ id: device.id, label: device.name, detail: "", kind: "device", position: [Math.cos(angle) * 5, 0.5, Math.sin(angle) * 5] })
    edges.push({ id: connectionId(device.id, "erp"), source: device.id, target: "erp", kind: device.lastSeenAt ? "report" : "enrollment", review: flagged.has(connectionId(device.id, "erp")) })
    const peers = [...new Set((device.report?.observations ?? []).map((event) => event.remoteAddress))]
    peers.forEach((address, peerIndex) => {
      const peerAngle = angle + (peerIndex - (peers.length - 1) / 2) * Math.min(0.35, 2 / Math.max(peers.length, 1))
      const id = connectionId(device.id, address)
      const peerId = `peer:${id}`
      nodes.push({ id: peerId, label: address, detail: "", kind: "peer", position: [Math.cos(peerAngle) * (9 + peerIndex % 3), 1 + peerIndex % 4, Math.sin(peerAngle) * (9 + peerIndex % 3)] })
      edges.push({ id, source: device.id, target: peerId, kind: "tcp", review: flagged.has(id) })
    })
  })
  return { nodes, edges }
}

export function NetworkExplorer({ initial = EMPTY, previewOnly = false, appOrigin = "" }: { initial?: NetworkSnapshot; previewOnly?: boolean; appOrigin?: string }) {
  const th = useLang() === "th"
  const text = (thai: string, english: string) => th ? thai : english
  const [snapshot, setSnapshot] = useState(initial)
  const [sample, setSample] = useState(previewOnly)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [resetKey, setResetKey] = useState(0)
  const [failed3d, setFailed3d] = useState(false)
  const [now, setNow] = useState(() => Date.parse(initial.serverTime))
  const [message, setMessage] = useState("")
  const [refreshError, setRefreshError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deviceName, setDeviceName] = useState("")
  const [erpUrl, setErpUrl] = useState(appOrigin)
  const [policyDraft, setPolicyDraft] = useState(initial.policy.allowedCidrs.join("\n"))

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (previewOnly) return
    const controller = new AbortController()
    const refresh = async () => {
      try {
        const response = await fetch("/api/network", { cache: "no-store", signal: controller.signal })
        if (!response.ok) throw new Error("Unavailable")
        setSnapshot(await response.json() as NetworkSnapshot)
        setRefreshError(false)
      } catch {
        if (!controller.signal.aborted) setRefreshError(true)
      }
    }
    const timer = setInterval(() => { void refresh() }, 15_000)
    return () => { clearInterval(timer); controller.abort() }
  }, [previewOnly])

  async function refresh() {
    const response = await fetch("/api/network", { cache: "no-store" })
    if (!response.ok) { setRefreshError(true); return }
    setSnapshot(await response.json() as NetworkSnapshot)
    setRefreshError(false)
  }

  const signals = useMemo(() => sample ? sampleSignals : evaluateNetworkSignals(snapshot, now), [sample, snapshot, now])
  const topology = useMemo(() => sample ? {
    nodes: SAMPLE_MACHINES.map((machine): TopologyNode => ({ id: machine.id, label: machine.name, detail: machine.address, kind: "device", position: machine.position })),
    edges: sampleConnections.map((connection): TopologyEdge => ({ id: connection.id, source: connection.source, target: connection.target, kind: "ssh", review: signals.some((signal) => signal.connectionId === connection.id) })),
  } : liveTopology(snapshot, signals), [sample, snapshot, signals])
  const selected = topology.edges.find((edge) => edge.id === selectedId)
  const labels = new Map(topology.nodes.map((node) => [node.id, node.detail ? `${node.label} · ${node.detail}` : node.label]))
  const selectedDevice = snapshot.devices.find((device) => device.id === selected?.source)
  const selectedEvents = sample ? sampleConnections.find((connection) => connection.id === selectedId)?.events ?? [] : []
  const selectedObservations = !sample && selected?.kind === "tcp" ? selectedDevice?.report?.observations.filter((event) => connectionId(selectedDevice.id, event.remoteAddress) === selectedId) ?? [] : []
  const selectedSignals = signals.filter((signal) => signal.connectionId === selectedId)

  function switchMode(next: boolean) { setSample(next); setSelectedId(null); setResetKey((key) => key + 1) }
  async function mutate(path: string, body: unknown) {
    const response = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    if (!response.ok) throw new Error("Request failed")
    return response
  }
  async function enroll() {
    setBusy(true); setMessage("")
    try {
      const origin = new URL(erpUrl)
      if (origin.origin !== erpUrl.replace(/\/$/, "") || (origin.protocol !== "https:" && !(origin.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)))) throw new Error("Invalid origin")
      const response = await mutate("/api/network/devices", { name: deviceName.trim() })
      const credential = await response.json() as { deviceId: string; deviceToken: string }
      // This one-time private credential is downloaded, never rendered or retained in state.
      const blob = new Blob([JSON.stringify({ erpUrl: origin.origin, deviceId: credential.deviceId, deviceToken: credential.deviceToken }, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url; link.download = "bbn-collector.json"; link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setDeviceName("")
      setMessage(text("ดาวน์โหลดไฟล์ส่วนตัวแล้ว ตั้งสิทธิ์ chmod 600 ก่อนใช้ collector ห้ามแชร์ไฟล์นี้", "Private config downloaded. Run chmod 600 before starting the collector. Do not share this file."))
      await refresh()
    } catch { setMessage(text("ลงทะเบียนไม่สำเร็จ ตรวจสิทธิ์ ชื่อเครื่อง และ HTTPS origin หากสร้างเครื่องแล้วให้เพิกถอนก่อนลองใหม่", "Enrollment failed. Check permissions, device name and HTTPS origin. Revoke any newly created device before retrying.")) }
    finally { setBusy(false) }
  }
  async function savePolicy() {
    setBusy(true); setMessage("")
    try {
      const allowedCidrs = policyDraft.split(/[\s,]+/).map((cidr) => cidr.trim()).filter(Boolean)
      await mutate("/api/network/policy", { allowedCidrs })
      await refresh()
      setMessage(text("บันทึก policy แล้ว ไม่ใช่การตั้งค่า firewall", "Policy saved. This does not configure a firewall."))
    } catch { setMessage(text("บันทึกไม่ได้ ตรวจรูปแบบ CIDR และสิทธิ์ของคุณ", "Could not save. Check CIDR syntax and your permissions.")) }
    finally { setBusy(false) }
  }
  async function revoke(id: string) {
    setBusy(true)
    try { await mutate(`/api/network/devices/${id}/revoke`, {}); await refresh(); setSelectedId(null) }
    catch { setMessage(text("เพิกถอนไม่สำเร็จ", "Could not revoke device.")) }
    finally { setBusy(false) }
  }

  const ruleTitle = (rule: ReviewSignal["rule"]) => ({
    failed_burst: text("SSH ล้มเหลวถี่", "Repeated SSH failures"), root_login: text("SSH ด้วย root", "Root SSH login"),
    off_hours: text("SSH นอกเวลา", "Off-hours SSH login"), outside_policy: text("ปลายทางนอก policy", "Destination outside policy"),
    coverage_gap: text("ขาดข้อมูลการสังเกต", "Observation coverage gap"),
  })[rule]
  const fallback = <p className="p-6 text-sm text-muted-foreground">{text("3D ไม่พร้อมใช้งาน ใช้รายการเส้นด้านล่างเพื่อดูหลักฐานได้", "3D unavailable. Use the connection list below to inspect evidence.")}</p>

  return (
    <section className="space-y-5">
      <PageHeader title={text("เครือข่าย 3D", "Network Explorer 3D")} description={text("ERP · เครื่องที่ลงทะเบียน · ปลายทางที่สังเกตได้", "ERP · enrolled computers · observed destinations")}>
        <span className="bbn-chip"><Network className="size-3" />macOS</span>
      </PageHeader>
      <div className="flex flex-wrap gap-2" aria-label={text("แหล่งข้อมูล", "Data source")}>
        {!previewOnly && <Button variant={!sample ? "default" : "outline"} aria-pressed={!sample} onClick={() => switchMode(false)}>{text("ข้อมูลจริง", "Live telemetry")}</Button>}
        <Button variant={sample ? "default" : "outline"} aria-pressed={sample} onClick={() => switchMode(true)}>{text("ตัวอย่าง SSH", "SSH sample")}</Button>
        <Button variant="outline" onClick={() => setResetKey((key) => key + 1)}><RotateCcw />{text("รีเซ็ตมุมมอง", "Reset view")}</Button>
        {!sample && <Button variant="ghost" onClick={() => { void refresh().catch(() => setRefreshError(true)) }}><RefreshCw />{text("โหลดใหม่", "Refresh")}</Button>}
      </div>
      <div className="rounded-xl border border-primary/40 bg-card/90 p-4 text-sm" role="note">
        <p className="flex items-start gap-2 font-medium"><ShieldQuestion className="mt-0.5 size-4 shrink-0 text-primary" />{sample ? text("ข้อมูลตัวอย่างเท่านั้น — ไม่ใช่สถานะเครือข่ายจริง", "Sample data only — not your real network status") : text("การมองเห็นบางส่วน ไม่ใช่การยืนยันว่าไม่มีข้อมูลรั่ว", "Partial visibility — not proof that no data leaves a computer")}</p>
        <p className="mt-2 text-muted-foreground">{text("TCP snapshot เห็นเฉพาะ process ที่ OS อนุญาต อาจพลาด connection อายุสั้น ไม่เห็น payload, bytes หรือทิศทางเริ่มต้นของ TCP; การเข้ารหัสทำให้ระบุไม่ได้ว่าส่งข้อมูล ERP หรือไม่ ไม่มีการบล็อกอัตโนมัติ", "TCP snapshots cover only OS-permitted processes, may miss short-lived connections, and do not expose payloads, byte counts or TCP initiation direction. Encrypted traffic cannot be identified as ERP data. Nothing is blocked automatically.")}</p>
        {!sample && !snapshot.policy.allowedCidrs.length && <p className="mt-2 font-medium">{text("ยังไม่ตั้ง policy: ทุกปลายทางเป็น unknown ไม่ใช่ safe", "No policy configured: all destinations are unknown, not safe.")}</p>}
        {refreshError && <p className="mt-2 font-medium" role="alert">{text("โหลดข้อมูลไม่ได้ กำลังแสดงรายงานเดิม — ความสดไม่รับประกัน", "Refresh failed. Showing previous reports — freshness is not guaranteed.")}</p>}
      </div>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 rounded-xl border bg-background/95">
          <div className="flex flex-wrap justify-between gap-2 border-b px-4 py-3 text-xs text-muted-foreground">
            <span>{topology.nodes.length} {text("โหนด", "nodes")} · {topology.edges.length} {text("เส้น", "connections")}</span>
            <span>{text("ลากเพื่อหมุน · เลื่อนเพื่อซูม · คลิกเส้น", "Drag to orbit · scroll to zoom · click an edge")}</span>
          </div>
          <div className="h-[420px] min-w-0 sm:h-[540px]" data-network-canvas>
            {failed3d ? fallback : <SceneBoundary fallback={fallback}><Scene nodes={topology.nodes} edges={topology.edges} selectedEdgeId={selectedId} onSelectEdge={setSelectedId} resetKey={resetKey} onFailure={() => setFailed3d(true)} /></SceneBoundary>}
          </div>
          <p className="border-t px-4 py-2 text-xs text-muted-foreground">{text("เส้นประ: ลงทะเบียน/รายงาน collector · ลูกศร: ทิศทางรายงานหรือ SSH ตัวอย่าง · TCP ไม่ทราบผู้เริ่ม", "Dashed: enrollment/collector reports · arrows: report or sample SSH direction · TCP initiator unknown")}</p>
        </div>
        <aside className="min-w-0 space-y-3 rounded-xl border bg-card/95 p-4" aria-label={text("รายละเอียดเส้น", "Connection details")}>
          <h2 className="font-semibold">{text("รายละเอียดเหตุการณ์", "Event details")}</h2>
          {!selected ? <p className="text-sm text-muted-foreground">{text("คลิกเส้นในฉากหรือเลือกรายการด้านล่าง", "Click an edge in 3D or select a connection below.")}</p> : <>
            <p className="break-words text-sm font-medium">{labels.get(selected.source)} {selected.kind === "tcp" || selected.kind === "enrollment" ? "↔" : "→"} {labels.get(selected.target)}</p>
            <p className="text-xs text-muted-foreground">{selected.kind === "enrollment" ? text("ลงทะเบียนแล้ว แต่ยังไม่มี telemetry: unknown", "Enrolled, but no telemetry received: unknown") : selected.kind === "report" ? text("หลักฐาน: collector ส่งรายงาน ไม่ยืนยันว่ามีผู้ใช้เปิด ERP", "Evidence: collector report, not proof of a user ERP session") : selected.kind === "ssh" ? "SSH · sample · Asia/Bangkok" : "TCP · lsof snapshot · Asia/Bangkok"}</p>
            {!sample && <dl className="space-y-2 text-sm"><div><dt className="text-muted-foreground">{text("เก็บเมื่อ", "Captured")}</dt><dd>{time(selectedDevice?.report?.capturedAt ?? null)}</dd></div><div><dt className="text-muted-foreground">{text("server รับเมื่อ", "Server received")}</dt><dd>{time(selectedDevice?.lastSeenAt ?? null)}</dd></div><div><dt className="text-muted-foreground">{text("เนื้อหา / bytes / SSH authentication", "Contents / bytes / SSH authentication")}</dt><dd>unknown</dd></div></dl>}
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {selectedEvents.map((event) => <article key={event.id} className="rounded-lg border p-3 text-xs"><p className="font-mono">{event.id}</p><p>{time(event.timestamp)} · Asia/Bangkok</p><p>SSH :{event.port} · {event.account} · {event.outcome}</p></article>)}
              {selectedObservations.map((event) => <article key={event.id} className="space-y-1 rounded-lg border p-3 text-xs"><p className="break-all font-mono">{event.localAddress}:{event.localPort} ↔ {event.remoteAddress}:{event.remotePort}</p><p>{event.process} · PID {event.pid} · TCP</p><p>{classifyAddress(event.remoteAddress, snapshot.policy.allowedCidrs)}</p></article>)}
            </div>
            {selectedSignals.map((signal) => <div key={signal.id} className="rounded-lg border border-primary/40 p-3 text-xs"><p>{ruleTitle(signal.rule)}</p><p className="font-medium text-primary">รอคนตรวจ{!th && " · Awaiting human review"}</p><p className="mt-1 break-words text-muted-foreground">{signal.eventIds.join(", ") || text("ไม่มีรายงานสด", "No fresh report")}</p></div>)}
          </>}
        </aside>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="min-w-0 rounded-xl border bg-card/95 p-4">
          <h2 className="mb-3 font-semibold">{text("เส้นเชื่อมต่อ", "Connections")}</h2>
          {!topology.edges.length && <p className="text-sm text-muted-foreground">{text("ยังไม่มีรายงาน ลงทะเบียน Mac และเริ่ม collector ด้านล่าง", "No reports yet. Enroll a Mac and start its collector below.")}</p>}
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {topology.edges.map((edge) => <button type="button" key={edge.id} onClick={() => setSelectedId(edge.id)} aria-pressed={selectedId === edge.id} className={`w-full rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring ${selectedId === edge.id ? "border-primary bg-primary/10" : "border-border"}`}><span className="block break-words">{labels.get(edge.source)} {edge.kind === "tcp" || edge.kind === "enrollment" ? "↔" : "→"} {labels.get(edge.target)}</span><span className="text-xs text-muted-foreground">{edge.kind === "enrollment" ? "Enrollment · no telemetry" : edge.kind === "report" ? "Collector report" : edge.kind.toUpperCase()}{edge.review ? " · รอคนตรวจ" : ""}</span></button>)}
          </div>
        </section>
        <section className="min-w-0 rounded-xl border bg-card/95 p-4">
          <h2 className="mb-3 font-semibold">{text("สัญญาณให้ตรวจ", "Review signals")} · {signals.length}</h2>
          {!signals.length && <p className="text-sm text-muted-foreground">{text("ไม่มีสัญญาณจากข้อมูลที่มี ไม่ใช่การยืนยันว่าปลอดภัย", "No signals in available evidence. This does not establish safety.")}</p>}
          <div className="max-h-72 space-y-2 overflow-y-auto">{signals.map((signal) => <button type="button" key={signal.id} onClick={() => setSelectedId(signal.connectionId)} className="w-full rounded-lg border border-primary/30 px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"><span className="block">{ruleTitle(signal.rule)}</span><span className="block text-xs text-primary">รอคนตรวจ{!th && " · Awaiting human review"}</span><span className="block break-words text-xs text-muted-foreground">{labels.get(topology.edges.find((edge) => edge.id === signal.connectionId)?.source ?? "") ?? snapshot.devices.find((device) => signal.connectionId.includes(device.id))?.name ?? signal.rule}</span></button>)}</div>
        </section>
      </div>
      {!sample && <section className="space-y-4 rounded-xl border bg-card/95 p-4">
        <h2 className="font-semibold">{text("เครื่องที่ลงทะเบียน", "Enrolled computers")}</h2>
        <p className="text-xs text-muted-foreground">{text("ทุกเวลา Asia/Bangkok · เก่ากว่า 120 วินาที = unknown · เป็น snapshot ไม่ใช่การเฝ้าดูทุก packet", "All times Asia/Bangkok · older than 120 seconds = unknown · snapshots, not continuous packet monitoring")}</p>
        {snapshot.devices.map((device) => {
          const age = Math.max(now - Date.parse(device.lastSeenAt ?? ""), now - Date.parse(device.report?.capturedAt ?? ""))
          const status = device.revokedAt ? "revoked" : !Number.isFinite(age) || age < 0 || age > FRESHNESS_MS ? "unknown / stale" : "partial snapshot"
          return <div key={device.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"><div className="min-w-0 text-sm"><p className="break-words font-medium">{device.name}</p><p className="text-xs text-muted-foreground">{status} · {time(device.lastSeenAt)}</p><p className="text-xs text-muted-foreground">{device.report?.coverage ?? "no telemetry"}{device.report?.truncated ? " · truncated" : ""}</p></div>{!device.revokedAt && <Button variant="outline" size="sm" disabled={busy} onClick={() => { void revoke(device.id) }}>{text("เพิกถอน", "Revoke")}</Button>}</div>
        })}
        <div className="grid gap-5 pt-2 lg:grid-cols-2">
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void enroll() }}>
            <h3 className="text-sm font-medium">{text("ลงทะเบียน Mac · owner/admin", "Enroll a Mac · owner/admin")}</h3>
            <label className="block space-y-1 text-xs"><span>{text("ชื่อเครื่อง", "Computer name")}</span><Input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} maxLength={80} required autoComplete="off" /></label>
            <label className="block space-y-1 text-xs"><span>ERP origin (HTTPS; HTTP loopback only)</span><Input type="url" value={erpUrl} onChange={(event) => setErpUrl(event.target.value)} required /></label>
            <Button type="submit" disabled={busy || !deviceName.trim()}><Download />{text("ลงทะเบียนและดาวน์โหลด config ส่วนตัว", "Enroll & download private config")}</Button>
            <p className="text-xs text-muted-foreground">{text("บน Mac ที่ลงทะเบียน: ใช้โปรแกรม Go native boombignose จาก build นี้ ไม่ต้องติดตั้ง Node.js ตั้ง chmod 600 ให้ไฟล์ config แล้วรันคำสั่งด้านล่าง ใช้ HTTPS origin ที่ Mac เครื่องนั้นเข้าถึงได้ ห้ามแชร์ credential", "On the enrolled Mac: use the native Go boombignose binary from this build. No Node.js required. Set config permissions to 600, then run the command below. Use an HTTPS ERP origin reachable by that Mac. Never share the credential.")}</p>
            <pre className="overflow-x-auto rounded-lg bg-background p-3 text-[11px]">{"chmod 600 ~/Downloads/bbn-collector.json\n./boombignose network-collector --config ~/Downloads/bbn-collector.json"}</pre>
          </form>
          <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void savePolicy() }}>
            <h3 className="text-sm font-medium">{text("เครือข่ายที่อนุญาต · CIDR", "Allowed destination networks · CIDR")}</h3>
            <label className="block space-y-1 text-xs"><span>{text("หนึ่ง CIDR ต่อบรรทัด · เว้นว่าง = unknown", "One CIDR per line · empty = unknown")}</span><textarea className="min-h-32 w-full rounded-lg border border-input bg-background p-3 font-mono text-sm focus-visible:outline-2 focus-visible:outline-ring" value={policyDraft} onChange={(event) => setPolicyDraft(event.target.value)} placeholder={"192.0.2.0/24\n2001:db8::/32"} /></label>
            <Button type="submit" variant="outline" disabled={busy}>{text("บันทึก policy", "Save policy")}</Button>
            <p className="text-xs text-muted-foreground">{text("เป็น policy เพื่อคัดกรองสัญญาณเท่านั้น ไม่ตั้ง firewall และไม่ได้แปลว่าปลายทางที่อนุญาตปลอดภัย", "Review classification only. This does not configure a firewall or establish that an allowed destination is safe.")}</p>
          </form>
        </div>
        <p role="status" className="text-sm text-primary">{message}</p>
      </section>}
    </section>
  )
}
