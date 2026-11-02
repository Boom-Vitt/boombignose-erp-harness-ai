import { describe, expect, it } from "vitest"

import { NAV_ITEMS } from "./nav"

describe("nav", () => {
  it("gives every item a Thai label for the English-title + Thai-subtitle rail", () => {
    expect(NAV_ITEMS.filter((item) => !item.th).map((item) => item.title)).toEqual([])
  })
})
