import { describe, expect, it } from "vitest"

import { NAV_ITEMS } from "./nav"

describe("nav", () => {
  it("gives every item a Thai label for the English-title + Thai-subtitle rail", () => {
    expect(NAV_ITEMS.filter((item) => !item.th).map((item) => item.title)).toEqual([])
  })
})

describe("NAV_GROUPS", () => {
  it("has separate Thai and English labels so the language toggle can pick one", async () => {
    const { NAV_GROUPS } = await import("@/components/nav")
    for (const g of NAV_GROUPS) {
      expect(g.th).toBeTruthy()
      expect(g.label).not.toContain("/")
    }
  })
})
