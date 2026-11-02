"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

export type Device = { id: string; name: string; created_at: string; last_seen_at: string | null; revoked_at: string | null }
type Pairing = { qr: string; baseUrl: string; expiresAt: string }

export function MobileLinkCard({ initial }: { initial: Device[] }) {
  const [baseUrl, setBaseUrl] = useState("")
  const [pairing, setPairing] = useState<Pairing | null>(null)
  const [devices, setDevices] = useState<Device[]>(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  async function load() {
    const res = await fetch("/api/mobile/devices")
    if (res.ok) setDevices((await res.json()).devices)
  }

  async function generate() {
    setPending(true)
    setError("")
    try {
      const res = await fetch("/api/mobile/pair/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ baseUrl }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        setPairing(null)
        setError(body?.error ?? "Could not create a pairing code.")
        return
      }
      setPairing(body)
      if (!baseUrl) setBaseUrl(body.baseUrl)
      void load()
    } finally {
      setPending(false)
    }
  }

  async function revoke(id: string) {
    const res = await fetch(`/api/mobile/devices/${id}`, { method: "DELETE" })
    if (res.ok) void load()
    else setError("Could not revoke the device.")
  }

  const active = devices.filter((d) => !d.revoked_at)
  return (
    <div className="space-y-4">
      <p className="text-muted-foreground text-sm">
        เชื่อมผ่าน Tailscale เท่านั้น รัน{" "}
        <code className="bg-muted rounded px-1">tailscale serve --bg 3100</code> หนึ่งครั้ง แล้วสแกน QR (ใช้ได้ครั้งเดียว หมดอายุใน 5 นาที)
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
          Address of this computer (optional if Tailscale is detected)
          <input
            className="border-input bg-background rounded-md border px-3 py-2"
            placeholder="https://my-mac.tailnet-name.ts.net"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        <Button type="button" onClick={generate} disabled={pending}>
          {pending ? "Creating…" : "Generate QR"}
        </Button>
      </div>
      {error ? <p role="alert" className="text-destructive text-sm">{error}</p> : null}
      {pairing ? (
        <div className="flex items-center gap-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- data URL, nothing to optimise */}
          <img src={pairing.qr} alt="Pairing QR code" width={200} height={200} className="rounded-md bg-white" />
          <p className="text-muted-foreground text-sm">
            {pairing.baseUrl}
            <br />
            Expires {new Date(pairing.expiresAt).toLocaleTimeString()}
          </p>
        </div>
      ) : null}
      {active.length > 0 ? (
        <ul className="divide-y text-sm">
          {active.map((d) => (
            <li key={d.id} className="flex items-center justify-between gap-2 py-2">
              <span>
                {d.name}
                <span className="text-muted-foreground">
                  {" "}· {d.last_seen_at ? `last seen ${new Date(d.last_seen_at).toLocaleString()}` : "never opened"}
                </span>
              </span>
              <Button type="button" variant="outline" size="sm" onClick={() => revoke(d.id)}>
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
