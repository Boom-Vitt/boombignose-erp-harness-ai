import { describe, expect, it, vi } from "vitest"

import { buildSnapshot } from "@/lib/ai/model-catalog"
import { listDevices } from "@/lib/mobile/pairing"
import { softLoad } from "./soft-load"

vi.spyOn(console, "error").mockImplementation(() => {})

const boom = async () => {
  throw new Error("x")
}

describe("softLoad", () => {
  it("returns the read value on success", async () => {
    expect(await softLoad(async () => 1, 0)).toBe(1)
  })

  it("returns [] when listDevices throws on a Supabase error", async () => {
    const db = {
      from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: null, error: { message: "boom" } }) }) }) }),
    }
    await expect(listDevices(db as never, "org")).rejects.toThrow("Could not load devices.")
    expect(await softLoad(() => listDevices(db as never, "org"), [])).toEqual([])
  })

  it("falls back to a daemon-down ModelSnapshot so Local AI still renders", async () => {
    const host = { platform: "darwin", arch: "arm64" } as const
    const snap = await softLoad(boom, () => buildSnapshot(host, [], { up: false }))
    expect(snap.daemonUp).toBe(false)
    expect(snap.rows.length).toBeGreaterThan(0)
  })

  it("falls back to an empty asr card", async () => {
    expect(await softLoad(boom, { offered: false, installed: false })).toEqual({ offered: false, installed: false })
  })
})
