import { describe, expect, it } from "vitest"
import { parseLookup } from "./assistant-lookup"

const specs = [{ function: { name: "list_invoices", description: "Read authorized invoices", parameters: { type: "object", properties: {}, additionalProperties: false } } }]

describe("fresh authorized lookup decisions", () => {
  it("cannot finish from historical replies or failed reads without current ERP evidence", () => {
    expect(parseLookup(JSON.stringify({ kind: "complete" }), specs, false)).toBeNull()
    expect(parseLookup(JSON.stringify({ kind: "complete" }), specs, true)).toEqual({ kind: "complete" })
  })

  it("accepts an authorized read but rejects a privileged operation absent from this role's tools", () => {
    const read = { kind: "read", operations: [{ name: "list_invoices", arguments: { status: "overdue" } }] }
    expect(parseLookup(JSON.stringify(read), specs, false)).toEqual(read)
    expect(parseLookup(JSON.stringify({ ...read, operations: [{ name: "finance_summary", arguments: {} }] }), specs, false)).toBeNull()
  })

  it("rejects empty, excessive or malformed operations instead of executing a partial plan", () => {
    for (const operations of [[], Array.from({ length: 5 }, () => ({ name: "list_invoices", arguments: {} })), [{ name: "list_invoices", arguments: "{}" }]]) {
      expect(parseLookup(JSON.stringify({ kind: "read", operations }), specs, false)).toBeNull()
    }
  })

  it("rejects guidance as ERP completion and accepts only a capability actually unavailable to this session", () => {
    expect(parseLookup(JSON.stringify({ kind: "guidance" }), specs, false)).toBeNull()
    const denied = { kind: "unavailable", capability: "finance_summary", language: "en" }
    expect(parseLookup(JSON.stringify(denied), specs, false, ["finance_summary"])).toEqual(denied)
    expect(parseLookup(JSON.stringify(denied), specs, false)).toBeNull()
    expect(parseLookup(JSON.stringify({ ...denied, capability: "list_invoices" }), specs, false, ["finance_summary"])).toBeNull()
    expect(parseLookup('{"kind":"complete"}\n{"kind":"guidance"}', specs, true)).toBeNull()
  })
})
