import { test, expect, type Page } from "@playwright/test"
import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { financeFixture } from "./finance-fixture"
import { todayISO } from "@/lib/dates"

type RecordFixture = { org: string; uid: string; clientId: string; staff: SupabaseClient }

async function records(f: RecordFixture) {
  async function insert(table: string, values: Record<string, unknown>) {
    const result = await f.staff.from(table).insert({ org_id: f.org, ...values }).select("id").single()
    expect(result.error, result.error?.message).toBeNull()
    return result.data!.id as string
  }
  const client = f.clientId
  const deal = await insert("deals", { client_id: client, title: "Route deal", stage: "lead" })
  const project = await insert("projects", { client_id: client, name: "Route project" })
  const quote = await insert("quotes", { client_id: client, number: `QA-${randomUUID()}` })
  const invoice = await insert("invoices", { client_id: client, number: `DRAFT-${randomUUID()}` })
  const subscription = await insert("subscriptions", { client_id: client, name: "Route subscription", amount_satang: 100, tax_rate_bps: 0, wht_rate_bps: 0, prices_include_vat: false })
  const product = await insert("products", { name: "Route service" })
  const vendor = await insert("vendors", { name: "Route vendor" })
  const purchase = await insert("purchase_orders", { vendor_id: vendor, number: `QA-${randomUUID()}` })
  const expense = await insert("expense_claims", { employee: f.uid, number: `QA-${randomUUID()}`, title: "Route expense" })
  const template = await insert("automation_templates", { name: `Route template ${randomUUID()}` })
  return [
    `/clients/${client}`, `/clients/${client}/edit`, `/deals/${deal}`, `/deals/${deal}/edit`,
    `/projects/${project}`, `/projects/${project}/edit`, `/quotes/${quote}`, `/finance/invoices/${invoice}`,
    `/finance/subscriptions/${subscription}`, `/products/${product}`, `/products/${product}/edit`,
    `/vendors/${vendor}`, `/vendors/${vendor}/edit`, `/purchases/${purchase}`, `/expenses/${expense}`,
    `/templates/${template}`, `/templates/${template}/edit`,
  ]
}

function captureErrors(page: Page) {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  return errors
}

const restricted = [
  "/deals/lost-reasons", "/products/new", "/vendors/new", "/purchases/new",
  "/inventory/adjust", "/inventory/transfer", "/settings/lead-forms", "/settings/purchasing",
]

test("business record routes render valid records and distinguish malformed, absent and foreign IDs", async ({ page }) => {
  test.setTimeout(180_000)
  const local = await financeFixture()
  const foreign = await financeFixture()
  try {
    const routes = await records(local)
    const foreignRoutes = await records(foreign)
    const errors = captureErrors(page)
    await local.login(page)
    for (const route of routes) {
      await page.goto(route)
      await expect(page.locator("h1")).toBeVisible()
      await expect(page.getByText(/This page couldn.t load|This page could not be found/)).toHaveCount(0)
    }
    for (const [index, route] of routes.entries()) {
      for (const inaccessible of [route.replace(/[0-9a-f-]{36}/, "not-a-guid"), route.replace(/[0-9a-f-]{36}/, randomUUID()), foreignRoutes[index]]) {
        await page.goto(inaccessible)
        await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible()
        await expect(page.getByText(/This page couldn.t load/)).toHaveCount(0)
      }
    }
    expect(errors).toEqual([])
  } finally {
    await foreign.cleanup()
    await local.cleanup()
  }
})

for (const role of ["member", "accountant"] as const) {
  test(`${role} gets a designed denial and no unusable template management controls`, async ({ page }) => {
    const f = await financeFixture()
    try {
      const templateName = `Readable template ${randomUUID()}`
      const template = await f.staff.from("automation_templates").insert({ org_id: f.org, name: templateName }).select("id").single()
      expect(template.error).toBeNull()
      expect((await f.admin.from("memberships").update({ role }).eq("org_id", f.org).eq("user_id", f.uid)).error).toBeNull()
      const errors = captureErrors(page)
      await f.login(page)
      await page.goto("/templates")
      await expect(page.getByRole("link", { name: "New template" })).toHaveCount(0)
      await expect(page.getByRole("button", { name: "New category" })).toHaveCount(0)
      await page.getByRole("link", { name: templateName, exact: true }).click()
      await expect(page.getByRole("heading", { name: templateName })).toBeVisible()
      await expect(page.getByRole("link", { name: "Edit", exact: true })).toHaveCount(0)
      await expect(page.getByRole("button", { name: /Delete/ })).toHaveCount(0)
      for (const route of [...restricted, "/templates/new", `/templates/${template.data!.id}/edit`]) {
        await page.goto(route)
        await expect(page.getByRole("heading", { name: "This workspace action is not available to your session." })).toBeVisible()
        await expect(page.getByText(/This page couldn.t load/)).toHaveCount(0)
      }
      // Database authorization remains authoritative even without the form affordance.
      const denied = await f.staff.from("automation_templates").insert({ org_id: f.org, name: "Unauthorized template" })
      expect(denied.error).not.toBeNull()
      expect(errors).toEqual([])
    } finally { await f.cleanup() }
  })
}

test("calendar overflow is keyboard-expandable and every dated activity remains reachable", async ({ page }) => {
  const f = await financeFixture()
  try {
    const due = todayISO()
    const rows = Array.from({ length: 5 }, (_, index) => ({ org_id: f.org, record_type: "client", record_id: f.clientId, owner: f.uid, type: "follow_up", due_date: due, body: `Overflow task ${index + 1}` }))
    expect((await f.staff.from("activities").insert(rows)).error).toBeNull()
    await f.login(page)
    await page.goto("/calendar")
    const more = page.locator("summary").filter({ hasText: "+2 more" })
    await expect(more).toBeVisible()
    await more.focus()
    await page.keyboard.press("Enter")
    await expect(more.locator("..")).toHaveAttribute("open", "")
    const activityLinks = page.locator(`a[href="/clients/${f.clientId}"]`)
    await expect(activityLinks).toHaveCount(5)
    for (const link of await activityLinks.all()) await expect(link).toBeVisible()
    await activityLinks.nth(4).click()
    await expect(page.getByRole("heading", { name: "Synthetic finance buyer" })).toBeVisible()
  } finally { await f.cleanup() }
})

test("template saves persist, but a concurrently removed template is not reported as saved", async ({ page }) => {
  const f = await financeFixture()
  try {
    await f.login(page)
    await page.goto("/templates/new")
    const name = `Saved template ${randomUUID()}`
    await page.getByLabel("Name", { exact: true }).fill(name)
    await page.getByRole("button", { name: "Create template", exact: true }).click()
    await page.waitForURL(/\/templates\/[0-9a-f-]{36}$/)
    const id = page.url().split("/").pop()!
    await expect(page.getByRole("heading", { name })).toBeVisible()
    expect((await f.staff.from("automation_templates").select("name").eq("id", id).single()).data?.name).toBe(name)
    await page.getByRole("link", { name: "Edit", exact: true }).click()
    const edited = `${name} edited`
    await page.getByLabel("Name", { exact: true }).fill(edited)
    await page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(page.getByRole("heading", { name: edited })).toBeVisible()
    expect((await f.staff.from("automation_templates").select("name").eq("id", id).single()).data?.name).toBe(edited)
    await page.getByRole("link", { name: "Edit", exact: true }).click()
    expect((await f.admin.from("automation_templates").delete().eq("id", id)).error).toBeNull()
    await page.getByLabel("Name", { exact: true }).fill(`${name} removed`)
    await page.getByRole("button", { name: "Save changes", exact: true }).click()
    await expect(page.getByText("Template not found or unavailable.", { exact: true })).toBeVisible()
    expect(new URL(page.url()).pathname).toBe(`/templates/${id}/edit`)
  } finally { await f.cleanup() }
})

test("template browsing remains scoped to the active workspace when both workspaces are authorized", async ({ page }) => {
  const local = await financeFixture()
  const other = await financeFixture()
  try {
    expect((await local.admin.from("memberships").insert({ org_id: other.org, user_id: local.uid, role: "member" })).error).toBeNull()
    const localName = `Local playbook ${randomUUID()}`
    const otherName = `Other playbook ${randomUUID()}`
    expect((await local.staff.from("automation_templates").insert({ org_id: local.org, name: localName })).error).toBeNull()
    const template = await other.staff.from("automation_templates").insert({ org_id: other.org, name: otherName }).select("id").single()
    expect(template.error).toBeNull()
    await local.login(page)
    await page.context().addCookies([{ name: "active_org", value: local.org, url: new URL(page.url()).origin }])
    await page.goto("/templates")
    await expect(page.getByRole("link", { name: localName, exact: true })).toBeVisible()
    await expect(page.getByRole("link", { name: otherName, exact: true })).toHaveCount(0)
    await page.goto(`/templates/${template.data!.id}`)
    await expect(page.getByRole("heading", { name: "This page could not be found." })).toBeVisible()
  } finally {
    await other.cleanup()
    await local.cleanup()
  }
})

test("malformed print links are not confused with unavailable financial evidence", async ({ page }) => {
  const f = await financeFixture()
  try {
    await f.login(page)
    for (const route of [
      "/quotes/not-a-guid/pdf", "/finance/invoices/not-a-guid/pdf", "/finance/invoices/not-a-guid/wht",
      "/finance/credit-notes/not-a-guid/pdf", "/purchases/not-a-guid/pdf", "/inventory/documents/not-a-guid/print",
    ]) {
      const response = await page.goto(route)
      expect(response?.status(), route).toBe(route.includes("/credit-notes/") ? 400 : 404)
      await expect(page.getByText(/This page couldn.t load|server error occurred/)).toHaveCount(0)
    }
  } finally { await f.cleanup() }
})
