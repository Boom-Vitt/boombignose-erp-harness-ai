import "server-only"

import { getVerifiedApiContext, machineOperatorDenied } from "@/lib/auth"
import { can } from "@/lib/permissions"
import type { Host } from "@/lib/ai/model-catalog"
import { readLimitedJson } from "@/lib/http/read-json"

/** Inference requires membership; shared-host mutations also require settings capability and OS authorization. */
export async function localModelAccess(write: boolean, request: Request): Promise<Response | null> {
  const access = await getVerifiedApiContext(request, { mutation: request.method !== "GET" && request.method !== "HEAD" })
  if (access.response) return access.response
  if (write && !can(access.ctx.role, "settings:manage")) {
    return Response.json({ error: "Only an owner or admin can install or remove models on this computer." }, { status: 403 })
  }
  return write ? machineOperatorDenied(access.ctx.userId) : null
}

export function currentModelHost(): Host {
  return { platform: process.platform, arch: process.arch }
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const result = await readLimitedJson(request, 3_000_000)
  if ("error" in result || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) return null
  return result.data as Record<string, unknown>
}
