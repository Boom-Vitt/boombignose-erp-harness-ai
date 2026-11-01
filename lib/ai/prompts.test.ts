import { describe, it, expect } from "vitest"

import {
  closeSummaryPrompt,
  dealSummaryPrompt,
  followupDraftPrompt,
  meetingIntakePrompt,
  type ActivityLike,
} from "@/lib/ai/prompts"

const activities: ActivityLike[] = [
  { type: "call", body: "Intro call, budget confirmed", due_date: null, done: true },
  { type: "follow_up", body: "Send proposal", due_date: "2026-07-04", done: false },
]

describe("dealSummaryPrompt", () => {
  it("includes the title, client, stage, and value", () => {
    const { system, prompt } = dealSummaryPrompt({
      title: "Website revamp",
      stage: "proposal",
      valueBaht: 250000,
      client: "Acme Co",
      activities,
    })
    expect(system).toMatch(/summar/i)
    expect(prompt).toContain("Website revamp")
    expect(prompt).toContain("Acme Co")
    expect(prompt).toContain("proposal")
    // Value rendered with thousands separators.
    expect(prompt).toContain("250,000")
    // Activity bodies flow into the prompt.
    expect(prompt).toContain("Send proposal")
  })

  it("handles empty activities without a dangling label", () => {
    const { prompt } = dealSummaryPrompt({
      title: "New lead",
      stage: "lead",
      valueBaht: 0,
      client: null,
      activities: [],
    })
    expect(prompt).toContain("no activities logged yet")
    expect(prompt).toContain("(unknown)") // null client rendered safely
  })
})

describe("followupDraftPrompt", () => {
  it("defaults to a friendly tone", () => {
    const { system, prompt } = followupDraftPrompt({
      title: "Website revamp",
      client: "Acme Co",
      activities,
    })
    expect(system).toMatch(/friendly/i)
    expect(prompt).toContain("Website revamp")
    expect(prompt).toContain("Acme Co")
    expect(prompt).toContain("friendly")
  })

  it("reflects a formal tone when requested", () => {
    const { system, prompt } = followupDraftPrompt({
      title: "Website revamp",
      client: "Acme Co",
      activities,
      tone: "formal",
    })
    expect(system).toMatch(/formal/i)
    expect(system).not.toMatch(/warm, friendly/i)
    expect(prompt).toContain("formal")
  })

  it("instructs Thai-friendly output", () => {
    const { system } = followupDraftPrompt({
      title: "x",
      client: null,
      activities: [],
    })
    expect(system).toMatch(/thai/i)
  })
})

describe("meetingIntakePrompt", () => {
  it("asks for a summary and a bulleted action-item list", () => {
    const { system, prompt } = meetingIntakePrompt(
      "Met with client. They want a quote by Friday. Budget ~200k."
    )
    expect(system).toMatch(/summary/i)
    expect(system).toMatch(/action items/i)
    expect(system).toMatch(/bullet/i)
    expect(prompt).toContain("quote by Friday")
  })

  it("handles empty notes", () => {
    const { prompt } = meetingIntakePrompt("   ")
    expect(prompt).toContain("(no notes provided)")
  })
})

describe("closeSummaryPrompt", () => {
  it("puts the open-item counts in the prompt and refuses a tax filing", () => {
    const { system, prompt } = closeSummaryPrompt({
      asOf: "2026-11-01",
      overdueReceivableCount: 2,
      overdueReceivableSatang: 150000,
      unpaidBillCount: 1,
      unpaidBillSatang: 4000,
      unmatchedBankCount: 3,
    })
    expect(prompt).toContain("2026-11-01")
    expect(prompt).toContain("Overdue receivables: 2")
    expect(prompt).toContain("1,500.00")
    expect(prompt).toContain("Unmatched bank lines: 3")
    expect(system).toMatch(/e-Tax/)
    expect(prompt).toMatch(/tax return/i)
  })
})
