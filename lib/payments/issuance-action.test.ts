import { beforeEach, expect, it, vi } from "vitest"
const { rpc, gate, from } = vi.hoisted(() => ({ rpc: vi.fn(), gate: vi.fn(), from: vi.fn() }))
const orgId = "00000000-0000-4000-8000-000000000003"
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "00000000-0000-4000-8000-000000000003", role: "owner" }), requireRole: gate, requireCapability: gate }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc, from }) }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))
import { adoptLegacyInvoice, issueInvoice, issueTaxInvoice, updateBusinessProfile, updateInvoiceWithholding } from "@/app/(app)/finance/actions"
const key = "00000000-0000-4000-8000-000000000002"
const invoiceId = "00000000-0000-0000-0000-000000000001"
beforeEach(() => { vi.clearAllMocks(); gate.mockImplementation(() => {}); rpc.mockResolvedValue({ data: "snapshot", error: null }) })
it("issuance sends exact expected version and retry key to one atomic command", async () => {
  expect(await issueInvoice({ invoiceId, expectedVersion: 4, key })).toEqual({})
  expect(rpc).toHaveBeenCalledExactlyOnceWith("issue_invoice", { p_org_id: orgId, p_invoice_id: invoiceId, p_expected_version: 4, p_key: key })
})
it("nonstaff and invalid versions cannot dispatch issuance", async () => {
  expect((await issueInvoice({ invoiceId, expectedVersion: -1, key })).error).toBeTruthy()
  expect((await issueInvoice({ invoiceId, expectedVersion: 0, key })).error).toBeTruthy()
  gate.mockImplementation(() => { throw new Error("denied") })
  expect((await issueInvoice({ invoiceId, expectedVersion: 4, key })).error).toBeTruthy()
  expect(rpc).not.toHaveBeenCalled()
})
it("legacy adoption sends the trimmed reason, version and retry key to one org-scoped command", async () => {
  expect(await adoptLegacyInvoice({ invoiceId, expectedVersion: 4, key, reason: "  Confirmed against the original invoice  " })).toEqual({})
  expect(gate).toHaveBeenCalledExactlyOnceWith({ orgId, role: "owner" }, "payment:verify")
  expect(rpc).toHaveBeenCalledExactlyOnceWith("adopt_legacy_invoice", { p_org_id: orgId, p_invoice_id: invoiceId, p_expected_version: 4, p_key: key, p_reason: "Confirmed against the original invoice" })
  expect(from).not.toHaveBeenCalled()
})
it("legacy adoption rejects invalid reasons, versions and keys before dispatch", async () => {
  const input = { invoiceId, expectedVersion: 4, key, reason: "Reviewed original invoice" }
  for (const reason of ["", "   ", "x".repeat(1001)]) expect((await adoptLegacyInvoice({ ...input, reason })).error).toBeTruthy()
  for (const expectedVersion of [-1, 0, 1.5, 2147483648]) expect((await adoptLegacyInvoice({ ...input, expectedVersion })).error).toBeTruthy()
  expect((await adoptLegacyInvoice({ ...input, key: "invalid" })).error).toBeTruthy()
  expect(rpc).not.toHaveBeenCalled()
})
it("nonstaff cannot adopt a legacy invoice", async () => {
  gate.mockImplementation(() => { throw new Error("denied") })
  expect((await adoptLegacyInvoice({ invoiceId, expectedVersion: 4, key, reason: "Reviewed original invoice" })).error).toBeTruthy()
  expect(gate).toHaveBeenCalledExactlyOnceWith({ orgId, role: "owner" }, "payment:verify")
  expect(rpc).not.toHaveBeenCalled()
})
it("legacy adoption returns command errors so unchanged details can be retried", async () => {
  rpc.mockResolvedValue({ error: { message: "Invoice version changed" } })
  expect(await adoptLegacyInvoice({ invoiceId, expectedVersion: 4, key, reason: "Reviewed original invoice" })).toEqual({ error: "Invoice version changed" })
})
it("profile validation matches the database contract before dispatch", async () => {
  for (const value of [{ legalName: "Company", address: "Address", taxId: "", taxStatus: "registered" as const }, { legalName: "Company", address: "Address", taxId: "123", taxStatus: "unknown" as const }, { legalName: "Company", address: "A".repeat(1001), taxId: "", taxStatus: "unknown" as const }]) {
    expect((await updateBusinessProfile({ ...value, expectedOrgId: orgId })).error).toBeTruthy()
  }
  expect(rpc).not.toHaveBeenCalled()
})
it("profile update leaves tax classification explicit and trusts active org only", async () => {
  expect(await updateBusinessProfile({ expectedOrgId: orgId, legalName: "ร้านทดลอง", address: "ที่อยู่ทดลอง", taxId: "", taxStatus: "unknown" })).toEqual({})
  expect(rpc).toHaveBeenCalledExactlyOnceWith("update_tax_business_profile", { p_org_id: orgId, p_legal_name: "ร้านทดลอง", p_business_address: "ที่อยู่ทดลอง", p_tax_id: "", p_tax_status: "unknown", p_vat_rate_bps: 700, p_prices_include_vat: false, p_branch_label: "" })
})
it("stale profile form cannot save an A profile after the active org switches to B", async () => {
  expect((await updateBusinessProfile({ expectedOrgId: invoiceId, legalName: "ร้าน A", address: "ที่อยู่ A", taxId: "", taxStatus: "unknown" })).error).toContain("Workspace changed")
  expect(rpc).not.toHaveBeenCalled()
})
it("withholding reaches a draft invoice whose seeded id lacks RFC 9562 version bits", async () => {
  const seeded = "60000000-0000-0000-0000-000000000001"
  const query = { update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), select: vi.fn().mockReturnThis(), maybeSingle: async () => ({ data: { id: seeded }, error: null }) }
  from.mockReturnValue(query)
  expect(await updateInvoiceWithholding({ invoiceId: seeded, rateBps: 300 })).toEqual({})
  expect(query.update).toHaveBeenCalledWith({ wht_rate_bps: 300 })
  expect(query.eq).toHaveBeenCalledWith("id", seeded)
})

it.each(["registered", "not_registered", "unknown"] as const)("profile sends explicit %s status", async taxStatus => {
  expect(await updateBusinessProfile({ expectedOrgId: orgId, legalName: "Seller", address: "Address", taxId: "1234567890123", taxStatus })).toEqual({})
  expect(rpc).toHaveBeenCalledWith("update_tax_business_profile", expect.objectContaining({ p_tax_status: taxStatus }))
})

it.each(["TX", "ABB"] as const)("tax invoice issuance sends the %s doc type with the exact version and key", async docType => {
  expect(await issueTaxInvoice({ invoiceId, expectedVersion: 4, key, docType })).toEqual({})
  expect(rpc).toHaveBeenCalledExactlyOnceWith("issue_tax_invoice", { p_org_id: orgId, p_invoice_id: invoiceId, p_expected_version: 4, p_key: key, p_doc_type: docType })
})
it("tax invoice issuance rejects unknown types and nonstaff before dispatch, and surfaces refusals", async () => {
  expect((await issueTaxInvoice({ invoiceId, expectedVersion: 4, key, docType: "INV" as never })).error).toBeTruthy()
  gate.mockImplementation(() => { throw new Error("denied") })
  expect((await issueTaxInvoice({ invoiceId, expectedVersion: 4, key, docType: "TX" })).error).toBeTruthy()
  expect(rpc).not.toHaveBeenCalled()
  gate.mockImplementation(() => {})
  rpc.mockResolvedValue({ data: null, error: { message: "VAT registration and a 13-digit seller tax ID required for a tax invoice" } })
  expect((await issueTaxInvoice({ invoiceId, expectedVersion: 4, key, docType: "TX" })).error).toContain("VAT registration")
})
