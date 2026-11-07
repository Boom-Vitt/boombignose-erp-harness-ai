import { serviceAmountSatang } from "@/lib/workflows/service"
import { emptyOcrFields, type OcrFields } from "./contracts"

/** Strict printed THB: grouping must be correct; never round or strip arbitrary characters. */
export function printedMoneySatang(raw: unknown): number | null {
  if (typeof raw !== "string" || raw.length > 40) return null
  const text = raw.trim().replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 0x0e50)).replace(/^(?:฿|THB)\s*/i, "").replace(/\s*(?:บาท|THB)$/i, "")
  if (!/^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text)) return null
  try { return serviceAmountSatang(text.replaceAll(",", "")) } catch { return null }
}

const THAI_MONTHS = [
  "มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน",
  "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม",
] as const

/** Named Thai months and BE/ISO dates are explicit; ambiguous numeric D/M dates stay unknown. */
export function printedDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const text = raw.trim().replace(/[๐-๙]/g, digit => String(digit.charCodeAt(0) - 0x0e50))
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text)
  const thai = /^(\d{1,2})\s+([ก-๙]+)\s+(\d{4})$/.exec(text)
  const thaiMonth = thai ? THAI_MONTHS.findIndex(month => month === thai[2]) + 1 : 0
  if (!iso && !dmy && !thaiMonth) return null
  const rawYear = Number(iso ? iso[1] : dmy ? dmy[3] : thai![3])
  const month = iso ? Number(iso[2]) : dmy ? Number(dmy[2]) : thaiMonth
  const day = Number(iso ? iso[3] : dmy ? dmy[1] : thai![1])
  if (dmy && rawYear < 2400 && day <= 12 && month <= 12 && day !== month) return null
  const year = rawYear >= 2400 ? rawYear - 543 : rawYear
  if (year < 1900 || year > 2200) return null
  const result = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
  const date = new Date(`${result}T00:00:00Z`)
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day ? result : null
}

/** Structured pass is advisory and must quote values actually present in the verbatim pass. */
export function parseOcrFields(raw: string, source: string): { fields: OcrFields; warnings: string[] } {
  const fields = emptyOcrFields()
  const warnings: string[] = []
  let data: Record<string, unknown>
  try {
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object required")
    data = value as Record<string, unknown>
  } catch { return { fields, warnings: ["Structured fields could not be read; use the source text and enter fields manually."] } }
  function quoted(key: string, max: number): string | null {
    const value = data[key]
    if (value === null || value === undefined) return null
    if (typeof value !== "string" || !value.trim() || value.length > max || /\[unreadable\]|^(?:unknown|n\/a|null)$/i.test(value.trim()) || !source.includes(value.trim())) {
      warnings.push(`${key}: unsupported by the extracted source; left unknown.`)
      return null
    }
    return value.trim()
  }
  fields.vendor = quoted("vendor", 200)
  fields.documentNumber = quoted("documentNumber", 200)
  fields.description = quoted("description", 1000)
  const date = quoted("date", 30)
  fields.date = printedDate(date)
  if (date && !fields.date) warnings.push("Date is invalid or day/month order is ambiguous; left unknown.")
  for (const [key, target] of [["subtotal", "subtotalSatang"], ["vat", "vatSatang"], ["total", "totalSatang"]] as const) {
    const value = quoted(key, 40)
    fields[target] = printedMoneySatang(value)
    if (value && fields[target] === null) warnings.push(`${key}: malformed THB amount; left unknown (no rounding).`)
  }
  if (/(?:\b(?:USD|EUR|GBP|JPY|CNY|SGD|AUD|MYR|LAK|KHR|MMK)\b|[$€£¥])/i.test(source)) {
    fields.totalSatang = null
    fields.vatSatang = null
    fields.subtotalSatang = null
    warnings.push("Foreign or mixed currency found; monetary fields left unknown. THB conversion is never inferred.")
  }
  if (fields.totalSatang !== null && fields.totalSatang <= 0) {
    fields.totalSatang = null
    warnings.push("Total must be above zero; left unknown.")
  }
  if (fields.vatSatang !== null && (fields.totalSatang === null || fields.vatSatang > fields.totalSatang)) {
    fields.vatSatang = null
    warnings.push("VAT cannot be checked against a valid total; left unknown.")
  }
  if (fields.subtotalSatang !== null && fields.totalSatang !== null && (fields.subtotalSatang > fields.totalSatang || (fields.vatSatang !== null && fields.subtotalSatang + fields.vatSatang !== fields.totalSatang))) {
    fields.subtotalSatang = null
    fields.vatSatang = null
    warnings.push("Subtotal + VAT does not equal total exactly in satang; subtotal/VAT left unknown. Check discounts and other charges manually.")
  }
  warnings.push("VAT is transcribed only, not calculated or certified. Verify tax invoice eligibility, rate, discounts and totals manually.")
  return { fields, warnings }
}

export type OcrReviewValues = { vendor: string; date: string; documentNumber: string; description: string; total: string; vat: string; subtotal: string }

/** Human edits are revalidated, and no consumer may apply them without an explicit review acknowledgement. */
export function reviewOcrFields(values: OcrReviewValues, reviewed: boolean): { fields: OcrFields; error?: never } | { fields?: never; error: string } {
  if (!reviewed) return { error: "Compare every suggestion with the original and acknowledge review first." }
  const totalSatang = printedMoneySatang(values.total), vatSatang = printedMoneySatang(values.vat), subtotalSatang = printedMoneySatang(values.subtotal)
  if (values.vendor.length > 200 || values.documentNumber.length > 200 || values.description.length > 1000) return { error: "A reviewed text field exceeds its form limit." }
  if ((values.date && !printedDate(values.date)) || (values.total && (totalSatang === null || totalSatang <= 0)) || (values.vat && vatSatang === null) || (values.subtotal && subtotalSatang === null)) {
    return { error: "Use a valid date and nonnegative THB amounts with at most two decimal places; total must be above zero. No rounding is allowed." }
  }
  if ((vatSatang !== null && (totalSatang === null || vatSatang > totalSatang)) || (subtotalSatang !== null && totalSatang !== null && (subtotalSatang > totalSatang || (vatSatang !== null && subtotalSatang + vatSatang !== totalSatang)))) {
    return { error: "Review subtotal + VAT = total exactly in satang. Clear unknown amounts rather than guessing." }
  }
  return { fields: { vendor: values.vendor.trim() || null, date: printedDate(values.date), documentNumber: values.documentNumber.trim() || null, description: values.description.trim() || null, totalSatang, vatSatang, subtotalSatang } }
}
