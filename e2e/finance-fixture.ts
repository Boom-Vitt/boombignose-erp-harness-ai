import { expect, type Page } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"

export async function financeFixture() {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const org = randomUUID(), email = `finance-${randomUUID()}@example.invalid`, password = `Local-${randomUUID()}!`
  const user = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  expect(user.error).toBeNull()
  const uid = user.data.user!.id
  expect((await admin.from("organizations").insert({ id: org, name: "Synthetic finance corrections", slug: `finance-${org}` })).error).toBeNull()
  expect((await admin.from("memberships").insert({ org_id: org, user_id: uid, role: "owner" })).error).toBeNull()
  const buyer = await admin.from("clients").insert({ org_id: org, name: "Synthetic finance buyer" }).select("id").single()
  expect(buyer.error).toBeNull()
  const clientId = buyer.data!.id as string
  const staff = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  expect((await staff.auth.signInWithPassword({ email, password })).error).toBeNull()
  expect((await staff.rpc("update_tax_business_profile", { p_org_id: org, p_legal_name: "Synthetic finance seller", p_business_address: "Synthetic address", p_tax_id: "1234567890123", p_tax_status: "registered", p_vat_rate_bps: 700, p_prices_include_vat: false, p_branch_label: "Head office" })).error).toBeNull()
  async function invoice(lines = [{ description: "Service", unit_price_satang: 10000, tax_rate_bps: 0 }], wht = 0) {
    const row = await staff.from("invoices").insert({ org_id: org, client_id: clientId, number: `DRAFT-${randomUUID()}`, wht_rate_bps: wht }).select("id").single()
    expect(row.error).toBeNull()
    const id = row.data!.id as string
    expect((await staff.from("invoice_items").insert(lines.map(line => ({ org_id: org, invoice_id: id, ...line })))).error).toBeNull()
    const current = await staff.from("invoices").select("version").eq("id", id).single()
    expect((await staff.rpc("issue_invoice", { p_org_id: org, p_invoice_id: id, p_expected_version: current.data!.version, p_key: randomUUID() })).error).toBeNull()
    const issued = await staff.from("invoices").select("number, issued_snapshot_id").eq("id", id).single()
    expect(issued.error).toBeNull()
    return { id, number: issued.data!.number as string, snapshotId: issued.data!.issued_snapshot_id as string }
  }
  async function login(page: Page, credentials = { email, password }) {
    await page.goto("/login")
    await page.getByLabel(/^(Email|อีเมล)$/).fill(credentials.email)
    await page.getByLabel(/^(Password|รหัสผ่าน)$/).fill(credentials.password)
    await page.getByRole("button", { name: /^(Sign in|เข้าสู่ระบบ)$/ }).click()
    await page.waitForURL("**/dashboard")
  }
  async function cleanup() {
    await admin.from("payment_claims").delete().eq("org_id", org)
    await admin.from("payment_allocations").delete().eq("org_id", org)
    await admin.from("payments").delete().eq("org_id", org)
    expect((await admin.from("organizations").delete().eq("id", org)).error).toBeNull()
    expect((await admin.auth.admin.deleteUser(uid)).error).toBeNull()
  }
  return { admin, staff, org, uid, clientId, invoice, login, cleanup }
}
