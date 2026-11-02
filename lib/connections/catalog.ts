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
      th: "MCP แบบอ่านอย่างเดียว ให้ AI ดูข้อมูล ERP",
      en: "Read-only MCP so an AI can view ERP data.",
    },
    href: "/assistant#assistant-mcp",
    cta: { th: "เปิดแผง MCP", en: "Open MCP panel" },
  },
  {
    id: "local-ai",
    name: "Local AI / Ollama",
    category: "productivity",
    description: {
      th: "โมเดล AI บนเครื่องนี้ ข้อมูลไม่ออกนอกเครื่อง",
      en: "AI models on this computer. Data stays here.",
    },
    href: "/settings#local-models",
    cta: { th: "จัดการโมเดล", en: "Manage models" },
  },
  {
    id: "flowaccount",
    name: "FlowAccount",
    category: "finance",
    description: {
      th: "ส่งออกใบแจ้งหนี้ไป FlowAccount ไม่ใช่การยื่นภาษี",
      en: "Export invoices to FlowAccount. Not a tax filing.",
    },
    href: "/settings/accounting",
  },
  ...(
    [
      ["gmail", "Gmail", "communication", { th: "อ่านและร่างอีเมลใน ERP", en: "Read and draft email in ERP." }],
      ["slack", "Slack", "communication", { th: "ส่งแจ้งเตือนเข้า Slack", en: "Send alerts to Slack." }],
      ["google-drive", "Google Drive", "productivity", { th: "แนบไฟล์จาก Drive", en: "Attach Drive files." }],
      ["notion", "Notion", "productivity", { th: "ซิงก์โน้ตกับ Notion", en: "Sync notes with Notion." }],
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
