// `startup` is the existing persisted Organization profile key. It is not an entity type.
export const MODES = ["sme", "startup", "individual"] as const
export type Mode = (typeof MODES)[number]
export const DEFAULT_MODE: Mode = "sme"
export const MODE_KEY = "bbn-mode"

type StarterTask = { href: string; th: string; en: string }
type ModeProfile = { th: string; en: string; tipTh: string; tipEn: string; first: string[]; tasks: StarterTask[] }

export const MODE_COPY: Record<Mode, ModeProfile> = {
  individual: {
    th: "งานส่วนตัว", en: "Individual",
    tipTh: "งานส่วนตัวและฟรีแลนซ์: รับงาน บันทึกเวลา และติดตามเงินรับ",
    tipEn: "Personal and freelance work: capture work, track time and get paid.",
    first: ["/dashboard", "/intake", "/projects", "/timesheets", "/clients", "/finance", "/expenses", "/documents/ocr", "/assistant"],
    tasks: [
      { href: "/intake", th: "รับบรีฟงาน", en: "Capture a work brief" },
      { href: "/timesheets", th: "บันทึกเวลางาน", en: "Log freelance time" },
      { href: "/finance", th: "ติดตามใบแจ้งหนี้", en: "Track invoices" },
    ],
  },
  sme: {
    th: "ธุรกิจ SME", en: "SME",
    tipTh: "งานประจำวัน: ขาย ซื้อ รับสินค้า และตรวจเอกสาร",
    tipEn: "Daily operations: sell, purchase, receive stock and review documents.",
    first: ["/dashboard", "/quotes", "/clients", "/purchases", "/vendors", "/inventory", "/products", "/finance", "/documents/ocr", "/assistant"],
    tasks: [
      { href: "/quotes/new", th: "สร้างใบเสนอราคา", en: "Prepare a quote" },
      { href: "/purchases", th: "ติดตามการสั่งซื้อ", en: "Follow up purchases" },
      { href: "/inventory", th: "ตรวจสต็อกพร้อมขาย", en: "Check available stock" },
    ],
  },
  startup: {
    th: "องค์กร", en: "Organization",
    tipTh: "ควบคุมงานข้ามทีม: ภาระงาน ส่งมอบ อนุมัติ และรายงาน",
    tipEn: "Cross-team control: workload, delivery, approvals and reporting.",
    first: ["/dashboard", "/warehouse", "/projects", "/deals", "/reports", "/expenses", "/automation", "/documents/ocr", "/assistant"],
    tasks: [
      { href: "/warehouse", th: "ตรวจภาระงานองค์กร", en: "Review organization workload" },
      { href: "/projects?view=board", th: "ทบทวนการส่งมอบ", en: "Review delivery board" },
      { href: "/reports", th: "ตรวจรายงานข้ามทีม", en: "Review cross-team reports" },
    ],
  },
}

export function parseMode(raw: unknown): Mode {
  return MODES.includes(raw as Mode) ? (raw as Mode) : DEFAULT_MODE
}

/** Presentation only: callers authorize before partitioning. No records or permissions change. */
export function navigationForMode<T extends { href: string }>(items: T[], mode: Mode): { primary: T[]; additional: T[] } {
  const profile = MODE_COPY[mode].first
  const byHref = new Map(items.map((item) => [item.href, item]))
  const primary = profile.flatMap((href) => {
    const item = byHref.get(href)
    return item ? [item] : []
  })
  const selected = new Set(profile)
  return { primary, additional: items.filter((item) => !selected.has(item.href)) }
}
