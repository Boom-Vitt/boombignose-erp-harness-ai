import { describe, expect, it } from "vitest"

import { Constants } from "@/lib/types/database"
import { INVOICE_STATUS_TH, QUOTE_STATUS_TH, salesChain } from "./sales-chain"

const states = (c: ReturnType<typeof salesChain>) => c.steps.map((s) => `${s.key}:${s.state}`).join(" ")
const inv = (status: "draft" | "sent" | "paid" | "cancelled", issued: boolean, outstandingSatang = 100) => ({ status, issued, outstandingSatang })

describe("salesChain", () => {
  it("sent quote: next is accept", () => {
    const c = salesChain({ quoteStatus: "sent", vatRegistered: true })
    expect(states(c)).toBe("quote:current invoice:todo issued:todo receipt:todo")
    expect(c.next?.command).toBe("accept")
  })
  it("accepted quote without invoice: one-click convert is next", () => {
    const c = salesChain({ quoteStatus: "accepted", vatRegistered: true })
    expect(states(c)).toBe("quote:done invoice:current issued:todo receipt:todo")
    expect(c.next?.command).toBe("convert")
  })
  it("draft invoice from quote: next is issue", () => {
    const c = salesChain({ quoteStatus: "converted", invoice: inv("draft", false), vatRegistered: false })
    expect(states(c)).toBe("quote:done invoice:current issued:todo receipt:todo")
    expect(c.next?.command).toBe("issue")
    expect(c.vatNote).toBeNull()
  })
  it("issued VAT invoice surfaces receipt as next and never claims a statutory tax invoice", () => {
    const c = salesChain({ quoteStatus: "converted", invoice: inv("sent", true), vatRegistered: true })
    expect(states(c)).toBe("quote:done invoice:done issued:done receipt:current")
    expect(c.next?.command).toBe("pay")
    expect(c.steps[2]!.th).toContain("VAT")
    expect(c.vatNote).toContain("ไม่ใช่ใบกำกับภาษีตามกฎหมาย")
  })
  it("paid invoice completes the chain", () => {
    const c = salesChain({ quoteStatus: "converted", invoice: inv("paid", true, 0), vatRegistered: true })
    expect(states(c)).toBe("quote:done invoice:done issued:done receipt:done")
    expect(c.next).toBeNull()
  })
  it("invoice without a quote omits the quote step", () => {
    expect(states(salesChain({ invoice: inv("draft", false), vatRegistered: false }))).toBe("invoice:current issued:todo receipt:todo")
  })
  it("declined quote stops; a cancelled invoice is ignored", () => {
    const stopped = salesChain({ quoteStatus: "declined", vatRegistered: false })
    expect(stopped.steps[0]!.state).toBe("stopped")
    expect(stopped.next).toBeNull()
    expect(salesChain({ quoteStatus: "accepted", invoice: inv("cancelled", true), vatRegistered: false }).next?.command).toBe("convert")
  })
  it("has a Thai label for every status", () => {
    for (const s of Constants.public.Enums.quote_status) expect(QUOTE_STATUS_TH[s]).toBeTruthy()
    for (const s of Constants.public.Enums.invoice_status) expect(INVOICE_STATUS_TH[s]).toBeTruthy()
  })
})
