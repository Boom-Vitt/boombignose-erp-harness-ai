import { describe, expect, it } from "vitest"
import { WHT_RATES } from "@/lib/tax/totals"
import {
  BAHT_CAPTION_EN,
  BAHT_CAPTION_TH,
  OLLAMA_CLOSE_NOTE_UNAVAILABLE,
  STANDARD_VAT_RATE_BPS,
  VAT_SUPPORT_EN,
  VAT_SUPPORT_TH,
  WHT_SUPPORT_EN,
  WHT_SUPPORT_TH,
  closeDateLabel,
  closeMonthLabel,
  whtRateList,
} from "@/lib/finance/close-copy"

describe("close display copy", () => {
  it("shows a Gregorian date with its Buddhist-era label", () => {
    expect(closeDateLabel("2026-01-31")).toBe("2026-01-31 (31/01/2569)")
    expect(closeDateLabel("2024-02-29")).toBe("2024-02-29 (29/02/2567)")
    expect(closeDateLabel("2026-02-29")).toBe("2026-02-29")
    expect(closeDateLabel("2026-02-31")).toBe("2026-02-31")
    expect(closeMonthLabel("2026-01")).toBe("2026-01 (01/2569)")
    expect(closeMonthLabel("2025-12")).toBe("2025-12 (12/2568)")
    expect(closeDateLabel("2026-01-01")).toBe("2026-01-01 (01/01/2569)")
    expect(closeMonthLabel("2026-13")).toBe("2026-13")
    expect(closeMonthLabel("January")).toBe("January")
  })

  it("names baht, VAT 7%, and the withholding rates already stored on documents", () => {
    expect(STANDARD_VAT_RATE_BPS).toBe(700)
    expect(BAHT_CAPTION_TH).toContain("บาท")
    expect(BAHT_CAPTION_EN).toMatch(/baht/i)
    expect(VAT_SUPPORT_TH).toContain("7%")
    expect(VAT_SUPPORT_TH).toContain("ไม่ใช่การยื่นแบบ ภ.พ.30")
    expect(VAT_SUPPORT_EN).toContain("7%")
    expect(VAT_SUPPORT_EN).toContain("Not a ภ.พ.30 filing")
    expect(whtRateList()).toBe(WHT_RATES.map((bps) => `${bps / 100}%`).join(", "))
    expect(WHT_SUPPORT_TH).toContain("0%, 1%, 2%, 3%, 5%")
    expect(WHT_SUPPORT_TH).toContain("ไม่ใช่การยื่นแบบหัก ณ ที่จ่าย")
    expect(WHT_SUPPORT_EN).toContain("0%, 1%, 2%, 3%, 5%")
    expect(WHT_SUPPORT_EN).toMatch(/does not file a withholding return/)
    for (const text of [VAT_SUPPORT_TH, VAT_SUPPORT_EN, WHT_SUPPORT_TH, WHT_SUPPORT_EN, OLLAMA_CLOSE_NOTE_UNAVAILABLE]) {
      expect(text).not.toMatch(/ยื่นแบบสำเร็จ|filed successfully|e-Tax Invoice/i)
    }
  })

  it("tells the owner the month-end note stays on this machine when Ollama is down", () => {
    expect(OLLAMA_CLOSE_NOTE_UNAVAILABLE).toContain("Settings")
    expect(OLLAMA_CLOSE_NOTE_UNAVAILABLE).toContain("ไม่ต้องลงแอป AI แยก")
    expect(OLLAMA_CLOSE_NOTE_UNAVAILABLE).toContain("ไม่มีข้อมูลถูกส่งไปโมเดลบนคลาวด์")
    expect(OLLAMA_CLOSE_NOTE_UNAVAILABLE).toContain("Nothing was sent to a cloud model")
  })
})
