import { beforeEach, expect, it, vi } from "vitest"

const { from, state } = vi.hoisted(() => ({
  from: vi.fn(),
  state: { role: "owner", userId: "viewer" },
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "active-org", userId: state.userId, role: state.role }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }))
vi.mock("@/lib/dates", async importOriginal => ({ ...(await importOriginal<object>()), todayISO: () => "2026-02-15" }))

import { loadMonthEndCloseChecklist } from "@/lib/finance/close-checklist-load"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"

const invoice = (org: string, id: string, extra: Record<string, unknown>) => ({
  org_id: org, id, status: "sent", issue_date: "2026-01-05", due_date: "2026-01-20", amount_satang: 100, vat_satang: 7, ...extra,
})

function serve() {
  const client = databaseFixture({
    org_settings: [
      { org_id: "other-org", lock_date: "2099-12-31", legal_name: "FOREIGN", business_address: "อื่น", tax_id: "1234567890123", branch_label: "สาขา", tax_status: "registered" },
      { org_id: "active-org", lock_date: null, legal_name: "", business_address: "", tax_id: "", branch_label: "", tax_status: "yes" },
    ],
    invoices: [
      invoice("other-org", "foreign-invoice", { amount_satang: 999999, vat_satang: 999 }),
      invoice("active-org", "local-invoice", { amount_satang: 5000, vat_satang: 700 }),
      invoice("active-org", "local-draft", { status: "draft", amount_satang: 100, vat_satang: 0, due_date: null }),
    ],
    invoice_balances: [
      { org_id: "other-org", invoice_id: "foreign-invoice", paid_satang: 0, credited_satang: 0 },
      { org_id: "active-org", invoice_id: "local-invoice", paid_satang: 1000, credited_satang: 0 },
    ],
    costs: [
      { org_id: "other-org", id: "foreign-bill", vendor_id: "v", expense_claim_id: null, paid_at: null, due_date: "2026-01-01", amount_satang: 8888, purchase_cost_kind: "bill" },
      { org_id: "active-org", id: "local-bill", vendor_id: "v", expense_claim_id: null, paid_at: null, due_date: "2026-01-01", amount_satang: 2000, purchase_cost_kind: "bill" },
    ],
    bank_lines: [
      { org_id: "other-org", id: "foreign-line", booked_on: "2026-01-15", amount_satang: 50, matched_payment_id: null },
      { org_id: "active-org", id: "local-line", booked_on: "2026-01-15", amount_satang: 400, matched_payment_id: null },
      { org_id: "active-org", id: "matched-line", booked_on: "2026-01-10", amount_satang: 400, matched_payment_id: "pay" },
    ],
    expense_claims: [
      { org_id: "other-org", id: "foreign-claim", status: "submitted", employee: "someone" },
      { org_id: "active-org", id: "other-claim", status: "submitted", employee: "someone" },
      { org_id: "active-org", id: "own-claim", status: "submitted", employee: "viewer" },
    ],
    credit_note_revenue: [
      { org_id: "other-org", id: "foreign-credit", issue_date: "2026-01-20", base_satang: 0, total_satang: 500 },
      { org_id: "active-org", id: "local-credit", issue_date: "2026-01-20", base_satang: 100, total_satang: 107 },
    ],
    monthly_purchase_vat: [
      { org_id: "other-org", month: "2026-01-01", input_vat_satang: 5000 },
      { org_id: "active-org", month: "2026-01-01", input_vat_satang: 70 },
      { org_id: "active-org", month: "2026-02-01", input_vat_satang: 999 },
    ],
  })
  from.mockImplementation(client.from)
}

beforeEach(() => {
  state.role = "owner"
  state.userId = "viewer"
  from.mockReset()
})

it("counts only the active org for the previous month", async () => {
  serve()
  const list = await loadMonthEndCloseChecklist()
  expect(list?.month).toBe("2026-01")
  expect(list?.alreadyClosed).toBe(false)
  expect(list?.items.find(row => row.id === "overdue_ar")).toMatchObject({ count: 1, amountSatang: 4000 })
  expect(list?.items.find(row => row.id === "unpaid_ap")).toMatchObject({ count: 1, amountSatang: 2000 })
  expect(list?.items.find(row => row.id === "unmatched_bank")).toMatchObject({ count: 1, amountSatang: 400 })
  expect(list?.items.find(row => row.id === "draft_invoices")).toMatchObject({ count: 1 })
  expect(list?.items.find(row => row.id === "expense_claims")).toMatchObject({ count: 2, href: "/expenses?tab=approve" })
  expect(list?.items.find(row => row.id === "tax_profile")?.state).toBe("review")
  expect(list?.items.find(row => row.id === "vat_support")).toMatchObject({ outputVatSatang: 700 - 7, inputVatSatang: 70 })
  expect(from.mock.calls.map(call => call[0])).toEqual(expect.arrayContaining(["invoices", "costs", "bank_lines", "expense_claims", "org_settings"]))
})

it("hides the checklist from members without reading finance rows", async () => {
  state.role = "member"
  await expect(loadMonthEndCloseChecklist()).resolves.toBeNull()
  expect(from).not.toHaveBeenCalled()
})

it("loads the same list for an accountant", async () => {
  state.role = "accountant"
  serve()
  const list = await loadMonthEndCloseChecklist()
  expect(list?.items.find(row => row.id === "overdue_ar")?.count).toBe(1)
})

it("fails closed when a page fails", async () => {
  from.mockImplementation(() => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      range: () => query,
      maybeSingle: () => query,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "nope" } }).then(resolve),
    }
    return query
  })
  await expect(loadMonthEndCloseChecklist()).rejects.toThrow("Month-end close data unavailable")
})
