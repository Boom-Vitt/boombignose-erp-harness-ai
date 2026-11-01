/**
 * Owners, admins, and an accountant can review cash at close and the
 * outstanding pack. The accountant role is included with this desktop
 * build. Members cannot.
 */
export function canReviewFinanceClose(role: string): boolean {
  return role === "owner" || role === "admin" || role === "accountant"
}
