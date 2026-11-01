import { describe, expect, it } from "vitest"
import {
  backupFileName,
  checksumLine,
  checksumMatches,
  dumpLooksCustom,
  loopbackBackupURL,
  sha256Hex,
} from "./local-backup"

describe("local backup", () => {
  it("builds a loopback URL and ignores a hosted port string", () => {
    expect(loopbackBackupURL({})).toBe("postgresql://boombignose@127.0.0.1:54329/boombignose")
    expect(loopbackBackupURL({ BOOMBIGNOSE_PG_PORT: "5433" })).toBe("postgresql://boombignose@127.0.0.1:5433/boombignose")
    expect(() => loopbackBackupURL({ BOOMBIGNOSE_PG_PORT: "5432;host=db.example.com" })).toThrow(/not allowed/)
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
})
