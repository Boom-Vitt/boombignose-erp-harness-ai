import { createHash } from "node:crypto"
import { isCalendarDate } from "@/lib/finance/close-window"
import type { TrialBalance } from "@/lib/finance/trial-balance"

/**
 * Acceptance of a draft trial balance inside a locked period.
 * It is a step toward a legal close. It is not a statutory sign-off
 * and not a ภ.พ.30 filing. Purchases and expenses that were never
 * posted are not in the accepted figures.
 */

export const DRAFT_CLOSE_ACCEPTANCE_TH =
  "การรับนี้คือการยอมรับงบทดลองจากบันทึกรายวันฉบับร่างในช่วงที่ล็อกแล้ว เป็นก้าวไปสู่การปิดงบตามกฎหมาย ไม่ใช่การลงนามงบการเงิน และไม่ใช่การยื่นแบบ ภ.พ.30 รายการซื้อและค่าใช้จ่ายที่ยังไม่ได้ลงบันทึกไม่ได้อยู่ในยอดนี้"

export const DRAFT_CLOSE_ACCEPTANCE_EN =
  "This acceptance is of the draft trial balance for a locked period. It is a step toward a legal close. It is not a statutory sign-off and not a ภ.พ.30 filing. Purchases and expenses that are not in the draft journal are not in these figures."

export const DRAFT_CLOSE_DUAL_EN =
  "When more than one owner, admin, or accountant can accept, a different one of them confirms."

export type DraftCloseFigures = {
  through: string
  debitSatang: number
  creditSatang: number
  lineCount: number
  sha256: string
}

export type DraftCloseCheck =
  | { ok: true; figures: DraftCloseFigures }
  | { ok: false; error: string }

/** Stable text for the accepted figures. A blank line remains when there are no account rows. */
export function draftCloseFiguresPayload(through: string, balance: TrialBalance): string {
  const rows = balance.rows.map(row => `${row.code} ${row.debitSatang} ${row.creditSatang}`).join("\n")
  return ["v1", through, rows, String(balance.debitSatang), String(balance.creditSatang), String(balance.lineCount)].join("\n")
}

export function draftCloseFiguresSha256(payload: string): string {
  return createHash("sha256").update(payload, "utf8").digest("hex")
}

/** Refuse an open period and a trial balance whose debits do not equal its credits. */
export function draftCloseAcceptance(lockDate: string | null, through: string | null, balance: TrialBalance | null): DraftCloseCheck {
  if (!through || !isCalendarDate(through)) return { ok: false, error: "Accept a draft close only inside a locked period." }
  if (!lockDate || !isCalendarDate(lockDate) || through > lockDate) return { ok: false, error: "Accept a draft close only inside a locked period." }
  if (!balance || !balance.balanced) return { ok: false, error: "Accept a trial balance only when debits equal credits." }
  const payload = draftCloseFiguresPayload(through, balance)
  return {
    ok: true,
    figures: {
      through,
      debitSatang: balance.debitSatang,
      creditSatang: balance.creditSatang,
      lineCount: balance.lineCount,
      sha256: draftCloseFiguresSha256(payload),
    },
  }
}
