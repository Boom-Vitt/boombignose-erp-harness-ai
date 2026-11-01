/**
 * Tiny, dependency-free CSV writer (RFC 4180).
 *
 * Pure string in / string out — no DB, no money math. Route handlers convert
 * satang → baht (numbers) BEFORE handing rows here; this module never formats
 * currency, so numeric columns stay machine-parseable in Excel/Sheets.
 *
 *  - Records are separated by CRLF, the RFC-4180 terminator Excel expects.
 *  - A field is quoted only if it contains `,`, `"`, CR, or LF.
 *  - Internal `"` is escaped by doubling it.
 *  - A UTF-8 BOM is prepended once so Excel detects UTF-8 and renders Thai.
 *  - CSV-injection defense: a string cell starting with `= + - @` (or TAB/CR) is
 *    prefixed with a single quote so Excel/Sheets treat it as text, not a formula.
 */

/** UTF-8 byte order mark. Prepended once at the very start of the output. */
export const BOM = "﻿"

const RECORD_SEP = "\r\n"

/**
 * Leading characters that make Excel/Google Sheets evaluate a cell as a formula.
 * Client-controlled text (client names, deal titles, cost notes) flows into
 * exports, so an unguarded `=HYPERLINK(...)`/`=cmd|...` would execute on open.
 */
const FORMULA_TRIGGERS = new Set(["=", "+", "-", "@", "\t", "\r"])

/** True when a field must be wrapped in double quotes per RFC 4180. */
function needsQuoting(field: string): boolean {
  return (
    field.includes(",") ||
    field.includes('"') ||
    field.includes("\n") ||
    field.includes("\r")
  )
}

/**
 * Escape one cell: null/undefined → ""; numbers pass through raw (money stays
 * machine-parseable); strings get CSV-injection-guarded, then RFC-4180 quoted.
 */
function escapeField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "number") return String(value)

  // Neutralize formula-injection: force text with a leading apostrophe. Quoting
  // alone is NOT enough — Excel strips the quotes and still evaluates a `=`.
  // A plain negative number such as -7.01 is money, not a formula.
  let s = value
  if (s.length > 0 && FORMULA_TRIGGERS.has(s[0]!) && !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(s)) {
    s = `'${s}`
  }

  if (!needsQuoting(s)) return s
  return `"${s.replace(/"/g, '""')}"`
}

/**
 * Build a CSV document from a header row and data rows.
 * @param headers column titles
 * @param rows    matrix of cells; money columns should already be baht numbers
 */
export function toCsv(
  headers: string[],
  rows: (string | number | null | undefined)[][]
): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeField).join(","))
  return BOM + lines.join(RECORD_SEP)
}
