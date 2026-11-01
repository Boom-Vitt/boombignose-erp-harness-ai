import { deflateRawSync, gzipSync } from "node:zlib"
import { describe, expect, it } from "vitest"

import {
  ASR_MODEL,
  allowedDownloadHost,
  asrArchive,
  asrArgs,
  asrHostKey,
  audioKind,
  pinnedUrl,
  safeArchiveName,
  unpackTarGz,
  unpackZip,
} from "./asr-runtime"

function tarGz(entries: { name: string; data: string }[]): Buffer {
  const blocks: Buffer[] = []
  for (const entry of entries) {
    const header = Buffer.alloc(512)
    header.write(entry.name)
    header.write(entry.data.length.toString(8).padStart(11, "0"), 124)
    header[156] = "0".charCodeAt(0)
    header.write("ustar", 257)
    let sum = 0
    header.fill(32, 148, 156)
    for (const byte of header) sum += byte
    header.write(sum.toString(8).padStart(6, "0"), 148)
    const data = Buffer.from(entry.data)
    const padded = Buffer.alloc(Math.ceil(data.length / 512) * 512)
    data.copy(padded)
    blocks.push(header, padded)
  }
  blocks.push(Buffer.alloc(1024))
  return gzipSync(Buffer.concat(blocks))
}

function zip(name: string, data: string): Buffer {
  const raw = Buffer.from(data)
  const compressed = deflateRawSync(raw)
  const nameBytes = Buffer.from(name)
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(8, 8)
  local.writeUInt32LE(compressed.length, 18)
  local.writeUInt32LE(raw.length, 22)
  local.writeUInt16LE(nameBytes.length, 26)
  return Buffer.concat([local, nameBytes, compressed])
}

describe("speech-to-text runtime", () => {
  it("offers the pinned whisper.cpp archives on Linux and Windows only", () => {
    expect(asrHostKey("linux", "x64")).toBe("linux-amd64")
    expect(asrHostKey("linux", "arm64")).toBe("linux-arm64")
    expect(asrHostKey("win32", "x64")).toBe("windows-amd64")
    expect(asrHostKey("darwin", "arm64")).toBeNull()
    expect(asrArchive("linux", "x64")?.binary).toBe("whisper-bin-ubuntu-x64/whisper-cli")
    expect(asrArchive("win32", "x64")?.binary).toBe("Release/whisper-cli.exe")
    expect(ASR_MODEL.sha256).toBe("be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21")
    expect(ASR_MODEL.bytes).toBe(77_691_713)
    expect(pinnedUrl(ASR_MODEL.url)).toBe(true)
    expect(pinnedUrl("https://evil.example/ggml-tiny.bin")).toBe(false)
    expect(allowedDownloadHost("us.aws.cdn.hf.co")).toBe(true)
    expect(allowedDownloadHost("evil.example")).toBe(false)
  })

  it("builds a CPU-only auto-language command", () => {
    expect(asrArgs("/models/ggml-tiny.bin", "/tmp/in.wav")).toEqual([
      "-m", "/models/ggml-tiny.bin",
      "-f", "/tmp/in.wav",
      "-l", "auto",
      "-nt",
      "-np",
      "-ng",
    ])
  })

  it("refuses archive paths that leave the folder", () => {
    expect(safeArchiveName("whisper-bin-ubuntu-x64/whisper-cli")).toBe("whisper-bin-ubuntu-x64/whisper-cli")
    expect(safeArchiveName("../evil")).toBeNull()
    expect(safeArchiveName("/tmp/evil")).toBeNull()
    expect(() => unpackTarGz(tarGz([{ name: "../evil", data: "x" }]))).toThrow(/refused/)
    expect(() => unpackZip(zip("../evil.txt", "x"))).toThrow(/refused/)
  })

  it("unpacks a normal file and recognizes an audio header", () => {
    const files = unpackTarGz(tarGz([{ name: "whisper-bin-ubuntu-x64/whisper-cli", data: "#!/bin/sh\necho hi\n" }]))
    expect(files.map((file) => file.name)).toEqual(["whisper-bin-ubuntu-x64/whisper-cli"])
    expect(audioKind(Buffer.from("RIFFxxxxWAVE"))).toBe("wav")
    expect(audioKind(Buffer.from("not audio"))).toBeNull()
  })
})
