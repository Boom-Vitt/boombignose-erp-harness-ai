import { describe, expect, it } from "vitest"
import { interpretRelease } from "@/lib/release/update-check"

const page = (version: string) => `https://github.com/Boom-Vitt/nose-erp/releases/tag/boombignose-v${version}`

describe("interpretRelease", () => {
  it("links the release page when a newer tag is published", () => {
    const result = interpretRelease({
      tag_name: "boombignose-v1.3.0",
      html_url: page("1.3.0"),
      assets: [{ browser_download_url: "https://github.com/Boom-Vitt/nose-erp/releases/download/boombignose-v1.3.0/app.exe" }],
    }, "1.2.0")
    expect(result).toEqual({ state: "available", version: "1.3.0", url: page("1.3.0") })
    expect(JSON.stringify(result)).not.toContain("download")
  })

  it("stays on the installed version when the published tag is the same or older", () => {
    expect(interpretRelease({ tag_name: "boombignose-v1.2.0", html_url: page("1.2.0") }, "1.2.0")).toEqual({ state: "current", version: "1.2.0", url: page("1.2.0") })
    expect(interpretRelease({ tag_name: "v1.2.10", html_url: page("1.2.10") }, "1.2.9").state).toBe("available")
    expect(interpretRelease({ tag_name: "boombignose-v1.1.0", html_url: page("1.1.0") }, "1.2.0").state).toBe("current")
  })

  it("rejects a release link that is not this repository's tag page", () => {
    expect(interpretRelease({ tag_name: "boombignose-v9.0.0", html_url: "https://example.com/boombignose-v9.0.0" }, "1.2.0").state).toBe("unavailable")
    expect(interpretRelease({ tag_name: "boombignose-v1.3.0", html_url: `${page("1.3.0")}?download=1` }, "1.2.0").state).toBe("unavailable")
    expect(interpretRelease(null, "1.2.0").state).toBe("unavailable")
  })
})
