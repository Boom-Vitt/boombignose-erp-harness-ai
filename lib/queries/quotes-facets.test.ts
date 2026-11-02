import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ rows: [] as unknown[], orders: [] as string[] }))
vi.mock("next/navigation", () => ({ usePathname: () => "/quotes" }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", userId: "me" }) }))
vi.mock("@/lib/queries/saved-views", () => ({ getFacetSavedViews: async () => [] }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  let [from, to] = [0, 999]
  const query = {
    select: () => query,
    eq: () => query, not: () => query, neq: () => query, in: () => query, maybeSingle: async () => ({ data: null, error: null }),
    order: (column: string) => { if (table === "quotes") state.orders.push(column); return query },
    range: (start: number, end: number) => { [from, to] = [start, end]; return query },
    // Like PostgREST, never return more than 1,000 rows per request.
    then: (resolve: (result: unknown) => unknown) =>
      resolve({ data: table === "quotes" ? state.rows.slice(from, Math.min(to, from + 999) + 1) : [], error: null }),
  }
  return query
} }) }))

import QuotesPage from "@/app/(app)/quotes/page"
import { formatTHB } from "@/lib/money"

const quote = (id: number, status: string, total: number) => ({
  id: `q${id}`, number: `QUO-${id}`, status, total_satang: total, valid_until: null,
  issue_date: "2026-10-01", client_id: "c1", owner: "me", clients: { name: "Acme" },
})

beforeEach(() => { state.rows = []; state.orders = [] })

async function render(params: Record<string, string>) {
  const page = await QuotesPage({ searchParams: Promise.resolve(params) })
  return renderToStaticMarkup(createElement(() => page))
}

describe("quote facets past the API row cap", () => {
  it("counts and sums every quote in each status group", async () => {
    state.rows = [
      ...Array.from({ length: 1200 }, (_, i) => quote(i, "sent", 10001)),
      ...Array.from({ length: 50 }, (_, i) => quote(2000 + i, "draft", 3)),
    ]
    const html = await render({ groupBy: "status" })
    const headers = [...html.matchAll(/data-testid="group-header".*?font-semibold">([^<]+)<.*?\((\d+)\).*?tabular-nums">([^<]+)</g)].map((m) => m.slice(1, 4))
    expect(headers).toEqual([
      ["Sent", "1200", formatTHB(1200 * 10001)],
      ["Draft", "50", formatTHB(150)],
    ])
    expect(state.orders).toEqual(["issue_date", "id", "issue_date", "id"])
  })
})
