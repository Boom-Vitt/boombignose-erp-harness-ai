import "server-only"

import { AINotConfiguredError, localOllamaOrigin } from "@/lib/ai/client"
import {
  buildSnapshot,
  cleanPrompt,
  createPullSanitizer,
  findCatalogModel,
  imageGenerateBody,
  imageMediaType,
  modelPullable,
  namesMatch,
  parseGenerateLine,
  speechBody,
  unavailableCopy,
  visionChatBody,
  type Host,
  type InstalledModel,
} from "@/lib/ai/model-catalog"

const encoder = new TextEncoder()

function origin(): { origin: string } | { error: string } {
  try {
    return { origin: localOllamaOrigin() }
  } catch (err) {
    if (err instanceof AINotConfiguredError) return { error: err.message }
    return { error: "AI is not configured." }
  }
}

function clip(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 200)
}

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => "")
  try {
    const parsed = JSON.parse(text) as { error?: unknown }
    if (typeof parsed.error === "string" && parsed.error.trim()) return clip(parsed.error)
  } catch {
    // A non-JSON body is not shown to the operator.
  }
  return `The local model service returned HTTP ${res.status}.`
}

export async function listInstalledModels(fetchImpl: typeof fetch = fetch): Promise<
  { up: true; models: InstalledModel[] } | { up: false; error: string }
> {
  const where = origin()
  if ("error" in where) return { up: false, error: where.error }
  let res: Response
  try {
    res = await fetchImpl(`${where.origin}/api/tags`, { signal: AbortSignal.timeout(3_000), redirect: "error" })
  } catch {
    return { up: false, error: "Ollama is not running on this computer." }
  }
  if (!res.ok) return { up: false, error: await readError(res) }
  const data = (await res.json().catch(() => null)) as { models?: unknown } | null
  if (!data || !Array.isArray(data.models)) return { up: true, models: [] }
  const models: InstalledModel[] = []
  for (const item of data.models) {
    if (!item || typeof item !== "object") continue
    const record = item as { name?: unknown; size?: unknown }
    if (typeof record.name !== "string" || !record.name.trim() || /[\r\n]/.test(record.name)) continue
    const size = typeof record.size === "number" && Number.isFinite(record.size) ? record.size : 0
    models.push({ name: record.name.trim(), size })
  }
  return { up: true, models }
}

export async function deleteInstalledModel(
  model: string,
  host: Host,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true } | { error: string; status: number }> {
  const gate = gateModel(model, host)
  if (gate) return gate
  const where = origin()
  if ("error" in where) return { error: where.error, status: 503 }
  let res: Response
  try {
    res = await fetchImpl(`${where.origin}/api/delete`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    })
  } catch {
    return { error: "Ollama is not running on this computer.", status: 503 }
  }
  if (!res.ok) return { error: await readError(res), status: 502 }
  return { ok: true }
}

export async function pullInstalledModel(
  model: string,
  host: Host,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: true; stream: ReadableStream<Uint8Array> } | { error: string; status: number }> {
  const gate = gateModel(model, host)
  if (gate) return gate
  const where = origin()
  if ("error" in where) return { error: where.error, status: 503 }
  let res: Response
  try {
    res = await fetchImpl(`${where.origin}/api/pull`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, stream: true }),
      signal: AbortSignal.timeout(45 * 60 * 1000),
      redirect: "error",
    })
  } catch {
    return { error: "Ollama is not running on this computer.", status: 503 }
  }
  if (!res.ok || !res.body) {
    return { error: res.ok ? "The download did not start." : await readError(res), status: 502 }
  }
  const sanitizer = createPullSanitizer()
  const stream = res.body.pipeThrough(new TextDecoderStream()).pipeThrough(
    new TransformStream<string, Uint8Array>({
      transform(chunk, controller) {
        const text = sanitizer.push(chunk)
        if (text) controller.enqueue(encoder.encode(text))
      },
      flush(controller) {
        const text = sanitizer.finish()
        if (text) controller.enqueue(encoder.encode(text))
      },
    }),
  )
  return { ok: true, stream }
}

function gateModel(model: string, host: Host): { error: string; status: number } | null {
  const known = findCatalogModel(model)
  if (!known) return { error: "That model is not in this build.", status: 400 }
  if (!modelPullable(model, host)) {
    const copy = unavailableCopy(known.modality)
    return { error: copy?.reasonEn ?? "Not available in this build.", status: 409 }
  }
  return null
}

async function requireInstalled(model: string, fetchImpl: typeof fetch): Promise<{ error: string; status: number } | null> {
  const listed = await listInstalledModels(fetchImpl)
  if (!listed.up) return { error: listed.error, status: 503 }
  if (!listed.models.some((item) => namesMatch(item.name, model))) {
    return { error: "Install that model on this computer first.", status: 409 }
  }
  return null
}

const VISION_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

export async function describeLocalImage(
  input: { mediaType: string; imageBase64: string },
  host: Host,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string } | { error: string; status: number }> {
  if (!modelPullable("qwen2.5vl:3b", host)) return { error: "Not available in this build.", status: 409 }
  if (!VISION_TYPES.has(input.mediaType)) return { error: "Use a JPEG, PNG, or WebP image.", status: 400 }
  const image = input.imageBase64.replace(/\s/g, "")
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(image) || image.length < 16 || image.length > 2_000_000) {
    return { error: "That image is empty or larger than this page accepts.", status: 400 }
  }
  const missing = await requireInstalled("qwen2.5vl:3b", fetchImpl)
  if (missing) return missing
  const where = origin()
  if ("error" in where) return { error: where.error, status: 503 }
  let res: Response
  try {
    res = await fetchImpl(`${where.origin}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(visionChatBody(image)),
      signal: AbortSignal.timeout(120_000),
      redirect: "error",
    })
  } catch {
    return { error: "Ollama is not running on this computer.", status: 503 }
  }
  if (!res.ok) return { error: await readError(res), status: 502 }
  const data = (await res.json().catch(() => null)) as { error?: unknown; message?: { content?: unknown } } | null
  if (typeof data?.error === "string" && data.error.trim()) return { error: clip(data.error), status: 502 }
  const content = data?.message?.content
  if (typeof content !== "string" || !content.trim()) return { error: "The vision model returned no text.", status: 502 }
  return { text: content.trim().slice(0, 4000) }
}

export async function speakLocalText(
  raw: string,
  host: Host,
  fetchImpl: typeof fetch = fetch,
): Promise<{ audio: Uint8Array } | { error: string; status: number }> {
  if (!modelPullable("phonon", host)) {
    const copy = unavailableCopy("tts")
    return { error: copy?.reasonEn ?? "Not available in this build.", status: 409 }
  }
  const input = cleanPrompt(raw, 200)
  if (!input) return { error: "Enter one short English sentence.", status: 400 }
  const missing = await requireInstalled("phonon", fetchImpl)
  if (missing) return missing
  const where = origin()
  if ("error" in where) return { error: where.error, status: 503 }
  let res: Response
  try {
    res = await fetchImpl(`${where.origin}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(speechBody(input)),
      signal: AbortSignal.timeout(90_000),
      redirect: "error",
    })
  } catch {
    return { error: "Ollama is not running on this computer.", status: 503 }
  }
  if (!res.ok) return { error: await readError(res), status: 502 }
  const bytes = new Uint8Array(await res.arrayBuffer())
  if (bytes.byteLength < 44 || bytes.byteLength > 8_000_000) {
    return { error: "The speech model did not return audio.", status: 502 }
  }
  return { audio: bytes }
}

export async function drawLocalImage(
  raw: string,
  host: Host,
  fetchImpl: typeof fetch = fetch,
): Promise<{ mediaType: string; image: string } | { error: string; status: number }> {
  if (!modelPullable("x/flux2-klein:4b", host)) {
    const copy = unavailableCopy("image")
    return { error: copy?.reasonEn ?? "Not available in this build.", status: 409 }
  }
  const prompt = cleanPrompt(raw, 300)
  if (!prompt) return { error: "Enter a short description.", status: 400 }
  const missing = await requireInstalled("x/flux2-klein:4b", fetchImpl)
  if (missing) return missing
  const where = origin()
  if ("error" in where) return { error: where.error, status: 503 }
  let res: Response
  try {
    res = await fetchImpl(`${where.origin}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(imageGenerateBody(prompt)),
      signal: AbortSignal.timeout(180_000),
      redirect: "error",
    })
  } catch {
    return { error: "Ollama is not running on this computer.", status: 503 }
  }
  if (!res.ok || !res.body) return { error: res.ok ? "The picture did not start." : await readError(res), status: 502 }
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let pending = ""
  let image = ""
  let failure = ""
  for (;;) {
    const step = await reader.read()
    if (step.done) break
    pending += step.value
    const lines = pending.split("\n")
    pending = lines.pop() ?? ""
    for (const line of lines) {
      const event = parseGenerateLine(line)
      if (!event) continue
      if (event.error) failure = event.error
      if (event.image) image = event.image
    }
  }
  const tail = parseGenerateLine(pending)
  if (tail?.error) failure = tail.error
  if (tail?.image) image = tail.image
  if (failure && !image) return { error: failure, status: 502 }
  const mediaType = imageMediaType(image)
  if (!mediaType) return { error: "The model returned no picture.", status: 502 }
  return { mediaType, image }
}

export async function loadModelSettings(host: Host, fetchImpl: typeof fetch = fetch) {
  const listed = await listInstalledModels(fetchImpl)
  if (!listed.up) return buildSnapshot(host, [], { up: false, message: listed.error })
  return buildSnapshot(host, listed.models, { up: true })
}
