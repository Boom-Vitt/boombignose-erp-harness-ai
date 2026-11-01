import { beforeEach, expect, it, vi } from "vitest"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"

const state = { role: "owner" }
const tables: { current: ReturnType<typeof databaseFixture> | { from: () => never } } = { current: databaseFixture({}) }

vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "active-org", orgName: "Acme", userId: "u", email: null, role: state.role }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => tables.current }))

import { loadAccountantPack } from "@/lib/finance/accountant-pack-load"

function fixture() {
  return databaseFixture({
    invoices: [
      { org_id: "other-org", id: "foreign", number: "INV-X", status: "sent", issue_date: "2026-10-02", client_id: "c-x", total_satang: 10700, vat_satang: 700, wht_satang: 300, clients: { name: "Foreign", tax_id: "999" } },
      { org_id: "active-org", id: "local", number: "INV-1", status: "sent", issue_date: "2026-10-02", client_id: "c1", total_satang: 10700, vat_satang: 700, wht_satang: 300, clients: { name: "Local", tax_id: "010" } },
      { org_id: "active-org", id: "draft", number: "DRAFT", status: "draft", issue_date: "2026-10-03", client_id: "c1", total_satang: 100, vat_satang: 7, wht_satang: 0, clients: { name: "Local", tax_id: "010" } },
      { org_id: "active-org", id: "old", number: "INV-OLD", status: "sent", issue_date: "2026-09-30", client_id: "c1", total_satang: 214, vat_satang: 14, wht_satang: 0, clients: { name: "Local", tax_id: "010" } },
    ],
    credit_notes: [
      { org_id: "active-org", id: "cn1", number: "CN-1", issue_date: "2026-10-20", invoice_id: "old", snapshot: { buyer: { name: "Local", taxId: "010" }, originalNumber: "INV-OLD", document: { baseSatang: 100, vatSatang: 7, whtSatang: 3 } } },
      { org_id: "other-org", id: "cn-x", number: "CN-X", issue_date: "2026-10-20", invoice_id: "foreign", snapshot: { buyer: { name: "Foreign", taxId: "999" }, document: { baseSatang: 9000, vatSatang: 900, whtSatang: 900 } } },
    ],
    costs: [
      { org_id: "active-org", id: "bill", vendor_bill_match_id: "m1", bill_date: "2026-10-05", vendor_id: "v1", vendor: "Vendor text", vendor_invoice_reference: "BILL-1", purchase_cost_kind: "bill", amount_satang: 1070, input_vat_satang: 70 },
      { org_id: "active-org", id: "unmatched", vendor_bill_match_id: null, bill_date: "2026-10-06", vendor_id: "v1", vendor: "Vendor text", vendor_invoice_reference: "LOOSE", purchase_cost_kind: "bill", amount_satang: 2140, input_vat_satang: 140 },
      { org_id: "other-org", id: "foreign-bill", vendor_bill_match_id: "m9", bill_date: "2026-10-05", vendor_id: "v9", vendor: "Other", vendor_invoice_reference: "FOREIGN", purchase_cost_kind: "bill", amount_satang: 999, input_vat_satang: 99 },
    ],
    monthly_purchase_vat: [
      { org_id: "active-org", month: "2026-10-01", base_satang: 1000, input_vat_satang: 70 },
      { org_id: "other-org", month: "2026-10-01", base_satang: 900, input_vat_satang: 99 },
      { org_id: "active-org", month: "2026-09-01", base_satang: 1, input_vat_satang: 1 },
    ],
    vendors: [
      { org_id: "active-org", id: "v1", name: "ร้านค้า", tax_id: "111" },
      { org_id: "other-org", id: "v9", name: "Other", tax_id: "222" },
    ],
  })
}

beforeEach(() => {
  state.role = "owner"
  tables.current = fixture()
})

it("assembles one workspace month from issued invoices, credit notes, and the purchase VAT table", async () => {
  const loaded = await loadAccountantPack("2026-10")
  expect(loaded.ok).toBe(true)
  if (!loaded.ok) return
  expect(loaded.pack.orgName).toBe("Acme")
  expect(loaded.pack.outputVatSatang).toBe(693)
  expect(loaded.pack.outputWhtSatang).toBe(297)
  expect(loaded.pack.inputVatSatang).toBe(70)
  expect(loaded.pack.inputLines.map((row) => row.number)).toEqual(["BILL-1"])
  expect(loaded.pack.inputLines[0]?.partyName).toBe("ร้านค้า")
  expect(loaded.pack.whtParties).toMatchObject([{ partyId: "c1", partyName: "Local", whtSatang: 297, documentCount: 2 }])
  expect(loaded.pack.outputLines.map((row) => row.number)).toEqual(["INV-1", "CN-1"])
})

it("refuses a member before reading workspace rows", async () => {
  state.role = "member"
  tables.current = { from() { throw new Error("should not read") } }
  await expect(loadAccountantPack("2026-10")).resolves.toMatchObject({ ok: false, status: 403 })
})

it("loads the same pack for an accountant", async () => {
  state.role = "accountant"
  const loaded = await loadAccountantPack("2026-10")
  expect(loaded.ok).toBe(true)
  if (!loaded.ok) return
  expect(loaded.pack.inputVatSatang).toBe(70)
})

it("rejects a month that is not YYYY-MM before reading", async () => {
  tables.current = { from() { throw new Error("should not read") } }
  await expect(loadAccountantPack("2026-13")).resolves.toMatchObject({ ok: false, status: 400 })
})
