export const RELEASE_REPO = "Boom-Vitt/boombignose-erp-harness-ai"
export const MACOS_ARM64_ASSET = "BoomBigNose-macos-arm64.dmg"
export const SHA256SUMS = "SHA256SUMS"

const RELEASE_FILES = new Set([
  MACOS_ARM64_ASSET,
  "BoomBigNose-windows-x64-setup.exe",
  "BoomBigNose-linux-amd64.tar.gz",
  "BoomBigNose-linux-amd64.AppImage",
  SHA256SUMS,
])

const DOWNLOAD_HOSTS = new Set([
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
  "github-releases.githubusercontent.com",
])

export type UpdateCapability = "apply" | "needs-window" | "deferred"

export const DEFERRED_MESSAGE =
  "รุ่นนี้ติดตั้งทับให้อัตโนมัติบน macOS Apple Silicon เท่านั้น บน Windows และ Linux ให้เปิดหน้า release / This version replaces the app automatically on macOS Apple Silicon only. On Windows and Linux, open the release page."

export const WINDOW_MESSAGE =
  "เปิดหน้าต่าง BoomBigNose เพื่อติดตั้งจากในแอป แท็บเบราว์เซอร์แทนที่โปรแกรมไม่ได้ / Open the BoomBigNose window to install from inside the app. A browser tab cannot replace the program."

export function semver(value: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function versionGreater(next: string, current: string): boolean {
  const left = semver(next)
  const right = semver(current)
  if (!left || !right) return false
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index]! > right[index]!
  }
  return false
}

/** Automatic replace is the macOS arm64 disk image, and only from the desktop window. */
export function updateCapability(platform: string, arch: string, helperConfigured: boolean): UpdateCapability {
  if (platform !== "darwin" || arch !== "arm64") return "deferred"
  return helperConfigured ? "apply" : "needs-window"
}

export function releaseDownloadURL(version: string, file: string): string | null {
  if (!semver(version) || !RELEASE_FILES.has(file)) return null
  return `https://github.com/${RELEASE_REPO}/releases/download/boombignose-v${version}/${file}`
}

export function initialDownloadURL(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return false
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return false
  if (url.hostname !== "github.com") return false
  return /^\/Boom-Vitt\/boombignose-erp-harness-ai\/releases\/download\/boombignose-v\d+\.\d+\.\d+\/[^/]+$/.test(url.pathname)
}

export function redirectAllowed(current: URL, location: string): URL | null {
  let next: URL
  try {
    next = new URL(location, current)
  } catch {
    return null
  }
  if (next.protocol !== "https:" || next.username || next.password) return null
  if (!DOWNLOAD_HOSTS.has(next.hostname)) return null
  return next
}

/** One hash for one release filename. A second, different hash fails closed. */
export function parseSHA256SUMS(text: string, file: string): string | null {
  if (!RELEASE_FILES.has(file) || text.length === 0 || text.length > 100_000) return null
  let found: string | null = null
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const match = /^([a-fA-F0-9]{64}) [ *](\S+)$/.exec(line)
    if (!match) return null
    if (match[2] !== file) continue
    const hash = match[1]!.toLowerCase()
    if (found && found !== hash) return null
    found = hash
  }
  return found
}

export function helperConfigured(url = process.env.BOOMBIGNOSE_UPDATE_URL, token = process.env.BOOMBIGNOSE_UPDATE_TOKEN): boolean {
  const raw = url?.trim() ?? ""
  const secret = token?.trim() ?? ""
  if (!/^[a-f0-9]{64}$/.test(secret)) return false
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return false
  }
  if (parsed.protocol !== "http:" || parsed.username || parsed.password || parsed.search || parsed.hash) return false
  const host = parsed.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  return host === "127.0.0.1" && parsed.port !== ""
}
