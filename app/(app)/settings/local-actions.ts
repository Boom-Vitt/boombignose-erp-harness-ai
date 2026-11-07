"use server"

import { requireOrgContext } from "@/lib/auth"
import { localDataDir, readStartLog } from "@/lib/install/logs"
import { interpretRelease, type UpdateCheck } from "@/lib/release/update-check"
import { RELEASE_REPO, helperConfigured, updateCapability, type UpdateCapability } from "@/lib/release/update-plan"

const RELEASE_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`

export type UpdateStatus = Exclude<UpdateCheck, { state: "unavailable" }> & { capability: UpdateCapability } | Extract<UpdateCheck, { state: "unavailable" }>

/** User-clicked check. Reads the public release page and returns a link. The download is a separate action. */
export async function checkForUpdate(): Promise<UpdateStatus> {
  await requireOrgContext()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(RELEASE_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "BoomBigNose" },
      signal: controller.signal,
      cache: "no-store",
    })
    if (!response.ok) return { state: "unavailable", message: "The release page did not respond." }
    const result = interpretRelease(await response.json())
    if (result.state === "unavailable") return result
    return { ...result, capability: updateCapability(process.platform, process.arch, helperConfigured()) }
  } catch {
    return { state: "unavailable", message: "The release page could not be reached." }
  } finally {
    clearTimeout(timer)
  }
}

/** User-clicked read of one local start log. No network. */
export async function readLocalLog(name: string): Promise<{ text: string } | { error: string }> {
  await requireOrgContext()
  const dir = localDataDir()
  if (!dir) return { error: "No local data directory yet." }
  return readStartLog(dir, name)
}
