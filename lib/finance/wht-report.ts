import { toCsv } from "@/lib/export/csv"
import { type AccountantPack, type PackPurchaseWht } from "@/lib/finance/accountant-pack"
import { FILING_LIMIT_EN, FILING_LIMIT_TH } from "@/lib/finance/filing-responsibility"
import { satangToBahtString, sumSatang, type Satang } from "@/lib/money"

/**
 * Purchase withholding lists for the accountant: ภ.ง.ด.3 (individual payees) and
 * ภ.ง.ด.53 (company payees), one row per 50 ทวิ working-copy number. Totals come from
 * the same pack the VAT report uses. Not a filing and not a signed 50 ทวิ.
 */

export const WHT_REPORT_DISCLAIMER_TH = `รายการนี้เป็นข้อมูลประกอบสำหรับนักบัญชี ไม่ใช่การยื่นแบบ ภ.ง.ด.3 หรือ ภ.ง.ด.53 และเลขที่ WHT เป็นเลขอ้างอิงภายใน ไม่ใช่หนังสือรับรอง 50 ทวิ ที่ลงนามแล้ว ${FILING_LIMIT_TH}`
export const WHT_REPORT_DISCLAIMER_EN = `Support data for the external accountant only. Not a filing: these lists help prepare ภ.ง.ด.3 / ภ.ง.ด.53, and the WHT number is an internal working-copy reference, not a signed 50 ทวิ. ${FILING_LIMIT_EN}`

export const WHT_FORMS = ["pnd3", "pnd53"] as const
export type WhtForm = (typeof WHT_FORMS)[number]
export const WHT_FORM_LABEL: Record<WhtForm, { th: string; en: string }> = {
  pnd3: { th: "ภ.ง.ด.3 (ผู้รับเป็นบุคคลธรรมดา)", en: "ภ.ง.ด.3 (individual payees)" },
  pnd53: { th: "ภ.ง.ด.53 (ผู้รับเป็นนิติบุคคล)", en: "ภ.ง.ด.53 (company payees)" },
}
export const WHT_INCOME_LABEL: Record<string, { th: string; en: string }> = {
  service_40_8: { th: "ค่าบริการ (40(8))", en: "Service fees (40(8))" },
  professional_40_6: { th: "วิชาชีพอิสระ (40(6))", en: "Professional fees (40(6))" },
  contract_40_7: { th: "รับเหมา (40(7))", en: "Contract work (40(7))" },
  rent_40_5: { th: "ค่าเช่า (40(5))", en: "Rent (40(5))" },
  royalty_40_3: { th: "ค่าลิขสิทธิ์ (40(3))", en: "Royalty (40(3))" },
  other: { th: "อื่น ๆ", en: "Other" },
}

export type WhtList = {
  form: WhtForm
  rows: PackPurchaseWht[]
  baseSatang: Satang
  whtSatang: Satang
  /** Rows with no payee tax ID, which the accountant must complete. */
  missingTaxId: number
}

export type WhtReport = {
  month: string
  orgName: string
  lists: WhtList[]
  whtSatang: Satang
}

export function buildWhtReport(pack: AccountantPack, only?: WhtForm): WhtReport {
  const lists = WHT_FORMS.filter((form) => !only || form === only).map((form): WhtList => {
    const rows = pack.purchaseWht.filter((row) => row.form === form)
    return {
      form,
      rows,
      baseSatang: sumSatang(rows.map((row) => row.baseSatang)),
      whtSatang: sumSatang(rows.map((row) => row.whtSatang)),
      missingTaxId: rows.filter((row) => !row.vendorTaxId?.trim()).length,
    }
  })
  const report = { month: pack.month, orgName: pack.orgName, lists, whtSatang: sumSatang(lists.map((list) => list.whtSatang)) }
  // The full report must equal the pack's purchase withholding total.
  if (!only && report.whtSatang !== pack.purchaseWhtSatang) throw new Error("WHT report does not match the accountant pack for this month")
  return report
}

export const WHT_REPORT_CSV_HEADERS = ["Section", "Form", "WHT number", "Paid on", "Payee", "Payee tax ID", "Income type", "Rate (%)", "Base (THB)", "WHT (THB)", "Note"]

export function whtReportCsv(report: WhtReport): string {
  const note = (text: string) => ["summary", "", "", report.month, "", "", "", "", "", "", text]
  return toCsv(WHT_REPORT_CSV_HEADERS, [
    note(`disclaimer_th: ${WHT_REPORT_DISCLAIMER_TH}`),
    note(`disclaimer_en: ${WHT_REPORT_DISCLAIMER_EN}`),
    ...report.lists.map((list) => ["summary", list.form, "", report.month, "", "", "", "", satangToBahtString(list.baseSatang), satangToBahtString(list.whtSatang), `${list.rows.length} rows, ${list.missingTaxId} without payee tax ID`]),
    ...report.lists.flatMap((list) => list.rows.map((row) => [
      "line", row.form, row.certificateNo, row.paidOn, row.vendorName, row.vendorTaxId ?? "",
      WHT_INCOME_LABEL[row.incomeType]?.en ?? row.incomeType, row.rateBps / 100, satangToBahtString(row.baseSatang), satangToBahtString(row.whtSatang),
      row.vendorTaxId?.trim() ? "" : "Payee tax ID missing",
    ])),
  ])
}
