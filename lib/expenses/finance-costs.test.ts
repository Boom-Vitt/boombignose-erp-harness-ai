import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"
import type { Tables } from "@/lib/types/database"

const state = vi.hoisted(() => ({ costs: [] as unknown[] }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", userId: "user", role: "owner" }) }))
vi.mock("@/lib/queries/saved-views", () => ({ getFacetSavedViews: async () => [] }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const query = { select: () => query, eq: () => query, order: () => query, range: () => query, maybeSingle: async () => ({ data: null, error: null }), then: (resolve: (value: unknown) => unknown) => resolve({ data: table === "costs" ? state.costs : [], error: null }) }
  return query
} }) }))
vi.mock("@/app/(app)/purchases/_components/action-button", () => ({ PurchaseAction: ({ label }: { label: string }) => createElement("button", null, label) }))
vi.mock("@/components/search/search-facets", () => ({ SearchFacets: () => null }))
vi.mock("@/app/(app)/finance/_components/delete-cost-button", () => ({ DeleteCostButton: ({ label }: { label: string }) => createElement("button", null, `Delete ${label}`) }))
vi.mock("@/app/(app)/finance/_components/close-summary", () => ({ CloseSummary: () => null }))

import FinancePage from "@/app/(app)/finance/page"

const expenseCost: Tables<"costs"> = { vendor_bill_match_id: null, vendor_invoice_reference: null, input_vat_rate: 0, input_vat_satang: 0, purchase_cost_kind: null, id: "cost", org_id: "org", vendor_id: null, purchase_order_id: null, expense_claim_id: "claim-1", bill_number: "EXP-0001", bill_date: null, due_date: null, paid_at: null, amount_satang: 12345, category: "other", incurred_on: "2026-10-23", vendor: "Employee expense", project_id: null, notes: "Expense claim EXP-0001", created_at: "2026-10-23T03:00:00Z", updated_at: "2026-10-23T03:00:00Z" }

const renderCosts = async (costs: Tables<"costs">[]) => {
  state.costs = costs
  return renderToStaticMarkup(await FinancePage({ searchParams: Promise.resolve({ tab: "costs" }) }))
}

it("links an expense cost to its claim and offers no Delete the database would refuse", async () => {
  const html = await renderCosts([expenseCost])
  expect(html).toContain('href="/expenses/claim-1"')
  expect(html).toContain("Awaiting reimbursement")
  expect(html).not.toContain("Delete Other cost")
  expect(html).not.toContain("Mark paid")
})

it("shows when an expense cost was reimbursed, in Bangkok time", async () => {
  const html = await renderCosts([{ ...expenseCost, paid_at: "2026-10-23T18:00:00Z" }])
  expect(html).toContain("Reimbursed 2026-10-24")
})

it("still lets a manual cost be deleted", async () => {
  const html = await renderCosts([{ ...expenseCost, expense_claim_id: null, bill_number: null, vendor: null }])
  expect(html).toContain("Delete Other cost")
})
