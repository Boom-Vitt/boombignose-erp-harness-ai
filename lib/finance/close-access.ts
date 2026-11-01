/**
 * Owners, admins, and an accountant can review cash at close and the
 * outstanding pack. The accountant role is added in separate work. Until
 * that migration is applied, nobody has the role. Members cannot.
 */
export function canReviewFinanceClose(role: string): boolean {
  return role === "owner" || role === "admin" || role === "accountant"
}
