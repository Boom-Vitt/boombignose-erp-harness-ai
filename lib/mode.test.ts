import { describe, expect, it } from "vitest"

import { MODES, navigationForMode, parseMode } from "@/lib/mode"
import { NAV_ITEMS, showNavItem } from "@/components/nav"

function navigation(role: string, mode: (typeof MODES)[number]) {
  return navigationForMode(NAV_ITEMS.filter((item) => showNavItem(role, item)), mode)
}

describe("task profiles", () => {
  it("reads the saved Organization preference and rejects unknown preferences", () => {
    expect(parseMode("startup")).toBe("startup")
    expect(parseMode("nope")).toBe("sme")
    expect(parseMode(null)).toBe("sme")
  })

  it("changes default visible modules for freelance, daily trade and cross-team work", () => {
    const individual = navigation("owner", "individual").primary.map((item) => item.href)
    const sme = navigation("owner", "sme").primary.map((item) => item.href)
    const organization = navigation("owner", "startup").primary.map((item) => item.href)
    expect(individual).toContain("/timesheets")
    expect(individual).not.toContain("/purchases")
    expect(sme).toEqual(expect.arrayContaining(["/purchases", "/inventory", "/quotes"]))
    expect(sme).not.toContain("/timesheets")
    expect(organization).toEqual(expect.arrayContaining(["/warehouse", "/reports", "/projects"]))
    expect(organization).not.toContain("/products")
    for (const profile of [individual, sme, organization]) expect(profile).toContain("/documents/ocr")
  })

  it("keeps every authorized extra module available exactly once across repeated profile changes", () => {
    const original = NAV_ITEMS.map((item) => item.href)
    for (const mode of [...MODES, "individual", "sme"] as const) {
      const { primary, additional } = navigation("owner", mode)
      const union = [...primary, ...additional].map((item) => item.href)
      expect(new Set(union).size).toBe(union.length)
      expect([...union].sort()).toEqual([...original].sort())
      expect(NAV_ITEMS.map((item) => item.href)).toEqual(original)
    }
    expect(navigation("owner", "individual").additional.some((item) => item.href === "/purchases")).toBe(true)
  })

  it("never grants privileged modules through profile switching or Show more", () => {
    for (const mode of MODES) {
      const member = navigation("member", mode)
      const memberLinks = [...member.primary, ...member.additional].map((item) => item.href)
      expect(memberLinks).not.toContain("/audit")
      expect(memberLinks).not.toContain("/network")
      const accountant = navigation("accountant", mode)
      const accountantLinks = [...accountant.primary, ...accountant.additional].map((item) => item.href)
      expect(accountantLinks).toContain("/audit")
      expect(accountantLinks).not.toContain("/network")
    }
  })
})
