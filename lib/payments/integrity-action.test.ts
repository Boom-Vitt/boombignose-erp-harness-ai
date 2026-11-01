import { beforeEach, expect, it, vi } from "vitest"

const { from, insert, update, rpc, gate } = vi.hoisted(() => ({ from: vi.fn(), insert: vi.fn(), update: vi.fn(), rpc: vi.fn(), gate: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "00000000-0000-4000-8000-000000000003", role: "owner" }), requireCapability: gate, requireRole: gate }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from, rpc }) }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
import { createInvoice, updateInvoice, updateFinanceLockDate, cancelDraftInvoice, closeCompletedMonth } from "@/app/(app)/finance/actions"

const orgId = "00000000-0000-4000-8000-000000000003"
const id = "00000000-0000-4000-8000-000000000001"
const draft = { client_id: id, amountBaht: "0.00", is_recurring: false }
beforeEach(() => {
  vi.clearAllMocks()
  gate.mockImplementation(() => {})
  const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), single: async () => ({ data: { id }, error: null }), maybeSingle: async () => ({ data: { id }, error: null }), then: (resolve: (v: unknown) => unknown) => resolve({ error: null }) }
  insert.mockReturnValue(chain); update.mockReturnValue(chain); from.mockReturnValue({ insert, update })
  rpc.mockResolvedValue({ error: null })
})

it("creates an unnumbered draft without reading existing document numbers", async () => {
  await createInvoice(draft)
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ status: "draft", number: expect.stringMatching(/^DRAFT-[a-f0-9-]{36}$/) }))
  expect(from).toHaveBeenCalledTimes(1)
})
it("rejects manual numbers that reserve the issued series", async () => {
  for (const number of ["INV-2026-001", "INV-2026-000001", " inv-2026-1 "]) {
    expect((await createInvoice({ ...draft, number })).error).toBeTruthy()
    expect((await updateInvoice({ ...draft, id, number } as Parameters<typeof updateInvoice>[0])).error).toBeTruthy()
  }
  expect(from).not.toHaveBeenCalled()
})
it("never passes a supplied status through invoice content editing", async () => {
  await updateInvoice({ ...draft, id, status: "sent" } as Parameters<typeof updateInvoice>[0])
  expect(update).toHaveBeenCalled()
  expect(update.mock.calls[0][0]).not.toHaveProperty("status")
})
it("cancels a draft only through the org-scoped command", async () => {
  expect(await cancelDraftInvoice({ invoiceId: id })).toEqual({})
  expect(rpc).toHaveBeenCalledWith("cancel_draft_invoice", { p_org_id: orgId, p_invoice_id: id })
})
it("sets and clears the finance lock with an active workspace check", async () => {
  expect(await updateFinanceLockDate({ expectedOrgId: orgId, lockDate: "2026-01-31" })).toEqual({})
  expect(rpc).toHaveBeenCalledWith("propose_finance_lock", { p_org_id: orgId, p_lock_date: "2026-01-31", p_reason: null })
  expect(await updateFinanceLockDate({ expectedOrgId: orgId, lockDate: "", reason: "Correction" })).toEqual({})
  expect(rpc).toHaveBeenLastCalledWith("propose_finance_lock", { p_org_id: orgId, p_lock_date: null, p_reason: "Correction" })
})
it("tells the screen when another owner or admin must confirm a reopen", async () => {
  rpc.mockResolvedValueOnce({ data: { pending: true, requestId: "req-1" }, error: null })
  expect(await updateFinanceLockDate({ expectedOrgId: orgId, lockDate: "", reason: "Need a second person" })).toEqual({ pending: true })
})
it("refuses a reopen reason longer than 200 characters before the database call", async () => {
  expect((await updateFinanceLockDate({ expectedOrgId: orgId, lockDate: "", reason: "x".repeat(201) })).error).toBeTruthy()
  expect(rpc).not.toHaveBeenCalled()
})
it("refuses a future lock date before the database call", async () => {
  expect((await updateFinanceLockDate({ expectedOrgId: orgId, lockDate: "2099-01-31" })).error).toBe("Finance lock date cannot be in the future.")
  expect(rpc).not.toHaveBeenCalled()
})
it("closes a completed month through the database command", async () => {
  rpc.mockResolvedValueOnce({ data: "2020-01-31", error: null })
  expect(await closeCompletedMonth({ expectedOrgId: orgId, month: "2020-01" })).toEqual({ lockDate: "2020-01-31" })
  expect(rpc).toHaveBeenCalledWith("close_completed_month", { p_org_id: orgId, p_month: "2020-01" })
  expect((await closeCompletedMonth({ expectedOrgId: orgId, month: "January" })).error).toBeTruthy()
  expect((await closeCompletedMonth({ expectedOrgId: id, month: "2020-01" })).error).toBeTruthy()
  expect(rpc).toHaveBeenCalledTimes(1)
})
it("refuses nonstaff, malformed dates and stale workspace forms before dispatch", async () => {
  expect((await updateFinanceLockDate({ expectedOrgId: orgId, lockDate: "2026-02-30" })).error).toBeTruthy()
  expect((await updateFinanceLockDate({ expectedOrgId: id, lockDate: "" })).error).toBeTruthy()
  gate.mockImplementation(() => { throw new Error("denied") })
  expect((await updateFinanceLockDate({ expectedOrgId: orgId, lockDate: "" })).error).toBeTruthy()
  expect(rpc).not.toHaveBeenCalled()
})
