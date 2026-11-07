import { describe, expect, it } from "vitest"
import {
  backupFileName,
  checksumLine,
  checksumMatches,
  dumpLooksCustom,
  dumpHasAclMetadata,
  loopbackBackupURL,
  sha256Hex,
} from "./local-backup"

describe("local backup", () => {
  it("requires explicit native identity and port, ignoring other connection settings", () => {
    expect(() => loopbackBackupURL({})).toThrow(/not configured/)
    expect(() => loopbackBackupURL({ BOOMBIGNOSE_PG_PORT: "5433" })).toThrow(/not configured/)
    expect(() => loopbackBackupURL({ BOOMBIGNOSE_NATIVE: "1" })).toThrow(/not configured/)
    expect(loopbackBackupURL({ BOOMBIGNOSE_NATIVE: "1", BOOMBIGNOSE_PG_PORT: "5433", DATABASE_URL: "postgresql://other.example/foreign" })).toBe("postgresql://boombignose@127.0.0.1:5433/boombignose")
    expect(() => loopbackBackupURL({ BOOMBIGNOSE_NATIVE: "1", BOOMBIGNOSE_PG_PORT: "5432;host=db.example.com" })).toThrow(/not configured/)
  })

  it("names one dump and checks its sidecar", () => {
    const name = backupFileName(new Date("2026-10-28T02:00:00.000Z"))
    expect(name).toBe("boombignose-20261028T020000Z.dump")
    const body = Buffer.from("PGDMP-test")
    expect(dumpLooksCustom(body)).toBe(true)
    const hex = sha256Hex(body)
    const sidecar = checksumLine(name, hex)
    expect(checksumMatches(name, body, sidecar)).toBe(true)
    expect(checksumMatches(name, body, sidecar.replace(hex[0]!, hex[0] === "a" ? "b" : "a"))).toBe(false)
    expect(checksumMatches(name, Buffer.from("PGDMPother"), sidecar)).toBe(false)
  })

  it("requires an ACL entry, not an ACL-looking object name or comment", () => {
    expect(dumpHasAclMetadata("3387; 0 0 ACL public TABLE memberships boombignose")).toBe(true)
    expect(dumpHasAclMetadata("3388; 0 0 DEFAULT ACL public DEFAULT PRIVILEGES FOR TABLES boombignose")).toBe(true)
    expect(dumpHasAclMetadata("; ACL public TABLE memberships\n123; 1259 42 TABLE public ACL boombignose")).toBe(false)
    expect(dumpHasAclMetadata("123; 1259 42 TABLE public memberships boombignose")).toBe(false)
  })
})
