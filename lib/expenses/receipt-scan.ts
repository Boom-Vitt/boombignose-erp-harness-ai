import type { OcrFields } from "@/lib/ocr/contracts"
import { serviceAmountBaht } from "@/lib/workflows/service"
import { printedDate } from "@/lib/ocr/fields"

export type ReceiptDraft = { vendor: string; spent_on: string; amountBaht: string; vatBaht: string | null; description: string }

/** Review-only adapter. Unknown fields never overwrite a user's form with a fabricated default. */
export function reviewedReceiptDraft(fields: OcrFields): ReceiptDraft | null {
  if (!fields.vendor?.trim() || !fields.date || printedDate(fields.date) !== fields.date || fields.totalSatang === null || !Number.isSafeInteger(fields.totalSatang) || fields.totalSatang <= 0) return null
  if (fields.vatSatang !== null && (!Number.isSafeInteger(fields.vatSatang) || fields.vatSatang < 0 || fields.vatSatang > fields.totalSatang)) return null
  return {
    vendor: fields.vendor,
    spent_on: fields.date,
    amountBaht: serviceAmountBaht(fields.totalSatang),
    vatBaht: fields.vatSatang === null ? null : serviceAmountBaht(fields.vatSatang),
    description: (fields.description ? `${fields.vendor} — ${fields.description}` : fields.vendor).slice(0, 1000),
  }
}
