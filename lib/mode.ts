export const MODES = ["sme", "startup", "individual"] as const
export type Mode = (typeof MODES)[number]
export const DEFAULT_MODE: Mode = "sme"
export const MODE_KEY = "bbn-mode"

export const MODE_COPY: Record<Mode, { th: string; en: string; tipTh: string; tipEn: string; first: string[] }> = {
  sme: {
    th: "ธุรกิจ SME",
    en: "SMEs",
    tipTh: "เริ่มจากใบเสนอราคา ใบแจ้งหนี้ และการซื้อ",
    tipEn: "Start with quotes, invoices and purchases.",
    first: ["/dashboard", "/quotes", "/purchases", "/inventory", "/finance", "/warehouse"],
  },
  startup: {
    th: "สตาร์ทอัป",
    en: "Startup",
    tipTh: "เริ่มจากดีล โปรเจกต์ และรายงานการเติบโต",
    tipEn: "Start with deals, projects and growth reports.",
    first: ["/dashboard", "/deals", "/projects", "/reports", "/automation", "/warehouse"],
  },
  individual: {
    th: "บุคคลธรรมดา",
    en: "Individual",
    tipTh: "เริ่มจากไทม์ชีต ค่าใช้จ่าย และใบแจ้งหนี้ฟรีแลนซ์",
    tipEn: "Start with timesheets, expenses and freelance invoices.",
    first: ["/dashboard", "/intake", "/timesheets", "/expenses", "/clients", "/finance", "/warehouse"],
  },
}

export function parseMode(raw: unknown): Mode {
  return MODES.includes(raw as Mode) ? (raw as Mode) : DEFAULT_MODE
}

/** Stable sort: the mode's starter pages first, everything else keeps its order. */
export function orderForMode<T extends { href: string }>(items: T[], mode: Mode): T[] {
  const first = MODE_COPY[mode].first
  const rank = (href: string) => {
    const i = first.indexOf(href)
    return i === -1 ? first.length : i
  }
  return items.map((item, i) => ({ item, i })).sort((a, b) => rank(a.item.href) - rank(b.item.href) || a.i - b.i).map((x) => x.item)
}
