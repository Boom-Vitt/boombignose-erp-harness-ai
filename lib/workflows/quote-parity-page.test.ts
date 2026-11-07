import { beforeEach, expect, it, vi } from "vitest"
import { Children, isValidElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"

const state = vi.hoisted(() => ({ role: "owner" }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", role: state.role }) }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("not-found") } }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  let from = 0
  let to = 999
  const invoices = Array.from({ length: 1001 }, (_, index) => ({ id: `invoice-${index}`, number: `INV-${index}`, status: "draft", quote_invoice_kind: "lines", quote_deposit_satang: 0, total_satang: 1 }))
  const rows: Record<string, unknown[]> = {
    quotes: [{ id: "d0000000-0000-4000-8000-000000000002", number: "QUO", status: "converted", valid_until: "2000-01-01", client_id: "client", project_id: null, total_satang: 100, subtotal_satang: 100, discount_satang: 0, clients: { name: "Client" } }],
    quote_items: [{ id: "line", description: "Service", quantity: 5, invoiced_quantity: 1, unit_price_satang: 100, amount_satang: 500, tax_rate_bps: 0 }],
    invoices,
  }
  const query = {
    select: () => query, eq: () => query, order: () => query, limit: () => query,
    range: (start: number, end: number) => { from = start; to = end; return query },
    maybeSingle: async () => ({ data: rows[table]?.[0] ?? null, error: null }),
    then: (resolve: (value: unknown) => unknown) => resolve({ data: (rows[table] ?? []).slice(from, to + 1), error: null }),
  }
  return query
} }) }))

import QuoteDetailPage from "@/app/(app)/quotes/[id]/page"
import { StatusBar } from "@/components/record/status-bar"
import { SmartButtons } from "@/components/record/smart-buttons"
import { CancelQuoteInvoiceButton } from "@/app/(app)/quotes/_components/cancel-quote-invoice-button"

function elements(node: ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => isValidElement<Record<string, unknown>>(child) ? [child, ...elements(child.props.children as ReactNode), ...elements(child.props.value as ReactNode)] : [])
}

beforeEach(() => { state.role = "owner" })

it("offers another invoice for an accepted scope after conversion and validity expiry", async () => {
  const nodes = elements(await QuoteDetailPage({ params: Promise.resolve({ id: "d0000000-0000-4000-8000-000000000002" }) }))
  const bar = nodes.find((node) => node.type === StatusBar)!
  expect(renderToStaticMarkup(bar)).toContain('id="create-invoice"')
})

it("links every invoice and counts beyond the API cap", async () => {
  const nodes = elements(await QuoteDetailPage({ params: Promise.resolve({ id: "d0000000-0000-4000-8000-000000000002" }) }))
  const related = renderToStaticMarkup(nodes.find((node) => node.type === SmartButtons) ?? null)
  expect(related).toContain('href="#invoices"')
  expect(related).toContain(">1001</span>")
  const links = nodes.filter(node => typeof node.props.href === "string" && node.props.href.startsWith("/finance/invoices/"))
  const html = links.map(node => renderToStaticMarkup(node)).join("")
  expect(links).toHaveLength(1001)
  expect(html).toContain('href="/finance/invoices/invoice-1000"')
  const comparison = nodes.find(node => node.props.label === "Invoiced vs quote")!
  const comparisonHtml = renderToStaticMarkup(comparison.props.value as ReactNode)
  expect(comparisonHtml).toContain("10.01")
  expect(comparisonHtml).toContain("9.01")
})

it("hides staff acceptance from ordinary members", async () => {
  state.role = "member"
  const nodes = elements(await QuoteDetailPage({ params: Promise.resolve({ id: "d0000000-0000-4000-8000-000000000002" }) }))
  const bar = nodes.find((node) => node.type === StatusBar)!
  expect(renderToStaticMarkup(bar)).not.toContain('id="create-invoice"')
  const cancellations = nodes.filter((node) => node.type === CancelQuoteInvoiceButton)
  expect(cancellations.map(node => renderToStaticMarkup(node)).join("")).toBe("")
})
