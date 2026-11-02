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
  Building2,
  Rocket,
  UserRound,
  Boxes,
  Bot,
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
  /** Thai label shown beside the English title (FlowAccount wording). */
  th?: string
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
  { title: "Dashboard", th: "แดชบอร์ด", group: "sell", href: "/dashboard", icon: LayoutDashboard },
  { title: "Clients", th: "ลูกค้า", group: "sell", href: "/clients", icon: Users },
  { title: "Deals", th: "ดีล", group: "sell", href: "/deals", icon: Handshake },
  { title: "Inventory", th: "สินค้าคงคลัง", group: "operate", href: "/inventory", icon: Package },
  { title: "Purchases", th: "ซื้อ", group: "operate", href: "/purchases", icon: Receipt },
  { title: "Vendors", th: "ผู้ขาย", group: "operate", href: "/vendors", icon: Users },
  { title: "Quotes", th: "ใบเสนอราคา", group: "sell", href: "/quotes", icon: FileText },
  { title: "Projects", th: "โปรเจกต์", group: "operate", href: "/projects", icon: FolderKanban },
  { title: "Timesheets", th: "บันทึกเวลา", group: "operate", href: "/timesheets", icon: Clock },
  { title: "Finance", th: "ใบแจ้งหนี้ / ใบเสร็จ", group: "money", href: "/finance", icon: Receipt },
  { title: "Expenses", th: "ค่าใช้จ่าย", group: "money", href: "/expenses", icon: Wallet },
  { title: "Reports", th: "รายงาน", group: "money", href: "/reports", icon: BarChart3 },
  { title: "Calendar", th: "ปฏิทิน", group: "operate", href: "/calendar", icon: CalendarDays },
  { title: "Templates", th: "แม่แบบ", group: "workspace", href: "/templates", icon: Sparkles },
  { title: "ERP AI", th: "แชท AI องค์กร", group: "workspace", href: "/assistant", icon: Bot },
  { title: "Intake", th: "รับงาน", group: "workspace", href: "/intake", icon: NotebookPen },
  { title: "Automation", th: "อัตโนมัติ", group: "workspace", href: "/automation", icon: Workflow },
  { title: "Activity", th: "กิจกรรม", group: "workspace", href: "/audit", icon: ScrollText, ownerAdminOnly: true },
  { title: "Organization", th: "องค์กร", group: "workspace", href: "/warehouse", icon: Boxes },
  { title: "Blueprint", th: "บลูพริ้นท์", group: "workspace", href: "/blueprint", icon: Compass },
  { title: "Settings", th: "ตั้งค่า", group: "workspace", href: "/settings", icon: Settings },
  { title: "Products", th: "สินค้า", group: "operate", href: "/products", icon: Package },
]

/** Operator-mode glyphs (login, mode tip). The switch itself stays text-only. */
export const MODE_ICON: Record<"sme" | "startup" | "individual", LucideIcon> = {
  sme: Building2,
  startup: Rocket,
  individual: UserRound,
}
