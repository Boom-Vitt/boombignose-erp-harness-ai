import { toCsv } from "@/lib/export/csv"
import { ACCOUNTANT_PACK_DISCLAIMER_EN, ACCOUNTANT_PACK_DISCLAIMER_TH, vatSupportKindLabel, type AccountantPack, type VatSupportLine } from "@/lib/finance/accountant-pack"
import { FILING_LIMIT_EN, FILING_LIMIT_TH } from "@/lib/finance/filing-responsibility"
import { satangToBahtString, sumSatang, type Satang } from "@/lib/money"

/**
 * ภ.พ.30-style monthly VAT support. Every figure is derived from the accountant
 * pack lines, so month totals equal the pack by construction. Abbreviated tax
 * invoices (ABB-…) are rolled into one row per day. Not a filing.
 */

export const VAT_REPORT_DISCLAIMER_TH = `${ACCOUNTANT_PACK_DISCLAIMER_TH} รายงานนี้เป็นข้อมูลประกอบ ไม่ใช่การยื่นแบบ ภ.พ.30 และไม่ใช่ e-Tax. ${FILING_LIMIT_TH}`
export const VAT_REPORT_DISCLAIMER_EN = `${ACCOUNTANT_PACK_DISCLAIMER_EN} This report is a ภ.พ.30-style support summary, not a filing and not e-Tax. ${FILING_LIMIT_EN}`

export type VatReportRow = {
  kind: VatSupportLine["kind"] | "abb_daily"
  date: string
  /** One document number, or first … last for a rolled ABB day. */
  number: string
  documents: number
  partyName: string
  taxId: string | null
  baseSatang: Satang
  vatSatang: Satang
}

export type VatReport = {
  month: string
  orgName: string
  output: VatReportRow[]
  input: VatReportRow[]
  outputBaseSatang: Satang
  outputVatSatang: Satang
  inputBaseSatang: Satang
  inputVatSatang: Satang
  /** Output minus input VAT. Support difference, not tax payable. */
  netVatSatang: Satang
}

export function isAbbNumber(number: string): boolean {
  return number.startsWith("ABB-")
}

function toRow(line: VatSupportLine): VatReportRow {
  return { kind: line.kind, date: line.date, number: line.number, documents: 1, partyName: line.partyName, taxId: line.taxId, baseSatang: line.baseSatang, vatSatang: line.vatSatang }
}

/** Roll issued ABB invoices into one row per day; every other line stays one row. */
export function rollAbbDaily(lines: readonly VatSupportLine[]): VatReportRow[] {
  const days = new Map<string, VatSupportLine[]>()
  const rows: VatReportRow[] = []
  for (const line of lines) {
    if (line.kind === "invoice" && isAbbNumber(line.number)) {
      days.set(line.date, [...(days.get(line.date) ?? []), line])
    } else {
      rows.push(toRow(line))
    }
  }
  for (const [date, group] of days) {
    const numbers = group.map((line) => line.number).sort()
    rows.push({
      kind: "abb_daily",
      date,
      number: numbers.length === 1 ? numbers[0]! : `${numbers[0]} … ${numbers[numbers.length - 1]}`,
      documents: group.length,
      partyName: "ผู้ซื้อทั่วไป / Retail buyers (ABB)",
      taxId: null,
      baseSatang: sumSatang(group.map((line) => line.baseSatang)),
      vatSatang: sumSatang(group.map((line) => line.vatSatang)),
    })
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))
}

export function buildVatReport(pack: AccountantPack): VatReport {
  const output = rollAbbDaily(pack.outputLines)
  const input = pack.inputLines.map(toRow)
  const report: VatReport = {
    month: pack.month,
    orgName: pack.orgName,
    output,
    input,
    outputBaseSatang: sumSatang(output.map((row) => row.baseSatang)),
    outputVatSatang: sumSatang(output.map((row) => row.vatSatang)),
    inputBaseSatang: sumSatang(input.map((row) => row.baseSatang)),
    inputVatSatang: sumSatang(input.map((row) => row.vatSatang)),
    netVatSatang: pack.outputMinusInputVatSatang,
  }
  // The roll-up must not move a satang. A mismatch means the pack and this report disagree.
  if (report.outputBaseSatang !== pack.outputBaseSatang || report.outputVatSatang !== pack.outputVatSatang
    || report.inputBaseSatang !== pack.inputBaseSatang || report.inputVatSatang !== pack.inputVatSatang) {
    throw new Error("VAT report does not match the accountant pack for this month")
  }
  return report
}

export function vatRowLabel(row: VatReportRow): string {
  return row.kind === "abb_daily" ? "ใบกำกับภาษีอย่างย่อ รายวัน / Abbreviated tax invoices, daily" : vatSupportKindLabel(row.kind)
}

export const VAT_REPORT_CSV_HEADERS = ["Section", "Kind", "Number", "Date", "Documents", "Party", "Tax ID", "Base (THB)", "VAT (THB)", "Note"]

export function vatReportCsv(report: VatReport): string {
  const note = (text: string) => ["summary", "", "", report.month, "", "", "", "", "", text]
  const line = (section: string, row: VatReportRow) => [section, row.kind, row.number, row.date, row.documents, row.partyName, row.taxId ?? "", satangToBahtString(row.baseSatang), satangToBahtString(row.vatSatang), vatRowLabel(row)]
  return toCsv(VAT_REPORT_CSV_HEADERS, [
    note(`disclaimer_th: ${VAT_REPORT_DISCLAIMER_TH}`),
    note(`disclaimer_en: ${VAT_REPORT_DISCLAIMER_EN}`),
    ["summary", "output_vat", "", report.month, "", "", "", satangToBahtString(report.outputBaseSatang), satangToBahtString(report.outputVatSatang), "Output VAT support"],
    ["summary", "input_vat", "", report.month, "", "", "", satangToBahtString(report.inputBaseSatang), satangToBahtString(report.inputVatSatang), "Input VAT support"],
    ["summary", "output_minus_input", "", report.month, "", "", "", "", satangToBahtString(report.netVatSatang), "Support difference only. Not tax payable."],
    ...report.output.map((row) => line("output_vat", row)),
    ...report.input.map((row) => line("input_vat", row)),
  ])
}
