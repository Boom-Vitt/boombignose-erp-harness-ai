import { describe, expect, it } from "vitest"
import {
  CLOSE_ITEM_ORDER,
  canReviewMonthEndClose,
  monthEndCloseChecklist,
  previousCompletedMonth,
  type CloseChecklist,
  type CloseChecklistInput,
} from "@/lib/finance/close-checklist"

const tax = { legalName: "ร้านตัวอย่าง", address: "กรุงเทพ", taxId: "1234567890123", branchLabel: "สำนักงานใหญ่", taxStatus: "registered" as const }

function input(overrides: Partial<CloseChecklistInput> = {}): CloseChecklistInput {
  return {
    month: "2026-01",
    today: "2026-02-15",
    lockDate: null,
    viewerId: "viewer",
    invoices: [],
    bills: [],
    bankLines: [],
    claims: [],
    credits: [],
    purchaseVat: [],
    tax,
    ...overrides,
  }
}

function checklist(overrides: Partial<CloseChecklistInput> = {}): CloseChecklist {
  const result = monthEndCloseChecklist(input(overrides))
  if (!result.ok) throw new Error(result.error)
  return result.checklist
}

function item(list: CloseChecklist, id: CloseChecklist["items"][number]["id"]) {
  const found = list.items.find(row => row.id === id)
  if (!found) throw new Error(id)
  return found
}

describe("monthEndCloseChecklist", () => {
  it("is ready to close a quiet completed month", () => {
    const list = checklist()
    expect(list.periodEnd).toBe("2026-01-31")
    expect(list.ready).toBe(true)
    expect(list.closable).toBe(true)
    expect(list.alreadyClosed).toBe(false)
    expect(list.reviewCount).toBe(0)
    expect(list.items.map(row => row.id)).toEqual([...CLOSE_ITEM_ORDER])
    expect(list.items.filter(row => row.id !== "vat_support" && row.id !== "finance_lock").every(row => row.state === "clear")).toBe(true)
    expect(item(list, "vat_support")).toMatchObject({ state: "info", outputVatSatang: 0, inputVatSatang: 0, href: "/reports#purchase-vat" })
    expect(item(list, "finance_lock").detail).toContain("No lock date is set")
    expect(list.summary).toContain("พร้อมปิดงวด 2026-01")
    expect(list.summary).toContain("not a general-ledger close or a tax filing")
    expect(item(list, "vat_support").detail).toContain("Not a ภ.พ.30 filing")
    expect(item(list, "tax_profile").detail).toContain("statutory tax invoice")
    expect(list.items.some(row => row.detail.includes("e-Tax"))).toBe(false)
  })

  it("counts the open work an owner reviews before locking the month", () => {
    const list = checklist({
      invoices: [
        { status: "sent", issueDate: "2026-01-05", dueDate: "2026-01-20", amountSatang: 10000, paidSatang: 2500, creditedSatang: 500, vatSatang: 700 },
        { status: "sent", issueDate: "2026-01-06", dueDate: "2026-02-15", amountSatang: 8000, paidSatang: 0, creditedSatang: 0, vatSatang: 80 },
        { status: "sent", issueDate: "2026-01-06", dueDate: "2026-03-01", amountSatang: 8000, paidSatang: 0, creditedSatang: 0, vatSatang: 0 },
        { status: "paid", issueDate: "2026-01-06", dueDate: "2026-01-01", amountSatang: 1000, paidSatang: 1000, creditedSatang: 0, vatSatang: 70 },
        { status: "draft", issueDate: "2026-01-08", dueDate: "2026-01-01", amountSatang: 400, paidSatang: 0, creditedSatang: 0, vatSatang: 0 },
        { status: "draft", issueDate: "2026-02-02", dueDate: null, amountSatang: 50, paidSatang: 0, creditedSatang: 0, vatSatang: 0 },
        { status: "cancelled", issueDate: "2026-01-08", dueDate: "2026-01-01", amountSatang: 9000, paidSatang: 0, creditedSatang: 0, vatSatang: 900 },
        { status: "sent", issueDate: "2025-12-01", dueDate: "2025-12-15", amountSatang: 300, paidSatang: 0, creditedSatang: 0, vatSatang: 50 },
      ],
      bills: [
        { vendorId: "v", expenseClaimId: null, paidAt: null, dueDate: "2026-01-10", amountSatang: 3000, kind: "bill" },
        { vendorId: "v", expenseClaimId: null, paidAt: null, dueDate: "2026-03-01", amountSatang: 1000, kind: null },
        { vendorId: "v", expenseClaimId: null, paidAt: "2026-01-02", dueDate: "2026-01-01", amountSatang: 5000, kind: "bill" },
        { vendorId: "v", expenseClaimId: null, paidAt: null, dueDate: "2026-01-01", amountSatang: 200, kind: "credit" },
        { vendorId: "v", expenseClaimId: null, paidAt: null, dueDate: "2026-01-01", amountSatang: 100, kind: "return_adjustment" },
        { vendorId: null, expenseClaimId: "claim", paidAt: null, dueDate: "2026-01-01", amountSatang: 800, kind: null },
        { vendorId: "v", expenseClaimId: "claim", paidAt: null, dueDate: "2026-01-01", amountSatang: 800, kind: "bill" },
        { vendorId: "v", expenseClaimId: null, paidAt: null, dueDate: "2026-01-01", amountSatang: 0, kind: "bill" },
      ],
      bankLines: [
        { bookedOn: "2026-01-31", amountSatang: -1500, matched: false },
        { bookedOn: "2026-01-01", amountSatang: 400, matched: true },
        { bookedOn: "2026-02-01", amountSatang: 9000, matched: false },
        { bookedOn: "not-a-date", amountSatang: 100, matched: false },
      ],
      claims: [
        { status: "submitted", employeeId: "other" },
        { status: "submitted", employeeId: "viewer" },
        { status: "approved", employeeId: "other" },
        { status: "draft", employeeId: "other" },
      ],
      credits: [
        { issueDate: "2026-01-20", baseSatang: 100, totalSatang: 107 },
        { issueDate: "2025-12-20", baseSatang: 0, totalSatang: 50 },
      ],
      purchaseVat: [
        { month: "2026-01-01", inputVatSatang: 210 },
        { month: "2025-12-01", inputVatSatang: 999 },
      ],
      tax: { legalName: " ", address: "", taxId: "123", branchLabel: "", taxStatus: "unknown" },
    })

    expect(item(list, "overdue_ar")).toMatchObject({ state: "review", count: 2, amountSatang: 7300, href: "/finance?status=overdue" })
    expect(item(list, "unpaid_ap")).toMatchObject({ state: "review", count: 2, amountSatang: 4000, href: "/finance?tab=costs" })
    expect(item(list, "unpaid_ap").detail).toContain("1 past due as of 2026-02-15")
    expect(item(list, "unmatched_bank")).toMatchObject({ state: "review", count: 1, amountSatang: 1500, href: "/finance/bank" })
    expect(item(list, "unmatched_bank").detail).toContain("1 unmatched line booked after 2026-01-31 stays")
    expect(item(list, "draft_invoices")).toMatchObject({ state: "review", count: 1, amountSatang: 400, href: "/finance?status=draft" })
    expect(item(list, "draft_invoices").detail).toContain("1 draft invoice dated after 2026-01-31 stays open")
    expect(item(list, "expense_claims")).toMatchObject({ state: "review", count: 2, href: "/expenses?tab=approve" })
    expect(item(list, "expense_claims").detail).toContain("cannot approve your own claim")
    expect(item(list, "tax_profile")).toMatchObject({ state: "review", count: 5, href: "/finance/business-profile" })
    expect(item(list, "tax_profile").detail).toBe("Missing seller name, seller address, 13-digit tax ID, branch, VAT registration.")
    expect(item(list, "vat_support")).toMatchObject({ outputVatSatang: 700 + 80 + 70 - 7, inputVatSatang: 210 })
    expect(list.reviewCount).toBe(6)
    expect(list.ready).toBe(false)
    expect(list.summary).toContain("ตรวจก่อนปิดงวด 2026-01")
    expect(list.summary).toContain("does not clear this list")
  })

  it("sends a viewer who only has their own claim to their expense list", () => {
    const list = checklist({ claims: [{ status: "submitted", employeeId: "viewer" }] })
    expect(item(list, "expense_claims")).toMatchObject({ count: 1, href: "/expenses" })
  })

  it("keeps an unregistered seller profile clear without asking for a tax invoice", () => {
    const list = checklist({ tax: { ...tax, taxStatus: "not_registered" } })
    expect(item(list, "tax_profile").state).toBe("clear")
    expect(item(list, "tax_profile").detail).toContain("not registered")
    expect(item(list, "tax_profile").detail).toContain("operational invoices")
  })

  it("describes a lock that already covers the month and one that will extend", () => {
    const closed = checklist({ lockDate: "2026-01-31" })
    expect(closed.alreadyClosed).toBe(true)
    expect(closed.closable).toBe(false)
    expect(closed.summary).toContain("งวด 2026-01 ล็อกแล้ว")
    expect(closed.summary).toContain("Edits on or before the lock date are blocked")
    expect(item(closed, "finance_lock").detail).toContain("Locked through 2026-01-31")

    const extend = checklist({ lockDate: "2025-12-31" })
    expect(extend.closable).toBe(true)
    expect(item(extend, "finance_lock").detail).toContain("extends the block through 2026-01-31")
    expect(checklist({ lockDate: "" }).alreadyClosed).toBe(false)
  })

  it("refuses the current month and a month that is not a calendar month", () => {
    const open = checklist({ month: "2026-02", today: "2026-02-15" })
    expect(open.periodEnd).toBe("2026-02-28")
    expect(open.closable).toBe(false)
    expect(open.summary).toContain("Close a completed month. The current month stays open.")
    expect(monthEndCloseChecklist(input({ month: "2026-13" }))).toEqual({ ok: false, error: "Enter a month as YYYY-MM." })
    expect(monthEndCloseChecklist(input({ today: "today" }))).toEqual({ ok: false, error: "Enter today as YYYY-MM-DD." })
    expect(checklist({ month: "2024-02", today: "2024-03-01" }).periodEnd).toBe("2024-02-29")
  })

  it("rejects an amount that is not integer satang", () => {
    expect(() => checklist({ bills: [{ vendorId: "v", expenseClaimId: null, paidAt: null, dueDate: "2026-01-01", amountSatang: 1.5, kind: "bill" }] })).toThrow("Unsafe integer-satang sum")
  })
})

describe("close checklist access", () => {
  it("reviews for owners, admins, and an accountant", () => {
    expect(canReviewMonthEndClose("owner")).toBe(true)
    expect(canReviewMonthEndClose("admin")).toBe(true)
    expect(canReviewMonthEndClose("accountant")).toBe(true)
    expect(canReviewMonthEndClose("member")).toBe(false)
    expect(canReviewMonthEndClose("")).toBe(false)
  })

  it("picks the previous calendar month", () => {
    expect(previousCompletedMonth("2026-03-01")).toBe("2026-02")
    expect(previousCompletedMonth("2026-01-01")).toBe("2025-12")
    expect(previousCompletedMonth("2026-02-31")).toBeNull()
    expect(previousCompletedMonth("January")).toBeNull()
  })
})
