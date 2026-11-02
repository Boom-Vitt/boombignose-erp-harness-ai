import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ orgId: "active-org", queries: [] as Array<{ table: string; filters: Array<[string, unknown]> }> }))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => ({ orgId: state.orgId, role: "owner", orgName: "Active workspace" }),
  requireCapability: vi.fn(),
}))
vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not-found") } }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: async (fn: string, args: { p_org_id?: string }) => {
    state.queries.push({ table: fn, filters: [["org_id", args.p_org_id]] })
    return { data: [], error: null }
  }, from: (table: string) => {
    const query = { table, filters: [] as Array<[string, unknown]> }
    state.queries.push(query)
    const rows: Record<string, unknown[]> = {
      quotes: [{ id: "quote-id", number: "QUO-1", status: "accepted", client_id: "client-id", project_id: "project-id", total_satang: 100, subtotal_satang: 100, discount_satang: 0, issue_date: "2026-10-13", clients: { name: "Client" }, projects: { name: "Project" } }],
      projects: [{ id: "project-id", name: "Project", status: "not_started", client_id: "client-id", client: { name: "Client" } }],
      clients: [{ id: "client-id", name: "Client" }],
      deals: [{ id: "deal-id", title: "Service", client_id: "client-id", value_satang: 100 }],
    }
    const chain = {
      range: () => chain,
      select: () => chain,
      eq: (column: string, value: unknown) => { query.filters.push([column, value]); return chain },
      in: () => chain, not: () => chain, neq: () => chain,
      order: () => chain,
      limit: () => chain,
      maybeSingle: async () => ({ data: rows[table]?.[0] ?? null, error: null }),
      then: (resolve: (value: unknown) => unknown) => resolve({ data: rows[table] ?? [], error: null }),
    }
    return chain
  } }),
}))

import QuotesPage from "@/app/(app)/quotes/page"
import NewQuotePage from "@/app/(app)/quotes/new/page"
import QuoteDetailPage from "@/app/(app)/quotes/[id]/page"
import ProjectsPage from "@/app/(app)/projects/page"
import NewProjectPage from "@/app/(app)/projects/new/page"
import EditProjectPage from "@/app/(app)/projects/[id]/edit/page"
import ProjectDetailPage from "@/app/(app)/projects/[id]/page"

beforeEach(() => { state.queries = [] })

describe("service pages select only the active organization", () => {
  const pages: Array<[string, () => Promise<unknown>]> = [
    ["quote list", () => QuotesPage()],
    ["new quote choices", () => NewQuotePage({ searchParams: Promise.resolve({ dealId: "deal-id" }) })],
    ["quote detail, lines and choices", () => QuoteDetailPage({ params: Promise.resolve({ id: "quote-id" }) })],
    ["project list", () => ProjectsPage({ searchParams: Promise.resolve({}) })],
    ["project board", () => ProjectsPage({ searchParams: Promise.resolve({ view: "board" }) })],
    ["new project and deal prefill", () => NewProjectPage({ searchParams: Promise.resolve({ dealId: "deal-id" }) })],
    ["edit project and client choices", () => EditProjectPage({ params: Promise.resolve({ id: "project-id" }) })],
    ["project tasks, milestones, financials and time", () => ProjectDetailPage({ params: Promise.resolve({ id: "project-id" }) })],
  ]
  it.each(pages)("filters every business query for %s", async (_name, page) => {
    await page()
    expect(state.queries.length).toBeGreaterThan(0)
    for (const query of state.queries) {
      expect(query.filters, `${query.table} needs the active organization`).toContainEqual(["org_id", state.orgId])
    }
  })
  it("traces converted quote milestones by source quote in the active workspace", async () => {
    await QuoteDetailPage({ params: Promise.resolve({ id: "quote-id" }) })
    expect(state.queries).toContainEqual({ table: "milestones", filters: [["org_id", state.orgId], ["source_quote_id", "quote-id"]] })
  })
  it("loads the project's commercial source quotes for drill-through", async () => {
    await ProjectDetailPage({ params: Promise.resolve({ id: "project-id" }) })
    expect(state.queries).toContainEqual({ table: "quotes", filters: [["org_id", state.orgId], ["project_id", "project-id"]] })
  })
})
