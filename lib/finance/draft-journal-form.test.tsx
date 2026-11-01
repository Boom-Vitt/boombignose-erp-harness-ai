import { createElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock("@/app/(app)/finance/journal/actions", () => ({ postDraftJournal: vi.fn() }))

import { JournalForm } from "@/app/(app)/finance/journal/journal-form"

const accounts = [
  { code: "1110", nameTh: "เงินสด", nameEn: "Cash" },
  { code: "4100", nameTh: "รายได้จากการขาย", nameEn: "Sales" },
]

describe("draft journal form", () => {
  it("asks for a balanced post and refuses an open period", () => {
    const open = renderToStaticMarkup(createElement(JournalForm, { accounts, lockDate: null }))
    expect(open).toContain("Post a journal only into a closed period.")
    expect(open).toContain("บันทึกรายวัน / Post draft journal")
    expect(open).toContain("disabled")

    const closed = renderToStaticMarkup(createElement(JournalForm, { accounts, lockDate: "2026-01-31" }))
    expect(closed).toContain("2026-01-31")
    expect(closed).toContain("1110 · เงินสด / Cash")
    expect(closed).toContain("4100 · รายได้จากการขาย / Sales")
    expect(closed).toContain("type=\"submit\"")
    expect(closed).not.toContain("Post a journal only into a closed period.")
    expect(closed).not.toMatch(/ยื่นแบบสำเร็จ|e-Tax Invoice|signed statutory books/)
  })
})
