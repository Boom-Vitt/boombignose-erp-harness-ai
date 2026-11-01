import { describe, expect, it } from "vitest"

import { nextDocumentNumber } from "./numbering"
import {
  DOCUMENT_KIND_LABEL,
  DOCUMENT_PREFIX,
  PUBLIC_REFERENCE_EXPECTED_COUNT,
  PUBLIC_REFERENCE_MAX_COLLISION_PROBABILITY,
  PUBLIC_REFERENCE_RANDOM_LENGTH,
  attachPublicReference,
  bech32mValid,
  collisionUpperBound,
  documentHref,
  checksummedReference,
  generatePublicReference,
  mintPublicReference,
  parsePublicReference,
  planPublicReferenceIssue,
  resolvePublicReference,
  validatePublicReference,
  type DocumentKind,
} from "./public-reference"

const BIP350_VALID = [
  "A1LQFN3A",
  "a1lqfn3a",
  "an83characterlonghumanreadablepartthatcontainsthetheexcludedcharactersbioandnumber11sg7hg6",
  "abcdef1l7aum6echk45nj3s0wdvt2fg8x9yrzpqzd3ryx",
  "11llllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllllludsr8",
  "split1checkupstagehandshakeupstreamerranterredcaperredlc445v",
  "?1v759aa",
]

const BIP350_INVALID = [
  "qyrz8wqd2c9m",
  "1qyrz8wqd2c9m",
  "y1b0jsk6g",
  "lt1igcx5c0",
  "in1muywd",
  "mm1crxm3i",
  "au1s5cgom",
  "M1VUXWEZ",
  "16plkw9",
  "1p2gdwpf",
]

function sequenceRandom(): (length: number) => Uint8Array {
  let n = 0
  return (length) => {
    n += 1
    return Uint8Array.from({ length }, (_, index) => (n * 31 + index) & 255)
  }
}

describe("Bech32m checksum", () => {
  it.each(BIP350_VALID)("accepts the BIP-350 vector %s", (vector) => {
    expect(bech32mValid(vector)).toBe(true)
  })

  it.each(BIP350_INVALID)("rejects the BIP-350 invalid vector %s", (vector) => {
    expect(bech32mValid(vector)).toBe(false)
  })
})

describe("typed public references", () => {
  it("freezes a payload length inside the collision budget", () => {
    expect(collisionUpperBound(PUBLIC_REFERENCE_RANDOM_LENGTH, PUBLIC_REFERENCE_EXPECTED_COUNT))
      .toBeLessThan(PUBLIC_REFERENCE_MAX_COLLISION_PROBABILITY)
    expect(collisionUpperBound(PUBLIC_REFERENCE_RANDOM_LENGTH - 1, PUBLIC_REFERENCE_EXPECTED_COUNT))
      .toBeGreaterThan(PUBLIC_REFERENCE_MAX_COLLISION_PROBABILITY)
  })

  it("generates, formats, parses, and validates each document type", () => {
    const random = sequenceRandom()
    for (const kind of Object.keys(DOCUMENT_PREFIX) as DocumentKind[]) {
      const issued = generatePublicReference(kind, random)
      expect(issued.canonical.startsWith(`${DOCUMENT_PREFIX[kind]}1`)).toBe(true)
      expect(issued.display).toBe(
        `${DOCUMENT_PREFIX[kind]}1${issued.canonical.slice(DOCUMENT_PREFIX[kind].length + 1).match(/.{1,4}/g)?.join("-")}`
      )
      expect(parsePublicReference(issued.canonical)).toEqual({
        ok: true,
        kind,
        canonical: issued.canonical,
        display: issued.display,
        normalized: false,
      })
      expect(parsePublicReference(`  ${issued.display.toUpperCase()}  `)).toMatchObject({
        ok: true,
        kind,
        canonical: issued.canonical,
        normalized: true,
      })
      expect(validatePublicReference(issued.display, kind)).toBe(true)
      expect(validatePublicReference(issued.display, kind === "quote" ? "delivery" : "quote")).toBe(false)
    }
  })

  it("rejects a one-character typo instead of guessing another document", () => {
    const issued = generatePublicReference("purchase_order", () => Uint8Array.from({ length: 14 }, (_, index) => index + 3))
    const bodyAt = issued.canonical.length - 1
    const original = issued.canonical[bodyAt]!
    const replacement = original === "q" ? "p" : "q"
    const typo = issued.canonical.slice(0, bodyAt) + replacement
    expect(parsePublicReference(typo)).toEqual({ ok: false, error: "checksum" })
    expect(validatePublicReference(typo)).toBe(false)
    const lookup = () => {
      throw new Error("lookup must not run for a checksum failure")
    }
    expect(resolvePublicReference(typo, true, lookup)).toEqual({ ok: false, error: "checksum" })
  })

  it("keeps a customer quote distinct from a purchase order and a delivery", () => {
    const random = sequenceRandom()
    const quote = generatePublicReference("quote", random)
    const purchase = generatePublicReference("purchase_order", random)
    const delivery = generatePublicReference("delivery", random)
    const parsedQuote = parsePublicReference(quote.display)
    const parsedPurchase = parsePublicReference(purchase.canonical)
    const parsedDelivery = parsePublicReference(delivery.canonical)
    expect(parsedQuote.ok && parsedQuote.kind).toBe("quote")
    expect(parsedPurchase.ok && parsedPurchase.kind).toBe("purchase_order")
    expect(parsedDelivery.ok && parsedDelivery.kind).toBe("delivery")
    expect(new Set([quote.canonical, purchase.canonical, delivery.canonical]).size).toBe(3)
    expect(DOCUMENT_KIND_LABEL.quote).not.toBe(DOCUMENT_KIND_LABEL.purchase_order)
  })

  it("does not treat tax numbers or accounting sequences as public references", () => {
    expect(nextDocumentNumber("QUO", [], 2026)).toBe("QUO-2026-001")
    expect(nextDocumentNumber("INV", ["INV-2026-122"], 2026)).toBe("INV-2026-123")
    for (const identifier of ["QUO-2026-001", "INV-2026-000123", "PO-2026-000001", "DO-2026-000001", "1234567890123"]) {
      expect(parsePublicReference(identifier).ok).toBe(false)
      expect(validatePublicReference(identifier)).toBe(false)
    }
  })

  it("rejects mixed case, lookalikes, a foreign prefix, and the wrong payload length", () => {
    const issued = generatePublicReference("invoice", () => new Uint8Array(14).fill(8))
    expect(parsePublicReference(issued.canonical.slice(0, 2).toUpperCase() + issued.canonical.slice(2))).toEqual({ ok: false, error: "case" })
    expect(parsePublicReference(issued.canonical.replace("i", "ⅰ"))).toEqual({ ok: false, error: "character" })
    expect(parsePublicReference("split1checkupstagehandshakeupstreamerranterredcaperredlc445v")).toEqual({ ok: false, error: "prefix" })
    expect(parsePublicReference("a1lqfn3a")).toEqual({ ok: false, error: "prefix" })
    const short = checksummedReference("inv", [0, 1, 2, 3, 4, 5, 6, 7])
    expect(parsePublicReference(short)).toEqual({ ok: false, error: "length" })
  })

  it("requires the exact stored form for canonical parsing", () => {
    const issued = generatePublicReference("receipt", () => new Uint8Array(14).fill(4))
    expect(parsePublicReference(issued.display, { canonical: true })).toEqual({ ok: false, error: "non_canonical" })
    expect(parsePublicReference(issued.canonical, { canonical: true }).ok).toBe(true)
  })
})

describe("optional workflow", () => {
  const identity = {
    number: "PO-2026-014",
    taxId: "1234567890123",
    links: { vendorId: "vendor-1", quoteId: null },
  }

  it("issues nothing and does not call the minter when the feature is off", () => {
    const plan = planPublicReferenceIssue({
      enabled: false,
      existingCanonical: null,
      kind: "purchase_order",
      mint: () => { throw new Error("mint must not run while disabled") },
    })
    expect(plan).toEqual({ status: "disabled" })
    const attached = attachPublicReference(identity, "unused")
    expect(identity).toEqual({ number: "PO-2026-014", taxId: "1234567890123", links: { vendorId: "vendor-1", quoteId: null } })
    expect(attached.number).toBe(identity.number)
    expect(attached.taxId).toBe(identity.taxId)
    expect(attached.links).toEqual(identity.links)
    expect(attached.publicReference).toBe("unused")
  })

  it("reuses a stored code and retries a canonical collision without changing identity", () => {
    const random = sequenceRandom()
    const first = generatePublicReference("quote", random)
    expect(planPublicReferenceIssue({
      enabled: true,
      existingCanonical: first.canonical,
      kind: "quote",
      mint: () => { throw new Error("mint must not replace a stored reference") },
    })).toEqual({ status: "reuse", canonical: first.canonical, display: first.display })

    const taken = new Set<string>()
    const minted = mintPublicReference("delivery", (canonical) => {
      if (taken.size === 0) {
        taken.add(canonical)
        return true
      }
      return false
    }, sequenceRandom())
    expect(minted).not.toBeNull()
    expect(taken.has(minted!.canonical)).toBe(false)
    const parsedMinted = parsePublicReference(minted!.canonical)
    expect(parsedMinted.ok && parsedMinted.kind).toBe("delivery")
  })

  it("resolves a formatted code to the matching document and refuses other types", () => {
    const purchase = generatePublicReference("purchase_order", sequenceRandom())
    const recordId = "00000000-0000-4000-8000-000000000010"
    const found = resolvePublicReference(purchase.display.toUpperCase(), true, () => ({ kind: "purchase_order", recordId }))
    expect(found).toEqual({
      ok: true,
      kind: "purchase_order",
      recordId,
      canonical: purchase.canonical,
      display: purchase.display,
      href: documentHref("purchase_order", recordId),
    })
    expect(resolvePublicReference(purchase.canonical, true, () => ({ kind: "quote", recordId }))).toEqual({ ok: false, error: "mismatch" })
    expect(resolvePublicReference(purchase.canonical, true, () => null)).toEqual({ ok: false, error: "not_found" })
    expect(resolvePublicReference(purchase.canonical, false, () => { throw new Error("lookup must not run while disabled") })).toEqual({ ok: false, error: "disabled" })
  })

  it("stops after repeated collisions", () => {
    expect(mintPublicReference("invoice", () => true, () => new Uint8Array(14).fill(1))).toBeNull()
    expect(planPublicReferenceIssue({
      enabled: true,
      existingCanonical: null,
      kind: "invoice",
      mint: () => null,
    })).toEqual({ status: "exhausted" })
  })
})
