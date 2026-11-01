import { describe, expect, it } from "vitest"
import { closeChainPayload, closeChainSha256, linkCloseChain, readChainStatus, verifyCloseChain, type CloseChainInput } from "@/lib/finance/close-chain"

const orgId = "11111111-1111-4111-8111-111111111111"
const firstId = "22222222-2222-4222-8222-222222222222"
const actorId = "33333333-3333-4333-8333-333333333333"

const first: CloseChainInput = {
  orgId,
  id: firstId,
  recordedAt: "2026-11-01T00:00:00.000000Z",
  action: "period_closed",
  actorId,
  summary: "Closed operational month 2026-01",
  meta: { month: "2026-01", lockDate: "2026-01-31", kind: "operational_close", chainSha256: "ignored" },
}

const second: CloseChainInput = {
  ...first,
  id: "44444444-4444-4444-8444-444444444444",
  recordedAt: "2026-11-02T00:00:00.000000Z",
  action: "finance_lock_reopened",
  summary: "Reopened the finance lock: Bank statement",
  meta: { reason: "Bank statement", previousLockDate: "2026-01-31", kind: "operational_lock" },
}

describe("close activity hash chain", () => {
  it("uses a stable payload and links each row to the previous hash", () => {
    const payload = closeChainPayload(first, "")
    expect(payload).toBe([
      "v1",
      orgId,
      firstId,
      "2026-11-01T00:00:00.000000Z",
      "period_closed",
      actorId,
      "Closed operational month 2026-01",
      "",
      "lockDate=2026-01-31;month=2026-01;kind=operational_close",
    ].join("\n"))
    expect(closeChainSha256(payload)).toBe("c4f7f4b763bc9aa183ad7f5b730f5b3e7fed442bcf56e0bf65f5985a18c0cd23")
    const { links, head } = linkCloseChain([first, second])
    expect(links[0]?.previous).toBe("")
    expect(links[0]?.seq).toBe(1)
    expect(links[1]?.previous).toBe(links[0]?.sha256)
    expect(links[1]?.seq).toBe(2)
    expect(head).toEqual({ sha256: links[1]?.sha256, seq: 2 })
    expect(verifyCloseChain(links, head)).toEqual({ ok: true, checked: 2, reason: null, brokenAt: null })
  })

  it("fails when a row is edited, when one is missing, and when the head still names a removed tail", () => {
    const { links, head } = linkCloseChain([first, second])
    const firstLink = links[0]
    const secondLink = links[1]
    if (!firstLink || !secondLink) throw new Error("chain")
    const edited = { ...firstLink, summary: "Changed after write" }
    expect(verifyCloseChain([edited, secondLink], head).ok).toBe(false)
    expect(verifyCloseChain([edited, secondLink], head).reason).toContain("changed after it was written")

    const jumped = { ...secondLink, seq: 3 }
    expect(verifyCloseChain([firstLink, jumped], head).reason).toContain("missing before this one")

    const removedTail = verifyCloseChain([firstLink], head)
    expect(removedTail.ok).toBe(false)
    expect(removedTail.reason).toContain("stored chain head")
  })

  it("reads the database verdict", () => {
    expect(readChainStatus({ ok: true, checked: 2, reason: null, brokenAt: null })).toEqual({ ok: true, checked: 2, reason: null, brokenAt: null })
    expect(readChainStatus({ ok: false, checked: 1, reason: "A close-activity row is missing before this one.", brokenAt: firstId })?.ok).toBe(false)
    expect(readChainStatus({ ok: false, checked: 0, reason: "" })).toBeNull()
  })
})
