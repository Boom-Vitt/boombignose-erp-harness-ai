import { mkdtemp } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { chmod, mkdir, open, writeFile } from "node:fs/promises"

import { asrInstalled, asrRoot, downloadPinned, removeAsr, transcribeLocalAudio } from "./asr-install"
import { ASR_MODEL, asrArchive } from "./asr-runtime"

describe("speech-to-text install", () => {
  const previous = process.env.BOOMBIGNOSE_DATA
  afterEach(() => {
    if (previous === undefined) delete process.env.BOOMBIGNOSE_DATA
    else process.env.BOOMBIGNOSE_DATA = previous
  })

  it("refuses a redirect off the pinned hosts and a bad checksum", async () => {
    await expect(downloadPinned(ASR_MODEL.url, ASR_MODEL.sha256, 1000, async () => new Response(null, {
      status: 302,
      headers: { location: "https://evil.example/model.bin" },
    }))).rejects.toThrow(/not allowed/)
    await expect(downloadPinned("https://evil.example/ggml-tiny.bin", ASR_MODEL.sha256, 1000, async () => new Response("nope"))).rejects.toThrow(/not in this build/)
    await expect(downloadPinned(ASR_MODEL.url, "a".repeat(64), 1000, async () => new Response("nope"))).rejects.toThrow(/checksum/)
  })

  it("runs the local program and returns its transcript", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bbn-asr-"))
    process.env.BOOMBIGNOSE_DATA = path.join(root, "pg")
    const asr = asrRoot()
    if (!asr) throw new Error("missing asr dir")
    const archive = asrArchive("linux", "x64")
    if (!archive) throw new Error("archive")
    const binary = path.join(asr, "runtime", archive.binary)
    await mkdir(path.dirname(binary), { recursive: true })
    await writeFile(binary, "#!/bin/sh\nprintf '%s\\n' 'สวัสดีจากเครื่องนี้'\n")
    await chmod(binary, 0o755)
    const handle = await open(path.join(asr, ASR_MODEL.file), "w")
    await handle.truncate(ASR_MODEL.bytes)
    await handle.close()
    await writeFile(path.join(asr, `${ASR_MODEL.file}.sha256`), ASR_MODEL.sha256)
    expect(await asrInstalled(asr, archive)).toBe(true)
    const spoken = await transcribeLocalAudio(Buffer.from("RIFFxxxxWAVEhello"), "linux", "x64")
    expect(spoken).toEqual({ text: "สวัสดีจากเครื่องนี้" })
    await removeAsr()
    expect(await asrInstalled(asr, archive)).toBe(false)
  })
})
