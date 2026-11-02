/** Pure parsing of the local vision model's receipt reply into prefill values for an expense line. No I/O. */

export type ReceiptDraft = { vendor: string; spent_on: string; amountBaht: string; vatBaht: string | null; description: string }

const BE_OFFSET = 543

function amount(raw: unknown): string | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw.replace(/[,฿\s]|THB|บาท/gi, "")) : NaN
  return Number.isFinite(n) && n > 0 && n < 1e9 ? n.toFixed(2) : null
}

/** Accepts YYYY-MM-DD or D/M/YYYY, in Gregorian or Buddhist years. */
function isoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const text = raw.trim()
  const ymd = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  const dmy = text.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  const parts = ymd ? ymd.slice(1).map(Number) : dmy ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])] : null
  if (!parts) return null
  const [rawYear, mo, d] = parts
  const y = rawYear > 2400 ? rawYear - BE_OFFSET : rawYear
  const iso = `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
  const t = new Date(`${iso}T00:00:00Z`)
  return t.getUTCFullYear() === y && t.getUTCMonth() + 1 === mo && t.getUTCDate() === d ? iso : null
}

export function parseReceiptDraft(text: string): ReceiptDraft | null {
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end < start) return null
  let data: Record<string, unknown>
  try { data = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  const total = amount(data.total)
  const spent_on = isoDate(data.date)
  const vendor = typeof data.vendor === "string" ? data.vendor.trim().slice(0, 120) : ""
  if (!total || !spent_on || !vendor) return null
  const items = typeof data.items === "string" ? data.items.trim() : ""
  return { vendor, spent_on, amountBaht: total, vatBaht: amount(data.vat), description: (items ? `${vendor} — ${items}` : vendor).slice(0, 1000) }
}
