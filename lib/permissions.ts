import type { Role } from "@/lib/auth"
import sharedCapabilityRoles from "@/boombignose/internal/erpwire/capabilities.json"

/**
 * Capability-based RBAC. Instead of scattering `["owner","admin"]` role lists
 * across actions, each sensitive operation maps to a named Capability, and this
 * matrix is shared with the Go server. Tune access in
 * boombignose/internal/erpwire/capabilities.json — no need to touch call sites.
 *
 * RLS still enforces org isolation at the database; capabilities are the
 * defense-in-depth layer for *which member* may perform an action.
 */
export type Capability = keyof typeof sharedCapabilityRoles

/**
 * Which roles hold each capability. Owner and admin share workspace management.
 * An accountant records invoices, receipts, and credit notes and can read
 * profit and the audit log. A member is staff who can write records and cannot
 * change finance. Receipt reversal stays with owner and admin (`invoice:delete`).
 */
export const CAPABILITY_ROLES = sharedCapabilityRoles as Record<Capability, Role[]>

/** True when `role` holds `capability`. */
export function can(role: Role, capability: Capability): boolean {
  return CAPABILITY_ROLES[capability].includes(role)
}

/** All capabilities a role holds (handy for shaping UI affordances). */
export function capabilitiesFor(role: Role): Capability[] {
  return (Object.keys(CAPABILITY_ROLES) as Capability[]).filter((c) =>
    can(role, c)
  )
}
