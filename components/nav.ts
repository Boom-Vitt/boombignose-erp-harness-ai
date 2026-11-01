import {
  LayoutDashboard,
  Users,
  Handshake,
  FileText,
  FolderKanban,
  Clock,
  Receipt,
  BarChart3,
  CalendarDays,
  Sparkles,
  NotebookPen,
  Workflow,
  ScrollText,
  Settings,
  Compass,
  type LucideIcon,
  Package,
  Wallet,
} from "lucide-react"

export type NavItem = {
  title: string
  href: string
  icon: LucideIcon
  /** Hide from staff members. Accountants still see the audit log. */
  ownerAdminOnly?: boolean
}

/** Sidebar and command palette share this. Staff members do not see owner/admin items. */
export function showNavItem(role: string, item: NavItem): boolean {
  if (!item.ownerAdminOnly) return true
  if (role === "owner" || role === "admin") return true
  return item.href === "/audit" && role === "accountant"
}

/**
 * Single source of truth for the app's primary navigation and routes.
 * Every module route is registered here so the sidebar stays in sync.
 */
export const NAV_ITEMS: NavItem[] = [
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { title: "Clients", href: "/clients", icon: Users },
  { title: "Deals", href: "/deals", icon: Handshake },
  { title: "Inventory", href: "/inventory", icon: Package },
  { title: "Purchases", href: "/purchases", icon: Receipt },
  { title: "Vendors", href: "/vendors", icon: Users },
  { title: "Quotes", href: "/quotes", icon: FileText },
  { title: "Projects", href: "/projects", icon: FolderKanban },
  { title: "Timesheets", href: "/timesheets", icon: Clock },
  { title: "Finance", href: "/finance", icon: Receipt },
  { title: "Expenses", href: "/expenses", icon: Wallet },
  { title: "Reports", href: "/reports", icon: BarChart3 },
  { title: "Calendar", href: "/calendar", icon: CalendarDays },
  { title: "Templates", href: "/templates", icon: Sparkles },
  { title: "Intake", href: "/intake", icon: NotebookPen },
  { title: "Automation", href: "/automation", icon: Workflow },
  { title: "Activity", href: "/audit", icon: ScrollText, ownerAdminOnly: true },
  { title: "Blueprint", href: "/blueprint", icon: Compass },
  { title: "Settings", href: "/settings", icon: Settings },
  { title: "Products", href: "/products", icon: Package },
]
