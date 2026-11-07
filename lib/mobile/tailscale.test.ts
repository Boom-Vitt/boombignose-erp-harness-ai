import { describe, expect, it } from "vitest"
import { verifiedServeOrigin } from "./tailscale"

const backend = "http://127.0.0.1:3128"
const status = { BackendState: "Running", Self: { Online: true, DNSName: "erp.tailnet.ts.net." } }
const ready = { TCP: { "443": { HTTPS: true } }, Web: { "erp.tailnet.ts.net:443": { Handlers: { "/": { Proxy: backend } } } } }

describe("private Tailscale Serve readiness", () => {
  it("accepts the running private HTTPS mapping to the actual ERP backend", () => {
    expect(verifiedServeOrigin(status, ready, backend)).toBe("https://erp.tailnet.ts.net")
  })
  it("uses a separate private ERP port without replacing another service or its Funnel", () => {
    const dedicated = {
      TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true } },
      Web: {
        "erp.tailnet.ts.net:443": { Handlers: { "/": { Proxy: "http://127.0.0.1:9000" } } },
        "erp.tailnet.ts.net:8443": { Handlers: { "/": { Proxy: backend } } },
      },
      AllowFunnel: { "erp.tailnet.ts.net:443": true },
    }
    expect(verifiedServeOrigin(status, dedicated, backend)).toBe("https://erp.tailnet.ts.net:8443")
    expect(verifiedServeOrigin(status, { ...dedicated, AllowFunnel: { "erp.tailnet.ts.net:8443": true } }, backend)).toBeNull()
  })
  it("does not guess among multiple private ERP front doors", () => {
    expect(verifiedServeOrigin(status, {
      TCP: { "443": { HTTPS: true }, "8443": { HTTPS: true } },
      Web: {
        "erp.tailnet.ts.net:443": { Handlers: { "/": { Proxy: backend } } },
        "erp.tailnet.ts.net:8443": { Handlers: { "/": { Proxy: backend } } },
      },
    }, backend)).toBeNull()
  })
  it("does not confuse DNS identity, offline nodes, missing Serve or another backend with readiness", () => {
    expect(verifiedServeOrigin(status, {}, backend)).toBeNull()
    expect(verifiedServeOrigin({ ...status, BackendState: "NeedsLogin" }, ready, backend)).toBeNull()
    expect(verifiedServeOrigin({ ...status, Self: { ...status.Self, Online: false } }, ready, backend)).toBeNull()
    expect(verifiedServeOrigin(status, ready, "http://127.0.0.1:3100")).toBeNull()
    expect(verifiedServeOrigin(status, ready, "https://public.example")).toBeNull()
    expect(verifiedServeOrigin(status, { ...ready, TCP: { "443": {} } }, backend)).toBeNull()
  })
  it("refuses Funnel, non-root handlers and foreign front doors", () => {
    expect(verifiedServeOrigin(status, { ...ready, AllowFunnel: { "erp.tailnet.ts.net:443": true } }, backend)).toBeNull()
    expect(verifiedServeOrigin(status, { ...ready, Web: { "erp.tailnet.ts.net:443": { Handlers: { "/erp": { Proxy: backend } } } } }, backend)).toBeNull()
    expect(verifiedServeOrigin({ ...status, Self: { Online: true, DNSName: "erp.public.example" } }, ready, backend)).toBeNull()
  })
})
