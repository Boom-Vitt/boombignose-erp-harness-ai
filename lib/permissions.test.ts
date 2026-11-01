import { describe, it, expect } from "vitest"

import { can, capabilitiesFor, CAPABILITY_ROLES, type Capability } from "./permissions"

describe("can", () => {
  it("grants owner every capability", () => {
    for (const cap of Object.keys(CAPABILITY_ROLES) as Capability[]) {
      expect(can("owner", cap)).toBe(true)
    }
  })

  it("grants admin the operational capabilities", () => {
    expect(can("admin", "quote:convert")).toBe(true)
    expect(can("admin", "subscription:manage")).toBe(true)
    expect(can("admin", "team:manage")).toBe(true)
  })

  it("lets an accountant record finance and not manage the workspace", () => {
    expect(can("accountant", "payment:verify")).toBe(true)
    expect(can("accountant", "profit:view")).toBe(true)
    expect(can("accountant", "audit:view")).toBe(true)
    expect(can("accountant", "record:write")).toBe(true)
    expect(can("accountant", "settings:manage")).toBe(false)
    expect(can("accountant", "team:manage")).toBe(false)
    expect(can("accountant", "invoice:delete")).toBe(false)
    expect(can("accountant", "purchase:approve")).toBe(false)
    expect(can("accountant", "inventory:manage")).toBe(false)
  })

  it("denies members staff capabilities", () => {
    for (const cap of Object.keys(CAPABILITY_ROLES) as Capability[]) {
      expect(can("member", cap)).toBe(cap === "record:write")
    }
  })
})

describe("capabilitiesFor", () => {
  it("returns all capabilities for owner", () => {
    expect(capabilitiesFor("owner").length).toBe(
      Object.keys(CAPABILITY_ROLES).length
    )
  })

  it("returns record collaboration for member", () => {
    expect(capabilitiesFor("member")).toEqual(["record:write"])
  })
})
