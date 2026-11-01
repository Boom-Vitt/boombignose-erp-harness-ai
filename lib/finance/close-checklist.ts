import { deriveInvoiceStatus, outstandingSatang, type InvoiceStatus } from "@/lib/metrics/invoice-status"
import { sumSatang } from "@/lib/money"

/**
 * Operational month-end review before an owner or admin sets the finance lock.
 * Counts open documents and receipts. It does not post a journal, age a ledger,
 * or file VAT. Statutory books stay in FlowAccount, PEAK, or Xero.
 */

export type CloseInvoice = {
  status: InvoiceStatus
  issueDate: string
  dueDate: string | null
  amountSatang: number
  paidSatang: number
  creditedSatang: number
  vatSatang: number
}

export type CloseVendorBill = {
  vendorId: string | null
  expenseClaimId: string | null
  paidAt: string | null
  dueDate: string | null
  amountSatang: number
  kind: "bill" | "credit" | "return_adjustment" | null
}

export type CloseBankLine = {
  bookedOn: string
  amountSatang: number
  matched: boolean
}

export type CloseExpenseClaim = {
  status: "draft" | "submitted" | "approved" | "rejected" | "paid"
  employeeId: string
}

export type CloseCreditNote = {
  issueDate: string
  baseSatang: number
  totalSatang: number
}

export type ClosePurchaseVat = {
  month: string
  inputVatSatang: number
}

export type CloseTaxProfile = {
  legalName: string
  address: string
  taxId: string
  branchLabel: string
  taxStatus: "unknown" | "not_registered" | "registered"
}

export type CloseChecklistInput = {
  month: string
  today: string
  lockDate: string | null
  viewerId: string
  invoices: readonly CloseInvoice[]
  bills: readonly CloseVendorBill[]
  bankLines: readonly CloseBankLine[]
  claims: readonly CloseExpenseClaim[]
  credits: readonly CloseCreditNote[]
  purchaseVat: readonly ClosePurchaseVat[]
  tax: CloseTaxProfile
}

export type CloseItemId =
  | "overdue_ar"
  | "unpaid_ap"
  | "unmatched_bank"
  | "draft_invoices"
  | "expense_claims"
  | "tax_profile"
  | "vat_support"
  | "finance_lock"

export type CloseChecklistItem = {
  id: CloseItemId
  title: string
  detail: string
  count: number
  amountSatang: number | null
  href: string
  state: "clear" | "review" | "info"
  outputVatSatang: number | null
  inputVatSatang: number | null
}

export type CloseChecklist = {
  month: string
  periodEnd: string
  today: string
  summary: string
  ready: boolean
  closable: boolean
  alreadyClosed: boolean
  reviewCount: number
  items: CloseChecklistItem[]
}

export type CloseChecklistResult =
  | { ok: true; checklist: CloseChecklist }
  | { ok: false; error: string }

export const CLOSE_ITEM_ORDER: readonly CloseItemId[] = [
  "overdue_ar",
  "unpaid_ap",
  "unmatched_bank",
  "draft_invoices",
  "expense_claims",
  "tax_profile",
  "vat_support",
  "finance_lock",
]

const BOUNDARY = "It is not a general-ledger close or a tax filing."

/**
 * Owners, admins, and an accountant can review the list. Members cannot.
 * The accountant role is added in separate work. Until that migration is
 * applied, nobody has the role. Setting the lock stays with owners and admins.
 */
export function canReviewMonthEndClose(role: string): boolean {
  return role === "owner" || role === "admin" || role === "accountant"
}

/** Calendar month before `today`, or null when `today` is not a real date. */
export function previousCompletedMonth(today: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 }
  return `${prev.year}-${String(prev.month).padStart(2, "0")}`
}

function lastDayOfMonth(month: string): string | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return null
  const year = Number(match[1])
  const mon = Number(match[2])
  if (mon < 1 || mon > 12) return null
  const end = new Date(Date.UTC(year, mon, 0))
  if (end.getUTCFullYear() !== year || end.getUTCMonth() !== mon - 1) return null
  return `${match[1]}-${match[2]}-${String(end.getUTCDate()).padStart(2, "0")}`
}

function calendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function inMonth(date: string, month: string): boolean {
  return date.slice(0, 7) === month && calendarDate(date)
}

function filled(value: string): boolean {
  return value.trim().length > 0
}

function noun(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`
}

function laterNote(count: number, periodEnd: string): string {
  if (count === 0) return ""
  return ` ${noun(count, "unmatched line booked", "unmatched lines booked")} after ${periodEnd} ${count === 1 ? "stays" : "stay"} with the next close.`
}

function unpaidVendorBill(bill: CloseVendorBill): boolean {
  return !!bill.vendorId && bill.expenseClaimId === null && bill.paidAt === null && bill.kind !== "credit" && bill.kind !== "return_adjustment" && bill.amountSatang > 0
}

function closeSummary(month: string, periodEnd: string, lockDate: string | null, reviewCount: number, closable: boolean, alreadyClosed: boolean): string {
  if (!closable && !alreadyClosed) return `งวด ${month} ยังไม่จบ / Close a completed month. The current month stays open. ${BOUNDARY}`
  if (alreadyClosed) {
    const open = reviewCount === 0
      ? "Nothing on this list is still open."
      : `${noun(reviewCount, "item", "items")} on this list stayed open. The lock does not clear them.`
    return `งวด ${month} ล็อกแล้ว / This month is already locked through ${lockDate}. ${open} Edits on or before the lock date are blocked. ${BOUNDARY}`
  }
  if (reviewCount === 0) {
    return `พร้อมปิดงวด ${month} / Nothing in this list still needs review. An owner or admin can close it in finance settings. The lock then blocks documents and receipts dated on or before ${periodEnd}. ${BOUNDARY}`
  }
  return `ตรวจก่อนปิดงวด ${month} / ${noun(reviewCount, "item still needs", "items still need")} review. An owner or admin can still set the lock. The lock blocks documents and receipts dated on or before ${periodEnd}. The lock does not clear this list. ${BOUNDARY}`
}

export function monthEndCloseChecklist(input: CloseChecklistInput): CloseChecklistResult {
  const periodEnd = lastDayOfMonth(input.month)
  if (!periodEnd) return { ok: false, error: "Enter a month as YYYY-MM." }
  if (!calendarDate(input.today)) return { ok: false, error: "Enter today as YYYY-MM-DD." }

  const lockDate = input.lockDate && calendarDate(input.lockDate) ? input.lockDate : null
  const alreadyClosed = lockDate !== null && lockDate >= periodEnd
  const closable = periodEnd < input.today && !alreadyClosed

  const overdue = input.invoices.filter(invoice => deriveInvoiceStatus({
    status: invoice.status,
    amount_satang: invoice.amountSatang,
    due_date: invoice.dueDate,
    credited_satang: invoice.creditedSatang,
  }, invoice.paidSatang, input.today) === "overdue")
  const overdueAmount = sumSatang(overdue.map(invoice => outstandingSatang(invoice.amountSatang, invoice.paidSatang, invoice.creditedSatang)))

  const unpaid = input.bills.filter(unpaidVendorBill)
  const pastDueBills = unpaid.filter(bill => bill.dueDate !== null && bill.dueDate < input.today)
  const unpaidAmount = sumSatang(unpaid.map(bill => bill.amountSatang))

  const unmatched = input.bankLines.filter(line => !line.matched && calendarDate(line.bookedOn) && line.bookedOn <= periodEnd)
  const laterBank = input.bankLines.filter(line => !line.matched && calendarDate(line.bookedOn) && line.bookedOn > periodEnd).length
  const unmatchedAmount = sumSatang(unmatched.map(line => Math.abs(line.amountSatang)))

  const drafts = input.invoices.filter(invoice => invoice.status === "draft" && calendarDate(invoice.issueDate) && invoice.issueDate <= periodEnd)
  const laterDrafts = input.invoices.filter(invoice => invoice.status === "draft" && calendarDate(invoice.issueDate) && invoice.issueDate > periodEnd).length
  const draftAmount = sumSatang(drafts.map(invoice => invoice.amountSatang))

  const submitted = input.claims.filter(claim => claim.status === "submitted")
  const ownClaims = submitted.filter(claim => claim.employeeId === input.viewerId).length
  const otherClaims = submitted.length - ownClaims

  const missingTax: string[] = []
  if (!filled(input.tax.legalName)) missingTax.push("seller name")
  if (!filled(input.tax.address)) missingTax.push("seller address")
  if (!/^[0-9]{13}$/.test(input.tax.taxId.trim())) missingTax.push("13-digit tax ID")
  if (!filled(input.tax.branchLabel)) missingTax.push("branch")
  if (input.tax.taxStatus === "unknown") missingTax.push("VAT registration")

  const outputVat = sumSatang(input.invoices.filter(invoice => invoice.status !== "draft" && invoice.status !== "cancelled" && inMonth(invoice.issueDate, input.month)).map(invoice => invoice.vatSatang))
    - sumSatang(input.credits.filter(credit => inMonth(credit.issueDate, input.month)).map(credit => credit.totalSatang - credit.baseSatang))
  const inputVat = sumSatang(input.purchaseVat.filter(row => row.month.slice(0, 7) === input.month).map(row => row.inputVatSatang))
  if (!Number.isSafeInteger(outputVat)) throw new Error("Unsafe integer-satang sum")

  const blank = { outputVatSatang: null, inputVatSatang: null }
  const items: CloseChecklistItem[] = [
    {
      id: "overdue_ar",
      title: "ลูกหนี้เกินกำหนด / Overdue receivables",
      detail: overdue.length === 0 ? "No issued invoice is past its due date." : `${noun(overdue.length, "issued invoice is", "issued invoices are")} past due and not fully paid.`,
      count: overdue.length,
      amountSatang: overdueAmount,
      href: "/finance?status=overdue",
      state: overdue.length === 0 ? "clear" : "review",
      ...blank,
    },
    {
      id: "unpaid_ap",
      title: "บิลเจ้าหนี้ค้างจ่าย / Unpaid vendor bills",
      detail: unpaid.length === 0 ? "No vendor bill is unpaid." : `${noun(unpaid.length, "vendor bill is", "vendor bills are")} unpaid. ${pastDueBills.length} past due as of ${input.today}.`,
      count: unpaid.length,
      amountSatang: unpaidAmount,
      href: "/finance?tab=costs",
      state: unpaid.length === 0 ? "clear" : "review",
      ...blank,
    },
    {
      id: "unmatched_bank",
      title: "รายการธนาคารที่ยังไม่จับคู่ / Unmatched bank lines",
      detail: `${unmatched.length === 0 ? `No bank line booked on or before ${periodEnd} is unmatched.` : `${noun(unmatched.length, "bank line", "bank lines")} booked on or before ${periodEnd} ${unmatched.length === 1 ? "is" : "are"} not matched to a verified receipt.`}${laterNote(laterBank, periodEnd)}`,
      count: unmatched.length,
      amountSatang: unmatchedAmount,
      href: "/finance/bank",
      state: unmatched.length === 0 ? "clear" : "review",
      ...blank,
    },
    {
      id: "draft_invoices",
      title: "ใบแจ้งหนี้ฉบับร่าง / Draft invoices",
      detail: `${drafts.length === 0 ? `No draft invoice is dated on or before ${periodEnd}.` : `${noun(drafts.length, "draft invoice is", "draft invoices are")} dated on or before ${periodEnd}. Issuing ${drafts.length === 1 ? "it" : "them"} after the lock fails while the issue date stays in the locked period.`}${laterDrafts ? ` ${noun(laterDrafts, "draft invoice dated", "draft invoices dated")} after ${periodEnd} ${laterDrafts === 1 ? "stays" : "stay"} open.` : ""}`,
      count: drafts.length,
      amountSatang: draftAmount,
      href: "/finance?status=draft",
      state: drafts.length === 0 ? "clear" : "review",
      ...blank,
    },
    {
      id: "expense_claims",
      title: "เคลมรออนุมัติ / Expense claims awaiting approval",
      detail: submitted.length === 0
        ? "No submitted expense claim is waiting for approval."
        : `${noun(submitted.length, "submitted expense claim is", "submitted expense claims are")} waiting for approval.${ownClaims === 0 ? "" : " You cannot approve your own claim."}`,
      count: submitted.length,
      amountSatang: null,
      href: submitted.length > 0 && otherClaims === 0 ? "/expenses" : "/expenses?tab=approve",
      state: submitted.length === 0 ? "clear" : "review",
      ...blank,
    },
    {
      id: "tax_profile",
      title: "ข้อมูลผู้ขาย / Seller profile",
      detail: missingTax.length === 0
        ? `Seller name, address, 13-digit tax ID, and branch are filled. VAT registration is recorded as ${input.tax.taxStatus === "registered" ? "registered" : "not registered"}. ${input.tax.taxStatus === "registered" ? "Saving the profile does not make a document a statutory tax invoice." : "These documents stay operational invoices."}`
        : `Missing ${missingTax.join(", ")}.`,
      count: missingTax.length,
      amountSatang: null,
      href: "/finance/business-profile",
      state: missingTax.length === 0 ? "clear" : "review",
      ...blank,
    },
    {
      id: "vat_support",
      title: "ข้อมูล VAT / VAT support",
      detail: `Output VAT is issued-invoice VAT in ${input.month} minus credit notes in that month. Input VAT is matched vendor bills in ${input.month}. Support data for your accountant. Not a ภ.พ.30 filing.`,
      count: 0,
      amountSatang: null,
      href: "/reports#purchase-vat",
      state: "info",
      outputVatSatang: outputVat,
      inputVatSatang: inputVat,
    },
    {
      id: "finance_lock",
      title: "ล็อกงวด / Finance lock",
      detail: alreadyClosed
        ? `Locked through ${lockDate}. Documents and receipts dated on or before that date stay blocked.`
        : lockDate
          ? `Locked through ${lockDate}. Documents and receipts on or before that date are already blocked. Closing ${input.month} extends the block through ${periodEnd}.`
          : `No lock date is set. Closing ${input.month} blocks invoice issues, receipts, and corrections dated on or before ${periodEnd}.`,
      count: 0,
      amountSatang: null,
      href: "/settings/finance",
      state: "info",
      ...blank,
    },
  ]

  const reviewCount = items.filter(item => item.state === "review").length
  return {
    ok: true,
    checklist: {
      month: input.month,
      periodEnd,
      today: input.today,
      summary: closeSummary(input.month, periodEnd, lockDate, reviewCount, closable, alreadyClosed),
      ready: reviewCount === 0,
      closable,
      alreadyClosed,
      reviewCount,
      items,
    },
  }
}
