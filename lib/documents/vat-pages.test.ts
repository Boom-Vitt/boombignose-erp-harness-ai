import { beforeEach, expect, it, vi } from "vitest"
import { isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { databaseFixture, pageContent } from "@/lib/supabase/__tests__/tenant-fixture"
import { GroupedTableRows } from "@/components/search/grouped-table-rows"
import { DocumentTotals } from "@/components/document-totals"
import { SmartButtons } from "@/components/record/smart-buttons"
import { CreditNoteForm } from "@/app/(app)/finance/_components/credit-note-form"
import { WithholdingForm } from "@/app/(app)/finance/_components/withholding-form"
import { StatCard } from "@/components/stat-card"
import { formatTHB } from "@/lib/money"

const state = vi.hoisted(() => ({ client: {} as unknown, role: "owner" }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "A", userId: "user", role: state.role }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("Not found") } }))
vi.mock("@edition", () => ({
  getInvoiceAccounting: async () => ({ connected: false, sync: null }),
  InvoiceAccountingControls: () => null, InvoiceAccountingStatus: () => null,
}))
vi.mock("@/app/(app)/finance/_components/close-summary", () => ({ CloseSummary: () => null }))
import InvoicePage from "@/app/(app)/finance/invoices/[id]/page"
import QuotePage from "@/app/(app)/quotes/[id]/page"
import FinancePage from "@/app/(app)/finance/page"
import ReceiptsPage from "@/app/(app)/finance/receipts/page"
import ProjectPage from "@/app/(app)/projects/[id]/page"

const header = { id: "d0000000-0000-4000-8000-000000000001", org_id: "A", client_id: "buyer", number: "VAT-1", issue_date: "2026-10-01", status: "draft", amount_satang: 1040000, subtotal_satang: 1000000, discount_satang: 0, vat_satang: 70000, total_satang: 1070000, wht_satang: 30000, wht_rate_bps: 300, tax_breakdown: [], prices_include_vat: false, version: 1 }
const payments = Array.from({ length: 1501 }, (_, n) => ({ id: `payment-${n}`, org_id: "A", invoice_id: "d0000000-0000-4000-8000-000000000001", amount_satang: 100, verification_state: "verified", paid_at: "2026-10-23" }))

function elements(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elements)
  if (!isValidElement<{ children?: ReactNode }>(node)) return []
  return [node, ...elements(node.props.children)]
}

function renderedCards(page: ReactNode) {
  return elements(page).filter(node => node.type === StatCard).map(node => renderToStaticMarkup(node))
}

function expectCard(cards: string[], label: string, value: string) {
  const card = cards.find(html => html.includes(`>${label}<`))
  expect(card).toBeDefined()
  expect(card).toContain(value)
}

beforeEach(() => { state.role = "owner"; state.client = databaseFixture({ invoices: [header], payments, invoice_receipts: payments, invoice_balances: [{ org_id: "A", invoice_id: "d0000000-0000-4000-8000-000000000001", paid_satang: 150100 }] }) })

it("customer receipts show Bangkok payment dates across a month boundary", async () => {
  const clientId = "cb000000-0000-4000-8000-000000000020"
  state.client = databaseFixture({
    clients: [{ id: clientId, org_id: "A", name: "Buyer" }],
    payments: [{ id: "receipt", org_id: "A", client_id: clientId, verification_state: "verified", amount_satang: 10001, paid_at: "2026-09-30T17:00:00Z", verification_reference: "Bank reference" }],
  })
  const content = pageContent(await ReceiptsPage({ searchParams: Promise.resolve({ client: clientId }) }))
  expect(content).toContain("2026-10-01")
  expect(content).not.toContain("2026-09-30")
})

it.each(["verified", "legacy_unverified"])("invoice details show Bangkok dates for %s receipts at a month boundary", async (verification_state) => {
  const receipt = { id: "receipt", org_id: "A", invoice_id: "d0000000-0000-4000-8000-000000000001", amount_satang: 10001, verification_state, paid_at: "2026-09-30T17:00:00Z", method: "transfer" }
  state.client = databaseFixture({ invoices: [header], payments: [receipt], invoice_receipts: verification_state === "verified" ? [receipt] : [] })
  const content = pageContent(await InvoicePage({ params: Promise.resolve({ id: "d0000000-0000-4000-8000-000000000001" }) }))
  expect(content).toContain("2026-10-01")
  expect(content).not.toContain("2026-09-30")
})

it("invoice detail renders tax totals, net balance, and a payment count beyond the row cap", async () => {
  const page = await InvoicePage({ params: Promise.resolve({ id: "d0000000-0000-4000-8000-000000000001" }) })
  const nodes = elements(page)
  const totals = renderToStaticMarkup(nodes.find(node => node.type === DocumentTotals) ?? null)
  for (const amount of ["700.00", "10,700.00", formatTHB(-30000), "10,400.00"]) expect(totals).toContain(amount)
  const related = renderToStaticMarkup(nodes.find(node => node.type === SmartButtons) ?? null)
  expect(related).toContain("Payments")
  expect(related).toContain(">1501</span>")
  expect(pageContent(page)).toContain("8,899.00")
})

it("unpaid invoice draft renders the current WHT selection", async () => {
  state.client = databaseFixture({ invoices: [header], invoice_balances: [{ org_id: "A", invoice_id: "d0000000-0000-4000-8000-000000000001", paid_satang: 0 }] })
  const page = await InvoicePage({ params: Promise.resolve({ id: "d0000000-0000-4000-8000-000000000001" }) })
  const html = renderToStaticMarkup(elements(page).find(node => node.type === WithholdingForm) ?? null)
  expect(html).toContain('<option value="300" selected="">3%</option>')
})

it("quote detail keeps VAT totals and the complete linked invoice count", async () => {
  state.client = databaseFixture({ quotes: [{ ...header, id: "d0000000-0000-4000-8000-000000000002", project_id: "project", valid_until: null }], invoices: Array.from({ length: 1001 }, (_, n) => ({ id: `invoice-${n}`, org_id: "A", source_quote_id: "d0000000-0000-4000-8000-000000000002", total_satang: 1, status: "draft" })) })
  const page = await QuotePage({ params: Promise.resolve({ id: "d0000000-0000-4000-8000-000000000002" }) })
  const nodes = elements(page)
  const totals = renderToStaticMarkup(nodes.find(node => node.type === DocumentTotals) ?? null)
  expect(totals).toContain("700.00")
  expect(totals).toContain("10,700.00")
  const related = renderToStaticMarkup(nodes.find(node => node.type === SmartButtons) ?? null)
  expect(related).toContain('href="#invoices"')
  expect(related).toContain(">1001</span>")
})

it("Finance keeps vendor bill metadata beyond the row cap alongside net receivables", async () => {
  const costs = Array.from({ length: 1001 }, (_, n) => ({ id: `cost-${n}`, org_id: "A", category: "software", input_vat_satang: 0, input_vat_rate: 0, vendor_invoice_reference: null, amount_satang: 1, incurred_on: "2026-10-23", vendor: "Vendor", vendor_id: "vendor", purchase_order_id: "purchase", bill_number: `BILL-${n}`, due_date: "2026-10-22", paid_at: null }))
  state.client = databaseFixture({ invoices: [{ ...header, status: "sent" }], payments, costs, invoice_balances: [{ org_id: "A", invoice_id: "d0000000-0000-4000-8000-000000000001", paid_satang: 150100, credited_satang: 0 }] })
  const content = pageContent(await FinancePage({ searchParams: Promise.resolve({}) }))
  expect(content).toContain("BILL-1000")
  expect(content).toContain("/purchases/purchase")
  expect(content).toContain("Mark paid")
  expect(content).toContain("8,899.00")
})

it.each(["ACME-PO-42", "DRAFT-12345678", "Acme Buyer"])("Finance finds a draft by %s while displaying its draft label", async (q) => {
  const id = "12345678-abcd-4000-8000-000000000001"
  state.client = databaseFixture({ invoices: [{ ...header, id, number: "ACME-PO-42", issued_snapshot_id: null, clients: { name: "Acme Buyer", owner: "user" } }] })
  const page = await FinancePage({ searchParams: Promise.resolve({ q, status: "draft" }) })
  const rows = elements(page).find(node => node.type === GroupedTableRows)
  const html = renderToStaticMarkup(rows ?? null)
  expect(html).toContain(`href="/finance/invoices/${id}"`)
  expect(html).toContain(">DRAFT-12345678</a>")
  expect(html).not.toContain("ACME-PO-42")
})

it("project profit counts every invoice and cost beyond the row cap, before WHT", async () => {
  const invoices = Array.from({ length: 1001 }, (_, n) => ({ id: `invoice-${n}`, org_id: "A", project_id: "project", number: `INV-${n}`, status: "sent", total_satang: 100, vat_satang: 0, amount_satang: 97 }))
  const costs = Array.from({ length: 1001 }, (_, n) => ({ id: `cost-${n}`, org_id: "A", project_id: "project", amount_satang: 50 }))
  state.client = databaseFixture({ projects: [{ id: "project", org_id: "A", name: "Project", status: "in_progress", client_id: "buyer" }], invoices, costs, project_labour_totals: [{ org_id: "A", project_id: "project", labour_cost_satang: 10000 }] })
  const cards = renderedCards(await ProjectPage({ params: Promise.resolve({ id: "project" }) }))
  for (const [label, satang] of [["Revenue", 100_100], ["Cost incl. labour", 60_050], ["Profit", 40_050]] as const) expectCard(cards, label, formatTHB(satang))
})

it.each([true, false])("Finance expenses and project profit use VAT registration %s", async (vatRegistered) => {
  vi.useFakeTimers().setSystemTime(new Date("2026-10-23T06:00:00Z"))
  try {
    state.client = databaseFixture({
      org_settings: [{ org_id: "A", vat_registered: vatRegistered }, { org_id: "B", vat_registered: !vatRegistered }],
      projects: [{ id: "project", org_id: "A", name: "Project", status: "in_progress" }],
      invoices: [{ ...header, status: "sent", project_id: "project" }],
      costs: [
        { id: "bill", org_id: "A", project_id: "project", category: "software", amount_satang: 107_000, input_vat_satang: 7_000, incurred_on: "2026-10-01" },
        { id: "credit", org_id: "A", project_id: "project", category: "software", amount_satang: -21_400, input_vat_satang: -1_400, incurred_on: "2026-10-23" },
      ],
      project_labour_totals: [{ org_id: "A", project_id: "project", labour_cost_satang: 10_000 }],
    })
    const expenses = vatRegistered ? 80_000 : 85_600
    const financeCards = renderedCards(await FinancePage({ searchParams: Promise.resolve({}) }))
    expectCard(financeCards, "Operating costs this month", formatTHB(expenses))
    const projectCards = renderedCards(await ProjectPage({ params: Promise.resolve({ id: "project" }) }))
    expectCard(projectCards, "Cost incl. labour", formatTHB(expenses + 10_000))
    expectCard(projectCards, "Profit", formatTHB(1_000_000 - expenses - 10_000))
  } finally {
    vi.useRealTimers()
  }
})

it("shows labour cost and loss even before a project has invoices or expenses", async () => {
  state.client = databaseFixture({
    projects: [{ id: "project", org_id: "A", name: "Project", status: "in_progress" }],
    time_entries: [{ id: "time", org_id: "A", project_id: "project", minutes: 60, billable: false, rate_satang: null }],
    project_labour_totals: [{ org_id: "A", project_id: "project", labour_cost_satang: 1500 }],
  })
  const cards = renderedCards(await ProjectPage({ params: Promise.resolve({ id: "project" }) }))
  expectCard(cards, "Cost incl. labour", formatTHB(1500))
  expectCard(cards, "Profit", formatTHB(-1500))
})

it("members see project hours but no labour cost or profit", async () => {
  state.role = "member"
  state.client = databaseFixture({
    projects: [{ id: "project", org_id: "A", name: "Project", status: "in_progress" }],
    invoices: [{ id: "d0000000-0000-4000-8000-000000000001", org_id: "A", project_id: "project", number: "INV-1", status: "sent", total_satang: 5000, vat_satang: 0, amount_satang: 5000 }],
    time_entries: [{ id: "time", org_id: "A", project_id: "project", minutes: 90, billable: false, rate_satang: null }],
    project_time_totals: [{ org_id: "A", project_id: "project", minutes: 90 }],
    project_labour_totals: [{ org_id: "A", project_id: "project", labour_cost_satang: 1500 }],
  })
  const cards = renderedCards(await ProjectPage({ params: Promise.resolve({ id: "project" }) }))
  expectCard(cards, "Hours logged", "1.5h")
  for (const label of ["Revenue", "Cost incl. labour", "Profit", "Margin"]) expect(cards.join("")).not.toContain(`>${label}<`)
})

it.each([true, false])("issued invoice credit controls use priced grid rows or the legacy header fallback: %s", async (hasLines) => {
  state.client = databaseFixture({
    invoices: [{ ...header, status: "sent", issued_snapshot_id: "snapshot" }],
    invoice_items: hasLines ? [{ id: "priced", org_id: "A", invoice_id: "d0000000-0000-4000-8000-000000000001", description: "Priced service", quantity: 1, unit: "item", unit_price_satang: 10000, tax_rate_bps: 0, position: 0 }] : [],
    document_sections: [{ id: "section", org_id: "A", invoice_id: "d0000000-0000-4000-8000-000000000001", kind: "section", description: "Section heading", lines_before: 0, position: 0 }],
  })
  const page = await InvoicePage({ params: Promise.resolve({ id: "d0000000-0000-4000-8000-000000000001" }) })
  const control = elements(page).find(node => node.type === CreditNoteForm)
  const html = renderToStaticMarkup(control ?? null)
  expect(html).toContain(hasLines ? "Credit Priced service" : "Credit Historical invoice amount")
  expect(html.includes('<option value="quantity">')).toBe(hasLines)
  expect(html).not.toContain("Credit Section heading")
})
