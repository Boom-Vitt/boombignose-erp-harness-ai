import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { createHash, randomUUID } from "node:crypto"

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

function previousMonthStart(): string {
  const bangkok = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date())
  const year = Number(bangkok.slice(0, 4))
  const month = Number(bangkok.slice(5, 7))
  return month === 1 ? `${year - 1}-12-01` : `${year}-${String(month - 1).padStart(2, "0")}-01`
}

test("VAT and WHT support reports: Thai default, ENG switch, record, checksummed export", async ({ page }) => {
  const org = randomUUID()
  const email = `wht-${randomUUID()}@example.invalid`
  const password = `Local-${randomUUID()}!`
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  expect(user.error).toBeNull()
  const uid = user.data.user!.id
  const monthStart = previousMonthStart()
  try {
    expect((await admin.from("organizations").insert({ id: org, name: "Synthetic WHT workspace", slug: `wht-${org}` })).error).toBeNull()
    expect((await admin.from("memberships").insert({ org_id: org, user_id: uid, role: "owner" })).error).toBeNull()
    expect((await admin.from("costs").insert({ org_id: org, category: "other", amount_satang: 107000, input_vat_satang: 7000, incurred_on: monthStart, vendor: "Synthetic consultant" })).error).toBeNull()
    await page.goto("/login")
    await page.getByLabel("Email").fill(email)
    await page.getByLabel("Password", { exact: true }).fill(password)
    await page.getByRole("button", { name: "Sign in", exact: true }).click()
    await page.waitForURL("**/dashboard")

    // VAT report: Thai by default, disclaimer present, no filing claim.
    await page.goto(`/reports/vat?month=${monthStart.slice(0, 7)}`)
    await expect(page.getByRole("heading", { name: /รายงานภาษีมูลค่าเพิ่ม/ })).toBeVisible()
    await expect(page.getByRole("note")).toContainText("ไม่ใช่การยื่นแบบ ภ.พ.30")
    await expect(page.getByText("Output VAT", { exact: true })).toBeHidden()

    // WHT: record on the cost, then the list shows 3% of the base before input VAT.
    await page.goto(`/reports/wht?month=${monthStart.slice(0, 7)}`)
    await page.getByLabel("อัตราหัก ณ ที่จ่าย").selectOption("300")
    await page.getByRole("button", { name: "บันทึก", exact: true }).click()
    await expect(page.getByText("บันทึกการหัก ณ ที่จ่ายแล้ว")).toBeVisible()
    await expect(page.getByRole("cell", { name: /^WHT-\d{4}-000001$/ })).toBeVisible()
    await expect(page.getByRole("cell", { name: "30.00" }).first()).toBeVisible()

    // ENG switch shows English only and saves profiles.locale.
    await page.getByRole("button", { name: "Switch to English" }).click()
    await expect(page.getByText("Total withheld on purchases")).toBeVisible()
    await expect(page.getByText("รวมภาษีที่หักจากผู้ขาย")).toBeHidden()
    await expect.poll(async () => (await admin.from("profiles").select("locale").eq("id", uid).single()).data?.locale).toBe("en")

    // Export carries the disclaimer and a checksum that matches the body and the activity log.
    const res = await page.request.get(`/reports/wht/export?month=${monthStart.slice(0, 7)}`)
    expect(res.ok()).toBe(true)
    const body = await res.text()
    const sum = createHash("sha256").update(body, "utf8").digest("hex")
    expect(res.headers()["x-content-sha256"]).toBe(sum)
    expect(body.toLowerCase()).toContain("not a filing")
    expect(body).toContain("Synthetic consultant")
    const logged = await admin.from("audit_log").select("meta").eq("org_id", org).eq("action", "support_exported")
    expect(logged.data?.some((row) => (row.meta as { sha256?: string }).sha256 === sum)).toBe(true)
    const vat = await page.request.get(`/reports/vat/export?month=${monthStart.slice(0, 7)}`)
    expect(vat.ok()).toBe(true)
    expect(vat.headers()["x-content-sha256"]).toBe(createHash("sha256").update(await vat.text(), "utf8").digest("hex"))
  } finally {
    expect((await admin.from("organizations").delete().eq("id", org)).error).toBeNull()
    expect((await admin.auth.admin.deleteUser(uid)).error).toBeNull()
  }
})
