/** Quote numbering suggestions only. Issued invoice numbers are allocated by issue_invoice in PostgreSQL. */

/** Zero-pad a positive integer to at least three digits. 1 → "001", 1000 → "1000". */
function padCounter(n: number): string {
  return String(n).padStart(3, "0")
}

/**
 * Compute the next document number for a given prefix and year.
 *
 * Scans `existingNumbers` for entries matching `^{prefix}-{year}-(\d+)$`, takes the
 * highest counter, adds one, and zero-pads to three digits. Entries that don't match
 * the prefix/year shape (different prefix, different year, free-form text) are ignored.
 * When nothing matches, numbering starts at 1 → `PREFIX-YEAR-001`.
 *
 * @example nextDocumentNumber("QUO", [], 2026)               // "QUO-2026-001"
 */
export function nextDocumentNumber(
  prefix: string,
  existingNumbers: string[],
  year: number
): string {
  if (!prefix.trim() || !Number.isInteger(year) || year < 1 || year > 9999) {
    throw new Error("Invalid document series")
  }
  const escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const pattern = new RegExp(`^${escapedPrefix}-${year}-(\\d+)$`)

  let max = 0
  for (const raw of existingNumbers) {
    const match = pattern.exec(raw.trim())
    if (!match) continue
    const counter = Number(match[1])
    if (!Number.isSafeInteger(counter) || counter >= Number.MAX_SAFE_INTEGER) {
      throw new Error("Document counter exceeds safe bounds")
    }
    if (counter > max) max = counter
  }

  return `${prefix}-${year}-${padCounter(max + 1)}`
}


/** Draft labels never allocate an issued document number. */
export function invoiceDisplayNumber(invoice: { id: string; number: string; issued_snapshot_id: string | null }): string {
  return invoice.issued_snapshot_id ? invoice.number : `DRAFT-${invoice.id.slice(0, 8)}`
}

/** INV (operational), TX (full tax invoice) and ABB (abbreviated tax invoice) numbers are all assigned only by issuing. */
export function isIssuedInvoiceNumber(number: string): boolean {
  return /^(INV|TX|ABB)-[0-9]{4}-[0-9]+$/i.test(number.trim())
}

export const TAX_DOC_TYPES = ["TX", "ABB"] as const
export type TaxDocType = (typeof TAX_DOC_TYPES)[number]
