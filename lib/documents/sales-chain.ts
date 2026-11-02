import type { Enums } from "@/lib/types/database"

type QuoteStatus = Enums<"quote_status">
type InvoiceStatus = Enums<"invoice_status">

/** Thai status words (FlowAccount-style). Operational wording only: nothing here claims a statutory filing. */
export const QUOTE_STATUS_TH: Record<QuoteStatus, string> = {
  draft: "ฉบับร่าง", sent: "ส่งแล้ว", accepted: "อนุมัติแล้ว", declined: "ปฏิเสธ", expired: "หมดอายุ", converted: "ออกใบแจ้งหนี้แล้ว",
}
export const INVOICE_STATUS_TH: Record<InvoiceStatus, string> = {
  draft: "ฉบับร่าง", sent: "ออกแล้ว · รอชำระ", partially_paid: "ชำระบางส่วน", paid: "ชำระแล้ว", overdue: "เกินกำหนด", cancelled: "ยกเลิก",
}

export type ChainKey = "quote" | "invoice" | "issued" | "receipt"
export type ChainState = "done" | "current" | "todo" | "stopped"
export type ChainStep = { key: ChainKey; th: string; en: string; state: ChainState }
export type NextCommand = "accept" | "convert" | "issue" | "pay"
export type SalesChain = {
  steps: ChainStep[]
  next: { command: NextCommand; th: string; en: string } | null
  /** Shown only after an issue on a VAT-registered profile; never says the document is a statutory tax invoice. */
  vatNote: string | null
}

export type ChainInput = {
  /** Omit when the invoice was created without a quotation. */
  quoteStatus?: QuoteStatus
  /** The newest non-cancelled invoice linked to the quote, if any. `status` is the effective status. */
  invoice?: { status: InvoiceStatus; issued: boolean; outstandingSatang: number }
  vatRegistered: boolean
}

const NEXT = {
  accept: { command: "accept", th: "อนุมัติใบเสนอราคา", en: "Accept the quotation" },
  convert: { command: "convert", th: "สร้างใบแจ้งหนี้ฉบับร่าง", en: "Create draft invoice" },
  issue: { command: "issue", th: "ออกใบแจ้งหนี้", en: "Issue the invoice" },
  pay: { command: "pay", th: "บันทึกรับเงิน / ใบเสร็จ", en: "Record payment / receipt" },
} as const

export function salesChain({ quoteStatus, invoice, vatRegistered }: ChainInput): SalesChain {
  const live = invoice && invoice.status !== "cancelled" ? invoice : undefined
  const issued = !!live?.issued
  const paid = issued && live!.outstandingSatang <= 0
  const quoteStopped = !live && (quoteStatus === "declined" || quoteStatus === "expired")
  const quoteDone = !!live || quoteStatus === "accepted" || quoteStatus === "converted"

  const pick = (done: boolean, current: boolean): ChainState => done ? "done" : current ? "current" : "todo"
  const quote = quoteStopped ? "stopped" : pick(quoteDone, true)
  const inv = pick(issued, quoteDone && !live || !!live && !issued)
  const iss = pick(issued, false)
  const rec = pick(paid, issued && !paid)
  const steps: ChainStep[] = [
    ...(quoteStatus ? [{ key: "quote" as const, th: "ใบเสนอราคา", en: "Quotation", state: quote }] : []),
    { key: "invoice", th: "ใบแจ้งหนี้ (ร่าง)", en: "Invoice draft", state: inv },
    { key: "issued", th: vatRegistered ? "ออกเอกสาร + VAT" : "ออกเอกสาร", en: vatRegistered ? "Issued + VAT" : "Issued", state: iss },
    { key: "receipt", th: "ใบเสร็จ", en: "Receipt", state: rec },
  ]

  let next: SalesChain["next"] = null
  if (quoteStopped || paid) next = null
  else if (issued) next = NEXT.pay
  else if (live) next = NEXT.issue
  else if (quoteStatus === "accepted" || quoteStatus === "converted") next = NEXT.convert
  else if (quoteStatus === "sent") next = NEXT.accept

  return {
    steps,
    next,
    vatNote: issued && vatRegistered
      ? "ข้อมูล VAT พร้อมให้ตรวจ — เอกสารนี้ยังไม่ใช่ใบกำกับภาษีตามกฎหมายและยังไม่ได้ยื่นกรมสรรพากร / VAT figures ready for review. Operational document, not a statutory tax invoice and not filed."
      : null,
  }
}
