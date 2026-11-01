import { moneyInput } from "@/lib/payments/input"

export type ImportKind = "customers" | "products" | "opening-stock"

export type ImportError = { row: number; message: string }

export type CustomerRow = { name: string; taxId: string | null; address: string | null; phone: string | null; email: string | null }
export type ProductRow = { sku: string | null; name: string; unit: string; priceSatang: number; costSatang: number; taxRateBps: number; type: "goods" | "service"; stockable: boolean }
export type OpeningStockRow = { sku: string; quantity: string; unitCostSatang: number }

const CUSTOMER = {
  name: ["name", "ชื่อ", "ชื่อลูกค้า"],
  taxId: ["tax id", "tax_id", "เลขผู้เสียภาษี", "เลขประจำตัวผู้เสียภาษี"],
  address: ["address", "ที่อยู่", "billing address"],
  phone: ["phone", "โทร", "โทรศัพท์"],
  email: ["email", "อีเมล"],
}
const PRODUCT = {
  sku: ["sku", "รหัส", "รหัสสินค้า"],
  name: ["name", "ชื่อ", "ชื่อสินค้า"],
  unit: ["unit", "หน่วย"],
  price: ["price", "ราคา", "ราคาขาย"],
  cost: ["cost", "ต้นทุน"],
  tax: ["vat", "ภาษี", "vat %"],
  type: ["type", "ประเภท"],
  stockable: ["stockable", "สต็อก", "สินค้าคงคลัง"],
}
const STOCK = {
  sku: ["sku", "รหัส", "รหัสสินค้า"],
  quantity: ["quantity", "qty", "จำนวน"],
  cost: ["unit cost", "ต้นทุนต่อหน่วย", "ต้นทุน"],
}

export function validateImport(kind: ImportKind, grid: string[][]): { customers: CustomerRow[]; products: ProductRow[]; stock: OpeningStockRow[]; errors: ImportError[] } {
  const empty = { customers: [] as CustomerRow[], products: [] as ProductRow[], stock: [] as OpeningStockRow[], errors: [] as ImportError[] }
  if (grid.length === 0) return { ...empty, errors: [{ row: 1, message: "The file is empty." }] }
  const header = grid[0]!.map(normalizeHeader)
  const index = (aliases: string[]) => header.findIndex((cell) => aliases.includes(cell))
  if (kind === "customers") return { ...empty, ...validateCustomers(grid, index) }
  if (kind === "products") return { ...empty, ...validateProducts(grid, index) }
  return { ...empty, ...validateStock(grid, index) }
}

function validateCustomers(grid: string[][], index: (aliases: string[]) => number) {
  const nameCol = index(CUSTOMER.name)
  if (nameCol < 0) return { errors: [{ row: 1, message: "The first row needs a ชื่อ or name column." }] }
  const taxCol = index(CUSTOMER.taxId)
  const addressCol = index(CUSTOMER.address)
  const phoneCol = index(CUSTOMER.phone)
  const emailCol = index(CUSTOMER.email)
  const customers: CustomerRow[] = []
  const errors: ImportError[] = []
  for (let i = 1; i < grid.length; i++) {
    const line = grid[i]!
    const row = i + 1
    const name = cell(line, nameCol)
    if (!name || name.length > 200) errors.push({ row, message: "ชื่อ is required and must be 200 characters or fewer." })
    const taxId = taxCol < 0 ? "" : digits(cell(line, taxCol))
    if (taxId && !/^[0-9]{13}$/.test(taxId)) errors.push({ row, message: "เลขผู้เสียภาษี must be 13 digits or blank." })
    const address = addressCol < 0 ? "" : cell(line, addressCol)
    if (address.length > 1000) errors.push({ row, message: "ที่อยู่ must be 1000 characters or fewer." })
    const phone = phoneCol < 0 ? "" : cell(line, phoneCol)
    if (phone.length > 40) errors.push({ row, message: "โทร must be 40 characters or fewer." })
    const email = emailCol < 0 ? "" : cell(line, emailCol)
    if (email && !/^[^\s@]+@[^\s@]+$/.test(email)) errors.push({ row, message: "อีเมล is not an email address." })
    if (!errors.some((error) => error.row === row)) {
      customers.push({ name, taxId: taxId || null, address: address || null, phone: phone || null, email: email || null })
    }
  }
  if (customers.length === 0 && errors.length === 0) errors.push({ row: 2, message: "There are no customer rows." })
  return { customers, errors }
}

function validateProducts(grid: string[][], index: (aliases: string[]) => number) {
  const nameCol = index(PRODUCT.name)
  if (nameCol < 0) return { errors: [{ row: 1, message: "The first row needs a ชื่อ or name column." }] }
  const skuCol = index(PRODUCT.sku)
  const unitCol = index(PRODUCT.unit)
  const priceCol = index(PRODUCT.price)
  const costCol = index(PRODUCT.cost)
  const taxCol = index(PRODUCT.tax)
  const typeCol = index(PRODUCT.type)
  const stockCol = index(PRODUCT.stockable)
  const products: ProductRow[] = []
  const errors: ImportError[] = []
  const seen = new Set<string>()
  for (let i = 1; i < grid.length; i++) {
    const line = grid[i]!
    const row = i + 1
    const name = cell(line, nameCol)
    if (!name || name.length > 200) errors.push({ row, message: "ชื่อ is required and must be 200 characters or fewer." })
    const sku = skuCol < 0 ? "" : cell(line, skuCol)
    if (sku.length > 80) errors.push({ row, message: "รหัส must be 80 characters or fewer." })
    if (sku) {
      const key = sku.toLowerCase()
      if (seen.has(key)) errors.push({ row, message: "รหัส is repeated in this file." })
      seen.add(key)
    }
    const unit = unitCol < 0 ? "piece" : cell(line, unitCol) || "piece"
    if (unit.length > 40) errors.push({ row, message: "หน่วย must be 40 characters or fewer." })
    const type = productType(typeCol < 0 ? "" : cell(line, typeCol))
    if (!type) errors.push({ row, message: "ประเภท must be สินค้า, บริการ, goods, or service." })
    let priceSatang = 0
    let costSatang = 0
    let taxRateBps = 0
    try { priceSatang = priceCol < 0 ? 0 : baht(cell(line, priceCol)) } catch { errors.push({ row, message: "ราคา must be a baht amount with up to two decimals." }) }
    try { costSatang = costCol < 0 ? 0 : baht(cell(line, costCol)) } catch { errors.push({ row, message: "ต้นทุน must be a baht amount with up to two decimals." }) }
    try { taxRateBps = taxCol < 0 ? 0 : vatBps(cell(line, taxCol)) } catch { errors.push({ row, message: "ภาษี must be a percent from 0 to 100." }) }
    const stockable = stockFlag(stockCol < 0 ? "" : cell(line, stockCol), type === "goods")
    if (stockable === null) errors.push({ row, message: "สต็อก must be ใช่, ไม่, yes, or no." })
    if (!errors.some((error) => error.row === row) && type && stockable !== null) {
      products.push({ sku: sku || null, name, unit, priceSatang, costSatang, taxRateBps, type, stockable })
    }
  }
  if (products.length === 0 && errors.length === 0) errors.push({ row: 2, message: "There are no product rows." })
  return { products, errors }
}

function validateStock(grid: string[][], index: (aliases: string[]) => number) {
  const skuCol = index(STOCK.sku)
  const qtyCol = index(STOCK.quantity)
  const costCol = index(STOCK.cost)
  if (skuCol < 0 || qtyCol < 0) return { errors: [{ row: 1, message: "The first row needs รหัส and จำนวน columns." }] }
  const stock: OpeningStockRow[] = []
  const errors: ImportError[] = []
  const seen = new Set<string>()
  for (let i = 1; i < grid.length; i++) {
    const line = grid[i]!
    const row = i + 1
    const sku = cell(line, skuCol)
    if (!sku || sku.length > 80) errors.push({ row, message: "รหัส is required." })
    if (sku && seen.has(sku.toLowerCase())) errors.push({ row, message: "รหัส is repeated in this file." })
    if (sku) seen.add(sku.toLowerCase())
    const quantity = cell(line, qtyCol).replace(/,/g, "")
    if (!/^\d+(\.\d{1,3})?$/.test(quantity) || Number(quantity) <= 0 || Number(quantity) > 999999999.999) {
      errors.push({ row, message: "จำนวน must be greater than zero with at most three decimals." })
    }
    const rawCost = costCol < 0 ? "" : cell(line, costCol)
    let unitCostSatang = Number.NaN
    if (!rawCost) errors.push({ row, message: "ต้นทุนต่อหน่วย is required." })
    else {
      try { unitCostSatang = baht(rawCost) } catch { errors.push({ row, message: "ต้นทุนต่อหน่วย is required." }) }
    }
    if (!errors.some((error) => error.row === row)) stock.push({ sku, quantity, unitCostSatang })
  }
  if (stock.length === 0 && errors.length === 0) errors.push({ row: 2, message: "There are no stock rows." })
  return { stock, errors }
}

function normalizeHeader(value: string): string {
  return value.replace(/^\uFEFF/, "").trim().replace(/\s+/g, " ").replace(/^\*|\*$/g, "").trim().toLowerCase()
}

function cell(row: string[], index: number): string {
  return (row[index] ?? "").trim()
}

function digits(value: string): string {
  return value.replace(/[\s-]/g, "")
}

function baht(value: string): number {
  const cleaned = value.trim().replace(/[฿,\s]/g, "")
  if (!cleaned) return 0
  return moneyInput(cleaned)
}

function vatBps(value: string): number {
  const cleaned = value.trim().replace(/%/g, "")
  if (!cleaned) return 0
  if (!/^\d+(\.\d)?$/.test(cleaned)) throw new Error("vat")
  const bps = Math.round(Number(cleaned) * 100)
  if (bps < 0 || bps > 10000) throw new Error("vat")
  return bps
}

function productType(value: string): "goods" | "service" | null {
  const text = value.trim().toLowerCase()
  if (!text || text === "goods" || text === "สินค้า") return "goods"
  if (text === "service" || text === "บริการ") return "service"
  return null
}

function stockFlag(value: string, fallback: boolean): boolean | null {
  const text = value.trim().toLowerCase()
  if (!text) return fallback
  if (["yes", "y", "true", "1", "ใช่", "มี"].includes(text)) return true
  if (["no", "n", "false", "0", "ไม่", "ไม่มี"].includes(text)) return false
  return null
}
