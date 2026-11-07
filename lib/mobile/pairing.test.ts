import { describe, expect, it } from "vitest"

import {
  PAIR_TTL_MS,
  authDevice,
  buildPairUri,
  hashToken,
  normalizeBaseUrl,
  redeemPairing,
  revokeDevice,
  startPairing,
} from "./pairing"

type Row = Record<string, unknown>

/** Just enough of the supabase-js query builder for pairing.ts, over in-memory tables. */
function fakeDb() {
  const tables: Record<string, Row[]> = { mobile_pairings: [], mobile_devices: [] }
  let n = 0
  const from = (name: string) => {
    const rows = tables[name]!
    let mode: "select" | "insert" | "update" = "select"
    let patch: Row = {}
    const preds: ((r: Row) => boolean)[] = []
    let picked: Row[] = []
    const b = {
      insert(row: Row) {
        mode = "insert"
        const dup = rows.some((r) => r.token_hash === row.token_hash)
        if (!dup) rows.push((picked = [{ id: `id${++n}`, consumed_at: null, revoked_at: null, ...row }])[0]!)
        else picked = []
        return b
      },
      update(p: Row) {
        mode = "update"
        patch = p
        return b
      },
      select: () => b,
      eq(k: string, v: unknown) {
        preds.push((r) => r[k] === v)
        return b
      },
      is(k: string, v: null) {
        preds.push((r) => r[k] === v)
        return b
      },
      gt(k: string, v: string) {
        preds.push((r) => (r[k] as string) > v)
        return b
      },
      order: () => b,
      run() {
        if (mode === "insert") return picked
        const hit = rows.filter((r) => preds.every((p) => p(r)))
        if (mode === "update") hit.forEach((r) => Object.assign(r, patch))
        return hit
      },
      maybeSingle: async () => ({ data: b.run()[0] ?? null, error: null }),
      single: async () => {
        const r = b.run()[0]
        return { data: r ?? null, error: r ? null : new Error("none") }
      },
      then: (ok: (v: { data: Row[]; error: null }) => unknown) => ok({ data: b.run(), error: null }),
    }
    return b
  }
  return { db: { from } as never, tables }
}

const t0 = new Date("2026-11-03T10:00:00Z")

describe("pairing tokens", () => {
  it("stores only a hash and expires after the TTL", async () => {
    const { db, tables } = fakeDb()
    const { token, expiresAt } = await startPairing(db, { orgId: "o", userId: "u", now: t0 })
    expect(expiresAt.getTime() - t0.getTime()).toBe(PAIR_TTL_MS)
    expect(JSON.stringify(tables)).not.toContain(token)
    expect(tables.mobile_pairings![0]!.token_hash).toBe(hashToken(token))

    const late = new Date(expiresAt.getTime() + 1)
    expect(await redeemPairing(db, { token, deviceName: "x", now: late })).toBeNull()
    expect(tables.mobile_devices).toHaveLength(0)
  })

  it("redeems once, bound to the issuing org and user", async () => {
    const { db, tables } = fakeDb()
    const { token } = await startPairing(db, { orgId: "org-1", userId: "user-1", now: t0 })
    const first = await redeemPairing(db, { token, deviceName: "iPhone", now: new Date(t0.getTime() + 1000) })
    expect(first).toMatchObject({ orgId: "org-1" })
    expect(tables.mobile_devices![0]).toMatchObject({ org_id: "org-1", user_id: "user-1", name: "iPhone" })

    expect(await redeemPairing(db, { token, deviceName: "again", now: new Date(t0.getTime() + 2000) })).toBeNull()
    expect(tables.mobile_devices).toHaveLength(1)
    expect(await redeemPairing(db, { token: "wrong", deviceName: "x", now: t0 })).toBeNull()
  })

  it("a revoked device no longer authenticates", async () => {
    const { db } = fakeDb()
    const { token } = await startPairing(db, { orgId: "o", userId: "u", now: t0 })
    const paired = (await redeemPairing(db, { token, deviceName: "p", now: t0 }))!
    expect(await authDevice(db, paired.deviceToken)).toMatchObject({ org_id: "o", user_id: "u" })
    expect(await authDevice(db, null)).toBeNull()
    expect(await revokeDevice(db, "other-org", paired.deviceId)).toBe(false)
    expect(await revokeDevice(db, "o", paired.deviceId)).toBe(true)
    expect(await authDevice(db, paired.deviceToken)).toBeNull()
  })
})

describe("base url and QR payload", () => {
  it("accepts only bare private HTTPS .ts.net origins", () => {
    expect(normalizeBaseUrl("https://mac.tail1234.ts.net/")).toBe("https://mac.tail1234.ts.net")
    expect(normalizeBaseUrl("https://mac.tail1234.ts.net:8443/")).toBe("https://mac.tail1234.ts.net:8443")
    for (const bad of ["http://100.101.102.103:3100/x", "https://public.example", "https://mac.tail1234.ts.net.evil.test", "https://user:secret@mac.tail1234.ts.net", "https://mac.tail1234.ts.net:0", "https://mac.tail1234.ts.net:65536", "https://mac.tail1234.ts.net/path", "https://mac.tail1234.ts.net?x=1", "https://mac.tail1234.ts.net#fragment", "http://localhost:3100", "http://127.0.0.1:3100", "ftp://a.b", "nope", ""]) {
      expect(normalizeBaseUrl(bad)).toBeNull()
    }
  })

  it("carries the token and expiry but no credentials", () => {
    const uri = buildPairUri({ baseUrl: "https://m.ts.net", token: "tok", orgName: "Acme Co", expiresAt: t0 })
    const q = new URL(uri).searchParams
    expect(uri.startsWith("bbn-pair://redeem?")).toBe(true)
    expect([q.get("u"), q.get("t"), q.get("o"), q.get("e")]).toEqual([
      "https://m.ts.net", "tok", "Acme Co", String(t0.getTime() / 1000),
    ])
  })
})
