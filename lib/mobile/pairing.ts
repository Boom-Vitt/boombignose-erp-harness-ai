import { createHash, randomBytes } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/types/database"

type Db = SupabaseClient<Database>

/** A pairing QR is good for 5 minutes and one redeem. */
export const PAIR_TTL_MS = 5 * 60 * 1000

export const hashToken = (raw: string) => createHash("sha256").update(raw).digest("hex")

/** 256-bit random, URL-safe. Tokens are never derived from user data. */
export const newToken = () => randomBytes(32).toString("base64url")

const LOOPBACK = /^(localhost|127\.|0\.0\.0\.0|\[?::1\]?$)/i

/**
 * The phone cannot reach loopback, so a loopback base URL would pair and then never connect.
 * Returns the bare origin, or null when the input is not an http(s) URL the phone could use.
 */
export function normalizeBaseUrl(input: string): string | null {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    return null
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null
  if (LOOPBACK.test(url.hostname)) return null
  return url.origin
}

/** `bbn-pair://redeem?...` — carries the one-time token only, never a password or a session. */
export function buildPairUri(p: { baseUrl: string; token: string; orgName: string; expiresAt: Date }) {
  const q = new URLSearchParams({
    u: p.baseUrl,
    t: p.token,
    o: p.orgName,
    e: String(Math.floor(p.expiresAt.getTime() / 1000)),
  })
  return `bbn-pair://redeem?${q}`
}

export async function startPairing(db: Db, a: { orgId: string; userId: string; now?: Date }) {
  const now = a.now ?? new Date()
  const token = newToken()
  const expiresAt = new Date(now.getTime() + PAIR_TTL_MS)
  const { error } = await db.from("mobile_pairings").insert({
    org_id: a.orgId,
    created_by: a.userId,
    token_hash: hashToken(token),
    expires_at: expiresAt.toISOString(),
  })
  if (error) throw new Error("Could not create a pairing code.")
  return { token, expiresAt }
}

/**
 * Consume a pairing token and mint a device credential. Consumption is one conditional UPDATE,
 * so two concurrent redeems cannot both win. Unknown, expired and used tokens all return null.
 */
export async function redeemPairing(db: Db, a: { token: string; deviceName: string; now?: Date }) {
  const now = (a.now ?? new Date()).toISOString()
  const { data: pairing } = await db
    .from("mobile_pairings")
    .update({ consumed_at: now })
    .eq("token_hash", hashToken(a.token))
    .is("consumed_at", null)
    .gt("expires_at", now)
    .select("org_id, created_by")
    .maybeSingle()
  if (!pairing) return null

  const deviceToken = newToken()
  const { data: device, error } = await db
    .from("mobile_devices")
    .insert({
      org_id: pairing.org_id,
      user_id: pairing.created_by,
      name: a.deviceName.trim().slice(0, 80) || "Mobile",
      token_hash: hashToken(deviceToken),
    })
    .select("id")
    .single()
  if (error || !device) throw new Error("Could not register the device.")
  return { deviceToken, deviceId: device.id, orgId: pairing.org_id }
}

export const bearerToken = (req: Request) => {
  const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "")
  return m ? m[1]! : null
}

/** Look up a live (not revoked) device by its bearer token. */
export async function authDevice(db: Db, token: string | null, now = new Date()) {
  if (!token) return null
  const { data: device } = await db
    .from("mobile_devices")
    .select("id, org_id, user_id, name")
    .eq("token_hash", hashToken(token))
    .is("revoked_at", null)
    .maybeSingle()
  if (!device) return null
  await db.from("mobile_devices").update({ last_seen_at: now.toISOString() }).eq("id", device.id)
  return device
}

export async function listDevices(db: Db, orgId: string) {
  const { data, error } = await db
    .from("mobile_devices")
    .select("id, name, created_at, last_seen_at, revoked_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
  if (error) throw new Error("Could not load devices.")
  return data ?? []
}

export async function revokeDevice(db: Db, orgId: string, id: string, now = new Date()) {
  const { data } = await db
    .from("mobile_devices")
    .update({ revoked_at: now.toISOString() })
    .eq("org_id", orgId)
    .eq("id", id)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle()
  return Boolean(data)
}
