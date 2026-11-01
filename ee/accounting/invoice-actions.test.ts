import { beforeEach, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn(async () => {}) }))

const { requireCapability, createClient } = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  createClient: vi.fn(),
}))

vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => ({ orgId: "org-1", userId: "user-1", role: "owner" }),
  requireCapability,
}))
vi.mock("@/lib/supabase/server", () => ({ createClient }))

import { syncInvoiceToAccounting } from "@/ee/accounting/invoice-actions"

const issued = {
  id: "inv-1",
  number: "INV-1",
  amount_satang: 100000,
  subtotal_satang: 100000,
  discount_satang: 0,
  vat_satang: 0,
  wht_satang: 0,
  wht_rate_bps: 0,
  total_satang: 100000,
  prices_include_vat: false,
  status: "sent",
  issue_date: "2026-06-01",
  due_date: "2026-06-30",
  notes: null,
  clients: { name: "Acme", tax_id: null, billing_address: null, email: null },
}

function client(input: {
  connection?: Record<string, unknown> | null
  invoice?: Record<string, unknown> | null
  lines?: Record<string, unknown>[]
}) {
  const saved: Record<string, unknown>[] = []
  createClient.mockResolvedValue({
    from(table: string) {
      const rows = table === "accounting_connections"
        ? (input.connection ? [input.connection] : [])
        : table === "invoices"
          ? (input.invoice ? [input.invoice] : [])
          : table === "invoice_items"
            ? (input.lines ?? [])
            : []
      const query = {
        select: () => query,
        eq: () => query,
        order: () => query,
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        upsert: (row: Record<string, unknown>) => {
          saved.push(row)
          return query
        },
        then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null }),
      }
      return query
    },
  })
  return saved
}

beforeEach(() => {
  requireCapability.mockReset()
  requireCapability.mockImplementation(() => {})
  createClient.mockReset()
})

it("exports an issued invoice through the fixture and stores the document number", async () => {
  const saved = client({
    connection: { provider: "flowaccount", status: "connected", config: { transport: "fixture" } },
    invoice: issued,
    lines: [{ description: "Work", quantity: 1, unit: null, unit_price_satang: 100000, amount_satang: 100000, position: 1 }],
  })
  await expect(syncInvoiceToAccounting("inv-1")).resolves.toEqual({ externalId: "FA-INV-1" })
  expect(saved).toEqual([expect.objectContaining({
    external_id: "FA-INV-1",
    status: "synced",
    local_id: "inv-1",
    provider: "flowaccount",
    last_error: null,
  })])
})

it("does not export a draft", async () => {
  const saved = client({
    connection: { provider: "flowaccount", status: "connected", config: {} },
    invoice: { ...issued, status: "draft" },
  })
  await expect(syncInvoiceToAccounting("inv-1")).resolves.toEqual({
    error: "Issue the invoice before exporting it. Drafts and cancelled invoices are not sent.",
  })
  expect(saved).toEqual([])
})

it("records the refusal when the connected provider is not FlowAccount", async () => {
  const saved = client({
    connection: { provider: "peak", status: "connected", config: {} },
    invoice: issued,
    lines: [],
  })
  const result = await syncInvoiceToAccounting("inv-1")
  expect(result.error).toMatch(/FlowAccount only/)
  expect(saved[0]).toMatchObject({ status: "error", provider: "peak", local_id: "inv-1" })
})
