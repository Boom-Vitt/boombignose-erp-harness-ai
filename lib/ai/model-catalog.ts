import catalogFile from "../../boombignose/internal/bundle/ollama_models.json"

export type ModelModality = "text" | "vision" | "image" | "tts"
export type BlockedModality = "video" | "asr" | "voice-clone" | "image" | "tts"
export type TryKind = "none" | "vision" | "image" | "speech"

export type CatalogModel = {
  id: string
  modality: ModelModality
  license: string
  sizeNote: string
  platforms: string[]
  arches: string[]
  try: TryKind
  titleTh: string
  titleEn: string
  detailTh: string
  detailEn: string
}

export type BlockedCopy = {
  modality: BlockedModality
  reasonTh: string
  reasonEn: string
}

type CatalogFile = {
  models: CatalogModel[]
  alwaysBlocked: BlockedCopy[]
  unavailableHere: Record<string, { reasonTh: string; reasonEn: string }>
}

const file = catalogFile as CatalogFile

export type Host = { platform: NodeJS.Platform; arch: string }

export type InstalledModel = { name: string; size: number }

export type ModelRow = CatalogModel & {
  installed: boolean
  installedBytes: number | null
}

export type ModelSnapshot = {
  daemonUp: boolean
  daemonMessage: string | null
  rows: ModelRow[]
  blocked: BlockedCopy[]
}

const DAEMON_DOWN =
  "Ollama บนเครื่องนี้ยังไม่ทำงาน เปิดหน้าต่าง BoomBigNose แล้วมันจะเริ่มบริการให้ ไม่ต้องติดตั้ง Ollama Desktop / The local model service is not running. Open the BoomBigNose window and it starts the bundled service. A separate AI app is not required."

/** Go's GOOS name. Node calls Windows `win32`. */
export function hostOS(platform: NodeJS.Platform): string {
  if (platform === "win32") return "windows"
  return platform
}

/** Go's GOARCH name. Node calls x86-64 `x64`. */
export function hostArch(arch: string): string {
  if (arch === "x64") return "amd64"
  return arch
}

export function catalogModels(): CatalogModel[] {
  return file.models
}

export function catalogModelIds(): string[] {
  return file.models.map((model) => model.id)
}

export function safeModelId(id: string): boolean {
  if (!id || id.length > 80 || id.includes("..") || id.startsWith("/")) return false
  if (/[\s\\\u0000]/.test(id)) return false
  return /^[a-z0-9][a-z0-9._:/-]*$/.test(id)
}

export function findCatalogModel(id: string): CatalogModel | null {
  if (!safeModelId(id)) return null
  return file.models.find((model) => model.id === id) ?? null
}

export function modelPullable(id: string, host: Host): boolean {
  const model = findCatalogModel(id)
  if (!model) return false
  if (!model.platforms.includes(hostOS(host.platform))) return false
  if (model.arches.length === 0) return false
  if (model.arches[0] === "any") return true
  return model.arches.includes(hostArch(host.arch))
}

export function namesMatch(installed: string, id: string): boolean {
  const left = installed.trim().toLowerCase()
  const right = id.trim().toLowerCase()
  return left === right || left === `${right}:latest` || right === `${left}:latest`
}

export function unavailableCopy(modality: string): { reasonTh: string; reasonEn: string } | null {
  return file.unavailableHere[modality] ?? null
}

export function buildSnapshot(
  host: Host,
  installed: InstalledModel[],
  daemon: { up: boolean; message?: string | null },
): ModelSnapshot {
  const rows: ModelRow[] = []
  const blocked: BlockedCopy[] = []
  for (const model of file.models) {
    if (!modelPullable(model.id, host)) {
      const copy = file.unavailableHere[model.modality]
      if (copy) blocked.push({ modality: model.modality as BlockedModality, ...copy })
      continue
    }
    const found = installed.find((item) => namesMatch(item.name, model.id))
    rows.push({
      ...model,
      installed: Boolean(found),
      installedBytes: found ? found.size : null,
    })
  }
  blocked.push(...file.alwaysBlocked)
  return {
    daemonUp: daemon.up,
    daemonMessage: daemon.up ? null : daemon.message || DAEMON_DOWN,
    rows,
    blocked,
  }
}

export type PullEvent = {
  status?: string
  completed?: number
  total?: number
  error?: string
  done?: boolean
}

/** One Ollama pull JSON line, with digests and oversized text removed. */
export function sanitizePullLine(line: string): PullEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return { error: "The download sent a status this app could not read." }
  }
  if (!parsed || typeof parsed !== "object") return null
  const record = parsed as Record<string, unknown>
  const event: PullEvent = {}
  if (typeof record.status === "string" && record.status.trim()) {
    event.status = record.status.replace(/\s+/g, " ").slice(0, 120)
  }
  if (typeof record.completed === "number" && Number.isFinite(record.completed) && record.completed >= 0) {
    event.completed = record.completed
  }
  if (typeof record.total === "number" && Number.isFinite(record.total) && record.total > 0) {
    event.total = record.total
  }
  if (typeof record.error === "string" && record.error.trim()) {
    event.error = record.error.replace(/\s+/g, " ").slice(0, 200)
  }
  if (event.status === "success") event.done = true
  if (!event.status && !event.error && event.completed === undefined) return null
  return event
}

export function createPullSanitizer(): { push(text: string): string; finish(): string } {
  let pending = ""
  const emit = (line: string) => {
    const event = sanitizePullLine(line)
    return event ? `${JSON.stringify(event)}\n` : ""
  }
  return {
    push(text: string) {
      pending += text
      const lines = pending.split("\n")
      pending = lines.pop() ?? ""
      return lines.map(emit).join("")
    },
    finish() {
      const tail = pending
      pending = ""
      return emit(tail)
    },
  }
}

export function formatBytes(size: number | null): string | null {
  if (size === null || !Number.isFinite(size) || size < 0) return null
  if (size < 1024) return `${size} B`
  const units = ["KB", "MB", "GB", "TB"]
  let value = size / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`
}

const VISION_PROMPT =
  "Describe this image briefly in Thai and then in English. Mention only what is visible. Do not invent amounts, do not post a journal, and do not file tax."

export const VISION_MODEL = "qwen3.5:4b"

export function visionChatBody(imageBase64: string, prompt: string = VISION_PROMPT): { model: string; stream: false; think: false; messages: unknown[] } {
  return {
    model: VISION_MODEL,
    stream: false,
    think: false,
    messages: [{ role: "user", content: prompt, images: [imageBase64] }],
  }
}

export function imageGenerateBody(prompt: string): { model: string; prompt: string; stream: true; width: number; height: number; steps: number } {
  return { model: "x/flux2-klein:4b", prompt, stream: true, width: 512, height: 512, steps: 4 }
}

export function speechBody(input: string): { model: string; input: string; voice: string; response_format: "wav" } {
  return { model: "phonon", input, voice: "default", response_format: "wav" }
}

export function cleanPrompt(raw: string, max: number): string | null {
  const text = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim()
  if (!text || text.length > max) return null
  return text
}

export function imageMediaType(base64: string): "image/png" | "image/jpeg" | "image/webp" | null {
  if (base64.startsWith("iVBORw0KGgo")) return "image/png"
  if (base64.startsWith("/9j/")) return "image/jpeg"
  if (base64.startsWith("UklGR")) return "image/webp"
  return null
}

export function parseGenerateLine(line: string): { status?: string; image?: string; error?: string } | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>
    const event: { status?: string; image?: string; error?: string } = {}
    if (typeof parsed.status === "string") event.status = parsed.status.replace(/\s+/g, " ").slice(0, 120)
    if (typeof parsed.error === "string") event.error = parsed.error.replace(/\s+/g, " ").slice(0, 200)
    if (typeof parsed.image === "string" && parsed.image.length > 0 && parsed.image.length <= 8_000_000) {
      event.image = parsed.image
    }
    if (typeof parsed.image === "string" && parsed.image.length > 8_000_000) {
      event.error = "The picture was larger than this page can show."
    }
    if (!event.status && !event.error && !event.image) return null
    return event
  } catch {
    return { error: "The model sent a status this app could not read." }
  }
}
