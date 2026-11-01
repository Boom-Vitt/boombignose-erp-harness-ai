import { describe, expect, it } from "vitest"

import {
  BLOCKED_BANK_HOST_SUFFIXES,
  DEFAULT_SAMPLE_URL,
  FORBIDDEN_MOLI_FLAGS,
  REVENUE_DEPARTMENT_SAMPLE_URL,
  artifactMetaPath,
  artifactRelativePath,
  buildArtifactMeta,
  decidePublicFetch,
  moliFetchArgs,
  parseFetchArgs,
  validateFetchBody,
} from "./public-fetch.mjs"

const fixedNow = new Date("2026-11-01T04:35:00.000Z")

function allowed(url: string, extra: { dump?: string; layout?: boolean } = {}) {
  const decision = decidePublicFetch({ url, ...extra })
  expect(decision.ok, !decision.ok ? decision.reason : url).toBe(true)
  if (!decision.ok) throw new Error(decision.reason)
  return decision
}

describe("public Moli fetch policy", () => {
  it("allows the Revenue Department public page and refuses the desktop ERP", () => {
    expect(DEFAULT_SAMPLE_URL).toBe(REVENUE_DEPARTMENT_SAMPLE_URL)
    expect(allowed(DEFAULT_SAMPLE_URL).dump).toBe("markdown")
    expect(allowed(DEFAULT_SAMPLE_URL).layout).toBe(false)
    expect(allowed(REVENUE_DEPARTMENT_SAMPLE_URL).url.hostname).toBe("www.rd.go.th")
    expect(decidePublicFetch({ url: "http://127.0.0.1:3100/" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "http://127.0.0.1:3100/finance" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "http://127.0.0.1:3100/finance/bank" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "http://127.0.0.1:3100/finance/cash" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "http://127.0.0.1:3100/reports/accountant-pack" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "http://localhost:3100/login" }).ok).toBe(false)
  })

  it("refuses non-https, credentials, local hosts, and IP literals", () => {
    expect(decidePublicFetch({ url: "http://example.com/docs" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "https://user:secret@example.com/docs" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "https://localhost/docs" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "https://printer.local/status" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "https://127.0.0.1/" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "https://10.1.2.3/admin" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "https://169.254.169.254/latest/meta-data" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "https://[::1]/" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "javascript:alert(1)" }).ok).toBe(false)
  })

  it("does not echo a password in the refusal", () => {
    const decision = decidePublicFetch({ url: "https://owner:super-secret@example.com/docs" })
    expect(decision.ok).toBe(false)
    if (decision.ok) return
    expect(decision.reason).not.toContain("super-secret")
  })

  it("refuses bank hosts, login paths, and credential query keys", () => {
    for (const suffix of BLOCKED_BANK_HOST_SUFFIXES) {
      const decision = decidePublicFetch({ url: `https://online.${suffix}/` })
      expect(decision.ok, suffix).toBe(false)
    }
    expect(decidePublicFetch({ url: "https://kbiz.kasikornbank.com/" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "https://example.com/app/login" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "https://example.com/mfa" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "https://www.rd.go.th/login" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "https://efiling.rd.go.th/rd-efiling-web/authen/ONE" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "https://www.rd.go.th/272.html" }).ok).toBe(true)
    expect(decidePublicFetch({ url: "https://example.com/docs?otp=123456" }).ok).toBe(false)
    expect(decidePublicFetch({ url: "https://example.com/docs#token=abc" }).ok).toBe(false)
  })

  it("still allows a public page whose name mentions login guidance", () => {
    expect(decidePublicFetch({ url: "https://example.com/docs/login-guide" }).ok).toBe(true)
  })

  it("turns layout on for screenshots and keeps text dumps structure-first", () => {
    expect(allowed(DEFAULT_SAMPLE_URL, { dump: "screenshot" }).layout).toBe(true)
    expect(allowed(DEFAULT_SAMPLE_URL, { dump: "screenshot_full" }).layout).toBe(true)
    expect(allowed(DEFAULT_SAMPLE_URL, { dump: "semantic_tree_text" }).layout).toBe(false)
    expect(allowed(DEFAULT_SAMPLE_URL, { layout: true }).layout).toBe(true)
  })

  it("builds a fetch command without session or interaction flags", () => {
    const decision = allowed(DEFAULT_SAMPLE_URL, { dump: "semantic_tree_text" })
    const args = moliFetchArgs(decision)
    expect(args.slice(0, 6)).toEqual([
      "fetch",
      "--dump",
      "semantic_tree_text",
      "--wait-until",
      "done",
      "--block-private-networks",
    ])
    expect(args).toContain(DEFAULT_SAMPLE_URL)
    expect(args).not.toContain("--layout")
    for (const flag of FORBIDDEN_MOLI_FLAGS) {
      expect(args).not.toContain(flag)
    }

    const shot = moliFetchArgs(allowed(DEFAULT_SAMPLE_URL, { dump: "screenshot" }))
    expect(shot).toContain("--layout")
    expect(shot).not.toContain("--eval")
  })

  it("rejects wrapper options that would forward cookies, headers, or eval", () => {
    for (const flag of ["--eval", "--cookie-file", "--profile-dir", "--header", "-H", "--insecure-disable-tls-host-verification"]) {
      const parsed = parseFetchArgs([flag, "document.cookie"])
      expect(parsed.error, flag).toMatch(/does not forward/)
    }
  })

  it("parses the documented command shape", () => {
    expect(parseFetchArgs([])).toMatchObject({
      help: false,
      url: DEFAULT_SAMPLE_URL,
      dump: "markdown",
      layout: false,
      timeoutMs: 25_000,
    })
    expect(parseFetchArgs(["--help"]).help).toBe(true)
    expect(parseFetchArgs(["--", "--timeout", "60000"])).toMatchObject({ timeoutMs: 60000 })
    expect(parseFetchArgs(["--url", REVENUE_DEPARTMENT_SAMPLE_URL, "--dump", "markdown"])).toMatchObject({
      url: REVENUE_DEPARTMENT_SAMPLE_URL,
      dump: "markdown",
    })
  })

  it("writes a stable path under artifacts/moli and a secret-free sidecar", () => {
    const decision = allowed(`${DEFAULT_SAMPLE_URL}?lang=th`)
    const relative = artifactRelativePath(decision.url, decision.dump, fixedNow)
    expect(relative).toMatch(
      /^artifacts\/moli\/2026-11-01\/rd-go-th-272-html-[0-9a-f]{8}\.md$/
    )
    expect(artifactMetaPath(relative)).toBe(relative.replace(/\.md$/, ".meta.json"))

    const screenshot = artifactRelativePath(decision.url, "screenshot_full", fixedNow)
    expect(screenshot).toContain("-full-")
    expect(screenshot.endsWith(".png")).toBe(true)

    const meta = buildArtifactMeta({
      sourceUrl: decision.url.href,
      dump: "markdown",
      layout: false,
      bytes: 12,
      createdAt: fixedNow.toISOString(),
    })
    expect(meta.policyVersion).toBe(1)
    expect(Object.keys(meta).sort()).toEqual([
      "bytes",
      "createdAt",
      "dump",
      "layout",
      "note",
      "policyVersion",
      "sourceUrl",
    ])
    expect(meta.note).toMatch(/No cookies or credentials/)
  })

  it("checks text emptiness and the PNG signature", () => {
    expect(validateFetchBody("markdown", Buffer.from("กรมสรรพากร")).ok).toBe(true)
    expect(validateFetchBody("markdown", Buffer.alloc(0)).ok).toBe(false)
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00])
    expect(validateFetchBody("screenshot", png).ok).toBe(true)
    expect(validateFetchBody("screenshot", Buffer.from("not a png")).ok).toBe(false)
  })
})
