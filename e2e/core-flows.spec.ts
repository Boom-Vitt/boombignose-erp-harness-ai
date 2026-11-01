import { randomUUID } from "node:crypto"
import { expect, test, type Page } from "@playwright/test"

test.describe.configure({ retries: 0 })

async function pageClue(page: Page) {
  const names = (await page.context().cookies()).map((cookie) => cookie.name).sort().join(" ")
  const text = (await page.locator("body").innerText()).replace(/\s+/g, " ").slice(0, 400)
  return `url=${page.url()} cookies=${names || "(none)"} body=${text}`
}

async function expectDashboard(page: Page) {
  try {
    await page.waitForURL((url) => url.pathname === "/dashboard")
    await expect(page.getByRole("heading", { name: "Dashboard", exact: true })).toBeVisible()
  } catch (error) {
    throw new Error(await pageClue(page), { cause: error })
  }
}

async function gotoApp(page: Page, path: string) {
  await page.goto(path)
  if (new URL(page.url()).pathname === "/login") {
    throw new Error(`redirected to login from ${path}; ${await pageClue(page)}`)
  }
}

/** A vertical scrollbar is fine. A sideways scrollbar means a control is wider than the phone. */
async function expectFits(page: Page, path: string) {
  await gotoApp(page, path)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow, `${path} is ${overflow}px wider than the viewport`).toBeLessThanOrEqual(1)
}

test("sign up, then record stock, a VAT invoice, a purchase, a transfer, a receipt, and reports", async ({ page }) => {
  test.setTimeout(300_000)
  const email = `core-${randomUUID()}@example.com`
  const password = "Local-Core-19"
  const buyer = "Core buyer"
  const product = "Core goods"
  const reason = "Opening count"

  await page.goto("/signup")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Create account", exact: true }).click()
  await page.waitForURL("**/onboarding")
  await page.getByLabel("Workspace name / ชื่อพื้นที่ทำงาน").fill("Core flow shop")
  await page.getByRole("button", { name: "Create workspace / สร้างพื้นที่ทำงาน", exact: true }).click()
  await expectDashboard(page)

  await page.getByRole("button", { name: "Sign out", exact: true }).click()
  await page.waitForURL((url) => url.pathname === "/login")
  await page.getByLabel("Email", { exact: true }).fill(email)
  await page.getByLabel("Password", { exact: true }).fill(password)
  await page.getByRole("button", { name: "Sign in", exact: true }).click()
  await expectDashboard(page)
  await expect(page.getByRole("link", { name: "Skip to content", exact: true })).toHaveAttribute("href", "#content")

  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ["/dashboard", "/finance", "/reports", "/purchases", "/settings"]) await expectFits(page, path)
  await page.setViewportSize({ width: 1280, height: 720 })

  await gotoApp(page, "/clients/new")
  await page.getByLabel("Name", { exact: true }).fill(buyer)
  await page.getByLabel("Tax ID", { exact: true }).fill("9876543210123")
  await page.getByRole("button", { name: "Create client", exact: true }).click()
  await page.waitForURL(/\/clients\/[^/]+$/)
  await expect(page.getByRole("heading", { name: buyer, exact: true })).toBeVisible()

  await gotoApp(page, "/products/new")
  await page.getByLabel("Name", { exact: true }).fill(product)
  await page.getByLabel("Type", { exact: true }).click()
  await page.getByRole("option", { name: "Goods", exact: true }).click()
  await page.getByLabel("Unit", { exact: true }).fill("piece")
  await page.getByLabel("Sales price (THB)").fill("20.00")
  await page.getByLabel("Cost (THB)").fill("10.00")
  await page.getByRole("checkbox", { name: "Stockable" }).check()
  await page.getByRole("button", { name: "Create product", exact: true }).click()
  await expect(page.getByRole("heading", { name: product, exact: true })).toBeVisible()
  const productId = new URL(page.url()).pathname.split("/").pop()!

  await gotoApp(page, "/inventory/warehouses")
  const warehouse = page.getByRole("region", { name: "Main warehouse", exact: true })
  await expect(warehouse).toContainText("MAIN")
  await expect(warehouse.getByText("Default", { exact: true })).toBeVisible()

  await gotoApp(page, "/inventory/adjust")
  await page.getByLabel("Product", { exact: true }).selectOption({ label: product })
  await page.getByLabel("Counted quantity", { exact: true }).fill("4")
  await page.getByLabel("Unit cost (THB)", { exact: true }).fill("10.00")
  await page.getByLabel("Reason", { exact: true }).fill(reason)
  await page.getByRole("button", { name: "Record count", exact: true }).click()
  await expect(page.getByRole("status")).toContainText("Count recorded.")
  await gotoApp(page, `/inventory?product=${productId}`)
  await expect(page.getByTestId(`on-hand-${productId}`)).toHaveText("4 piece")
  await gotoApp(page, "/inventory/moves")
  await expect(page.getByRole("cell", { name: "Adjustment In", exact: true })).toBeVisible()
  await expect(page.getByRole("cell", { name: reason, exact: true })).toBeVisible()

  await gotoApp(page, "/finance/business-profile")
  await expect(page.getByRole("heading", { name: "ข้อมูลกิจการ / Business profile", exact: true })).toBeVisible()
  await page.getByLabel(/Legal business name/).fill("Core flow seller")
  await page.getByLabel(/Business address/).fill("Core flow address")
  await page.getByLabel(/Tax ID/).fill("1234567890123")
  await page.getByLabel("Branch", { exact: true }).fill("Head office")
  await page.getByRole("combobox", { name: "VAT status", exact: true }).selectOption("registered")
  await page.getByRole("button", { name: "Save business profile", exact: true }).click()
  await expect(page.getByText("Business profile saved")).toBeVisible()

  await gotoApp(page, "/finance/invoices/new")
  await page.getByRole("combobox", { name: "Client", exact: true }).click()
  await page.getByRole("option", { name: buyer, exact: true }).click()
  await page.getByRole("button", { name: "Create invoice", exact: true }).click()
  await page.waitForURL(/\/finance\/invoices\/[^/]+$/)
  const lines = page.getByRole("form", { name: "Edit line items" })
  await lines.getByRole("button", { name: "Add a line", exact: true }).click()
  await lines.getByLabel("Description, row 1", { exact: true }).fill("Taxable consulting")
  await lines.getByLabel("Unit price, row 1", { exact: true }).fill("1000.00")
  await expect(lines.getByLabel("VAT, row 1", { exact: true })).toHaveValue("700")
  await lines.getByRole("button", { name: "Save lines", exact: true }).click()
  await expect(lines.getByText("Unsaved line changes", { exact: true })).toHaveCount(0)
  const withholding = page.getByRole("combobox", { name: "Withholding tax", exact: true })
  await withholding.selectOption("300")
  await expect(withholding).toHaveValue("300")
  const totals = page.getByTestId("document-totals")
  for (const [label, amount] of [["Subtotal", "1,000.00"], ["Discount", "0.00"], ["VAT 7%", "70.00"], ["Total", "1,070.00"], ["WHT 3%", "30.00"], ["Amount due", "1,040.00"]]) {
    await expect(totals.getByText(label, { exact: true }).locator("..").locator("dd")).toContainText(amount)
  }

  const invoiceUrl = page.url()
  const bangkokToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  await gotoApp(page, "/settings/finance")
  await page.getByLabel("Lock transactions through", { exact: true }).fill(bangkokToday)
  await page.getByRole("button", { name: "Save finance lock", exact: true }).click()
  await expect(page.getByText("Finance lock date saved", { exact: true })).toBeVisible()
  await gotoApp(page, invoiceUrl)
  await page.getByLabel("I checked the business profile, buyer, lines, discount and dates.").check()
  await page.getByRole("button", { name: "Issue operational invoice", exact: true }).click()
  await expect(page.getByText("Finance period is locked", { exact: true })).toBeVisible()

  await gotoApp(page, "/settings/finance")
  await page.getByLabel("Lock transactions through", { exact: true }).fill("")
  await page.getByLabel("Reason for reopening", { exact: true }).fill("Unlock the draft so it can be issued")
  await page.getByRole("button", { name: "Save finance lock", exact: true }).click()
  await expect(page.getByText("Finance lock date saved", { exact: true })).toBeVisible()
  await gotoApp(page, invoiceUrl)
  await page.getByLabel("I checked the business profile, buyer, lines, discount and dates.").check()
  await page.getByRole("button", { name: "Issue operational invoice", exact: true }).click()
  await expect(page.getByText("Issued snapshot retained. Corrections must preserve the original document.")).toBeVisible()
  const number = `INV-${bangkokToday.slice(0, 4)}-000001`
  await expect(page.getByRole("heading", { name: number, exact: true })).toBeVisible()
  const buddhistYear = String(Number(bangkokToday.slice(0, 4)) + 543)
  const buddhistLabel = `(${bangkokToday.slice(8, 10)}/${bangkokToday.slice(5, 7)}/${buddhistYear})`
  const pdf = await page.request.get(`${invoiceUrl}/pdf`)
  expect(pdf.ok()).toBeTruthy()
  const html = await pdf.text()
  expect(html).toContain("ผู้ขาย")
  expect(html).toContain("ลูกค้า")
  expect(html).toContain("Core flow seller")
  expect(html).toContain(buyer)
  expect(html).toContain(buddhistLabel)

  const vendor = "Core vendor"
  const line = "Core purchase line"
  await gotoApp(page, "/vendors/new")
  await page.getByLabel("Name", { exact: true }).fill(vendor)
  await page.getByLabel("Email", { exact: true }).fill("core-vendor@example.invalid")
  await page.getByRole("button", { name: "Create vendor", exact: true }).click()
  await expect(page.getByRole("heading", { name: vendor, exact: true })).toBeVisible()
  await page.getByRole("link", { name: "New purchase order", exact: true }).click()
  await page.getByRole("button", { name: "Create purchase order", exact: true }).click()
  await expect(page.getByRole("heading", { name: /^PO-/ })).toBeVisible()

  const purchaseLines = page.getByRole("form", { name: "Edit line items" })
  await purchaseLines.getByRole("button", { name: "Add a line", exact: true }).click()
  await purchaseLines.getByRole("combobox", { name: "Product, row 1" }).click()
  await page.getByLabel("Search products by name or SKU").fill(product)
  await page.getByRole("option").filter({ hasText: product }).click()
  await expect(purchaseLines.getByLabel("Unit cost, row 1")).not.toHaveValue("")
  await purchaseLines.getByLabel("Description, row 1", { exact: true }).fill(line)
  await purchaseLines.getByLabel("Quantity, row 1", { exact: true }).fill("2")
  await purchaseLines.getByLabel("Unit cost, row 1").fill("10.00")
  await purchaseLines.getByRole("button", { name: "Save lines", exact: true }).click()
  await expect(purchaseLines.getByText("Unsaved line changes", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Confirm", exact: true }).click()
  await expect(page.locator('[aria-label="Purchase status"] [aria-current="step"]')).toHaveText("Confirmed")
  await expect(page.getByLabel(`Received total for ${line}`)).toHaveValue("2")
  await page.getByRole("button", { name: "Record receipt", exact: true }).click()
  await expect(page.locator('[aria-label="Purchase status"] [aria-current="step"]')).toHaveText("Received")

  await gotoApp(page, `/inventory?product=${productId}`)
  await expect(page.getByTestId(`on-hand-${productId}`)).toHaveText("6 piece")

  await gotoApp(page, "/inventory/warehouses")
  await page.locator("#new-code").fill("WH2")
  await page.locator("#new-name").fill("Overflow")
  await page.getByRole("button", { name: "Create warehouse", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Warehouse saved." })).toBeVisible()
  await expect(page.getByRole("region", { name: "Overflow", exact: true })).toContainText("WH2")

  await gotoApp(page, "/inventory/transfer")
  await page.getByLabel("Product", { exact: true }).selectOption({ label: product })
  await page.getByLabel("Quantity", { exact: true }).fill("1")
  await page.getByLabel("From warehouse", { exact: true }).selectOption({ label: "MAIN · Main warehouse" })
  await page.getByLabel("To warehouse", { exact: true }).selectOption({ label: "WH2 · Overflow" })
  await page.getByLabel("Reason", { exact: true }).fill("Move one piece")
  await page.getByRole("button", { name: "Transfer stock", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Stock transferred." })).toBeVisible()
  await gotoApp(page, `/inventory?product=${productId}`)
  await expect(page.getByTestId(`on-hand-${productId}`)).toHaveText("6 piece")

  await gotoApp(page, "/finance/receipts")
  await page.getByRole("combobox", { name: "Customer", exact: true }).selectOption({ label: buyer })
  await page.getByRole("button", { name: "View customer receipts", exact: true }).click()
  const report = page.locator("form").filter({ has: page.getByRole("button", { name: "Report customer receipt", exact: true }) })
  await report.getByLabel("Receipt amount (THB)", { exact: true }).fill("1040.00")
  await report.getByLabel("Receipt report reference", { exact: true }).fill("CORE-RCPT-1")
  await report.getByLabel(new RegExp(`^Allocate ${number}`)).fill("1040.00")
  await report.getByRole("button", { name: "Report customer receipt", exact: true }).click()
  await expect(page.getByText("Receipt reported for verification", { exact: true })).toBeVisible()
  await expect(page.getByText("฿1,040.00 · CORE-RCPT-1", { exact: true })).toBeVisible()

  await gotoApp(page, "/reports")
  await expect(page.getByRole("heading", { name: "Reports", exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: "Print / PDF", exact: true })).toBeVisible()
  for (const [path, header] of [["/finance/invoices/export", "Invoice ID"], ["/finance/payments/export", "Receipt ID"], ["/finance/costs/export", "Category"]] as const) {
    const csv = await page.request.get(path)
    expect(csv.ok(), path).toBeTruthy()
    expect(csv.headers()["content-type"]).toContain("text/csv")
    expect(await csv.text()).toContain(header)
  }
  const invoicesCsv = await (await page.request.get("/finance/invoices/export")).text()
  expect(invoicesCsv).toContain(number)
  expect(invoicesCsv).toContain(buyer)

  await page.setViewportSize({ width: 390, height: 844 })
  for (const path of ["/finance", "/purchases", "/reports", invoiceUrl]) await expectFits(page, path)
})
