import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ writes: [] as unknown[] }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT ${href}`) } }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", userId: "me", role: "owner" }) }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: () => {
  const query = {
    insert: (row: unknown) => { state.writes.push(row); return query },
    update: (row: unknown) => { state.writes.push(row); return query },
    select: () => query,
    eq: () => query,
    single: async () => ({ data: { id: "created" }, error: null }),
    then: (resolve: (result: unknown) => unknown) => resolve({ data: [{ id: "created" }], error: null }),
  }
  return query
} }) }))

import { addContact } from "@/app/(app)/clients/actions"
import { createDeal, updateDeal } from "@/app/(app)/deals/actions"
import { createTemplate } from "@/app/(app)/templates/actions"

const clientId = "10000000-0000-0000-0000-000000000001"
const dealId = "20000000-0000-0000-0000-000000000001"
const categoryId = "11110000-0000-0000-0000-000000000001"

beforeEach(() => { state.writes = [] })

it("adds a contact to a client with a seed-shaped ID", async () => {
  expect(await addContact({ client_id: clientId, name: "Somchai" })).toEqual({})
  expect(state.writes).toEqual([expect.objectContaining({ client_id: clientId })])
})

it("creates and edits a deal for a client with a seed-shaped ID", async () => {
  const deal = { clientId, title: "Website", stage: "lead", valueBaht: 1000 } as const
  await expect(createDeal(deal)).rejects.toThrow("REDIRECT /deals/created")
  await expect(updateDeal(dealId, deal)).rejects.toThrow(`REDIRECT /deals/${dealId}`)
  expect(state.writes).toEqual([expect.objectContaining({ client_id: clientId }), expect.objectContaining({ client_id: clientId })])
})

it("creates a template in the seeded category", async () => {
  await expect(createTemplate({ name: "Onboarding", categoryId, implementationChecklist: [], tags: [] }))
    .rejects.toThrow("REDIRECT /templates/created")
  expect(state.writes).toEqual([expect.objectContaining({ category_id: categoryId })])
})
