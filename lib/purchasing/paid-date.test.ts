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
vi.mock("@/app/(app)/purchases/_components/action-button", () => ({ PurchaseAction: ({ label }: { label: string }) => createElement("button", {}, label) }))
vi.mock("@/components/search/search-facets", () => ({ SearchFacets: () => null }))
vi.mock("@/app/(app)/finance/_components/delete-cost-button", () => ({ DeleteCostButton: () => null }))
vi.mock("@/app/(app)/finance/_components/close-summary", () => ({ CloseSummary: () => null }))

import { VendorBills } from "@/app/(app)/purchases/_components/bills"
import FinancePage from "@/app/(app)/finance/page"

const bill: Tables<"costs"> = { vendor_bill_match_id: null, vendor_invoice_reference: null, input_vat_rate: 0, input_vat_satang: 0, purchase_cost_kind: "bill", id: "bill", org_id: "org", vendor_id: "vendor", purchase_order_id: null, expense_claim_id: null, bill_number: "B1", bill_date: "2026-10-23", due_date: "2026-11-23", paid_at: "2026-10-23T18:00:00Z", amount_satang: 101, category: "other", incurred_on: "2026-10-23", vendor: "Vendor", project_id: null, notes: null, created_at: "2026-10-23T18:00:00Z", updated_at: "2026-10-23T18:00:00Z" }

it("shows Bangkok payment dates in the vendor and PO bill table", () => {
  const html = renderToStaticMarkup(createElement(VendorBills, { bills: [bill], canManage: false }))
  expect(html).toContain("Paid 2026-10-24")
  expect(html).not.toContain("Paid 2026-10-23")
})
it("shows the same Bangkok payment date in Finance costs", async () => {
  state.costs = [bill]
  const html = renderToStaticMarkup(await FinancePage({ searchParams: Promise.resolve({ tab: "costs" }) }))
  expect(html).toContain("Paid 2026-10-24")
  expect(html).not.toContain("Paid 2026-10-23")
})

it("labels internal return adjustments and never offers payment for non-payable entries", () => {
  const adjustment = { ...bill, id: "adjustment", paid_at: null, vendor_id: null, due_date: null, bill_number: null, purchase_cost_kind: "return_adjustment" as const }
  const html = renderToStaticMarkup(createElement(VendorBills, { bills: [adjustment], canManage: true }))
  expect(html).toContain("Internal return adjustment")
  expect(html).toContain("Not payable")
  expect(html).not.toContain("Mark paid")
  const adjustmentWithVendor = renderToStaticMarkup(createElement(VendorBills, { bills: [{ ...adjustment, vendor_id: "vendor" }], canManage: true }))
  expect(adjustmentWithVendor).not.toContain("Mark paid")
  const noVendor = renderToStaticMarkup(createElement(VendorBills, { bills: [{ ...bill, paid_at: null, vendor_id: null }], canManage: true }))
  expect(noVendor).not.toContain("Mark paid")
  const vendorBill = renderToStaticMarkup(createElement(VendorBills, { bills: [{ ...bill, paid_at: null }], canManage: true }))
  expect(vendorBill).toContain("Mark paid")
})
