const MAX_REPLY = 8000

/**
 * Text the operator should see from one Ollama `/api/chat` message.
 * qwen3 fills `message.thinking` and leaves `message.content` empty unless the
 * request set `think: false`. A visible answer wins. Thinking is used only when
 * the answer channel is blank, so a deal button still returns text.
 */
export function ollamaReplyText(message: { content?: unknown; thinking?: unknown } | null | undefined): string | null {
  if (!message) return null
  const content = typeof message.content === "string" ? message.content : ""
  const thinking = typeof message.thinking === "string" ? message.thinking.trim() : ""
  const visible = content.replace(/<think>\s*[\s\S]*?\s*<\/think>/gi, " ").replace(/[ \t]+\n/g, "\n").trim()
  if (visible) return clip(visible)
  const inner = Array.from(content.matchAll(/<think>\s*([\s\S]*?)\s*<\/think>/gi))
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n")
    .trim()
  if (inner) return clip(inner)
  if (thinking) return clip(thinking)
  return null
}

function clip(text: string): string {
  const trimmed = text.trim()
  return trimmed.length > MAX_REPLY ? trimmed.slice(0, MAX_REPLY) : trimmed
}
