import { beforeEach, describe, expect, it, vi } from "vitest"
import type { OrgContext } from "@/lib/auth"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"

const state = vi.hoisted(() => ({
  ctx: { orgId: "org-a", orgName: "Workspace A", userId: "me", email: null, role: "owner" } as OrgContext,
  authError: "", failedTable: "", tables: {} as Record<string, Record<string, unknown>[]>, from: vi.fn(),
}))
vi.mock("server-only", () => ({}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => {
  if (state.authError) throw new Error(state.authError)
  return state.ctx
} }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: state.from }) }))
vi.mock("@/lib/dates", () => ({ todayISO: () => "2026-11-06" }))

import { organizationSnapshot } from "./data"

beforeEach(() => {
  state.ctx = { orgId: "org-a", orgName: "Workspace A", userId: "me", email: null, role: "owner" }
  state.authError = ""
  state.failedTable = ""
  state.tables = {
    projects: [
      { id: "project-a", org_id: "org-a", owner: "me", status: "in_progress" },
      { id: "project-other", org_id: "org-a", owner: "other", status: "review" },
      { id: "project-b", org_id: "org-b", owner: "me", status: "in_progress" },
    ],
    project_tasks: [
      { id: "task-a", org_id: "org-a", project_id: "project-a", assignee: "me", title: "Deliver real work", done: false, status: "in_progress", due_date: "2026-11-01" },
      { id: "task-other", org_id: "org-a", project_id: "project-other", assignee: "other", title: "Other assigned task", done: false, status: "todo", due_date: "2026-11-10" },
      { id: "task-done", org_id: "org-a", project_id: "project-a", assignee: "me", title: "Already complete", done: true, status: "done", due_date: "2026-10-01" },
      { id: "task-b", org_id: "org-b", project_id: "project-b", assignee: "me", title: "Other workspace secret", done: false, status: "todo", due_date: "2026-10-01" },
    ],
    quotes: [
      { id: "quote-a", org_id: "org-a", owner: "me", status: "draft" },
      { id: "quote-other", org_id: "org-a", owner: "other", status: "sent" },
    ],
    expense_claims: [
      { id: "own-draft", org_id: "org-a", employee: "me", status: "draft" },
      { id: "own-submitted", org_id: "org-a", employee: "me", status: "submitted" },
      { id: "other-submitted", org_id: "org-a", employee: "other", status: "submitted" },
      { id: "foreign-submitted", org_id: "org-b", employee: "other", status: "submitted" },
    ],
    purchase_orders: [{ id: "po-a", org_id: "org-a", status: "confirmed" }],
    products: [{ id: "product-a", org_id: "org-a", active: true, is_stockable: true }],
    warehouses: [{ id: "warehouse-a", org_id: "org-a", active: true }],
    invoices: [
      { id: "invoice-a", org_id: "org-a", status: "sent", due_date: "2026-11-01" },
      { id: "paid-a", org_id: "org-a", status: "paid", due_date: "2026-11-01" },
    ],
  }
  state.from.mockReset()
  state.from.mockImplementation((table: string) => {
    const query = databaseFixture(state.tables).from(table)
    const originalNot = query.not
    // The shared fixture implements IS NOT NULL; this consumer also uses NOT employee = self.
    query.not = (key, operator, value) => operator === "eq" ? query.neq(key, value) : originalNot(key, operator, value)
    if (table === state.failedTable) query.then = (resolve, reject) => Promise.resolve({ data: null, count: null, error: { message: "read failed" } }).then(resolve, reject)
    return query
  })
})

describe("authorized organization workload", () => {
  it.each(["REDIRECT:/login", "REDIRECT:/onboarding", "REDIRECT:/auth/mfa"])("preserves the organization/MFA boundary: %s", async (failure) => {
    state.authError = failure
    await expect(organizationSnapshot()).rejects.toThrow(failure)
    expect(state.from).not.toHaveBeenCalled()
  })

  it("reads active-workspace counts and actionable task links without foreign records", async () => {
    const result = await organizationSnapshot()
    const delivery = result.modules.find((module) => module.id === "delivery")!
    expect(delivery.workload).toBe(2)
    expect(delivery.metrics.map((metric) => metric.count)).toEqual([2, 2, 1])
    expect(result.tasks.map((task) => task.title)).toEqual(["Deliver real work", "Other assigned task"])
    expect(result.tasks[0].href).toBe("/projects/project-a#tasks")
    expect(result.modules.find((module) => module.id === "claims")!.metrics.map((metric) => metric.count)).toEqual([1, 1])
    expect(result.modules.find((module) => module.id === "receivables")!.workload).toBe(1)
    expect(JSON.stringify(result)).not.toContain("Other workspace secret")
  })

  it("scopes member workload to their own assignments and omits restricted counts instead of reporting zero", async () => {
    state.ctx.role = "member"
    const result = await organizationSnapshot()
    expect(result.limited).toBe(true)
    expect(result.modules.map((module) => module.id)).toEqual(["delivery", "sales", "claims"])
    expect(result.modules.every((module) => module.scope === "mine")).toBe(true)
    expect(result.modules.find((module) => module.id === "delivery")!.metrics.map((metric) => metric.count)).toEqual([1, 1, 1])
    expect(result.modules.find((module) => module.id === "sales")!.workload).toBe(1)
    expect(result.tasks.map((task) => task.id)).toEqual(["task-a"])
    for (const table of ["invoices", "purchase_orders", "products", "warehouses"]) expect(state.from.mock.calls.flat()).not.toContain(table)
  })

  it("allows accountant receivables but not management or other people's expense approval counts", async () => {
    state.ctx.role = "accountant"
    const result = await organizationSnapshot()
    expect(result.modules.map((module) => module.id)).toEqual(["delivery", "sales", "claims", "receivables"])
    expect(result.modules.find((module) => module.id === "claims")!.scope).toBe("mine")
    expect(state.from.mock.calls.flat()).not.toContain("purchase_orders")
  })

  it("reflects record completion, approval and workspace switches on the next read", async () => {
    state.tables.project_tasks[0].done = true
    state.tables.quotes[0].status = "converted"
    state.tables.expense_claims[2].status = "approved"
    state.tables.invoices[0].status = "paid"
    const next = await organizationSnapshot()
    expect(next.modules.find((module) => module.id === "delivery")!.workload).toBe(1)
    expect(next.modules.find((module) => module.id === "sales")!.workload).toBe(1)
    expect(next.modules.find((module) => module.id === "claims")!.metrics[1].count).toBe(0)
    expect(next.modules.find((module) => module.id === "receivables")!.workload).toBe(0)
    state.ctx.orgId = "org-b"
    const switched = await organizationSnapshot()
    expect(switched.tasks.map((task) => task.id)).toEqual(["task-b"])
    expect(switched.modules.find((module) => module.id === "sales")!.workload).toBe(0)
  })

  it("uses exact counts beyond the API row cap and limits the record preview", async () => {
    state.tables.project_tasks = Array.from({ length: 1007 }, (_, index) => ({ id: `task-${index}`, org_id: "org-a", project_id: "project-a", assignee: "me", title: "Real work", done: false, status: "todo", due_date: null }))
    const result = await organizationSnapshot()
    expect(result.modules.find((module) => module.id === "delivery")!.workload).toBe(1007)
    expect(result.tasks).toHaveLength(8)
  })

  it.each(["quotes", "project_tasks", "invoices"])("fails honestly on %s read errors, never substituting empty success", async (table) => {
    state.failedTable = table
    await expect(organizationSnapshot()).rejects.toThrow(/unavailable/)
  })
})
