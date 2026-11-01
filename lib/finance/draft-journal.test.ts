import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { DRAFT_JOURNAL_LIMIT_EN, DRAFT_JOURNAL_LIMIT_TH, draftJournalLines, journalAmountSatang, journalDateInClosedPeriod, journalMemo } from "@/lib/finance/draft-journal"

const accounts = ["1110", "4100"]

describe("draft journal", () => {
  it("accepts balanced lines inside a closed period", () => {
    expect(journalDateInClosedPeriod("2026-01-15", "2026-01-31")).toEqual({ ok: true, debitSatang: 0 })
    expect(journalMemo("  ขายเงินสด  ")).toEqual({ ok: true, memo: "ขายเงินสด" })
    expect(draftJournalLines([
      { accountCode: "1110", debitSatang: 10700, creditSatang: 0 },
      { accountCode: "4100", debitSatang: 0, creditSatang: 10700 },
    ], accounts)).toEqual({ ok: true, debitSatang: 10700 })
  })

  it("refuses an open period, an unbalanced journal, and a line that is both sides", () => {
    expect(journalDateInClosedPeriod("2026-02-01", "2026-01-31")).toEqual({ ok: false, error: "Post a journal only into a closed period." })
    expect(journalDateInClosedPeriod("2026-01-31", null)).toEqual({ ok: false, error: "Post a journal only into a closed period." })
    expect(draftJournalLines([
      { accountCode: "1110", debitSatang: 100, creditSatang: 0 },
      { accountCode: "4100", debitSatang: 0, creditSatang: 90 },
    ], accounts)).toEqual({ ok: false, error: "Journal debits and credits do not balance." })
    expect(draftJournalLines([
      { accountCode: "1110", debitSatang: 100, creditSatang: 100 },
      { accountCode: "4100", debitSatang: 0, creditSatang: 100 },
    ], accounts)).toEqual({ ok: false, error: "A journal line is debit or credit, not both." })
    expect(draftJournalLines([{ accountCode: "1110", debitSatang: 100, creditSatang: 0 }], accounts)).toEqual({ ok: false, error: "A journal needs 2 to 20 lines." })
    expect(draftJournalLines([
      { accountCode: "9999", debitSatang: 100, creditSatang: 0 },
      { accountCode: "4100", debitSatang: 0, creditSatang: 100 },
    ], accounts)).toEqual({ ok: false, error: "Journal line account is not on the chart." })
  })

  it("reads baht at the form edge and refuses a third decimal", () => {
    expect(journalAmountSatang("")).toEqual({ ok: true, satang: 0 })
    expect(journalAmountSatang(" 107 ")).toEqual({ ok: true, satang: 10700 })
    expect(journalAmountSatang("10.5")).toEqual({ ok: true, satang: 1050 })
    expect(journalAmountSatang("10.555")).toEqual({ ok: false, error: "Journal line amount must be integer satang." })
  })

  it("does not call the journal signed statutory books or a filing", () => {
    const copy = `${DRAFT_JOURNAL_LIMIT_TH} ${DRAFT_JOURNAL_LIMIT_EN}`
    expect(copy).toContain("ไม่ใช่การยื่นแบบ ภ.พ.30")
    expect(copy).toContain("not signed statutory books")
    expect(copy).not.toMatch(/ยื่นแบบสำเร็จ|filed successfully|e-Tax Invoice/)
    const sql = readFileSync("supabase/migrations/20261101180000_draft_journal.sql", "utf8")
    for (const message of [
      "Post a journal only into a closed period.",
      "Enter a journal date.",
      "Enter a journal memo.",
      "A journal needs 2 to 20 lines.",
      "Journal line account is not on the chart.",
      "Journal line amount must be integer satang.",
      "A journal line is debit or credit, not both.",
      "A journal line needs an amount.",
      "Journal debits and credits do not balance.",
      "journal_draft_posted",
      "not signed statutory books",
      "filing",
    ]) expect(sql).toContain(message)
    expect(sql).toContain("'entryId','entryDate','debitSatang','lineCount'")
    expect(sql).not.toMatch(/ยื่นแบบสำเร็จ|e-Tax Invoice/)
  })
})
