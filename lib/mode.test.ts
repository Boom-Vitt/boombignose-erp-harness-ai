import { describe, expect, it } from "vitest"

import { MODES, orderForMode, parseMode } from "@/lib/mode"

describe("operator mode", () => {
  it("falls back to SME for anything unknown", () => {
    expect(parseMode("startup")).toBe("startup")
    expect(parseMode("nope")).toBe("sme")
    expect(parseMode(null)).toBe("sme")
    expect(MODES).toHaveLength(3)
  })

  it("puts the mode's pages first and keeps the rest in order", () => {
    const items = ["/dashboard", "/clients", "/deals", "/quotes", "/projects"].map((href) => ({ href }))
    expect(orderForMode(items, "startup").map((i) => i.href)).toEqual(["/dashboard", "/deals", "/projects", "/clients", "/quotes"])
    expect(orderForMode(items, "sme").map((i) => i.href)).toEqual(["/dashboard", "/quotes", "/clients", "/deals", "/projects"])
  })
})
