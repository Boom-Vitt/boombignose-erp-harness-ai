import { Children, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), notFound: () => { throw new Error("not-found") } }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", role: "owner" }) }))
vi.mock("@/lib/products/queries", () => ({ activeProductOptions: async () => [] }))
vi.mock("@/app/(app)/finance/subscription-actions", () => ({
  setSubscriptionStatus: vi.fn(), updateSubscription: vi.fn(), generateInvoiceNow: vi.fn(), deleteSubscription: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const rows = table === "subscriptions" ? [{
    id: "b0000000-0000-4000-8000-000000000001", name: "Support", status: "paused", client_id: "client", project_id: null,
    amount_satang: 10000, interval: "monthly", start_date: "2026-01-01", next_run_date: "2026-02-01",
    last_generated_on: null, auto_generate: false, notes: null, product_id: null, unit: "period",
    tax_rate_bps: 700, wht_rate_bps: 300, prices_include_vat: false, clients: { name: "Client" },
  }] : []
  const query = {
    select: () => query, eq: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (result: unknown) => unknown) => resolve({ data: rows, count: 0, error: null }),
  }
  return query
} }) }))

import SubscriptionDetailPage from "@/app/(app)/finance/subscriptions/[id]/page"
import { SubscriptionControls } from "@/app/(app)/finance/_components/subscription-controls"
import { StatusBar } from "@/components/record/status-bar"

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => isValidElement<Record<string, unknown>>(child) ? [child, ...elements(child.props.children as ReactNode)] : [])
}


it("keeps cancellation but offers no status-bar activation that bypasses the paused resume policy", async () => {
  const nodes = elements(await SubscriptionDetailPage({ params: Promise.resolve({ id: "b0000000-0000-4000-8000-000000000001" }) }))
  const bar = nodes.find(node => node.type === StatusBar)!
  const html = renderToStaticMarkup(bar)
  expect(html.match(/<button\b/g)).toHaveLength(1)
  expect(html).toContain('aria-haspopup="dialog"')
  const controls = renderToStaticMarkup(nodes.find(node => node.type === SubscriptionControls) ?? null)
  expect(controls).toContain('type="checkbox"')
})

