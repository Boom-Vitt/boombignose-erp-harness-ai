import { describe, expect, it } from "vitest"
import { AGING_BUCKET_DISPLAY, AGING_BUCKET_LABEL, agingBucket, daysPastDue, outstandingPack, outstandingPackCsv } from "@/lib/finance/outstanding-pack"
import type { OutstandingBill, OutstandingInvoice } from "@/lib/finance/outstanding-pack"

const asOf = "2026-10-31"

const invoice = (extra: Partial<OutstandingInvoice> & Pick<OutstandingInvoice, "id" | "outstandingSatang" | "dueDate">): OutstandingInvoice => ({
  number: extra.id.toUpperCase(),
  party: "ลูกค้า",
  status: "sent",
  issueDate: "2026-09-01",
  ...extra,
})

const bill = (extra: Partial<OutstandingBill> & Pick<OutstandingBill, "id" | "amountSatang" | "dueDate">): OutstandingBill => ({
  number: extra.id,
  party: "ผู้ขาย",
  incurredOn: "2026-09-01",
  paidOn: null,
  vendorId: "vendor",
  expenseClaimId: null,
  kind: "bill",
  ...extra,
})

describe("aging buckets", () => {
  it("uses the statements cuts, and a missing due date stays not yet due", () => {
    expect(daysPastDue(null, asOf)).toBe(0)
    expect(agingBucket("2026-10-31", asOf)).toBe("current")
    expect(agingBucket("2026-10-30", asOf)).toBe("days1to30")
    expect(agingBucket("2026-10-01", asOf)).toBe("days1to30")
    expect(agingBucket("2026-09-30", asOf)).toBe("days31to60")
    expect(agingBucket("2026-09-01", asOf)).toBe("days31to60")
    expect(agingBucket("2026-08-31", asOf)).toBe("days61to90")
    expect(agingBucket("2026-08-02", asOf)).toBe("days61to90")
    expect(agingBucket("2026-08-01", asOf)).toBe("days91plus")
  })

  it("shows Thai aging labels on screen and keeps the English name in the CSV", () => {
    for (const bucket of Object.keys(AGING_BUCKET_LABEL) as (keyof typeof AGING_BUCKET_LABEL)[]) {
      expect(AGING_BUCKET_DISPLAY[bucket]).toContain(AGING_BUCKET_LABEL[bucket])
      expect(AGING_BUCKET_DISPLAY[bucket]).toMatch(/[\u0E00-\u0E7F]/)
    }
  })
})

describe("outstandingPack", () => {
  const rows = outstandingPack(asOf, [
    invoice({ id: "open", outstandingSatang: 104_000, dueDate: "2026-10-01", status: "overdue" }),
    invoice({ id: "draft", outstandingSatang: 50_000, dueDate: "2026-10-01", status: "draft" }),
    invoice({ id: "future", outstandingSatang: 50_000, dueDate: "2026-11-15", issueDate: "2026-11-01" }),
    invoice({ id: "settled", outstandingSatang: 0, dueDate: "2026-10-01", status: "paid" }),
    invoice({ id: "current", outstandingSatang: 10_000, dueDate: null, number: "INV-2" }),
  ], [
    bill({ id: "bill", amountSatang: 20_000, dueDate: "2026-08-01" }),
    bill({ id: "paid", amountSatang: 20_000, dueDate: "2026-08-01", paidOn: "2026-10-31" }),
    bill({ id: "paid-later", amountSatang: 3_000, dueDate: "2026-10-15", paidOn: "2026-11-05" }),
    bill({ id: "credit", amountSatang: 1_000, dueDate: "2026-08-01", kind: "credit" }),
    bill({ id: "claim", amountSatang: 1_000, dueDate: "2026-08-01", expenseClaimId: "claim" }),
    bill({ id: "opex", amountSatang: 1_000, dueDate: "2026-08-01", vendorId: null }),
  ])

  it("keeps open issued invoices and unpaid vendor bills dated through the close", () => {
    expect(rows.map(row => row.id)).toEqual(["open", "current", "bill", "paid-later"])
    expect(rows.find(row => row.id === "open")).toMatchObject({ side: "AR", daysPastDue: 30, bucket: "days1to30", status: "overdue" })
    expect(rows.find(row => row.id === "current")).toMatchObject({ bucket: "current", dueDate: "", daysPastDue: 0 })
    expect(rows.find(row => row.id === "bill")).toMatchObject({ side: "AP", bucket: "days91plus", status: "unpaid" })
    expect(rows.find(row => row.id === "paid-later")?.status).toBe("unpaid at close")
  })

  it("writes an exact baht pack with both totals", () => {
    const csv = outstandingPackCsv([
      ...rows,
      { side: "AR", id: "x", number: "=1+1", party: "ลูกค้า, \"เอ\"", documentDate: "2026-09-01", dueDate: "", amountSatang: 50, daysPastDue: 0, bucket: "current", status: "sent" },
    ])
    expect(csv.startsWith("\uFEFFSide,Document ID")).toBe(true)
    expect(csv).toContain("1040.00")
    expect(csv).toContain(",0.50,0,Not yet due,sent")
    expect(csv).toContain("AR total")
    expect(csv).toContain("1140.50")
    expect(csv).toContain("AP total")
    expect(csv).toContain("230.00")
    expect(csv).toContain("'=1+1")
    expect(csv).toContain("\"ลูกค้า, \"\"เอ\"\"\"")
  })

  it("refuses a close date that is not a calendar date", () => {
    expect(() => outstandingPack("2026-10-32", [], [])).toThrow("YYYY-MM-DD")
  })
})
