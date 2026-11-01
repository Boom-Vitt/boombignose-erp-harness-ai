import { describe, expect, it } from "vitest"

import { ollamaReplyText } from "@/lib/ai/ollama-reply"

describe("ollamaReplyText", () => {
  it("returns the trimmed answer and ignores a thinking trace when both exist", () => {
    expect(ollamaReplyText({ content: "  hello  ", thinking: "secret reasoning" })).toBe("hello")
  })

  it("uses thinking when qwen3 left the answer channel empty", () => {
    expect(ollamaReplyText({ content: "", thinking: "  draft the follow-up  " })).toBe("draft the follow-up")
    expect(ollamaReplyText({ content: "   ", thinking: "summary" })).toBe("summary")
  })

  it("drops a think tag wrapped around a real answer", () => {
    expect(ollamaReplyText({ content: "<think>plan</think>\n\nHello from the shop." })).toBe("Hello from the shop.")
  })

  it("uses the think tag when that is the only text", () => {
    expect(ollamaReplyText({ content: "<think>only this</think>" })).toBe("only this")
  })

  it("rejects a message with no visible text", () => {
    expect(ollamaReplyText({ content: "  \n", thinking: "  " })).toBeNull()
    expect(ollamaReplyText(null)).toBeNull()
    expect(ollamaReplyText({ content: 12, thinking: { note: "no" } })).toBeNull()
  })
})
