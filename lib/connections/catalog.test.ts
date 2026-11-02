import { describe, expect, it } from "vitest"
import { CATALOG, filterEntries, parseLocale, statusOf, type Probes } from "./catalog"

const off: Probes = { erpMcp: false, ollama: false, flowaccount: "unavailable" }
const get = (id: string) => CATALOG.find((e) => e.id === id)!

describe("statusOf", () => {
  it("follows live probes for ERP MCP and Local AI", () => {
    expect(statusOf(get("erp-mcp"), off)).toBe("available")
    expect(statusOf(get("erp-mcp"), { ...off, erpMcp: true })).toBe("connected")
    expect(statusOf(get("local-ai"), { ...off, ollama: true })).toBe("connected")
  })
  it("FlowAccount follows edition/connection; community reads as coming soon", () => {
    expect(statusOf(get("flowaccount"), off)).toBe("coming-soon")
    expect(statusOf(get("flowaccount"), { ...off, flowaccount: "available" })).toBe("available")
    expect(statusOf(get("flowaccount"), { ...off, flowaccount: "connected" })).toBe("connected")
  })
  it("cloud apps are always coming soon with nothing to connect", () => {
    for (const id of ["gmail", "slack", "google-drive", "notion"]) {
      expect(statusOf(get(id), { erpMcp: true, ollama: true, flowaccount: "connected" })).toBe("coming-soon")
      expect(get(id).href).toBeUndefined()
    }
  })
})

describe("filterEntries", () => {
  it("filters by category", () => {
    expect(filterEntries(CATALOG, "", "communication").map((e) => e.id)).toEqual(["gmail", "slack"])
    expect(filterEntries(CATALOG, "", "all")).toHaveLength(CATALOG.length)
  })
  it("searches name and both languages, case-insensitively", () => {
    expect(filterEntries(CATALOG, " SLACK ", "all").map((e) => e.id)).toEqual(["slack"])
    expect(filterEntries(CATALOG, "ใบแจ้งหนี้", "all").map((e) => e.id)).toEqual(["flowaccount"])
    expect(filterEntries(CATALOG, "invoices", "finance").map((e) => e.id)).toEqual(["flowaccount"])
    expect(filterEntries(CATALOG, "zzz", "all")).toEqual([])
  })
})

it("parseLocale accepts only th/en", () => {
  expect(parseLocale("en")).toBe("en")
  expect(parseLocale("fr")).toBeNull()
  expect(parseLocale(null)).toBeNull()
})
