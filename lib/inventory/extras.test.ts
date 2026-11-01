import { expect, it } from "vitest"
import { TransferInput } from "./schema"

const command = { product_id: "a0000000-0000-0000-0000-000000000001", from_warehouse_id: "a0000000-0000-0000-0000-000000000002", to_warehouse_id: "a0000000-0000-0000-0000-000000000003", quantity: 0.001, reason: "Relocate", key: "be510000-0000-4000-8000-000000000060" }
it("accepts seeded database GUIDs and fractional transfers", () => { expect(TransferInput.parse(command)).toEqual(command) })
it("refuses same-warehouse, empty and overprecision transfers", () => {
  expect(TransferInput.safeParse({ ...command, to_warehouse_id: command.from_warehouse_id }).success).toBe(false)
  for (const quantity of [0, -1, NaN, 0.0001]) expect(TransferInput.safeParse({ ...command, quantity }).success).toBe(false)
})

it("prints the retained stock number, date and quantity while escaping user text", async () => {
  const { renderStockDocument } = await import("./printable")
  const html = renderStockDocument("<Org>", { kind: "delivery", number: "DO-2026-000001", document_date: "2026-10-23" }, [{ description: "<script>alert(1)</script>", quantity: 1.5, unit: "piece" }])
  expect(html).toContain("DO-2026-000001")
  expect(html).toContain("2026-10-23")
  expect(html).toContain("1.5")
  expect(html).toContain("&lt;script&gt;")
  expect(html).not.toContain("<script>")
  expect(html).not.toContain("Public reference")
  const withReference = renderStockDocument("<Org>", { kind: "delivery", number: "DO-2026-000001", document_date: "2026-10-23" }, [{ description: "Box", quantity: 1, unit: "piece" }], "dlv1qqqq-qqqq-qqqq-qqqq-qqqq")
  expect(withReference).toContain("DO-2026-000001")
  expect(withReference).toContain("Public reference dlv1qqqq-qqqq-qqqq-qqqq-qqqq")
})
