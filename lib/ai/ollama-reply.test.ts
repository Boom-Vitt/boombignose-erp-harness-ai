import { describe, expect, it } from "vitest"

import { ollamaReplyText } from "@/lib/ai/ollama-reply"

describe("ollamaReplyText", () => {
  it("returns the trimmed answer and ignores a thinking trace", () => {
    expect(ollamaReplyText({ content: "  hello  ", thinking: "secret reasoning" })).toBe("hello")
  })

  it("never returns the thinking channel as the answer", () => {
    expect(ollamaReplyText({ content: "", thinking: "draft the follow-up" })).toBeNull()
  })

  it("drops a think block wrapped around a real answer", () => {
    expect(ollamaReplyText({ content: "<think>plan</think>\n\nHello from the shop." })).toBe("Hello from the shop.")
  })

  it("drops reasoning with only a closing tag or no closing tag", () => {
    expect(ollamaReplyText({ content: "plan it out\n</think>\nFollow up Friday." })).toBe("Follow up Friday.")
    expect(ollamaReplyText({ content: "Answer first.<think>still thinking" })).toBe("Answer first.")
    expect(ollamaReplyText({ content: "<think>only this</think>" })).toBeNull()
  })

  it("drops untagged chain of thought that leads the reply", () => {
    const leaked =
      "Okay, let's see. The user wants a summary of this deal.\n\nFirst, I need to check the stage.\n\nThe Acme deal is in Proposal and worth 120,000 THB."
    expect(ollamaReplyText({ content: leaked })).toBe("The Acme deal is in Proposal and worth 120,000 THB.")
    expect(ollamaReplyText({ content: "Okay, so the user wants a note.\n\nI should be brief." })).toBeNull()
  })

  it("keeps a normal answer that merely contains these words later", () => {
    expect(ollamaReplyText({ content: "Deal summary.\n\nOkay to close this week." })).toBe("Deal summary.\n\nOkay to close this week.")
  })

  it("rejects a message with no visible text", () => {
    expect(ollamaReplyText({ content: "  \n", thinking: "  " })).toBeNull()
    expect(ollamaReplyText(null)).toBeNull()
    expect(ollamaReplyText({ content: 12, thinking: { note: "no" } })).toBeNull()
  })
})
