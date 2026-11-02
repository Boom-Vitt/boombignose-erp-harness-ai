import { test, expect, type Page } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"

const api = process.env.NEXT_PUBLIC_SUPABASE_URL!
const admin = createClient(api, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login")
  await page.getByLabel(/^(Email|อีเมล)$/).fill(email)
  await page.getByLabel(/^(Password|รหัสผ่าน)$/).fill(password)
  await page.getByRole("button", { name: /^(Sign in|เข้าสู่ระบบ)$/ }).click()
  await page.waitForURL("**/dashboard")
}

test("rates, labour cost and profit stay staff-only while members keep hours, and cancelled time rebills once", async ({ page, browser }) => {
  const org = randomUUID(), project = randomUUID(), entry = randomUUID()
  const password = `Local-${randomUUID()}!`
  const ownerEmail = `time-owner-${randomUUID()}@example.invalid`
  const memberEmail = `time-member-${randomUUID()}@example.invalid`
  const owner = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true })
  expect(owner.error).toBeNull()
  const member = await admin.auth.admin.createUser({ email: memberEmail, password, email_confirm: true })
  expect(member.error).toBeNull()
  const ownerId = owner.data.user!.id, memberId = member.data.user!.id
  const staffApi = createClient(api, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  const memberApi = createClient(api, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  let replacement: string | undefined
  const invoices: string[] = []
  try {
    expect((await admin.from("organizations").insert({ id: org, name: "Time privacy workspace", slug: `time-${org}` })).error).toBeNull()
    expect((await admin.from("memberships").insert([{ org_id: org, user_id: ownerId, role: "owner" }, { org_id: org, user_id: memberId, role: "member" }])).error).toBeNull()
    expect((await admin.from("profiles").update({ full_name: "Time member" }).eq("id", memberId)).error).toBeNull()
    const client = await admin.from("clients").insert({ org_id: org, name: "Time buyer" }).select("id").single()
    expect(client.error).toBeNull()
    expect((await admin.from("projects").insert({ id: project, org_id: org, client_id: client.data!.id, name: "Time privacy project" })).error).toBeNull()
    expect((await admin.from("time_entries").insert({ id: entry, org_id: org, project_id: project, user_id: memberId, minutes: 11, billable: true, rate_satang: 150 })).error).toBeNull()
    expect((await staffApi.auth.signInWithPassword({ email: ownerEmail, password })).error).toBeNull()
    expect((await memberApi.auth.signInWithPassword({ email: memberEmail, password })).error).toBeNull()

    await signIn(page, ownerEmail, password)
    await page.goto("/timesheets")
    await page.getByRole("combobox", { name: "Member", exact: true }).click()
    await page.getByRole("option", { name: "Time member", exact: true }).click()
    await page.getByLabel("Labour cost (THB/hour)", { exact: true }).fill("1.50")
    await expect(page.getByRole("button", { name: "Save cost rate", exact: true })).toHaveAttribute("type", "submit")
    await page.getByRole("button", { name: "Save cost rate", exact: true }).click()
    await expect.poll(async () => (await admin.from("member_cost_rates").select("cost_rate_satang").eq("org_id", org).eq("user_id", memberId).single()).data?.cost_rate_satang).toBe(150)
    expect((await memberApi.from("member_cost_rates").select("*").eq("org_id", org)).data).toEqual([])
    const memberships = await memberApi.from("memberships").select("*").eq("org_id", org)
    expect(memberships.error).toBeNull()
    expect(memberships.data).toHaveLength(1)
    expect(memberships.data![0]).not.toHaveProperty("cost_rate_satang")

    const memberContext = await browser.newContext({ baseURL: new URL(page.url()).origin })
    try {
      const memberPage = await memberContext.newPage()
      await signIn(memberPage, memberEmail, password)
      await memberPage.goto("/timesheets")
      await expect(memberPage.getByLabel("Labour cost (THB/hour)")).toHaveCount(0)
      await expect(memberPage.getByRole("button", { name: "Edit time entry", exact: true })).toBeVisible()
      await memberPage.getByRole("button", { name: "Edit time entry", exact: true }).click()
      await memberPage.getByRole("dialog").getByLabel("Notes", { exact: true }).fill("Reviewed time")
      await memberPage.getByRole("button", { name: "Save time", exact: true }).click()
      await expect.poll(async () => (await admin.from("time_entries").select("notes").eq("id", entry).single()).data?.notes).toBe("Reviewed time")
      expect((await memberApi.from("project_labour_totals").select("*").eq("org_id", org)).data).toEqual([])
      await memberPage.goto(`/projects/${project}`)
      await expect(memberPage.locator("#time")).toContainText("0.2h")
      for (const label of ["Revenue", "Cost incl. labour", "Profit", "Margin"]) await expect(memberPage.getByText(label, { exact: true })).toHaveCount(0)
      await page.goto(`/projects/${project}`)
      await expect(page.getByText("Cost incl. labour", { exact: true }).locator("../..")).toContainText("0.28")
      await expect(page.getByText("Profit", { exact: true })).toBeVisible()
      await page.goto("/timesheets")

      await page.getByRole("button", { name: "Bill time", exact: true }).click()
      await page.waitForURL(/\/finance\/invoices\/[^/]+$/)
      const original = page.url().split("/").pop()!
      invoices.push(original)
      await expect(page.getByLabel("Description, row 1", { exact: true })).toHaveValue(/11 minutes × 150 satang\/hour/)
      await memberPage.goto("/timesheets")
      await expect(memberPage.getByRole("button", { name: "Edit time entry", exact: true })).toHaveCount(0)
      await expect(memberPage.getByText("Locked", { exact: true })).toBeVisible()

      await page.getByRole("button", { name: "Cancel draft", exact: true }).click()
      await expect.poll(async () => (await admin.from("invoices").select("status").eq("id", original).single()).data?.status).toBe("cancelled")
      await page.goto("/timesheets")
      await page.getByRole("button", { name: "Bill time", exact: true }).click()
      await page.waitForURL(/\/finance\/invoices\/[^/]+$/)
      replacement = page.url().split("/").pop()!
      invoices.push(replacement)
      expect(replacement).not.toBe(original)
      expect((await admin.from("time_entries").select("invoice_id").eq("id", entry).single()).data?.invoice_id).toBe(replacement)
      expect((await staffApi.from("invoices").update({ status: "draft" }).eq("id", original)).error?.message).toContain("Cancelled draft is final")
      await page.goto(`/finance/invoices/${original}`)
      await expect(page.getByRole("button", { name: "Issue operational invoice", exact: true })).toHaveCount(0)
    } finally {
      await memberContext.close()
    }
  } finally {
    for (const invoice of invoices) expect((await staffApi.rpc("cancel_draft_invoice", { p_org_id: org, p_invoice_id: invoice })).error).toBeNull()
    expect((await admin.from("organizations").delete().eq("id", org)).error).toBeNull()
    expect((await admin.auth.admin.deleteUser(memberId)).error).toBeNull()
    expect((await admin.auth.admin.deleteUser(ownerId)).error).toBeNull()
  }
})
