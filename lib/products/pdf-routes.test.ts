import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ issued: false, noLines: false, discount: 0, unit: "hour" as string | null, snapshotUnit: "hour" as string | null | undefined }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", orgName: "Workspace" }) }))
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found") } }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  let fields = ""
  const header = { number: "DOC-1", status: "draft", amount_satang: 200, discount_satang: state.discount, issued_snapshot_id: state.issued ? "snapshot" : null, issue_date: "2026-10-23", due_date: null, clients: { name: "Buyer" }, subtotal_satang: 200 + state.discount, total_satang: 200 }
  const line = { description: "Consulting", quantity: 2, unit_price_satang: 100, amount_satang: 200 }
  const rows = () => {
    if (table === "invoices" || table === "quotes") return [header]
    if (table.endsWith("_items")) return state.noLines ? [] : [{ ...line, ...(fields.split(/,\s*/).includes("unit") ? { unit: state.unit } : {}) }]
    if (table === "invoice_snapshots") return [{ snapshot: {
      version: 1,
      seller: { legalName: "Seller", address: "Address", taxId: null, taxStatus: "unknown" },
      buyer: { id: "buyer", name: "Buyer", address: null, taxId: null },
      document: { number: "ISSUED-1", issueDate: "2026-10-23", dueDate: null, notes: null, subtotalSatang: 200, discountSatang: 0, totalSatang: 200 },
      lines: [{ description: "Consulting", quantity: 2, ...(state.snapshotUnit === undefined ? {} : { unit: state.snapshotUnit }), unitPriceSatang: 100, amountSatang: 200, position: 0 }],
    } }]
    return []
  }
  const chain = {
    range: () => chain,
    select: (value: string) => { fields = value; return chain },
    eq: () => chain, order: () => chain,
    maybeSingle: async () => ({ data: rows()[0], error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: rows(), error: null }),
  }
  return chain
} }) }))

import { GET as invoicePdf } from "@/app/(app)/finance/invoices/[id]/pdf/route"
import { GET as quotePdf } from "@/app/(app)/quotes/[id]/pdf/route"

beforeEach(() => { state.issued = false; state.noLines = false; state.discount = 0; state.unit = "hour"; state.snapshotUnit = "hour" })

describe.each([["invoice", invoicePdf], ["quote", quotePdf]] as const)("%s PDF", (_name, get) => {
  it("prints the line unit", async () => {
    const response = await get(new Request("http://localhost/document"), { params: Promise.resolve({ id: "d0000000-0000-4000-8000-000000000001" }) })
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('<td class="num">2 hour</td>')
  })
  it("keeps legacy null-unit lines printable", async () => {
    state.unit = null
    const response = await get(new Request("http://localhost/document"), { params: Promise.resolve({ id: "d0000000-0000-4000-8000-000000000001" }) })
    expect(await response.text()).toContain('<td class="num">2</td>')
  })
})

it("prints the frozen issued unit instead of dropping it in snapshot parsing", async () => {
  state.issued = true
  state.unit = "month"
  const response = await invoicePdf(new Request("http://localhost/document"), { params: Promise.resolve({ id: "d0000000-0000-4000-8000-000000000001" }) })
  const html = await response.text()
  expect(html).toContain('<td class="num">2 hour</td>')
  expect(html).not.toContain('<td class="num">2 month</td>')
})

it.each([undefined, null])("keeps old issued snapshots printable without substituting a live unit (%s)", async unit => {
  state.issued = true
  state.snapshotUnit = unit
  state.unit = "month"
  const response = await invoicePdf(new Request("http://localhost/document"), { params: Promise.resolve({ id: "d0000000-0000-4000-8000-000000000001" }) })
  const html = await response.text()
  expect(html).toContain('<td class="num">2</td>')
  expect(html).not.toContain('<td class="num">2 month</td>')
})

it("no-line manual invoice PDF uses the retained subtotal before discount", async () => {
  state.noLines = true
  state.discount = 100
  const response = await invoicePdf(new Request("http://localhost/document"), { params: Promise.resolve({ id: "d0000000-0000-4000-8000-000000000001" }) })
  expect(response.status).toBe(200)
  expect(await response.text()).toContain("3.00")
})
