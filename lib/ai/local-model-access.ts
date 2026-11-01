import "server-only"

import { getOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import type { Host } from "@/lib/ai/model-catalog"

/** Signed-in members may look and try. Installing or removing weights is an owner or admin action. */
export async function localModelAccess(write: boolean): Promise<Response | null> {
  const ctx = await getOrgContext()
  if (!ctx) return Response.json({ error: "Sign in required." }, { status: 401 })
  if (write && !can(ctx.role, "settings:manage")) {
    return Response.json({ error: "Only an owner or admin can install or remove models on this computer." }, { status: 403 })
  }
  return null
}

export function currentModelHost(): Host {
  return { platform: process.platform, arch: process.arch }
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  const data = await request.json().catch(() => null)
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  return data as Record<string, unknown>
}
