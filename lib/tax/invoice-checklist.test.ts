import { describe, expect, it } from "vitest"
import { readTaxInvoiceTemplate, taxInvoiceChecklist, TaxInvoiceTemplate } from "@/lib/tax/invoice-checklist"

const empty = { seller_phone: "", branch_code: "", copy_label: "" }
const profile = { legalName: "ร้านตัวอย่าง", address: "กรุงเทพ", taxId: "1234567890123", branchLabel: "สำนักงานใหญ่", taxStatus: "registered" as const, template: empty }

describe("taxInvoiceChecklist", () => {
  it("marks filled seller fields present and keeps the statutory gaps", () => {
    const items = taxInvoiceChecklist(profile)
    expect(items.find(item => item.id === "seller-name")?.state).toBe("present")
    expect(items.find(item => item.id === "seller-tax-id")?.state).toBe("present")
    expect(items.find(item => item.id === "etax")?.state).toBe("gap")
    expect(items.find(item => item.id === "statutory-name")?.detail).toContain("operational")
    expect(items.find(item => item.id === "registration")).toBeUndefined()
    expect(items.find(item => item.id === "buyer-name")?.state).toBe("per_document")
    expect(items.find(item => item.id === "series")?.state).toBe("per_document")
    expect(items.find(item => item.id === "branch-code")?.detail).toContain("Required to issue TX or ABB")
    expect(items.find(item => item.id === "original-copy")?.state).toBe("gap")
    expect(items.map(item => item.detail).join(" ")).not.toMatch(/filed successfully|ยื่นแบบสำเร็จ/)
  })

  it("reports a missing tax ID and an unregistered profile", () => {
    const items = taxInvoiceChecklist({ ...profile, taxId: "123", taxStatus: "not_registered" })
    expect(items.find(item => item.id === "seller-tax-id")?.state).toBe("missing")
    expect(items.find(item => item.id === "registration")?.state).toBe("gap")
  })

  it("accepts only the optional template keys", () => {
    expect(TaxInvoiceTemplate.parse({ seller_phone: "02-000-0000", branch_code: "00000", copy_label: "ต้นฉบับ" })).toEqual({ seller_phone: "02-000-0000", branch_code: "00000", copy_label: "ต้นฉบับ" })
    expect(TaxInvoiceTemplate.safeParse({ branch_code: "12" }).success).toBe(false)
    expect(TaxInvoiceTemplate.safeParse({ seller_phone: "x".repeat(41) }).success).toBe(false)
    expect(readTaxInvoiceTemplate({ seller_phone: "02", extra: true })).toEqual({ seller_phone: "02", branch_code: "", copy_label: "" })
    expect(readTaxInvoiceTemplate({ branch_code: "nope" })).toEqual(empty)
  })
})
