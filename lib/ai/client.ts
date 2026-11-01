// SERVER-ONLY. Importing this from a Client Component throws — that guard
// keeps the call on the server. The pure prompt/parse modules do not import
// this file, so they stay unit-testable with no network.
import "server-only"

import { ollamaReplyText } from "@/lib/ai/ollama-reply"

const DEFAULT_HOST = "127.0.0.1:11434"

/** Default local model. Override with OLLAMA_MODEL. The model must already be pulled. */
export const DEFAULT_MODEL = process.env.OLLAMA_MODEL?.trim() || "qwen2.5:3b"

/**
 * Thrown when Ollama is not usable on this machine. Callers catch this and
 * return `{ notConfigured: true }` instead of crashing.
 */
export class AINotConfiguredError extends Error {
  constructor(message = "AI is not configured. Open Settings and install the local text model. Nothing is sent to a cloud model.") {
    super(message)
    this.name = "AINotConfiguredError"
  }
}

export function localOllamaOrigin(): string {
  const raw = process.env.OLLAMA_HOST?.trim() || DEFAULT_HOST
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new AINotConfiguredError()
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new AINotConfiguredError()
  }
  const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
  if (host !== "localhost" && host !== "127.0.0.1" && host !== "::1") {
    throw new AINotConfiguredError()
  }
  return url.origin
}

/** True when the configured model endpoint is loopback. It does not probe the port. */
export function isAIConfigured(): boolean {
  try {
    localOllamaOrigin()
    return true
  } catch {
    return false
  }
}

/**
 * One-shot text generation against local Ollama. A remote host throws
 * AINotConfiguredError before any request. A refused connection or a missing
 * model throws the same error so the screen can degrade without a stack trace.
 */
export async function generateText({
  system,
  prompt,
  maxTokens = 1024,
}: {
  system: string
  prompt: string
  maxTokens?: number
}): Promise<string> {
  const origin = localOllamaOrigin()
  const model = process.env.OLLAMA_MODEL?.trim() || DEFAULT_MODEL

  let res: Response
  try {
    res = await fetch(`${origin}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        // Belt and braces: thinking models (qwen3) otherwise spend the reply in message.thinking.
        think: false,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        options: { num_predict: maxTokens },
      }),
      signal: AbortSignal.timeout(60_000),
    })
  } catch {
    throw new AINotConfiguredError(
      `AI is not configured. Open the BoomBigNose window so it can start the local model service, then install the text model in Settings. Address: ${origin}.`,
    )
  }

  const data = (await res.json().catch(() => null)) as {
    error?: unknown
    message?: { content?: unknown; thinking?: unknown }
  } | null

  const detail = () => {
    const raw = typeof data?.error === "string" ? data.error : ""
    return raw.replace(/\s+/g, " ").slice(0, 200)
  }

  if (!res.ok) {
    const extra = detail()
    throw new AINotConfiguredError(
      extra
        ? `AI is not configured. Ollama at ${origin} returned HTTP ${res.status}: ${extra}`
        : `AI is not configured. Ollama at ${origin} returned HTTP ${res.status}.`,
    )
  }
  if (data?.error) {
    const extra = detail()
    throw new AINotConfiguredError(
      extra
        ? `AI is not configured. ${extra}`
        : "AI is not configured. Ollama returned an error.",
    )
  }

  const content = ollamaReplyText(data?.message)
  if (!content) {
    throw new Error("Ollama returned no text")
  }
  return content
}
