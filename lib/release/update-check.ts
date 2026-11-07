import { APP_VERSION } from "@/lib/release/version"
import { RELEASE_REPO } from "@/lib/release/update-plan"

const RELEASE_HOST = `https://github.com/${RELEASE_REPO}/releases/tag/`

export type UpdateCheck =
  | { state: "current"; version: string; url: string }
  | { state: "available"; version: string; url: string }
  | { state: "unavailable"; message: string }

function versionParts(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

function compare(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index]
  }
  return 0
}

/** Read a public GitHub release payload. Asset download URLs are ignored. */
export function interpretRelease(body: unknown, current = APP_VERSION): UpdateCheck {
  const installed = versionParts(current)
  if (!installed || !body || typeof body !== "object") return { state: "unavailable", message: "The release page could not be read." }
  const record = body as { tag_name?: unknown; html_url?: unknown }
  if (typeof record.tag_name !== "string" || typeof record.html_url !== "string") return { state: "unavailable", message: "The release page could not be read." }
  const tag = /^(?:boombignose-v|v)(\d+\.\d+\.\d+)$/.exec(record.tag_name)
  const published = tag ? versionParts(tag[1]) : null
  if (!tag || !published) return { state: "unavailable", message: "The release page could not be read." }
  const url = `${RELEASE_HOST}boombignose-v${tag[1]}`
  if (record.html_url !== url) return { state: "unavailable", message: "The release page could not be read." }
  if (compare(published, installed) > 0) return { state: "available", version: tag[1], url }
  return { state: "current", version: current, url }
}
