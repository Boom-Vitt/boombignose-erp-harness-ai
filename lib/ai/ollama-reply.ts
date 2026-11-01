const MAX_REPLY = 8000

// Untagged chain of thought, as qwen3 leaks it into `content` even with `think: false`.
const COT_OPENER =
  /^(okay|ok|alright|hmm+|wait|let me|let's|first,? (i|the|let)|the user (wants|is asking|asked|provided|says)|i need to|i should|so,? the user)\b/i

/**
 * Text the operator should see from one Ollama `/api/chat` message.
 * Only the answer channel is used. `message.thinking`, `<think>` blocks and
 * leading untagged reasoning paragraphs are dropped, never shown as the answer.
 * Returns null when nothing but reasoning is left, so the caller reports an error.
 */
export function ollamaReplyText(message: { content?: unknown; thinking?: unknown } | null | undefined): string | null {
  if (!message || typeof message.content !== "string") return null
  const visible = message.content
    .replace(/<think>[\s\S]*?<\/think>/gi, " ")
    .replace(/^[\s\S]*<\/think>/i, " ") // closing tag only: the opener was eaten upstream
    .replace(/<think>[\s\S]*$/i, " ") // never closed: everything after it is reasoning
    .trim()
  const paragraphs = visible.split(/\n\s*\n/)
  while (paragraphs.length && COT_OPENER.test(paragraphs[0].trim())) paragraphs.shift()
  const answer = paragraphs.join("\n\n").trim()
  return answer ? answer.slice(0, MAX_REPLY) : null
}
