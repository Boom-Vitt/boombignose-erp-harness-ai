"use server"

import { revalidatePath } from "next/cache"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { parseSpreadsheet } from "@/lib/import/sheet"
import { validateImport, type ImportError, type ImportKind } from "@/lib/import/rows"
import { createClient } from "@/lib/supabase/server"

const MAX_BYTES = 1_000_000

export async function importSheet(formData: FormData): Promise<{ error?: string; errors?: ImportError[]; saved?: number }> {
  const ctx = await requireOrgContext()
  const kind = formData.get("kind")
  const file = formData.get("file")
  const warehouseId = String(formData.get("warehouseId") ?? "")
  if (kind !== "customers" && kind !== "products" && kind !== "opening-stock") return { error: "Choose what to import." }
  if (!(file instanceof File)) return { error: "Choose a CSV or Excel file." }
  if (file.size > MAX_BYTES) return { error: "The file is larger than 1 MB." }
  const capability = kind === "customers" ? "record:write" : kind === "products" ? "product:manage" : "inventory:manage"
  try { requireCapability(ctx, capability) } catch { return { error: "Your role cannot import this list." } }

  let grid: string[][]
  try {
    grid = parseSpreadsheet(file.name, Buffer.from(await file.arrayBuffer()))
  } catch (caught) {
    return { error: caught instanceof Error ? caught.message : "The file could not be read." }
  }
  const parsed = validateImport(kind, grid)
  if (parsed.errors.length > 0) return { errors: parsed.errors }

  const supabase = await createClient()
  if (kind === "customers") {
    for (const [index, row] of parsed.customers.entries()) {
      const { data, error } = await supabase.from("clients").insert({
        org_id: ctx.orgId,
        owner: ctx.userId,
        name: row.name,
        tax_id: row.taxId,
        billing_address: row.address,
        source: "import",
      }).select("id").single()
      if (error || !data) return { error: `Row ${index + 2} was not saved. Earlier rows in this file were saved. ${error?.message ?? "Customer was not saved."}` }
      if (row.phone || row.email) {
        const contact = await supabase.from("contacts").insert({ org_id: ctx.orgId, client_id: data.id, name: row.name, phone: row.phone, email: row.email })
        if (contact.error) return { error: `Row ${index + 2} saved the customer without a contact. ${contact.error.message}` }
      }
    }
    revalidatePath("/clients")
    return { saved: parsed.customers.length }
  }

  if (kind === "products") {
    for (const [index, row] of parsed.products.entries()) {
      const { error } = await supabase.from("products").insert({
        org_id: ctx.orgId,
        sku: row.sku,
        name: row.name,
        unit: row.unit,
        type: row.type,
        list_price_satang: row.priceSatang,
        cost_satang: row.costSatang,
        tax_rate_bps: row.taxRateBps,
        is_stockable: row.stockable,
      })
      if (error) {
        const message = error.code === "23505" ? "This SKU is already used in your workspace." : error.message
        return { error: `Row ${index + 2} was not saved. Earlier rows in this file were saved. ${message}` }
      }
    }
    revalidatePath("/products")
    return { saved: parsed.products.length }
  }

  if (!warehouseId) return { error: "Choose the warehouse for the opening quantities." }
  const skus = parsed.stock.map((row) => row.sku)
  const { data: products, error: productError } = await supabase.from("products").select("id, sku, is_stockable").eq("org_id", ctx.orgId).in("sku", skus)
  if (productError) return { error: "Products could not be read." }
  const bySku = new Map((products ?? []).filter((product) => product.sku).map((product) => [product.sku!.toLowerCase(), product]))
  const missing: ImportError[] = []
  for (const [index, row] of parsed.stock.entries()) {
    const product = bySku.get(row.sku.toLowerCase())
    if (!product) missing.push({ row: index + 2, message: "รหัส is not a product in this workspace." })
    else if (!product.is_stockable) missing.push({ row: index + 2, message: "รหัส is not a stockable product." })
  }
  if (missing.length > 0) return { errors: missing }
  for (const [index, row] of parsed.stock.entries()) {
    const product = bySku.get(row.sku.toLowerCase())!
    const { error } = await supabase.rpc("adjust_stock", {
      p_org_id: ctx.orgId,
      p_product_id: product.id,
      p_warehouse_id: warehouseId,
      p_count: Number(row.quantity),
      p_reason: "Opening stock import",
      p_key: crypto.randomUUID(),
      p_unit_cost_satang: row.unitCostSatang,
    })
    if (error) return { error: `Row ${index + 2} was not counted. Earlier rows in this file were counted. ${error.message}` }
  }
  revalidatePath("/inventory")
  return { saved: parsed.stock.length }
}
