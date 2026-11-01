/**
 * Optional typed public references for quotes, purchase orders, goods receipts,
 * deliveries, and invoices.
 *
 * This is a thin wrapper around the public idea proposed by @PerchAnton in
 * GitHub issue #34 and implemented by RefMint
 * (https://github.com/PerchAnton/refmint, MIT OR Apache-2.0). The cited
 * release, v0.1.0-alpha.1, is a GitHub package archive rather than a registry
 * release, and RefMint documents that the alpha format may change. This
 * repository therefore does not depend on that package. The checksum is the
 * standard Bech32m construction from BIP-350, written here independently.
 * RefMint source is not copied. See NOTICE and CONTRIBUTORS.md.
 *
 * A reference is `prefix + "1" + payload + 6 checksum characters`. The prefix
 * names the document type so a purchase-order code is not a customer quote or
 * a delivery. The checksum detects typos. It is not an access secret, a tax
 * ID, or an accounting sequence.
 *
 * Payload length is frozen at 14 characters (70 bits). That is the shortest
 * length whose pairwise union bound for 1,000,000 codes in one namespace is
 * below 1e-9. Do not recompute it from the current row count.
 */

export const PUBLIC_REFERENCE_RANDOM_LENGTH = 14
export const PUBLIC_REFERENCE_CHECKSUM_LENGTH = 6
export const PUBLIC_REFERENCE_EXPECTED_COUNT = 1_000_000
export const PUBLIC_REFERENCE_MAX_COLLISION_PROBABILITY = 1e-9
const MAX_INPUT_LENGTH = 128
const MAX_ISSUE_ATTEMPTS = 5

const ALPHABET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3]
const BECH32M_CONST = 0x2bc830a3

export const DOCUMENT_KINDS = ["quote", "purchase_order", "receipt", "delivery", "invoice"] as const
export type DocumentKind = (typeof DOCUMENT_KINDS)[number]

/** Frozen prefixes. Changing one changes which codes this workspace accepts. */
export const DOCUMENT_PREFIX: Record<DocumentKind, string> = {
  quote: "quo",
  purchase_order: "po",
  receipt: "grn",
  delivery: "dlv",
  invoice: "inv",
}

const PREFIX_KIND = Object.fromEntries(
  DOCUMENT_KINDS.map((kind) => [DOCUMENT_PREFIX[kind], kind])
) as Record<string, DocumentKind>

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  quote: "Customer quote",
  purchase_order: "Purchase order",
  receipt: "Goods receipt",
  delivery: "Delivery",
  invoice: "Invoice",
}

export type ParseError =
  | "type"
  | "too_long"
  | "format"
  | "case"
  | "character"
  | "checksum"
  | "prefix"
  | "length"
  | "non_canonical"

export type ParsedPublicReference = {
  ok: true
  kind: DocumentKind
  canonical: string
  display: string
  normalized: boolean
}

export type ParseResult = ParsedPublicReference | { ok: false; error: ParseError }

export type DocumentIdentity = {
  number: string
  taxId: string | null
  links: Readonly<Record<string, string | null>>
}

export type IssuePlan =
  | { status: "disabled" }
  | { status: "invalid_stored" }
  | { status: "reuse"; canonical: string; display: string }
  | { status: "insert"; canonical: string; display: string }
  | { status: "exhausted" }

export type ResolveResult =
  | { ok: true; kind: DocumentKind; recordId: string; canonical: string; display: string; href: string }
  | { ok: false; error: ParseError | "disabled" | "not_found" | "mismatch" }

const PREFIX_PATTERN = /^[a-z][a-z0-9]{0,15}$/

function polymod(values: number[]): number {
  let chk = 1
  for (const value of values) {
    const top = chk >> 25
    chk = ((chk & 0x1ffffff) << 5) ^ value
    for (let i = 0; i < 5; i++) {
      if ((top >> i) & 1) chk ^= GENERATOR[i]!
    }
  }
  return chk
}

function hrpExpand(hrp: string): number[] {
  const expanded: number[] = []
  for (const char of hrp) expanded.push(char.charCodeAt(0) >> 5)
  expanded.push(0)
  for (const char of hrp) expanded.push(char.charCodeAt(0) & 31)
  return expanded
}

function checksumSymbols(hrp: string, data: number[]): number[] {
  const mod = polymod(hrpExpand(hrp).concat(data, [0, 0, 0, 0, 0, 0])) ^ BECH32M_CONST
  const symbols: number[] = []
  for (let i = 0; i < PUBLIC_REFERENCE_CHECKSUM_LENGTH; i++) {
    symbols.push((mod >> (5 * (5 - i))) & 31)
  }
  return symbols
}

function alphabetIndex(symbol: string): number {
  return ALPHABET.indexOf(symbol)
}

/** True when `input` is a valid generic Bech32m string. Not a document reference check. */
export function bech32mValid(input: string): boolean {
  if (typeof input !== "string" || input.length < 8 || input.length > 90) return false
  if (/[^\x00-\x7f]/.test(input)) return false
  const mixed = input !== input.toLowerCase() && input !== input.toUpperCase()
  if (mixed) return false
  const text = input.toLowerCase()
  const separator = text.lastIndexOf("1")
  if (separator < 1) return false
  const hrp = text.slice(0, separator)
  const body = text.slice(separator + 1)
  if (hrp.length < 1 || hrp.length > 83 || body.length < 6) return false
  const values: number[] = []
  for (const symbol of body) {
    const index = alphabetIndex(symbol)
    if (index < 0) return false
    values.push(index)
  }
  return polymod(hrpExpand(hrp).concat(values)) === BECH32M_CONST
}

function groupBody(body: string): string {
  return body.match(/.{1,4}/g)?.join("-") ?? body
}

function encode(prefix: string, words: number[]): string {
  if (words.some((word) => !Number.isInteger(word) || word < 0 || word > 31)) {
    throw new RangeError("Reference symbols must be integers from 0 to 31")
  }
  const symbols = words.concat(checksumSymbols(prefix, words))
  return prefix + "1" + symbols.map((word) => ALPHABET[word]).join("")
}

/** Checksummed lowercase code for a prefix. Used to lock length checks; not a general encoder. */
export function checksummedReference(prefix: string, words: number[]): string {
  return encode(prefix, words)
}

function secureRandom(length: number): Uint8Array {
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Public references require crypto.getRandomValues")
  }
  return globalThis.crypto.getRandomValues(new Uint8Array(length))
}

/** Generate one canonical reference. `randomBytes` is for tests; production uses Web Crypto. */
export function generatePublicReference(
  kind: DocumentKind,
  randomBytes: (length: number) => Uint8Array = secureRandom
): { canonical: string; display: string } {
  const bytes = randomBytes(PUBLIC_REFERENCE_RANDOM_LENGTH)
  if (bytes.length !== PUBLIC_REFERENCE_RANDOM_LENGTH) {
    throw new Error("Public reference randomness has the wrong length")
  }
  const words = Array.from(bytes, (byte) => byte & 31)
  const canonical = encode(DOCUMENT_PREFIX[kind], words)
  return { canonical, display: formatPublicReference(canonical) }
}

/**
 * Parse a typed public reference.
 * `canonical: true` accepts only the exact lowercase storage string.
 */
export function parsePublicReference(input: unknown, options?: { canonical?: boolean }): ParseResult {
  if (typeof input !== "string") return { ok: false, error: "type" }
  if (input.length > MAX_INPUT_LENGTH) return { ok: false, error: "too_long" }
  if (/[^\x00-\x7f]/.test(input)) return { ok: false, error: "character" }
  const trimmed = input.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "")
  if (trimmed !== trimmed.toLowerCase() && trimmed !== trimmed.toUpperCase()) {
    return { ok: false, error: "case" }
  }
  const lowered = trimmed.toLowerCase()
  const separator = lowered.lastIndexOf("1")
  const prefix = separator > 0 ? lowered.slice(0, separator) : ""
  if (!PREFIX_PATTERN.test(prefix)) return { ok: false, error: "format" }
  let body = lowered.slice(separator + 1)
  if (body.includes("-")) {
    const groups = body.split("-")
    const grouped = groups.every((group, index) =>
      index < groups.length - 1 ? group.length === 4 : group.length >= 1 && group.length <= 4
    )
    if (!grouped || groups.length === 0) return { ok: false, error: "format" }
    body = groups.join("")
  }
  if (body.length === 0 || Array.from(body).some((symbol) => alphabetIndex(symbol) < 0)) {
    return { ok: false, error: "character" }
  }
  const values = Array.from(body, (symbol) => alphabetIndex(symbol))
  if (values.length < PUBLIC_REFERENCE_CHECKSUM_LENGTH || polymod(hrpExpand(prefix).concat(values)) !== BECH32M_CONST) {
    return { ok: false, error: "checksum" }
  }
  const kind = PREFIX_KIND[prefix]
  if (!kind) return { ok: false, error: "prefix" }
  const payloadLength = values.length - PUBLIC_REFERENCE_CHECKSUM_LENGTH
  if (payloadLength !== PUBLIC_REFERENCE_RANDOM_LENGTH) return { ok: false, error: "length" }
  const canonical = prefix + "1" + body
  if (options?.canonical && canonical !== input) return { ok: false, error: "non_canonical" }
  return {
    ok: true,
    kind,
    canonical,
    display: prefix + "1" + groupBody(body),
    normalized: canonical !== input,
  }
}

export function formatPublicReference(canonical: string): string {
  const parsed = parsePublicReference(canonical, { canonical: true })
  if (!parsed.ok) throw new TypeError(`Cannot format public reference: ${parsed.error}`)
  return parsed.display
}

/** True when `input` is a typed public reference. An optional kind must match the prefix. */
export function validatePublicReference(input: unknown, kind?: DocumentKind): boolean {
  const parsed = parsePublicReference(input)
  return parsed.ok && (kind === undefined || parsed.kind === kind)
}

export function documentHref(kind: DocumentKind, recordId: string): string {
  switch (kind) {
    case "quote":
      return `/quotes/${recordId}`
    case "purchase_order":
      return `/purchases/${recordId}`
    case "invoice":
      return `/finance/invoices/${recordId}`
    case "receipt":
    case "delivery":
      return `/inventory/documents/${recordId}/print`
  }
}

/**
 * Decide whether to issue a reference. Does not read or write document numbers,
 * tax IDs, or links. `mint` is not called when the feature is off or a valid
 * reference is already stored.
 */
export function planPublicReferenceIssue(input: {
  enabled: boolean
  existingCanonical: string | null
  kind: DocumentKind
  mint: () => { canonical: string; display: string } | null
}): IssuePlan {
  if (!input.enabled) return { status: "disabled" }
  if (input.existingCanonical) {
    const stored = parsePublicReference(input.existingCanonical, { canonical: true })
    if (!stored.ok || stored.kind !== input.kind) return { status: "invalid_stored" }
    return { status: "reuse", canonical: stored.canonical, display: stored.display }
  }
  const minted = input.mint()
  if (!minted) return { status: "exhausted" }
  return { status: "insert", canonical: minted.canonical, display: minted.display }
}

/** Mint a code whose canonical form is not already taken. Returns null after a few collisions. */
export function mintPublicReference(
  kind: DocumentKind,
  isTaken: (canonical: string) => boolean = () => false,
  randomBytes?: (length: number) => Uint8Array
): { canonical: string; display: string } | null {
  for (let attempt = 0; attempt < MAX_ISSUE_ATTEMPTS; attempt++) {
    const minted = generatePublicReference(kind, randomBytes)
    if (!isTaken(minted.canonical)) return minted
  }
  return null
}

/**
 * Resolve a pasted code. `lookup` runs only after the checksum and prefix
 * validate, and never when the feature is off.
 */
export function resolvePublicReference(
  input: unknown,
  enabled: boolean,
  lookup: (canonical: string) => { kind: DocumentKind; recordId: string } | null
): ResolveResult {
  if (!enabled) return { ok: false, error: "disabled" }
  const parsed = parsePublicReference(input)
  if (!parsed.ok) return parsed
  const found = lookup(parsed.canonical)
  if (!found) return { ok: false, error: "not_found" }
  if (found.kind !== parsed.kind) return { ok: false, error: "mismatch" }
  return {
    ok: true,
    kind: parsed.kind,
    recordId: found.recordId,
    canonical: parsed.canonical,
    display: parsed.display,
    href: documentHref(parsed.kind, found.recordId),
  }
}

/** Copy a document identity and attach a display reference without changing the original fields. */
export function attachPublicReference<T extends DocumentIdentity>(
  document: T,
  display: string
): T & { publicReference: string } {
  return { ...document, publicReference: display }
}

/** Exact integer union bound n(n-1)/2 / 32^length, used to lock the frozen payload length. */
export function collisionUpperBound(randomLength: number, count: number): number {
  const pairs = BigInt(count) * BigInt(count - 1) / BigInt(2)
  let space = BigInt(1)
  for (let i = 0; i < randomLength; i++) space *= BigInt(32)
  const whole = pairs / space
  if (whole >= BigInt(1)) return 1
  const remainder = pairs % space
  return Number(whole) + Number(remainder) / Number(space)
}
