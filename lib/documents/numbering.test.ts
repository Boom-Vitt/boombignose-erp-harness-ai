import { describe, it, expect } from "vitest"

import { nextDocumentNumber, invoiceDisplayNumber, isIssuedInvoiceNumber } from "./numbering"

describe("nextDocumentNumber", () => {
  it("starts at 001 when there are no existing numbers", () => {
    expect(nextDocumentNumber("INV", [], 2026)).toBe("INV-2026-001")
    expect(nextDocumentNumber("QUO", [], 2026)).toBe("QUO-2026-001")
  })

  it("increments from the highest matching counter", () => {
    expect(
      nextDocumentNumber("INV", ["INV-2026-001", "INV-2026-006"], 2026)
    ).toBe("INV-2026-007")
  })

  it("takes the max even when the list is out of order or has gaps", () => {
    expect(
      nextDocumentNumber("INV", ["INV-2026-010", "INV-2026-003", "INV-2026-007"], 2026)
    ).toBe("INV-2026-011")
  })

  it("ignores non-matching entries (wrong prefix, wrong year, free-form)", () => {
    expect(
      nextDocumentNumber(
        "INV",
        [
          "QUO-2026-050", // wrong prefix
          "INV-2025-099", // wrong year
          "INV-2026", // no counter
          "random text",
          "INV-2026-004",
        ],
        2026
      )
    ).toBe("INV-2026-005")
  })

  it("scopes counting to the requested year", () => {
    const numbers = ["INV-2025-020", "INV-2026-002"]
    expect(nextDocumentNumber("INV", numbers, 2025)).toBe("INV-2025-021")
    expect(nextDocumentNumber("INV", numbers, 2026)).toBe("INV-2026-003")
    expect(nextDocumentNumber("INV", numbers, 2027)).toBe("INV-2027-001")
  })

  it("pads to three digits but grows past 999 without truncating", () => {
    expect(nextDocumentNumber("INV", ["INV-2026-008"], 2026)).toBe("INV-2026-009")
    expect(nextDocumentNumber("INV", ["INV-2026-099"], 2026)).toBe("INV-2026-100")
    expect(nextDocumentNumber("INV", ["INV-2026-999"], 2026)).toBe("INV-2026-1000")
  })

  it("tolerates surrounding whitespace on stored numbers", () => {
    expect(nextDocumentNumber("INV", ["  INV-2026-002  "], 2026)).toBe("INV-2026-003")
  })
  it("treats punctuation in a prefix literally", () => {
    expect(nextDocumentNumber("I.V", ["IAV-2026-099", "I.V-2026-003"], 2026)).toBe("I.V-2026-004")
    expect(nextDocumentNumber("INV+", ["INV+-2026-003"], 2026)).toBe("INV+-2026-004")
  })
  it("rejects counters that cannot be safely incremented", () => {
    expect(() => nextDocumentNumber("INV", [`INV-2026-${Number.MAX_SAFE_INTEGER}`], 2026)).toThrow()
    expect(() => nextDocumentNumber("INV", ["INV-2026-9007199254740992"], 2026)).toThrow()
  })
  it("rejects invalid series input", () => {
    expect(() => nextDocumentNumber("", [], 2026)).toThrow()
    expect(() => nextDocumentNumber("INV", [], NaN)).toThrow()
    expect(() => nextDocumentNumber("INV", [], 2026.5)).toThrow()
  })
})


it("labels an unissued invoice by identity without allocating a series number", () => {
  expect(invoiceDisplayNumber({ id: "12345678-abcd-4000-8000-000000000001", number: "internal reference", issued_snapshot_id: null })).toBe("DRAFT-12345678")
  expect(invoiceDisplayNumber({ id: "12345678-abcd-4000-8000-000000000001", number: "INV-2026-000001", issued_snapshot_id: "snapshot" })).toBe("INV-2026-000001")
})

it("reserves every numeric invoice series spelling for issuance", () => {
  for (const number of ["INV-2026-001", "INV-2026-000001", " inv-2026-12 ", "TX-2026-000001", "ABB-2026-000001", " abb-2026-7 "]) expect(isIssuedInvoiceNumber(number)).toBe(true)
  for (const number of ["DRAFT-12345678", "Customer reference", "INV-QUO-2026-001", "TXX-2026-000001", "TX-26-1"]) expect(isIssuedInvoiceNumber(number)).toBe(false)
})
