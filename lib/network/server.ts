import "server-only"

import { createHash, randomBytes } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"

import { getOrgContext, type OrgContext } from "@/lib/auth"
import type { NetworkSnapshot } from "@/lib/network/model"
import { isValidCidr } from "@/lib/network/signals"
import {
  isCaptureTimeAllowed, isDeviceId, NetworkRequestError, parseCollectorReport,
  readNetworkJson, record, requireSameOrigin,
} from "@/lib/network/validation"
import { createAdminClient } from "@/lib/supabase/admin"
import { readAll } from "@/lib/supabase/read-all"
import { createClient } from "@/lib/supabase/server"
import type { Database, Json } from "@/lib/types/database"

function assertNetworkAdmin(ctx: OrgContext): void {
  if (ctx.role !== "owner" && ctx.role !== "admin") throw new NetworkRequestError(403, "Forbidden.")
}

async function requireNetworkAssurance(db: SupabaseClient<Database>): Promise<void> {
  const { data, error } = await db.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error || !data || (data.nextLevel === "aal2" && data.currentLevel !== "aal2")) {
    throw new NetworkRequestError(403, "Complete two-factor verification before accessing network visibility.")
  }
}

async function networkAdmin(): Promise<OrgContext> {
  const ctx = await getOrgContext()
  if (!ctx) throw new NetworkRequestError(401, "Sign in required.")
  assertNetworkAdmin(ctx)
  await requireNetworkAssurance(await createClient())
  return ctx
}

/** No credentials, hashes, arbitrary JSON, or workspace identifiers enter this projection. */
export async function getNetworkSnapshot(ctx: OrgContext): Promise<NetworkSnapshot> {
  assertNetworkAdmin(ctx)
  const db = await createClient()
  await requireNetworkAssurance(db)
  const [devices, policy] = await Promise.all([
    readAll((from, to) => db.from("network_devices")
      .select("id,name,created_at,last_received_at,revoked_at,latest_report")
      .eq("org_id", ctx.orgId).order("id").range(from, to)),
    db.from("network_policy").select("allowed_cidrs").eq("org_id", ctx.orgId).maybeSingle(),
  ])
  if (devices.error || !devices.data || policy.error) throw new Error("Could not load network visibility.")
  return {
    devices: devices.data.map((device) => ({
      id: device.id, name: device.name, createdAt: device.created_at,
      lastSeenAt: device.last_received_at, revokedAt: device.revoked_at,
      report: parseCollectorReport(device.latest_report),
    })),
    policy: { allowedCidrs: policy.data?.allowed_cidrs ?? [] },
    serverTime: new Date().toISOString(),
  }
}

export function networkJson(body: unknown, status = 200, headers?: HeadersInit): Response {
  const result = new Headers(headers)
  result.set("Cache-Control", "private, no-store, max-age=0")
  result.set("Pragma", "no-cache")
  result.set("X-Content-Type-Options", "nosniff")
  return Response.json(body, { status, headers: result })
}

/** A single safe error boundary never returns raw Supabase errors or request contents. */
export async function networkRoute(action: () => Promise<Response>): Promise<Response> {
  try {
    return await action()
  } catch (error) {
    return error instanceof NetworkRequestError
      ? networkJson({ error: error.message }, error.status)
      : networkJson({ error: "Network request could not be completed." }, 500)
  }
}

export async function snapshotResponse(): Promise<Response> {
  const ctx = await getOrgContext()
  if (!ctx) throw new NetworkRequestError(401, "Sign in required.")
  return networkJson(await getNetworkSnapshot(ctx))
}

export async function enrollResponse(request: Request): Promise<Response> {
  requireSameOrigin(request, process.env.NEXT_PUBLIC_APP_URL)
  const ctx = await networkAdmin()
  const body = await readNetworkJson(request)
  if (!record(body) || typeof body.name !== "string" || body.name.trim().length < 1
    || body.name.trim().length > 80 || /[\u0000-\u001f\u007f]/.test(body.name)) {
    throw new NetworkRequestError(400, "Device name must be 1–80 characters without control characters.")
  }
  const deviceToken = randomBytes(32).toString("base64url")
  const db = await createClient()
  const { data, error } = await db.from("network_devices").insert({
    org_id: ctx.orgId, created_by: ctx.userId, name: body.name.trim(),
    token_hash: createHash("sha256").update(deviceToken).digest("hex"),
  }).select("id").single()
  if (error || !data) throw new Error("Could not enroll device.")
  return networkJson({ deviceId: data.id, deviceToken }, 201, {
    "Content-Disposition": `attachment; filename="network-device-${data.id}.json"`,
  })
}

export async function revokeResponse(request: Request, id: string): Promise<Response> {
  requireSameOrigin(request, process.env.NEXT_PUBLIC_APP_URL)
  const ctx = await networkAdmin()
  if (!isDeviceId(id)) throw new NetworkRequestError(400, "Invalid device identifier.")
  const db = await createClient()
  const { data, error } = await db.from("network_devices")
    .update({ revoked_at: new Date().toISOString() })
    .eq("org_id", ctx.orgId).eq("id", id).is("revoked_at", null).select("id").maybeSingle()
  if (error) throw new Error("Could not revoke device.")
  if (!data) throw new NetworkRequestError(404, "Active device not found.")
  return networkJson({ revoked: true })
}

export async function policyResponse(request: Request): Promise<Response> {
  requireSameOrigin(request, process.env.NEXT_PUBLIC_APP_URL)
  const ctx = await networkAdmin()
  const body = await readNetworkJson(request)
  if (!record(body) || !Array.isArray(body.allowedCidrs) || body.allowedCidrs.length > 100
    || !body.allowedCidrs.every((cidr: unknown): cidr is string => typeof cidr === "string" && isValidCidr(cidr))) {
    throw new NetworkRequestError(400, "Provide up to 100 valid IPv4 or IPv6 CIDRs.")
  }
  const allowedCidrs = [...new Set(body.allowedCidrs as string[])]
  const db = await createClient()
  const { error } = await db.rpc("set_network_policy", {
    p_org_id: ctx.orgId, p_allowed_cidrs: allowedCidrs,
  })
  if (error) throw new Error("Could not save network policy.")
  return networkJson({ allowedCidrs })
}

export async function telemetryResponse(request: Request): Promise<Response> {
  // Device credential has only ingest authority. Authenticate before reading any body bytes.
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/i.exec(request.headers.get("authorization") ?? "")
  if (!match) throw new NetworkRequestError(401, "Device authentication required.")
  const tokenHash = createHash("sha256").update(match[1]!).digest("hex")
  const db = createAdminClient()
  const { data: device, error: authError } = await db.from("network_devices")
    .select("id,org_id").eq("token_hash", tokenHash).is("revoked_at", null).maybeSingle()
  if (authError) throw new Error("Device authentication unavailable.")
  if (!device) throw new NetworkRequestError(401, "Device authentication required.")

  const body = await readNetworkJson(request)
  if (!record(body) || !isDeviceId(body.deviceId) || body.deviceId !== device.id) {
    throw new NetworkRequestError(400, "Report device does not match the registered device.")
  }
  const report = parseCollectorReport(body.report)
  if (!report || !isCaptureTimeAllowed(report.capturedAt, Date.now())) {
    throw new NetworkRequestError(400, "Invalid, expired, or future-dated metadata report.")
  }
  const { data: receivedAt, error } = await db.rpc("ingest_network_report", {
    p_device_id: device.id, p_org_id: device.org_id, p_token_hash: tokenHash,
    p_captured_at: report.capturedAt, p_report: report as unknown as Json,
  })
  if (error) throw new Error("Could not receive report.")
  if (!receivedAt) throw new NetworkRequestError(409, "Report not accepted: device revoked or report is not newer.")
  return networkJson({ accepted: true, receivedAt }, 202)
}
