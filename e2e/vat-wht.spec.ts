import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"
import { community } from "./edition"

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

test("VAT-registered invoice with WHT 3% freezes and presents the same totals", async ({ page }) => {
  const org = randomUUID()
  const email = `vat-${randomUUID()}@example.invalid`
  const password = `Local-${randomUUID()}!`
  const token = randomUUID() + randomUUID()
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  expect(user.error).toBeNull()
  const uid = user.data.user!.id
  try {
    expect((await admin.from("organizations").insert({ id: org, name: "Synthetic VAT workspace", slug: `vat-${org}` })).error).toBeNull()
    expect((await admin.from("memberships").insert({ org_id: org, user_id: uid, role: "owner" })).error).toBeNull()
    const buyer = await admin.from("clients").insert({ org_id: org, name: "Synthetic VAT buyer", tax_id: "9876543210123", branch_label: "Branch 001", portal_enabled: true, portal_token: token }).select("id").single()
    expect(buyer.error).toBeNull()
    await page.goto("/login")
    await page.getByLabel(/^(Email|อีเมล)$/).fill(email)
    await page.getByLabel(/^(Password|รหัสผ่าน)$/).fill(password)
    await page.getByRole("button", { name: /^(Sign in|เข้าสู่ระบบ)$/ }).click()
    await page.waitForURL("**/dashboard")
    await page.goto("/finance/business-profile")
    await page.getByLabel(/Legal business name/).fill("Synthetic VAT seller")
    await page.getByLabel(/Business address/).fill("Synthetic seller address")
    await page.getByLabel(/Tax ID/).fill("1234567890123")
    await page.getByLabel("Branch", { exact: true }).fill("Head office")
    await page.getByRole("combobox", { name: "VAT status", exact: true }).selectOption("registered")
    await page.getByRole("button", { name: "Save business profile", exact: true }).click()
    await expect.poll(async () => (await admin.from("org_settings").select("vat_registered").eq("org_id", org).single()).data?.vat_registered).toBe(true)
    await page.goto("/finance/invoices/new")
    await page.getByRole("combobox", { name: "Client", exact: true }).click()
    await page.getByRole("option", { name: "Synthetic VAT buyer", exact: true }).click()
    await page.getByRole("button", { name: "Create invoice", exact: true }).click()
    await page.waitForURL(/\/finance\/invoices\/[^/]+$/)
    const lines = page.getByRole("form", { name: "Edit line items" })
    await lines.getByRole("button", { name: "Add a line", exact: true }).click()
    await lines.getByLabel("Description, row 1", { exact: true }).fill("Taxable consulting")
    await lines.getByLabel("Unit price, row 1", { exact: true }).fill("1000.00")
    await expect(lines.getByLabel("VAT, row 1", { exact: true })).toHaveValue("700")
    await lines.getByRole("button", { name: "Add a section", exact: true }).click()
    await lines.getByLabel("Section text, row 2").fill("Consulting scope")
    await lines.getByRole("button", { name: "Add a note", exact: true }).click()
    await lines.getByLabel("Note text, row 3").fill("Pay in 30 days")
    await lines.getByRole("button", { name: "Save lines", exact: true }).click()
    await expect(lines.getByText("Unsaved line changes", { exact: true })).toHaveCount(0)
    // getByLabel reads a wrapping <label>'s full text, option labels included; the accessible name is just "Withholding tax".
    const withholding = page.getByRole("combobox", { name: "Withholding tax", exact: true })
    await withholding.selectOption("300")
    await expect(withholding).toHaveValue("300")
    const totals = page.getByTestId("document-totals")
    for (const [label, amount] of [["Subtotal", "1,000.00"], ["Discount", "0.00"], ["VAT 7%", "70.00"], ["Total", "1,070.00"], ["WHT 3%", "30.00"], ["Amount due", "1,040.00"]]) {
      await expect(totals.getByText(label, { exact: true }).locator("..").locator("dd")).toContainText(amount)
    }
    const invoiceUrl = page.url()
    await expect(page.getByRole("heading", { name: /^DRAFT-[a-f0-9]{8}$/ })).toBeVisible()
    const bangkokToday = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
    await page.goto("/settings/finance")
    await page.getByRole("textbox", { name: "Lock transactions through", exact: true }).fill(bangkokToday)
    await page.getByRole("button", { name: "Save finance lock", exact: true }).click()
    await expect.poll(async () => (await admin.from("org_settings").select("lock_date").eq("org_id", org).single()).data?.lock_date).toBe(bangkokToday)
    await page.goto(invoiceUrl)
    await page.getByLabel("I checked the business profile, buyer, lines, discount and dates.").check()
    await page.getByRole("button", { name: "Issue operational invoice", exact: true }).click()
    await expect(page.getByText("Finance period is locked", { exact: true })).toBeVisible()
    await page.goto("/settings/finance")
    await page.getByRole("textbox", { name: "Lock transactions through", exact: true }).fill("")
    await page.getByRole("textbox", { name: "Reason for reopening", exact: true }).fill("Unlock the draft so it can be issued")
    await page.getByRole("button", { name: "Save finance lock", exact: true }).click()
    await expect.poll(async () => (await admin.from("org_settings").select("lock_date").eq("org_id", org).single()).data?.lock_date).toBeNull()
    await page.goto(invoiceUrl)
    await page.getByLabel("I checked the business profile, buyer, lines, discount and dates.").check()
    await page.getByRole("button", { name: "Issue operational invoice", exact: true }).click()
    await expect(page.getByText("Issued snapshot retained. Corrections must preserve the original document.")).toBeVisible()
    await expect(page.getByRole("heading", { name: new RegExp(`^INV-${bangkokToday.slice(0, 4)}-000001$`) })).toBeVisible()
    const pdf = await page.request.get(`${invoiceUrl}/pdf`)
    expect(pdf.ok()).toBe(true)
    const html = await pdf.text()
    for (const value of ["<h1>Invoice</h1>", "VAT 7%", "WHT 3%", "1,040.00", "Head office", "Branch 001", "1234567890123", "9876543210123", "Consulting scope", "Pay in 30 days"]) expect(html).toContain(value)
    // The client portal is Pro-only; community renders notFound() there.
    if (!community) {
      await page.goto(`/portal/${token}`)
      await expect(page.getByTestId("document-totals")).toContainText("1,040.00")
      await expect(page.getByTestId("document-totals")).toContainText("VAT 7%")
    }
  } finally {
    expect((await admin.from("organizations").delete().eq("id", org)).error).toBeNull()
    expect((await admin.auth.admin.deleteUser(uid)).error).toBeNull()
  }
})
