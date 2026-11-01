import type { LucideIcon } from "lucide-react"

import { NAV_ITEMS, showNavItem } from "@/components/nav"
import type { Role } from "@/lib/auth"
import { can, type Capability } from "@/lib/permissions"

export type PaletteCommand = { title: string; href: string; icon?: LucideIcon }

/** `gate` mirrors the check the matching create action enforces. */
const CREATE_COMMANDS: (PaletteCommand & { gate: Capability | readonly Role[] })[] = [
  { title: "New deal", href: "/deals/new", gate: "record:write" },
  { title: "New quote", href: "/quotes/new", gate: "record:write" },
  { title: "New invoice", href: "/finance/invoices/new", gate: "payment:verify" },
  { title: "New client", href: "/clients/new", gate: "record:write" },
  { title: "New project", href: "/projects/new", gate: "record:write" },
  { title: "New product", href: "/products/new", gate: "product:manage" },
  { title: "New purchase order", href: "/purchases/new", gate: "purchase:manage" },
  { title: "New vendor", href: "/vendors/new", gate: "purchase:manage" },
]

/** Go to every nav module the sidebar shows this role, and the creates the role may run. */
export function paletteCommands(role: Role) {
  return {
    goTo: NAV_ITEMS.filter((item) => showNavItem(role, item)).map(
      ({ title, href, icon }): PaletteCommand => ({ title, href, icon })
    ),
    create: CREATE_COMMANDS.filter(({ gate }) =>
      typeof gate === "string" ? can(role, gate) : gate.includes(role)
    ).map(({ title, href }): PaletteCommand => ({ title, href })),
  }
}
