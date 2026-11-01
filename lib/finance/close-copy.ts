import { buddhistEraLabel, withBuddhistEra } from "@/lib/dates"
import { WHT_RATES } from "@/lib/tax/totals"

/**
 * Display copy for operational month-end close.
 * Dates follow printable documents: Gregorian ISO plus พ.ศ.
 * VAT and withholding stay support data. Nothing here files a return.
 */

/** Standard Thai VAT rate in basis points. A stored document may use another rate. */
export const STANDARD_VAT_RATE_BPS = 700

export const BAHT_CAPTION_TH = "จำนวนเงินเป็นบาท"
export const BAHT_CAPTION_EN = "Amounts are baht (THB)."

export const CLOSE_STATE_LABEL = {
  clear: "ผ่าน / Clear",
  review: "ตรวจ / Review",
  info: "หมายเหตุ / Note",
} as const

/**
 * Gregorian date plus its Buddhist-era label.
 * `2026-01-31` → `2026-01-31 (31/01/2569)`. Invalid dates stay unchanged.
 */
export function closeDateLabel(isoDate: string): string {
  return withBuddhistEra(isoDate)
}

/** `2026-01` → `2026-01 (01/2569)`. A month that is not real stays unchanged. */
export function closeMonthLabel(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month
  const label = buddhistEraLabel(`${month}-01`)
  return label ? `${month} (${label.slice(3)})` : month
}

export const VAT_SUPPORT_TH =
  "ภาษีขายและภาษีซื้อคือยอดภาษีมูลค่าเพิ่มที่บันทึกในเอกสาร อัตรามาตรฐานคือ 7% เมื่อกิจการจดทะเบียนภาษีมูลค่าเพิ่ม เป็นข้อมูลประกอบ ไม่ใช่การยื่นแบบ ภ.พ.30"

export const VAT_SUPPORT_EN =
  "Output VAT and input VAT are the VAT amounts stored on the documents. The standard rate is 7% when the seller is VAT-registered. Support data for your accountant. Not a ภ.พ.30 filing."

/** Rates this app accepts, from the same list as document withholding. */
export function whtRateList(): string {
  return WHT_RATES.map((bps) => `${bps / 100}%`).join(", ")
}

export const WHT_SUPPORT_TH =
  `หัก ณ ที่จ่ายคือยอดที่บันทึกไว้ในใบแจ้งหนี้และใบลดหนี้ อัตราที่ระบบรับได้คือ ${whtRateList()} ไม่ใช่การยื่นแบบหัก ณ ที่จ่าย`

export const WHT_SUPPORT_EN =
  `Withholding is the amount already stored on issued invoices and credit notes. Rates in this app are ${whtRateList()}. This does not file a withholding return.`

export const OLLAMA_CLOSE_NOTE_UNAVAILABLE =
  "Ollama ยังไม่ทำงานบนเครื่องนี้ จึงไม่มีบันทึกที่เขียนให้ ตัวเลขด้านบนมาจากเวิร์กสเปซนี้ เริ่มด้วย ollama serve แล้ว ollama pull qwen3:4b ไม่มีข้อมูลถูกส่งไปโมเดลบนคลาวด์ / Ollama is not running on this machine, so there is no written note. The counts above are from this workspace. Start it with ollama serve, then ollama pull qwen3:4b. Nothing was sent to a cloud model."
