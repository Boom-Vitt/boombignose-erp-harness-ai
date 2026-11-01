/**
 * Policy for the optional Moli public-page wrapper.
 *
 * This module decides whether a URL may be fetched and which Moli arguments
 * the wrapper may pass. It does not launch a browser, store cookies, or accept
 * credentials. Bank login and MFA bypass stay refused until a separate consent
 * and security design changes this policy on purpose.
 */

import { createHash } from "node:crypto"

export const POLICY_VERSION = 1

/**
 * Public Revenue Department main page (the landing page's own "เข้าสู่เว็บไซต์" link).
 * Not an e-Filing login. The desktop app stays on http://127.0.0.1:3100.
 */
export const REVENUE_DEPARTMENT_SAMPLE_URL = "https://www.rd.go.th/272.html"

export const DEFAULT_SAMPLE_URL = REVENUE_DEPARTMENT_SAMPLE_URL

export const DUMP_MODES = ["markdown", "semantic_tree_text", "screenshot", "screenshot_full"]

const TEXT_BYTE_LIMIT = 5_000_000
const BINARY_BYTE_LIMIT = 15_000_000
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/**
 * Registrable bank domains the wrapper refuses in full.
 * This is a refusal list, not a set of sites to visit.
 */
export const BLOCKED_BANK_HOST_SUFFIXES = [
  "kasikornbank.com",
  "kbank.com",
  "scb.co.th",
  "scbeasy.com",
  "bangkokbank.com",
  "krungsri.com",
  "bankofayudhya.com",
  "krungthai.com",
  "ktb.co.th",
  "ttb.co.th",
  "tmbbank.com",
  "gsb.or.th",
  "baac.or.th",
  "uob.co.th",
  "cimbthai.com",
  "lhbank.co.th",
  "tisco.co.th",
  "kkpfg.com",
  "ghbank.co.th",
  "smebank.co.th",
  "exim.go.th",
  "hsbc.co.th",
  "citibank.co.th",
]

/** Hostname labels that mean an internet-banking or login host. */
const BLOCKED_HOST_LABELS = new Set([
  "internetbanking",
  "onlinebanking",
  "ebanking",
  "netbank",
  "ibank",
  "kbiz",
  "krungsrionline",
  "scbeasy",
  "login",
  "signin",
  "mfa",
  "otp",
])

const LOGIN_PATH_SEGMENT =
  /^(?:login|log-in|signin|sign-in|signon|sign-on|mfa|otp|2fa|verify-otp|verify-factor|auth|authen|authenticate|internetbanking|internet-banking|ebanking|e-banking|onlinebanking|online-banking)$/i

const SENSITIVE_QUERY_KEYS = new Set([
  "password",
  "passwd",
  "pwd",
  "otp",
  "mfa",
  "totp",
  "pin",
  "secret",
  "token",
  "access_token",
  "refresh_token",
  "id_token",
  "session",
  "cookie",
  "authorization",
  "credential",
  "credentials",
])

/** Flags the wrapper must never put on the Moli command line. */
export const FORBIDDEN_MOLI_FLAGS = [
  "--eval",
  "--eval-file",
  "--cookie-file",
  "--profile-dir",
  "--header",
  "-H",
  "-c",
  "-P",
  "--insecure-disable-tls-host-verification",
  "--document-start-script",
  "--document-start-script-file",
  "--http-proxy",
  "--web-bot-auth-key-file",
]

const LOCAL_HOSTS = new Set(["localhost", "localhost.localdomain"])

function hostnameOf(url) {
  return url.hostname.replace(/\.$/, "").toLowerCase()
}

function isIpLiteral(hostname) {
  if (hostname.includes(":")) return true
  return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)
}

export function isBlockedBankHost(hostname) {
  const host = hostname.replace(/\.$/, "").toLowerCase()
  if (BLOCKED_BANK_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
    return true
  }
  return host.split(".").some((label) => BLOCKED_HOST_LABELS.has(label))
}

function hasSensitiveParams(params) {
  for (const key of params.keys()) {
    if (SENSITIVE_QUERY_KEYS.has(key.toLowerCase())) return true
  }
  return false
}

function hasLoginPath(url) {
  const segments = url.pathname.split("/").filter(Boolean)
  return segments.some((segment) => LOGIN_PATH_SEGMENT.test(segment))
}

/**
 * @typedef {"markdown" | "semantic_tree_text" | "screenshot" | "screenshot_full"} DumpMode
 * @typedef {{ ok: true, url: URL, dump: DumpMode, layout: boolean, timeoutMs: number } | { ok: false, reason: string }} FetchDecision
 */

/**
 * @param {{ url?: string, dump?: string, layout?: boolean, timeoutMs?: number }} input
 * @returns {FetchDecision}
 */
export function decidePublicFetch(input) {
  const dump = input.dump ?? "markdown"
  if (!DUMP_MODES.includes(dump)) {
    return { ok: false, reason: `Unsupported dump "${dump}". Use ${DUMP_MODES.join(", ")}.` }
  }
  const layout = dump === "screenshot" || dump === "screenshot_full" ? true : Boolean(input.layout)
  const timeoutMs = input.timeoutMs ?? 25_000
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 120_000) {
    return { ok: false, reason: "Timeout must be an integer from 1000 to 120000 milliseconds." }
  }

  let url
  try {
    url = new URL(input.url ?? "")
  } catch {
    return { ok: false, reason: "URL could not be parsed. Pass an absolute https URL." }
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "Only https URLs are allowed." }
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with embedded credentials are refused." }
  }
  if (input.url.length > 2048) {
    return { ok: false, reason: "URL is longer than 2048 characters." }
  }

  const host = hostnameOf(url)
  if (!host || LOCAL_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".localhost") || host.endsWith(".internal")) {
    return { ok: false, reason: "Local and internal hosts are refused." }
  }
  if (isIpLiteral(host)) {
    return { ok: false, reason: "IP literals are refused. Use a public DNS name." }
  }
  if (isBlockedBankHost(host)) {
    return {
      ok: false,
      reason: `Refusing host ${host}. Bank and internet-banking sites are outside this wrapper.`,
    }
  }
  if (hasLoginPath(url)) {
    return { ok: false, reason: "Login, MFA, and internet-banking paths are refused." }
  }
  if (hasSensitiveParams(url.searchParams) || hasSensitiveParams(new URLSearchParams(url.hash.replace(/^#/, "")))) {
    return { ok: false, reason: "Refusing a URL that carries a credential, session, or one-time-code parameter." }
  }

  return { ok: true, url, dump, layout, timeoutMs }
}

export function moliFetchArgs(decision) {
  const args = ["fetch", "--dump", decision.dump, "--wait-until", "done", "--block-private-networks", "--timeout", String(decision.timeoutMs)]
  if (decision.layout) args.push("--layout")
  args.push(decision.url.href)
  assertPublicFetchArgs(args)
  return args
}

export function assertPublicFetchArgs(args) {
  for (const arg of args) {
    const forbidden = FORBIDDEN_MOLI_FLAGS.find((flag) => arg === flag || arg.startsWith(`${flag}=`))
    if (forbidden) throw new Error(`Refusing forbidden Moli option ${forbidden}.`)
  }
}

export function parseFetchArgs(argv, defaultUrl = DEFAULT_SAMPLE_URL) {
  let url = defaultUrl
  let dump = "markdown"
  let layout = false
  let timeoutMs = 25_000

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token === "--") continue
    if (token === "--help" || token === "-h") return { help: true }
    if (token === "--layout") {
      layout = true
      continue
    }
    if (token === "--url" || token === "--dump" || token === "--timeout") {
      const value = argv[index + 1]
      if (!value || value.startsWith("--")) return { error: `${token} needs a value.` }
      index += 1
      if (token === "--url") url = value
      else if (token === "--dump") dump = value
      else {
        const parsed = Number(value)
        if (!Number.isInteger(parsed)) return { error: "--timeout must be an integer millisecond value." }
        timeoutMs = parsed
      }
      continue
    }
    if (token.startsWith("-")) {
      return { error: `Unknown option ${token}. This wrapper does not forward Moli flags.` }
    }
    url = token
  }

  return { help: false, url, dump, layout, timeoutMs }
}

export function byteLimit(dump) {
  return dump === "screenshot" || dump === "screenshot_full" ? BINARY_BYTE_LIMIT : TEXT_BYTE_LIMIT
}

export function validateFetchBody(dump, body) {
  if (!body || body.length === 0) return { ok: false, reason: "Moli returned an empty body." }
  if (body.length > byteLimit(dump)) return { ok: false, reason: "Moli output exceeded the local size cap." }
  if (dump === "screenshot" || dump === "screenshot_full") {
    if (body.length < PNG_SIGNATURE.length) return { ok: false, reason: "Screenshot output is not a PNG." }
    for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
      if (body[index] !== PNG_SIGNATURE[index]) return { ok: false, reason: "Screenshot output is not a PNG." }
    }
  }
  return { ok: true }
}

function slug(value, fallback) {
  const cleaned = value
    .toLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return (cleaned || fallback).slice(0, 48).replace(/-+$/g, "")
}

export function artifactRelativePath(url, dump, now = new Date()) {
  const day = now.toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("Artifact date is not a UTC day.")
  const host = slug(url.hostname, "host")
  const pathSlug = slug(url.pathname, "index")
  const digest = createHash("sha256").update(url.href).digest("hex").slice(0, 8)
  const fullSuffix = dump === "screenshot_full" ? "-full" : ""
  const extension = dump === "markdown" ? "md" : dump === "semantic_tree_text" ? "txt" : "png"
  const relative = `artifacts/moli/${day}/${host}-${pathSlug}${fullSuffix}-${digest}.${extension}`
  if (!relative.startsWith("artifacts/moli/") || relative.includes("..")) {
    throw new Error("Artifact path escaped artifacts/moli.")
  }
  return relative
}

export function artifactMetaPath(relativePath) {
  return relativePath.replace(/\.(md|txt|png)$/, ".meta.json")
}

export function buildArtifactMeta({ sourceUrl, dump, layout, bytes, createdAt }) {
  return {
    policyVersion: POLICY_VERSION,
    sourceUrl,
    dump,
    layout,
    bytes,
    createdAt,
    note: "Public-page dump. No cookies or credentials are stored.",
  }
}

export const INSTALL_HELP = `Moli is not installed. This wrapper does not download it.

Linux or macOS:
  curl --proto '=https' --tlsv1.2 -fsSL \\
    https://github.com/lexmount/moli/releases/latest/download/moli-installer.sh | sh

Windows PowerShell:
  powershell -ExecutionPolicy ByPass -c "irm https://github.com/lexmount/moli/releases/latest/download/moli-installer.ps1 | iex"

Then run \`moli --version\`. The default binary is ~/.local/bin/moli on Linux and macOS,
and %LOCALAPPDATA%\\\\Moli\\\\bin\\\\moli.exe on Windows. Set MOLI_BIN if it lives elsewhere.
See docs/moli/README.md.`
