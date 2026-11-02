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

export type NavGroup = "sell" | "operate" | "money" | "workspace"

/** Sidebar sections, in order. Titles are bilingual so Thai operators scan the same rail. */
export const NAV_GROUPS: { id: NavGroup; label: string }[] = [
  { id: "sell", label: "ขาย / Sell" },
  { id: "operate", label: "ปฏิบัติการ / Operate" },
  { id: "money", label: "การเงิน / Money" },
  { id: "workspace", label: "พื้นที่ทำงาน / Workspace" },
]

export type NavItem = {
  title: string
  group: NavGroup
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
  { title: "Dashboard", group: "sell", href: "/dashboard", icon: LayoutDashboard },
  { title: "Clients", group: "sell", href: "/clients", icon: Users },
  { title: "Deals", group: "sell", href: "/deals", icon: Handshake },
  { title: "Inventory", group: "operate", href: "/inventory", icon: Package },
  { title: "Purchases", group: "operate", href: "/purchases", icon: Receipt },
  { title: "Vendors", group: "operate", href: "/vendors", icon: Users },
  { title: "Quotes", group: "sell", href: "/quotes", icon: FileText },
  { title: "Projects", group: "operate", href: "/projects", icon: FolderKanban },
  { title: "Timesheets", group: "operate", href: "/timesheets", icon: Clock },
  { title: "Finance", group: "money", href: "/finance", icon: Receipt },
  { title: "Expenses", group: "money", href: "/expenses", icon: Wallet },
  { title: "Reports", group: "money", href: "/reports", icon: BarChart3 },
  { title: "Calendar", group: "operate", href: "/calendar", icon: CalendarDays },
  { title: "Templates", group: "workspace", href: "/templates", icon: Sparkles },
  { title: "Intake", group: "workspace", href: "/intake", icon: NotebookPen },
  { title: "Automation", group: "workspace", href: "/automation", icon: Workflow },
  { title: "Activity", group: "workspace", href: "/audit", icon: ScrollText, ownerAdminOnly: true },
  { title: "Blueprint", group: "workspace", href: "/blueprint", icon: Compass },
  { title: "Settings", group: "workspace", href: "/settings", icon: Settings },
  { title: "Products", group: "operate", href: "/products", icon: Package },
]
