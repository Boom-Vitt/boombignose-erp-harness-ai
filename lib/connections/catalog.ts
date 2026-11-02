// Pure data + helpers for the in-app «เชื่อมต่อแอป» catalog. No I/O: probes are passed in.

export type Locale = "th" | "en"
export type Text = { th: string; en: string }
export type Category = "erp" | "productivity" | "communication" | "finance"
export type Status = "connected" | "available" | "coming-soon"

export type Entry = {
  id: string
  name: string
  category: Category
  description: Text
  /** Internal route for the Connect button. Absent = nothing to connect yet. */
  href?: string
  /** Shown instead of the generic CTA when it needs a different verb. */
  cta?: Text
}

/** Live facts gathered on the server. Anything unprobed stays false and reads as "available". */
export type Probes = { erpMcp: boolean; ollama: boolean; flowaccount: "connected" | "available" | "unavailable" }

export const LOCALE_KEY = "bbn-locale"

export const parseLocale = (v: unknown): Locale | null => (v === "th" || v === "en" ? v : null)
export const pick = (text: Text, locale: Locale): string => text[locale]

export const CATEGORIES: { id: Category; label: Text }[] = [
  { id: "erp", label: { th: "ERP / MCP", en: "ERP / MCP" } },
  { id: "productivity", label: { th: "เครื่องมือทำงาน", en: "Productivity" } },
  { id: "communication", label: { th: "การสื่อสาร", en: "Communication" } },
  { id: "finance", label: { th: "การเงินและบัญชี", en: "Finance adapters" } },
]

export const CATALOG: Entry[] = [
  {
    id: "erp-mcp",
    name: "BoomBigNose ERP MCP",
    category: "erp",
    description: {
      th: "เซิร์ฟเวอร์ MCP แบบอ่านอย่างเดียวในเครื่อง ให้ผู้ช่วย AI ดูข้อมูล ERP ของคุณ",
      en: "A read-only MCP server on this computer so an AI assistant can look at your ERP data.",
    },
    href: "/assistant#assistant-mcp",
    cta: { th: "เปิดแผง MCP", en: "Open MCP panel" },
  },
  {
    id: "local-ai",
    name: "Local AI / Ollama",
    category: "productivity",
    description: {
      th: "โมเดล AI ที่รันบนเครื่องนี้เท่านั้น ข้อมูลไม่ออกนอกเครื่อง",
      en: "AI models that run only on this computer. Your data stays here.",
    },
    href: "/settings#local-models",
    cta: { th: "จัดการโมเดล", en: "Manage models" },
  },
  {
    id: "flowaccount",
    name: "FlowAccount",
    category: "finance",
    description: {
      th: "ส่งออกใบแจ้งหนี้ที่ออกแล้วไป FlowAccount ไม่ยื่นภาษีและไม่แทนนักบัญชี",
      en: "Export issued invoices to FlowAccount. It does not file tax or replace an accountant.",
    },
    href: "/settings/accounting",
  },
  ...(
    [
      ["gmail", "Gmail", "communication", { th: "อ่านและร่างอีเมลจากใน ERP", en: "Read and draft email from inside the ERP." }],
      ["slack", "Slack", "communication", { th: "ส่งการแจ้งเตือนเข้าช่อง Slack", en: "Send notifications to a Slack channel." }],
      ["google-drive", "Google Drive", "productivity", { th: "แนบไฟล์จาก Drive เข้ากับเอกสาร", en: "Attach Drive files to documents." }],
      ["notion", "Notion", "productivity", { th: "ซิงก์บันทึกและโน้ตกับ Notion", en: "Sync notes and pages with Notion." }],
    ] as [string, string, Category, Text][]
  ).map(([id, name, category, description]): Entry => ({ id, name, category, description })),
]

export function statusOf(entry: Entry, probes: Probes): Status {
  switch (entry.id) {
    case "erp-mcp":
      return probes.erpMcp ? "connected" : "available"
    case "local-ai":
      return probes.ollama ? "connected" : "available"
    case "flowaccount":
      // Community builds have no accounting module (the route 404s), so it is not offered there.
      return probes.flowaccount === "unavailable" ? "coming-soon" : probes.flowaccount
    default:
      return "coming-soon"
  }
}

export const STATUS_LABEL: Record<Status, Text> = {
  connected: { th: "เชื่อมแล้ว", en: "Connected" },
  available: { th: "พร้อมเชื่อมต่อ", en: "Available" },
  "coming-soon": { th: "ยังไม่พร้อม", en: "Coming soon" },
}

const norm = (s: string) => s.trim().toLocaleLowerCase()

/** Search matches name or either-language description, so Thai and English queries both work. */
export function filterEntries(entries: Entry[], query: string, category: Category | "all"): Entry[] {
  const q = norm(query)
  return entries.filter(
    (e) =>
      (category === "all" || e.category === category) &&
      (!q || [e.name, e.description.th, e.description.en].some((s) => norm(s).includes(q))),
  )
}
