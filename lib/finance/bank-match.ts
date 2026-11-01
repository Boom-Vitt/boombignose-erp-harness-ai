import { moneyInput } from "@/lib/payments/input"

/** Signed THB for a bank-statement line. Money in is positive. */
export function bankAmountSatang(value: string): number {
  const trimmed = value.trim()
  const negative = trimmed.startsWith("-")
  const amount = moneyInput(negative ? trimmed.slice(1) : trimmed)
  if (amount === 0) throw new Error("Enter a non-zero THB amount")
  return negative ? -amount : amount
}

export type BankCandidate = {
  id: string
  amountSatang: number
  reference: string | null
  verified: boolean
  reversal: boolean
}

/**
 * Verified receipts with the same amount and the same reference that are not
 * already taken by another statement line. Reversals are not candidates.
 */
export function matchingReceipts(line: { amountSatang: number; reference: string }, payments: readonly BankCandidate[], taken: ReadonlySet<string>): BankCandidate[] {
  const reference = line.reference.trim()
  if (!reference || !Number.isSafeInteger(line.amountSatang) || line.amountSatang === 0) return []
  return payments.filter(payment => payment.verified && !payment.reversal && !taken.has(payment.id) && payment.amountSatang === line.amountSatang && (payment.reference ?? "").trim() === reference)
}

/**
 * One verified receipt with the same amount and the same reference.
 * Two matches are left unmatched rather than guessed.
 */
export function suggestBankMatch(line: { amountSatang: number; reference: string }, payments: readonly BankCandidate[], taken: ReadonlySet<string>): string | null {
  const hits = matchingReceipts(line, payments, taken)
  return hits.length === 1 ? hits[0]!.id : null
}
