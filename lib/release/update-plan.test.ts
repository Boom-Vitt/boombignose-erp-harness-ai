import { createHash } from "node:crypto"
import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

import { performDesktopUpdate } from "@/lib/release/perform-update"
import { APP_VERSION } from "@/lib/release/version"
import { readFileSync } from "node:fs"
import {
  DEFERRED_MESSAGE,
  helperConfigured,
  parseSHA256SUMS,
  redirectAllowed,
  releaseDownloadURL,
  updateCapability,
  versionGreater,
} from "@/lib/release/update-plan"

const page = "https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/tag/boombignose-v1.5.0"
const asset = "BoomBigNose-macos-arm64.dmg"

function releaseResponse() {
  return Response.json({
    tag_name: "boombignose-v1.5.0",
    html_url: page,
    assets: [{ browser_download_url: "https://evil.example/installer.dmg" }],
  })
}

describe("update plan", () => {
  it("locks the helper version to APP_VERSION", () => {
    const source = readFileSync(new URL("../../boombignose/internal/update/version.go", import.meta.url), "utf8")
    expect(source).toContain(`const AppVersion = "${APP_VERSION}"`)
    expect(APP_VERSION).toBe("1.4.2")
  })

  it("builds only this repository's asset URL and ignores other hosts", () => {
    expect(releaseDownloadURL("1.5.0", asset)).toBe(
      "https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/download/boombignose-v1.5.0/BoomBigNose-macos-arm64.dmg",
    )
    expect(releaseDownloadURL("1.5.0/../x", asset)).toBeNull()
    expect(releaseDownloadURL("1.5.0", "../SHA256SUMS")).toBeNull()
    expect(versionGreater("1.5.0", "1.4.0")).toBe(true)
    expect(versionGreater("1.4.0", "1.4.0")).toBe(false)
    expect(updateCapability("darwin", "arm64", true)).toBe("apply")
    expect(updateCapability("darwin", "arm64", false)).toBe("needs-window")
    expect(updateCapability("linux", "x64", true)).toBe("deferred")
    expect(updateCapability("win32", "x64", true)).toBe("deferred")
    expect(helperConfigured("http://127.0.0.1:9", "ab".repeat(32))).toBe(true)
    expect(helperConfigured("https://updates.example", "ab".repeat(32))).toBe(false)
    expect(helperConfigured("http://127.0.0.1:9", "nope")).toBe(false)
  })

  it("reads one hash and refuses a redirect off GitHub", () => {
    const hash = "ab".repeat(32)
    expect(parseSHA256SUMS(`${hash}  ${asset}\n`, asset)).toBe(hash)
    expect(parseSHA256SUMS(`${hash} *${asset}\ncd`.padEnd(0), asset)).toBeNull()
    expect(parseSHA256SUMS("not a sums file\n", asset)).toBeNull()
    const current = new URL("https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/download/boombignose-v1.5.0/SHA256SUMS")
    expect(redirectAllowed(current, "https://objects.githubusercontent.com/pkg")?.hostname).toBe("objects.githubusercontent.com")
    expect(redirectAllowed(current, "https://evil.example/pkg")).toBeNull()
  })
})

describe("performDesktopUpdate", () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
    vi.unstubAllEnvs()
  })

  it("stages the macOS image after SHA256SUMS matches and does not request the payload URL", async () => {
    const bytes = Buffer.from("dmg-bytes")
    const hash = createHash("sha256").update(bytes).digest("hex")
    const calls: string[] = []
    const fetchImpl: typeof fetch = async (input) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      calls.push(href)
      if (href.endsWith("/releases/latest")) return releaseResponse()
      if (href.endsWith("/SHA256SUMS")) return new Response(`${hash}  ${asset}\n`)
      if (href.endsWith(`/${asset}`)) return new Response(bytes)
      throw new Error(href)
    }
    const dir = await mkdtemp(path.join(tmpdir(), "bbn-update-"))
    dirs.push(dir)
    let applied = ""
    await performDesktopUpdate({
      platform: "darwin",
      arch: "arm64",
      currentVersion: "1.4.0",
      helperConfigured: true,
      fetchImpl,
      stageDir: dir,
      apply: async (version, file) => {
        applied = `${version} ${file}`
      },
    })
    expect(applied).toBe(`1.5.0 ${asset}`)
    expect(calls.some((href) => href.includes("evil.example"))).toBe(false)
    expect(await readFile(path.join(dir, asset))).toEqual(bytes)
    await expect(stat(path.join(dir, `${asset}.partial`))).rejects.toThrow()
  })

  it("stops when a checksum redirect leaves GitHub and does not call the helper", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url
      if (href.endsWith("/releases/latest")) return releaseResponse()
      if (href.endsWith("/SHA256SUMS")) {
        return new Response(null, { status: 302, headers: { location: "https://evil.example/SHA256SUMS" } })
      }
      throw new Error(href)
    }
    const dir = await mkdtemp(path.join(tmpdir(), "bbn-update-"))
    dirs.push(dir)
    const apply = vi.fn()
    await expect(performDesktopUpdate({
      platform: "darwin",
      arch: "arm64",
      currentVersion: "1.4.0",
      helperConfigured: true,
      fetchImpl,
      stageDir: dir,
      apply,
    })).rejects.toThrow(/refused/i)
    expect(apply).not.toHaveBeenCalled()
  })

  it("does not download when this operating system cannot replace the app", async () => {
    const fetchImpl = vi.fn()
    await expect(performDesktopUpdate({
      platform: "linux",
      arch: "x64",
      currentVersion: "1.4.0",
      helperConfigured: true,
      fetchImpl,
      stageDir: "/tmp/unused",
      apply: vi.fn(),
    })).rejects.toThrow(DEFERRED_MESSAGE)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
