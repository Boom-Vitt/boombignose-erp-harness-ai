import { createHash } from "node:crypto"
import { describe, expect, it } from "vitest"
import { checksumVerdict, normalizeSha256, sha256HexBytes, sha256Utf8, supportExportCall, supportExportHeaders } from "@/lib/finance/export-integrity"

describe("support export checksum", () => {
  it("hashes the UTF-8 bytes that will be downloaded", () => {
    const body = "ก,b\n"
    const call = supportExportCall("org-1", "accountant_pack_csv", "2026-01", body)
    expect(call.sha256).toBe(createHash("sha256").update(body, "utf8").digest("hex"))
    expect(call.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(call.rpc).toBe("record_support_export")
    expect(call.args).toEqual({
      p_org_id: "org-1",
      p_kind: "accountant_pack_csv",
      p_period: "2026-01",
      p_sha256: call.sha256,
      p_bytes: Buffer.byteLength(body, "utf8"),
    })
    expect(call.args.p_bytes).toBe(6)
  })

  it("puts the same digest on the response header", () => {
    const headers = supportExportHeaders("accountant-pack-2026-01.csv", "text/csv; charset=utf-8", "ab".repeat(32), "attachment")
    expect(headers["X-Content-SHA256"]).toBe("ab".repeat(32))
    expect(headers["Content-Disposition"]).toBe('attachment; filename="accountant-pack-2026-01.csv"')
    expect(headers["X-Robots-Tag"]).toBe("noindex")
  })
})

describe("sha256Utf8", () => {
  it("changes when the body changes", () => {
    expect(sha256Utf8("a")).not.toBe(sha256Utf8("b"))
  })
})

describe("saved file checksum", () => {
  it("matches a saved file to the stored export and rejects a different file", async () => {
    const bytes = new TextEncoder().encode("ก,b\n")
    const sha256 = await sha256HexBytes(bytes)
    expect(sha256).toBe(createHash("sha256").update(Buffer.from(bytes)).digest("hex"))
    expect(normalizeSha256(sha256.toUpperCase())).toBe(sha256)
    expect(normalizeSha256("not-a-hash")).toBeNull()
    const record = { sha256, kind: "accountant_pack_csv", period: "2026-01", bytes: bytes.byteLength }
    expect(checksumVerdict({ sha256, bytes: bytes.byteLength }, record)).toEqual({ match: true, kind: "accountant_pack_csv", period: "2026-01" })
    expect(checksumVerdict({ sha256: "ab".repeat(32), bytes: 1 }, null).match).toBe(false)
    const size = checksumVerdict({ sha256, bytes: bytes.byteLength + 1 }, record)
    expect(size.match).toBe(false)
    if (!size.match) expect(size.message).toContain("file size")
  })
})
