import { buddhistEraLabel } from "@/lib/dates"
import { FILING_LEAD_EN, FILING_LEAD_TH, FILING_LIMIT_EN, FILING_LIMIT_TH, FILING_PARTIES } from "@/lib/finance/filing-responsibility"
import { toCsv } from "@/lib/export/csv"
import { escapeHtml } from "@/lib/documents/printable"
import { BAHT_CAPTION_EN, BAHT_CAPTION_TH, closeDateLabel, VAT_SUPPORT_EN, VAT_SUPPORT_TH, WHT_SUPPORT_EN, WHT_SUPPORT_TH } from "@/lib/finance/close-copy"
import { formatTHB, satangToBahtString, sumSatang, type Satang } from "@/lib/money"

/**
 * Month pack for an external accountant. Figures are copied from stored
 * documents and from the purchase VAT table. Nothing here files ภ.พ.30,
 * calls the Revenue Department, or posts a statutory ledger.
 */

export const ACCOUNTANT_PACK_DISCLAIMER_EN =
  "Support data for the external accountant only. This pack does not file ภ.พ.30, does not call the Revenue Department, and is not a statutory ledger."

export const ACCOUNTANT_PACK_DISCLAIMER_TH =
  "ข้อมูลประกอบสำหรับนักบัญชีภายนอกเท่านั้น ชุดนี้ไม่ยื่นแบบ ภ.พ.30 ไม่ติดต่อกรมสรรพากร และไม่ใช่งบการเงินตามกฎหมาย"

export const VENDOR_WHT_NOTE =
  `Customer withholding is only what is already stored on issued invoices and credit notes, grouped by customer. Withholding we deducted on purchases is listed separately from the purchase withholding records. ${WHT_SUPPORT_EN} ${WHT_SUPPORT_TH}`

export const PACK_LINE_HEADERS = [
  "วันที่ / Date",
  "เอกสาร / Document",
  "เลขที่ / Number",
  "คู่ค้า / Party",
  "เลขผู้เสียภาษี / Tax ID",
  "ฐานภาษี / Base",
  "ภาษีมูลค่าเพิ่ม / VAT",
  "หัก ณ ที่จ่าย / WHT",
] as const

export const PACK_WHT_HEADERS = [
  "ลูกค้า / Customer",
  "เลขผู้เสียภาษี / Tax ID",
  "ฐานภาษี / Base",
  "หัก ณ ที่จ่าย / WHT",
  "จำนวนเอกสาร / Documents",
] as const

const KIND_LABEL: Record<VatSupportLine["kind"], string> = {
  invoice: "ใบแจ้งหนี้ / Invoice",
  credit_note: "ใบลดหนี้ / Credit note",
  vendor_bill: "บิลผู้ขาย / Vendor bill",
  vendor_credit: "ใบลดหนี้ผู้ขาย / Vendor credit",
  return_adjustment: "ปรับคืนสินค้า / Return adjustment",
  matched_cost: "ต้นทุนที่จับคู่แล้ว / Matched cost",
}

export function vatSupportKindLabel(kind: VatSupportLine["kind"]): string {
  return KIND_LABEL[kind]
}

export function packDateLabel(isoDate: string): string {
  return closeDateLabel(isoDate)
}

function isIssued(status: string): boolean {
  return status !== "draft" && status !== "cancelled"
}

export type PackInvoiceRow = {
  id: string
  number: string
  status: string
  issueDate: string
  clientId: string
  clientName: string
  clientTaxId: string | null
  totalSatang: number
  vatSatang: number
  whtSatang: number
}

export type PackCreditRow = {
  id: string
  number: string
  issueDate: string
  invoiceId: string
  clientId: string
  clientName: string
  clientTaxId: string | null
  buyerName: string
  buyerTaxId: string | null
  baseSatang: number
  vatSatang: number
  whtSatang: number
  originalNumber: string | null
}

export type PackPurchaseLine = {
  id: string
  billDate: string
  vendorName: string
  vendorTaxId: string | null
  reference: string
  kind: "bill" | "credit" | "return_adjustment" | null
  amountSatang: number
  inputVatSatang: number
  matched: boolean
}

/** Withholding we deducted when paying a vendor (ภ.ง.ด.3 / ภ.ง.ด.53 support). */
export type PackPurchaseWht = {
  id: string
  costId: string
  certificateNo: string
  paidOn: string
  form: "pnd3" | "pnd53"
  incomeType: string
  rateBps: number
  vendorName: string
  vendorTaxId: string | null
  baseSatang: number
  whtSatang: number
}

export type PackPurchaseVatTotal = {
  month: string
  baseSatang: number
  inputVatSatang: number
}

export type VatSupportLine = {
  kind: "invoice" | "credit_note" | "vendor_bill" | "vendor_credit" | "return_adjustment" | "matched_cost"
  id: string
  number: string
  date: string
  partyKind: "customer" | "vendor"
  partyName: string
  taxId: string | null
  baseSatang: number
  vatSatang: number
  whtSatang: number
  note: string
}

export type WhtPartyTotal = {
  partyKind: "customer"
  partyId: string
  partyName: string
  taxId: string | null
  baseSatang: number
  whtSatang: number
  documentCount: number
}

export type AccountantPack = {
  orgName: string
  month: string
  buddhistMonth: string
  outputLines: VatSupportLine[]
  inputLines: VatSupportLine[]
  outputBaseSatang: number
  outputVatSatang: number
  outputWhtSatang: number
  inputBaseSatang: number
  inputVatSatang: number
  outputMinusInputVatSatang: number
  whtParties: WhtPartyTotal[]
  whtSatang: number
  purchaseWht: PackPurchaseWht[]
  purchaseWhtSatang: number
}

export type CreditSupport = {
  buyerName: string
  buyerTaxId: string | null
  baseSatang: number
  vatSatang: number
  whtSatang: number
  originalNumber: string | null
}

/** Owners, admins, and an accountant. The accountant role arrives in separate work. */
export function canDownloadAccountantPack(role: string): boolean {
  return role === "owner" || role === "admin" || role === "accountant"
}

export function accountantPackMonth(month: string): { month: string; from: string; toExclusive: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month)
  if (!match) return null
  const year = Number(match[1])
  const mon = Number(match[2])
  if (mon < 1 || mon > 12) return null
  const start = new Date(Date.UTC(year, mon - 1, 1))
  if (start.getUTCFullYear() !== year || start.getUTCMonth() !== mon - 1) return null
  const toExclusive = mon === 12 ? `${year + 1}-01-01` : `${match[1]}-${String(mon + 1).padStart(2, "0")}-01`
  return { month, from: `${month}-01`, toExclusive }
}

export function previousCalendarMonth(isoDate: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null
  const year = Number(isoDate.slice(0, 4))
  const month = Number(isoDate.slice(5, 7))
  if (month < 1 || month > 12) return null
  if (month === 1) return `${year - 1}-12`
  return `${isoDate.slice(0, 5)}${String(month - 1).padStart(2, "0")}`
}

export function readStoredCreditSupport(snapshot: unknown): CreditSupport {
  if (!snapshot || typeof snapshot !== "object") throw new Error("Credit note snapshot is missing stored VAT or withholding")
  const body = snapshot as { buyer?: unknown; document?: unknown; originalNumber?: unknown }
  const buyer = body.buyer
  const document = body.document
  if (!buyer || typeof buyer !== "object" || !document || typeof document !== "object") {
    throw new Error("Credit note snapshot is missing stored VAT or withholding")
  }
  const name = (buyer as { name?: unknown }).name
  const taxId = (buyer as { taxId?: unknown }).taxId
  if (typeof name !== "string" || !name.trim()) throw new Error("Credit note snapshot is missing stored VAT or withholding")
  if (taxId !== null && taxId !== undefined && typeof taxId !== "string") {
    throw new Error("Credit note snapshot is missing stored VAT or withholding")
  }
  const baseSatang = storedMoney((document as { baseSatang?: unknown }).baseSatang)
  const vatSatang = storedMoney((document as { vatSatang?: unknown }).vatSatang)
  const total = (document as { totalSatang?: unknown }).totalSatang
  if (total !== undefined && total !== null) {
    const totalSatang = storedMoney(total)
    if (!Number.isSafeInteger(baseSatang + vatSatang) || totalSatang !== baseSatang + vatSatang) {
      throw new Error("Credit note snapshot is missing stored VAT or withholding")
    }
  }
  return {
    buyerName: name.trim(),
    buyerTaxId: typeof taxId === "string" && taxId.trim() ? taxId.trim() : null,
    baseSatang,
    vatSatang,
    whtSatang: storedMoney((document as { whtSatang?: unknown }).whtSatang),
    originalNumber: typeof body.originalNumber === "string" && body.originalNumber.trim() ? body.originalNumber.trim() : null,
  }
}

export function assembleAccountantPack(input: {
  orgName: string
  month: string
  invoices: readonly PackInvoiceRow[]
  credits: readonly PackCreditRow[]
  purchaseLines: readonly PackPurchaseLine[]
  purchaseVat: readonly PackPurchaseVatTotal[]
  purchaseWithholdings?: readonly PackPurchaseWht[]
}): AccountantPack {
  if (!accountantPackMonth(input.month)) throw new Error("Choose a month as YYYY-MM")
  const invoices = input.invoices.filter((row) => isIssued(row.status) && inMonth(row.issueDate, input.month))
  const credits = input.credits.filter((row) => inMonth(row.issueDate, input.month))
  const purchaseLines = input.purchaseLines.filter((row) => row.matched && inMonth(row.billDate, input.month))
  const purchaseVat = input.purchaseVat.filter((row) => row.month.slice(0, 7) === input.month)

  const outputLines = [
    ...invoices.map(invoiceLine),
    ...credits.map(creditLine),
  ].sort(byDateThenNumber)
  const inputLines = purchaseLines.map(purchaseLine).sort(byDateThenNumber)

  const outputBaseSatang = sumSatang(outputLines.map((row) => row.baseSatang))
  const outputVatSatang = sumSatang(outputLines.map((row) => row.vatSatang))
  const outputWhtSatang = sumSatang(outputLines.map((row) => row.whtSatang))
  const inputBaseSatang = sumSatang(inputLines.map((row) => row.baseSatang))
  const inputVatSatang = sumSatang(inputLines.map((row) => row.vatSatang))
  const tableBase = sumSatang(purchaseVat.map((row) => integerSatang(row.baseSatang, "Purchase VAT base")))
  const tableVat = sumSatang(purchaseVat.map((row) => integerSatang(row.inputVatSatang, "Purchase VAT")))
  if (inputBaseSatang !== tableBase || inputVatSatang !== tableVat) {
    throw new Error("Matched vendor bills do not match the purchase VAT table for this month")
  }

  const whtParties = groupCustomerWht(invoices, credits)
  const purchaseWht = (input.purchaseWithholdings ?? [])
    .filter((row) => inMonth(row.paidOn, input.month))
    .map((row) => ({ ...row, baseSatang: nonNegative(row.baseSatang, "Withholding base"), whtSatang: nonNegative(row.whtSatang, "Withholding") }))
    .sort((a, b) => a.certificateNo.localeCompare(b.certificateNo))
  const label = buddhistEraLabel(`${input.month}-01`)
  return {
    orgName: input.orgName,
    month: input.month,
    buddhistMonth: label ? label.slice(3) : input.month,
    outputLines,
    inputLines,
    outputBaseSatang,
    outputVatSatang,
    outputWhtSatang,
    inputBaseSatang,
    inputVatSatang,
    outputMinusInputVatSatang: subtractSatang(outputVatSatang, inputVatSatang),
    whtParties,
    whtSatang: sumSatang(whtParties.map((row) => row.whtSatang)),
    purchaseWht,
    purchaseWhtSatang: sumSatang(purchaseWht.map((row) => row.whtSatang)),
  }
}

export const ACCOUNTANT_PACK_CSV_HEADERS = [
  "Section",
  "Kind",
  "Number",
  "Date",
  "Party kind",
  "Party",
  "Tax ID",
  "Base (THB)",
  "VAT (THB)",
  "WHT (THB)",
  "Document ID",
  "Note",
]

export function accountantPackCsv(pack: AccountantPack): string {
  const rows: (string | number | null)[][] = [
    summary(pack, "disclaimer", "", "", "", ACCOUNTANT_PACK_DISCLAIMER_EN),
    summary(pack, "disclaimer_th", "", "", "", ACCOUNTANT_PACK_DISCLAIMER_TH),
    summary(pack, "responsibility_th", "", "", "", FILING_LEAD_TH),
    summary(pack, "responsibility_en", "", "", "", FILING_LEAD_EN),
    ...FILING_PARTIES.map((party) => summary(pack, "responsibility", "", "", "", `${party.th} / ${party.en}`)),
    summary(pack, "responsibility_limit_th", "", "", "", FILING_LIMIT_TH),
    summary(pack, "responsibility_limit_en", "", "", "", FILING_LIMIT_EN),
    summary(pack, "output_vat", pack.outputBaseSatang, pack.outputVatSatang, pack.outputWhtSatang, "Issued invoices minus credit notes. Output VAT support, not a filing."),
    summary(pack, "input_vat", pack.inputBaseSatang, pack.inputVatSatang, "", "Matched vendor bills on the purchase VAT table, including linked credits. Input VAT support, not a filing."),
    summary(pack, "output_minus_input", "", pack.outputMinusInputVatSatang, "", "Support difference only. Not tax payable and not a ภ.พ.30 filing."),
    summary(pack, "wht", "", "", pack.whtSatang, VENDOR_WHT_NOTE),
    summary(pack, "purchase_wht", "", "", pack.purchaseWhtSatang, "Withholding deducted on purchases, from purchase withholding records. Support for ภ.ง.ด.3/53 lists, not a filing."),
    ...pack.outputLines.map((row) => detail("output_vat", row)),
    ...pack.inputLines.map((row) => detail("input_vat", row)),
    ...pack.purchaseWht.map((row) => ["purchase_wht", row.form, row.certificateNo, row.paidOn, "vendor", row.vendorName, row.vendorTaxId ?? "", baht(row.baseSatang), "", baht(row.whtSatang), row.id, `${row.rateBps / 100}% ${row.incomeType}`]),
    ...pack.whtParties.map((row) => [
      "wht",
      "customer_total",
      "",
      pack.month,
      "customer",
      row.partyName,
      row.taxId ?? "",
      baht(row.baseSatang),
      "",
      baht(row.whtSatang),
      row.partyId,
      `${row.documentCount} document${row.documentCount === 1 ? "" : "s"} with stored withholding`,
    ]),
  ]
  return toCsv(ACCOUNTANT_PACK_CSV_HEADERS, rows)
}

export function renderAccountantPackHtml(pack: AccountantPack, generatedOn: string): string {
  const output = linesTable(pack.outputLines, "ไม่มีใบแจ้งหนี้ที่ออกหรือใบลดหนี้ในเดือนนี้ / No issued invoices or credit notes in this month.")
  const input = linesTable(pack.inputLines, "ไม่มีบิลผู้ขายที่จับคู่ในเดือนนี้ / No matched vendor bills in this month.")
  const wht = pack.whtParties.length === 0
    ? `<p class="muted">ไม่มีหัก ณ ที่จ่ายที่บันทึกไว้ในเดือนนี้ / No stored withholding in this month.</p>`
    : `<table>
      <thead><tr>${PACK_WHT_HEADERS.map((header, index) => `<th${index >= 2 ? ` class="num"` : ""}>${escapeHtml(header)}</th>`).join("")}</tr></thead>
      <tbody>
        ${pack.whtParties.map((row) => `<tr><td>${escapeHtml(row.partyName)}</td><td>${escapeHtml(row.taxId ?? "")}</td><td class="num">${money(row.baseSatang)}</td><td class="num">${money(row.whtSatang)}</td><td class="num">${row.documentCount}</td></tr>`).join("")}
        <tr class="totals-row"><td class="strong">รวม / Total</td><td></td><td></td><td class="num strong">${money(pack.whtSatang)}</td><td></td></tr>
      </tbody>
    </table>`
  return `<!DOCTYPE html>
<html lang="th">
<head>
<meta charset="utf-8" />
<title>ชุดข้อมูลนักบัญชี ${escapeHtml(pack.month)}</title>
<style>
  body { font-family: "Noto Sans Thai", "Segoe UI", sans-serif; color: #18181b; margin: 32px; }
  h1 { font-size: 22px; margin: 0 0 4px; }
  h2 { font-size: 16px; margin: 28px 0 8px; }
  .disclaimer { border: 1px solid #18181b; padding: 12px 14px; margin: 16px 0; }
  .muted { color: #52525b; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 13px; }
  th { text-align: left; border-bottom: 2px solid #18181b; padding: 6px; font-size: 11px; }
  td { padding: 6px; border-bottom: 1px solid #e4e4e7; vertical-align: top; }
  .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .strong { font-weight: 700; }
  .totals-row td { border-top: 2px solid #18181b; }
  button { margin-top: 8px; }
  @media print { button { display: none; } body { margin: 0; } }
</style>
</head>
<body>
  <h1>ชุดข้อมูลนักบัญชี / Accountant pack</h1>
  <p>${escapeHtml(pack.orgName)} · ${escapeHtml(pack.month)} (${escapeHtml(pack.buddhistMonth)}) · ${escapeHtml(closeDateLabel(generatedOn))}</p>
  <p class="muted">${escapeHtml(BAHT_CAPTION_TH)} / ${escapeHtml(BAHT_CAPTION_EN)} วันที่แสดงทั้ง ค.ศ. และ พ.ศ. / Dates show the Gregorian day and the Buddhist-era day.</p>
  <div class="disclaimer">
    <p>${escapeHtml(ACCOUNTANT_PACK_DISCLAIMER_TH)}</p>
    <p>${escapeHtml(ACCOUNTANT_PACK_DISCLAIMER_EN)}</p>
    <p>${escapeHtml(VAT_SUPPORT_TH)}</p>
    <p>${escapeHtml(VAT_SUPPORT_EN)}</p>
    <p>${escapeHtml(FILING_LEAD_TH)}</p>
    <p>${escapeHtml(FILING_LEAD_EN)}</p>
    <ul>${FILING_PARTIES.map((party) => `<li>${escapeHtml(party.th)} / ${escapeHtml(party.en)}</li>`).join("")}</ul>
    <p>${escapeHtml(FILING_LIMIT_TH)}</p>
    <p>${escapeHtml(FILING_LIMIT_EN)}</p>
  </div>
  <button type="button" onclick="window.print()">พิมพ์ / Print / PDF</button>
  <h2>ภาษีขาย / Output VAT</h2>
  <p class="muted">ใบแจ้งหนี้ที่ออกแล้วหักใบลดหนี้ในเดือนนี้ หนึ่งแถวต่อหนึ่งเอกสาร ภาษีมูลค่าเพิ่มคือยอดที่บันทึกในเอกสาร / Issued invoices minus credit notes dated in this month. One row per document. VAT is the amount stored on the document.</p>
  <p>ฐานภาษี / Base ${money(pack.outputBaseSatang)} · ภาษีมูลค่าเพิ่ม / VAT ${money(pack.outputVatSatang)}</p>
  ${output}
  <h2>ภาษีซื้อ / Input VAT</h2>
  <p class="muted">บิลผู้ขายที่จับคู่แล้วในตารางภาษีซื้อ ใบลดหนี้ที่เชื่อมกันลดยอด ต้นทุนที่ยังไม่จับคู่ไม่ถูกรวม / Matched vendor bills already on the purchase VAT table. Linked credit notes reduce the total. Unmatched costs are left out.</p>
  <p>ฐานภาษี / Base ${money(pack.inputBaseSatang)} · ภาษีมูลค่าเพิ่ม / VAT ${money(pack.inputVatSatang)}</p>
  ${input}
  <h2>ผลต่างภาษีขายกับภาษีซื้อ / Output minus input</h2>
  <p>${money(pack.outputMinusInputVatSatang)}</p>
  <p class="muted">ผลต่างนี้เป็นข้อมูลประกอบ ไม่ใช่ภาษีที่ต้องชำระ และไม่ใช่การยื่นแบบ ภ.พ.30 / Support difference only. Not tax payable and not a ภ.พ.30 filing.</p>
  <h2>หัก ณ ที่จ่าย / Stored withholding</h2>
  <p class="muted">${escapeHtml(VENDOR_WHT_NOTE)}</p>
  ${wht}
</body>
</html>`
}

function invoiceLine(row: PackInvoiceRow): VatSupportLine {
  const total = nonNegative(row.totalSatang, "Invoice total")
  const vat = nonNegative(row.vatSatang, "Invoice VAT")
  const wht = nonNegative(row.whtSatang, "Invoice withholding")
  return {
    kind: "invoice",
    id: row.id,
    number: row.number || row.id,
    date: row.issueDate,
    partyKind: "customer",
    partyName: row.clientName || "Unassigned customer",
    taxId: row.clientTaxId,
    baseSatang: subtractSatang(total, vat),
    vatSatang: vat,
    whtSatang: wht,
    note: "Issued invoice",
  }
}

function creditLine(row: PackCreditRow): VatSupportLine {
  return {
    kind: "credit_note",
    id: row.id,
    number: row.number || row.id,
    date: row.issueDate,
    partyKind: "customer",
    partyName: row.buyerName || row.clientName || "Unassigned customer",
    taxId: row.buyerTaxId ?? row.clientTaxId,
    baseSatang: negate(nonNegative(row.baseSatang, "Credit note base")),
    vatSatang: negate(nonNegative(row.vatSatang, "Credit note VAT")),
    whtSatang: negate(nonNegative(row.whtSatang, "Credit note withholding")),
    note: row.originalNumber ? `Credit note against ${row.originalNumber}` : "Credit note",
  }
}

function purchaseLine(row: PackPurchaseLine): VatSupportLine {
  const amount = integerSatang(row.amountSatang, "Vendor bill total")
  const vat = integerSatang(row.inputVatSatang, "Input VAT")
  return {
    kind: row.kind === "bill" ? "vendor_bill" : row.kind === "credit" ? "vendor_credit" : row.kind === "return_adjustment" ? "return_adjustment" : "matched_cost",
    id: row.id,
    number: row.reference || row.id,
    date: row.billDate,
    partyKind: "vendor",
    partyName: row.vendorName || "Unassigned vendor",
    taxId: row.vendorTaxId,
    baseSatang: subtractSatang(amount, vat),
    vatSatang: vat,
    whtSatang: 0,
    note: "Matched vendor bill on the purchase VAT table",
  }
}

function groupCustomerWht(invoices: readonly PackInvoiceRow[], credits: readonly PackCreditRow[]): WhtPartyTotal[] {
  const parties = new Map<string, WhtPartyTotal>()
  for (const row of invoices) {
    if (row.whtSatang === 0) continue
    addParty(parties, row.clientId, row.clientName, row.clientTaxId, subtractSatang(nonNegative(row.totalSatang, "Invoice total"), nonNegative(row.vatSatang, "Invoice VAT")), nonNegative(row.whtSatang, "Invoice withholding"))
  }
  for (const row of credits) {
    if (row.whtSatang === 0) continue
    addParty(parties, row.clientId, row.clientName, row.clientTaxId, negate(nonNegative(row.baseSatang, "Credit note base")), negate(nonNegative(row.whtSatang, "Credit note withholding")))
  }
  return [...parties.values()].sort((a, b) => a.partyName.localeCompare(b.partyName, "th"))
}

function addParty(parties: Map<string, WhtPartyTotal>, partyId: string, name: string, taxId: string | null, baseSatang: number, whtSatang: number) {
  const key = partyId || name || "unassigned"
  const current = parties.get(key) ?? {
    partyKind: "customer" as const,
    partyId: key,
    partyName: name || "Unassigned customer",
    taxId,
    baseSatang: 0,
    whtSatang: 0,
    documentCount: 0,
  }
  current.baseSatang = sumSatang([current.baseSatang, baseSatang])
  current.whtSatang = sumSatang([current.whtSatang, whtSatang])
  current.documentCount += 1
  parties.set(key, current)
}

function summary(pack: AccountantPack, kind: string, base: Satang | "", vat: Satang | "", wht: Satang | "", note: string) {
  return ["summary", kind, "", pack.month, "", "", "", base === "" ? "" : baht(base), vat === "" ? "" : baht(vat), wht === "" ? "" : baht(wht), "", note]
}

function detail(section: string, row: VatSupportLine) {
  return [section, row.kind, row.number, row.date, row.partyKind, row.partyName, row.taxId ?? "", baht(row.baseSatang), baht(row.vatSatang), baht(row.whtSatang), row.id, row.note]
}

function linesTable(rows: readonly VatSupportLine[], empty: string): string {
  if (rows.length === 0) return `<p class="muted">${escapeHtml(empty)}</p>`
  const head = PACK_LINE_HEADERS.map((header, index) => `<th${index >= 5 ? ` class="num"` : ""}>${escapeHtml(header)}</th>`).join("")
  return `<table>
    <thead><tr>${head}</tr></thead>
    <tbody>${rows.map((row) => `<tr><td>${escapeHtml(packDateLabel(row.date))}</td><td>${escapeHtml(vatSupportKindLabel(row.kind))}</td><td>${escapeHtml(row.number)}</td><td>${escapeHtml(row.partyName)}</td><td>${escapeHtml(row.taxId ?? "")}</td><td class="num">${money(row.baseSatang)}</td><td class="num">${money(row.vatSatang)}</td><td class="num">${money(row.whtSatang)}</td></tr>`).join("")}</tbody>
  </table>`
}

function byDateThenNumber(a: VatSupportLine, b: VatSupportLine): number {
  return a.date.localeCompare(b.date) || a.number.localeCompare(b.number) || a.id.localeCompare(b.id)
}

function inMonth(date: string, month: string): boolean {
  return date.slice(0, 7) === month
}

function storedMoney(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error("Credit note snapshot is missing stored VAT or withholding")
  }
  return value
}

function integerSatang(value: number, label: string): Satang {
  if (!Number.isSafeInteger(value)) throw new Error(`${label} is not integer satang`)
  return value
}

function nonNegative(value: number, label: string): Satang {
  const amount = integerSatang(value, label)
  if (amount < 0) throw new Error(`${label} cannot be negative`)
  return amount
}

function negate(value: Satang): Satang {
  if (!Number.isSafeInteger(-value)) throw new Error("Unsafe integer-satang sum")
  return -value
}

function subtractSatang(total: Satang, part: Satang): Satang {
  if (!Number.isSafeInteger(total - part)) throw new Error("Unsafe integer-satang sum")
  return total - part
}

function baht(satang: Satang): string {
  return satangToBahtString(satang)
}

function money(satang: Satang): string {
  return escapeHtml(formatTHB(satang))
}
