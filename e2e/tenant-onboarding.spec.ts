import { test as base, expect, type Page } from "@playwright/test"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { community } from "./edition"
import { todayISO } from "@/lib/dates"

const isolation = JSON.parse(readFileSync(".local-stack/isolation.json", "utf8"))
const env = Object.fromEntries(readFileSync(".env.local", "utf8").trim().split("\n").filter(line => line.includes("=")).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]))
const baseURL = `http://127.0.0.1:${isolation.app}`
if (env.NEXT_PUBLIC_SUPABASE_URL !== `http://127.0.0.1:${isolation.api}`) throw new Error("Tenant fixtures require this worktree's isolated local API")
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options)

type Actor = { id: string; email: string; password: string; api: SupabaseClient }
type Workspace = { id: string; name: string }

function ok<T extends { data: unknown; error: { message: string } | null }>(response: T): NonNullable<T["data"]> {
  expect(response.error, response.error?.message).toBeNull()
  if (response.data == null) throw new Error("Expected local fixture result")
  return response.data as NonNullable<T["data"]>
}

class Fixtures {
  readonly run = randomUUID()
  readonly users: Actor[] = []
  readonly workspaces = new Set<string>()
  readonly workspaceNames = new Set<string>()
  private readonly startedAt = Date.now()

  constructor(readonly page: Page) {}

  name(label: string) { return `QA ${label} ${this.run}` }

  async user(): Promise<Actor> {
    const email = `qa-${randomUUID()}@example.invalid`
    const password = `Local-${randomUUID()}!`
    const created = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }))
    if (!created.user) throw new Error("Expected synthetic user")
    const api = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
    const actor = { id: created.user.id, email, password, api }
    this.users.push(actor)
    ok(await api.auth.signInWithPassword({ email, password }))
    return actor
  }

  async workspace(label: string, owner: Actor): Promise<Workspace> {
    const workspace = { id: randomUUID(), name: this.name(label) }
    this.workspaces.add(workspace.id)
    this.workspaceNames.add(workspace.name)
    expect((await admin.from("organizations").insert({ ...workspace, slug: `qa-${workspace.id}` })).error).toBeNull()
    expect((await admin.from("memberships").insert({ org_id: workspace.id, user_id: owner.id, role: "owner", created_at: new Date(this.startedAt + this.workspaces.size).toISOString() })).error).toBeNull()
    return workspace
  }

  async signIn(actor: Actor, navigate = true) {
    if (navigate) await this.page.goto("/login")
    await this.page.getByLabel(/^(Email|อีเมล)$/).fill(actor.email)
    await this.page.getByLabel(/^(Password|รหัสผ่าน)$/).fill(actor.password)
    await this.page.getByRole("button", { name: /^(Sign in|เข้าสู่ระบบ)$/ }).click()
    await this.page.waitForURL(/\/(dashboard|onboarding|invite\/[^/]+)(?:\?.*)?$/)
  }

  async cleanup() {
    // Discover only this test's uniquely named UI-created workspaces, not every
    // membership: a failed authorization test must never delete an unrelated org.
    if (this.workspaceNames.size) {
      const rows = ok(await admin.from("organizations").select("id").in("name", [...this.workspaceNames]))
      for (const row of rows) this.workspaces.add(row.id)
    }
    for (const id of this.workspaces) expect((await admin.from("organizations").delete().eq("id", id)).error).toBeNull()
    for (const actor of this.users) expect((await admin.auth.admin.deleteUser(actor.id)).error).toBeNull()
  }
}

const test = base.extend<{ fixtures: Fixtures }>({
  fixtures: async ({ page }, provide) => {
    const fixtures = new Fixtures(page)
    try { await provide(fixtures) } finally { await fixtures.cleanup() }
  },
})

test("quote dialog creates deposits and partial invoices, releases a cancelled draft and settles the final balance", async ({ fixtures: f, page }) => {
  const owner = await f.user()
  const workspace = await f.workspace("quote invoicing", owner)
  const client = ok(await admin.from("clients").insert({ org_id: workspace.id, name: f.name("quote buyer") }).select("id").single())
  const quote = ok(await owner.api.from("quotes").insert({ org_id: workspace.id, client_id: client.id, number: f.name("quote") }).select("id").single())
  const line = ok(await owner.api.from("quote_items").insert({ org_id: workspace.id, quote_id: quote.id, description: "Agreed service", quantity: 4, unit_price_satang: 10000 }).select("id").single())
  expect((await owner.api.from("quotes").update({ status: "sent" }).eq("id", quote.id)).error).toBeNull()
  await f.signIn(owner)
  const quoteUrl = `/quotes/${quote.id}`
  await page.goto(quoteUrl)
  await page.getByLabel("Notes", { exact: true }).fill("Header saved before acceptance")
  await page.getByRole("button", { name: "Accept", exact: true }).click()
  await expect.poll(async () => ok(await admin.from("quotes").select("accepted_at").eq("id", quote.id).single()).accepted_at).not.toBeNull()
  expect(ok(await admin.from("quotes").select("notes").eq("id", quote.id).single()).notes).toBe("Header saved before acceptance")

  await page.keyboard.press("ControlOrMeta+k")
  const palette = page.getByRole("dialog", { name: "Command palette" })
  await expect(palette).toBeVisible()
  await palette.getByRole("option", { name: "Create draft invoice", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Create draft invoice", exact: true })
  await expect(dialog).toBeVisible()
  await dialog.getByLabel("Invoice scope").selectOption("deposit_percent")
  await dialog.getByLabel("Deposit (%)").fill("25")
  await dialog.getByRole("button", { name: "Create draft invoice", exact: true }).click()
  await page.waitForURL(/\/finance\/invoices\/[^/]+$/)
  const invoices = async () => ok(await admin.from("invoices").select("id,status,total_satang,quote_invoice_kind,quote_deposit_deduction_satang").eq("org_id", workspace.id).eq("source_quote_id", quote.id))
  expect((await invoices())[0]).toMatchObject({ total_satang: 10000, quote_invoice_kind: "deposit" })

  await page.goto(quoteUrl)
  await page.getByRole("button", { name: "Create draft invoice", exact: true }).click()
  await dialog.getByLabel("Invoice scope").selectOption("selected")
  await dialog.getByLabel("Agreed service (4 remaining)").fill("1")
  await dialog.getByRole("button", { name: "Create draft invoice", exact: true }).click()
  await page.waitForURL(/\/finance\/invoices\/[^/]+$/)
  const partialId = new URL(page.url()).pathname.split("/").pop()!
  expect((await invoices()).find(row => row.id === partialId)?.total_satang).toBe(10000)
  expect(ok(await admin.from("quote_items").select("invoiced_quantity").eq("id", line.id).single()).invoiced_quantity).toBe(1)
  await page.goto(quoteUrl)
  const partialLink = page.locator("#invoices a").filter({ hasText: "draft" }).filter({ hasNotText: "Deposit" })
  await partialLink.locator("..").getByRole("button", { name: /^Cancel draft/ }).click()
  await expect.poll(async () => ok(await admin.from("quote_items").select("invoiced_quantity").eq("id", line.id).single()).invoiced_quantity).toBe(0)
  await expect(page.locator("#invoices")).toContainText("cancelled")
  await page.getByRole("button", { name: "Create draft invoice", exact: true }).click()
  await dialog.getByRole("button", { name: "Create draft invoice", exact: true }).click()
  await page.waitForURL(/\/finance\/invoices\/[^/]+$/)
  const rows = await invoices()
  expect(rows.find(row => row.id === partialId)?.status).toBe("cancelled")
  expect(rows.filter(row => row.status !== "cancelled").reduce((sum, row) => sum + row.total_satang, 0)).toBe(40000)
  expect(rows.filter(row => row.status !== "cancelled").reduce((sum, row) => sum + row.quote_deposit_deduction_satang, 0)).toBe(10000)
  expect(ok(await admin.from("quote_items").select("invoiced_quantity").eq("id", line.id).single()).invoiced_quantity).toBe(4)
})

test("Accept stops over notes typed while its save is pending, then accepts once they are saved", async ({ fixtures: f, page }) => {
  const owner = await f.user()
  const workspace = await f.workspace("accept during save", owner)
  const client = ok(await admin.from("clients").insert({ org_id: workspace.id, name: f.name("accept buyer") }).select("id").single())
  const quote = ok(await owner.api.from("quotes").insert({ org_id: workspace.id, client_id: client.id, number: f.name("accept quote") }).select("id").single())
  expect((await owner.api.from("quote_items").insert({ org_id: workspace.id, quote_id: quote.id, description: "Agreed service", quantity: 1, unit_price_satang: 10000 })).error).toBeNull()
  expect((await owner.api.from("quotes").update({ status: "sent" }).eq("id", quote.id)).error).toBeNull()
  await f.signIn(owner)
  await page.goto(`/quotes/${quote.id}`)
  let release = () => {}
  const held = new Promise<void>(resolve => (release = resolve))
  let reached = () => {}
  const saveSent = new Promise<void>(resolve => (reached = resolve))
  await page.route(`**/quotes/${quote.id}`, async route => {
    if (route.request().method() === "POST" && route.request().postData()?.includes("Saved by Accept")) {
      reached()
      await held
    }
    await route.continue()
  })
  const notes = page.getByLabel("Notes", { exact: true })
  await notes.fill("Saved by Accept")
  await page.getByRole("button", { name: "Accept", exact: true }).click()
  await saveSent
  await notes.fill("Typed during the save")
  release()
  await expect(page.getByText("Nothing ran because some of your changes are not saved yet. Save them, then try again.", { exact: true })).toBeVisible()
  const saved = async () => ok(await admin.from("quotes").select("status,notes").eq("id", quote.id).single())
  expect(await saved()).toEqual({ status: "sent", notes: "Saved by Accept" })
  await expect(notes).toHaveValue("Typed during the save")

  await page.getByRole("button", { name: "Accept", exact: true }).click()
  await expect.poll(async () => (await saved()).status).toBe("accepted")
  expect((await saved()).notes).toBe("Typed during the save")
})

test("a committed quote deposit survives a lost response and refresh with its exact request", async ({ fixtures: f, page }) => {
  const owner = await f.user()
  const workspace = await f.workspace("deposit recovery", owner)
  const client = ok(await admin.from("clients").insert({ org_id: workspace.id, name: f.name("deposit buyer") }).select("id").single())
  const quote = ok(await owner.api.from("quotes").insert({ org_id: workspace.id, client_id: client.id, number: f.name("deposit quote") }).select("id").single())
  expect((await owner.api.from("quote_items").insert({ org_id: workspace.id, quote_id: quote.id, description: "Recoverable deposit", quantity: 4, unit_price_satang: 10000 })).error).toBeNull()
  for (const status of ["sent", "accepted"]) expect((await owner.api.from("quotes").update({ status }).eq("id", quote.id)).error).toBeNull()
  await f.signIn(owner)
  await page.goto(`/quotes/${quote.id}`)
  await page.getByRole("button", { name: "Create draft invoice", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "Create draft invoice", exact: true })
  await dialog.getByLabel("Invoice scope").selectOption("deposit_percent")
  await dialog.getByLabel("Deposit (%)").fill("25")
  let dropResponse = true
  await page.route("**/*", async route => {
    if (dropResponse && route.request().method() === "POST" && route.request().headers()["next-action"]) {
      dropResponse = false
      await route.fetch()
      await route.abort("failed")
    } else await route.continue()
  })
  const invoices = async () => ok(await admin.from("invoices").select("id,total_satang,quote_invoice_kind").eq("org_id", workspace.id).eq("source_quote_id", quote.id))
  await dialog.getByRole("button", { name: "Create draft invoice", exact: true }).click()
  await expect(page.getByText("The conversion result could not be confirmed. Retry to recover the same invoice.", { exact: true })).toBeVisible()
  await expect.poll(async () => (await invoices()).length).toBe(1)
  const original = (await invoices())[0]
  expect(original).toMatchObject({ total_satang: 10000, quote_invoice_kind: "deposit" })

  await page.reload()
  await page.getByRole("button", { name: "Create draft invoice", exact: true }).click()
  await expect(dialog.getByText("Deposit: 25%", { exact: true })).toBeVisible()
  await dialog.getByLabel("Invoice scope").selectOption("deposit_percent")
  await dialog.getByLabel("Deposit (%)").fill("50")
  await dialog.getByRole("button", { name: "Retry pending invoice", exact: true }).click()
  await page.waitForURL(new RegExp(`/finance/invoices/${original.id}$`))
  expect(await invoices()).toEqual([original])
  await page.goto(`/quotes/${quote.id}`)
  await expect(page.getByText("Invoiced vs quote", { exact: true })).toBeVisible()
  await page.getByRole("button", { name: "Create draft invoice", exact: true }).click()
  await expect(dialog.getByRole("button", { name: "Create draft invoice", exact: true })).toBeVisible()
  await dialog.getByLabel("Invoice scope").selectOption("deposit_percent")
  await dialog.getByLabel("Deposit (%)").fill("100")
  await dialog.getByRole("button", { name: "Create draft invoice", exact: true }).click()
  await expect(page.getByText("Deposit exceeds remaining quote value", { exact: true })).toBeVisible()
  await dialog.getByLabel("Deposit (%)").fill("25")
  await dialog.getByRole("button", { name: "Create draft invoice", exact: true }).click()
  await page.waitForURL(/\/finance\/invoices\/[^/]+$/)
  expect(await invoices()).toHaveLength(2)
})

test("subscription resume skips paused periods unless selected and generated invoices retain VAT and WHT", async ({ fixtures: f, page }) => {
  const owner = await f.user()
  const workspace = await f.workspace("subscription resume", owner)
  const client = ok(await admin.from("clients").insert({ org_id: workspace.id, name: f.name("recurring buyer") }).select("id").single())
  expect((await owner.api.rpc("update_tax_business_profile", { p_org_id: workspace.id, p_legal_name: "Synthetic recurring seller", p_business_address: "Synthetic address", p_tax_id: "1234567890123", p_vat_registered: true, p_vat_rate_bps: 700, p_prices_include_vat: false, p_branch_label: "Head office" })).error).toBeNull()
  const today = todayISO()
  const missed = new Date(Date.parse(`${today}T12:00:00Z`) - 35 * 86400000).toISOString().slice(0, 10)
  const create = async (label: string) => ok(await admin.from("subscriptions").insert({ org_id: workspace.id, client_id: client.id, name: f.name(label), amount_satang: 10000, interval: "weekly", start_date: missed, next_run_date: missed, status: "paused", tax_rate_bps: 700, wht_rate_bps: 300 }).select("id").single())
  const current = await create("skip paused periods")
  const catchUp = await create("bill paused periods")
  await f.signIn(owner)
  await page.goto(`/finance/subscriptions/${current.id}`)
  await expect(page.getByLabel("Bill missed periods")).not.toBeChecked()
  await page.getByRole("button", { name: "Resume subscription", exact: true }).click()
  await expect.poll(async () => ok(await admin.from("subscriptions").select("next_run_date").eq("id", current.id).single()).next_run_date).toBe(today)
  await page.getByRole("button", { name: "Generate scheduled invoice", exact: true }).click()
  await expect.poll(async () => ok(await admin.from("invoices").select("id").eq("org_id", workspace.id).eq("source_subscription_id", current.id)).length).toBe(1)
  const invoice = ok(await admin.from("invoices").select("id,total_satang,amount_satang,wht_rate_bps").eq("source_subscription_id", current.id).single())
  expect(invoice).toMatchObject({ total_satang: 10700, amount_satang: 10400, wht_rate_bps: 300 })
  expect(ok(await admin.from("invoice_items").select("tax_rate_bps,wht_rate_bps").eq("invoice_id", invoice.id).single())).toEqual({ tax_rate_bps: 700, wht_rate_bps: 300 })
  await page.goto(`/finance/subscriptions/${catchUp.id}`)
  await page.getByLabel("Bill missed periods").check()
  await page.getByRole("button", { name: "Resume subscription", exact: true }).click()
  await expect(page.getByRole("button", { name: "Generate scheduled invoice", exact: true })).toBeEnabled()
  expect(ok(await admin.from("subscriptions").select("next_run_date").eq("id", catchUp.id).single()).next_run_date).toBe(missed)
})

test("switching two actual memberships fences dashboard, clients, deals and exports", async ({ fixtures: f, page, context }) => {
  test.skip(community, "The workspace switcher is Pro-only (BBN_EDITION=pro)")
  page.on("pageerror", error => console.error("QA switcher client error:", error.stack ?? error.message))
  const actor = await f.user()
  const a = await f.workspace("workspace A", actor)
  const b = await f.workspace("workspace B", actor)
  const clients = []
  for (const [workspace, label, amount] of [[a, "client A", 123400], [b, "client B", 567800]] as const) {
    const client = ok(await admin.from("clients").insert({ org_id: workspace.id, name: f.name(label) }).select("id, name").single())
    clients.push(client)
    expect((await admin.from("deals").insert({ org_id: workspace.id, client_id: client.id, title: f.name(`deal ${label.at(-1)}`), value_satang: amount, stage: "lead" })).error).toBeNull()
  }
  const [clientA, clientB] = clients
  const pipeline = page.locator('[data-slot="card"]').filter({ has: page.getByText("Open pipeline", { exact: true }) })
  await f.signIn(actor)
  await expect(pipeline.getByText("฿1,234", { exact: true })).toBeVisible()
  await page.goto("/clients")
  await expect(page.getByRole("link", { name: clientA.name, exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: clientB.name, exact: true })).toHaveCount(0)
  await page.goto("/deals")
  await expect(page.getByText(f.name("deal A"), { exact: true })).toBeVisible()
  await expect(page.getByText(f.name("deal B"), { exact: true })).toHaveCount(0)

  await page.getByRole("button", { name: new RegExp(a.name) }).click()
  await page.getByRole("menuitem", { name: b.name, exact: true }).click()
  await expect.poll(async () => (await context.cookies(baseURL)).find(cookie => cookie.name === "active_org")?.value).toBe(b.id)
  await expect(pipeline.getByText("฿5,678", { exact: true })).toBeVisible()
  await page.goto("/clients")
  await expect(page.getByRole("link", { name: clientB.name, exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: clientA.name, exact: true })).toHaveCount(0)
  await page.goto(`/clients/${clientA.id}`)
  await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible()
  await page.goto("/deals")
  await expect(page.getByText(f.name("deal B"), { exact: true })).toBeVisible()
  await expect(page.getByText(f.name("deal A"), { exact: true })).toHaveCount(0)
  const exported = await page.request.get("/deals/export")
  expect(exported.status()).toBe(200)
  const csv = await exported.text()
  expect(csv).toContain(f.name("deal B"))
  expect(csv).not.toContain(f.name("deal A"))

  await context.addCookies([{ name: "active_org", value: randomUUID(), url: baseURL, httpOnly: true, sameSite: "Lax" }])
  await page.goto("/dashboard")
  await expect(pipeline.getByText("฿1,234", { exact: true })).toBeVisible()
  await page.goto("/clients")
  await expect(page.getByRole("link", { name: clientA.name, exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: clientB.name, exact: true })).toHaveCount(0)
})

test("a zero-membership account reaches onboarding and provisions one owner workspace", async ({ fixtures: f, page, context }) => {
  test.skip(community, "Provisioning an additional workspace is Pro-only (BBN_EDITION=pro)")
  const actor = await f.user()
  expect(ok(await admin.from("memberships").select("id").eq("user_id", actor.id))).toHaveLength(0)
  await f.signIn(actor)
  await expect(page).toHaveURL(/\/onboarding$/)
  await expect(page.getByText("Create your workspace / สร้างพื้นที่ทำงาน", { exact: true })).toBeVisible()
  await page.goto("/clients")
  await expect(page).toHaveURL(/\/onboarding$/)
  const name = f.name("provisioned workspace")
  f.workspaceNames.add(name)
  await page.locator("#workspace-name").fill(name)
  await page.getByRole("button", { name: /^Create workspace/ }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  const memberships = ok(await admin.from("memberships").select("org_id, role").eq("user_id", actor.id))
  expect(memberships).toHaveLength(1)
  expect(memberships[0].role).toBe("owner")
  expect(ok(await admin.from("organizations").select("name").eq("id", memberships[0].org_id).single()).name).toBe(name)
  f.workspaces.add(memberships[0].org_id)
  const activeCookie = (await context.cookies()).find(cookie => cookie.name === "active_org")
  console.info("QA active cookie metadata:", JSON.stringify({ present: !!activeCookie, secure: activeCookie?.secure, domain: activeCookie?.domain, path: activeCookie?.path, appURL: baseURL }))
  expect((await context.cookies(baseURL)).find(cookie => cookie.name === "active_org")?.value).toBe(memberships[0].org_id)
})

test("invitation account switching accepts only the intended recipient and retry preserves one membership", async ({ fixtures: f, page }) => {
  const owner = await f.user()
  const recipient = await f.user()
  const wrong = await f.user()
  const workspace = await f.workspace("invited workspace", owner)
  const token = randomUUID().replaceAll("-", "")
  const invite = ok(await admin.from("invitations").insert({ org_id: workspace.id, email: recipient.email, role: "member", token, invited_by: owner.id, expires_at: new Date(Date.now() + 86400000).toISOString() }).select("id").single())
  await f.signIn(wrong)
  await page.goto(`/invite/${token}`)
  await expect(page.getByText("Invitation unavailable", { exact: true })).toBeVisible()
  await expect(page.getByText(workspace.name, { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Accept invitation", exact: true })).toHaveCount(0)
  expect((await wrong.api.rpc("accept_workspace_invitation", { p_token: token })).error).not.toBeNull()
  expect(ok(await admin.from("memberships").select("id").eq("user_id", wrong.id))).toHaveLength(0)
  expect(ok(await admin.from("invitations").select("status").eq("id", invite.id).single()).status).toBe("pending")
  await page.getByRole("button", { name: "Use another account", exact: true }).click()
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await f.signIn(recipient, false)
  await expect(page).toHaveURL(new RegExp(`/invite/${token}$`))
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  const accepted = ok(await admin.from("invitations").select("status, accepted_by").eq("id", invite.id).single())
  expect(accepted).toEqual({ status: "accepted", accepted_by: recipient.id })
  await page.goto(`/invite/${token}`)
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  const memberships = ok(await admin.from("memberships").select("role").eq("org_id", workspace.id).eq("user_id", recipient.id))
  expect(memberships).toEqual([{ role: "member" }])
})

test("a committed subscription request survives lost response, reload and status refresh without billing the next occurrence", async ({ fixtures: f, page }) => {
  const owner = await f.user()
  const workspace = await f.workspace("subscription recovery", owner)
  const client = ok(await admin.from("clients").insert({ org_id: workspace.id, name: f.name("subscription client") }).select("id").single())
  const subscription = ok(await admin.from("subscriptions").insert({ org_id: workspace.id, client_id: client.id, name: f.name("weekly subscription"), amount_satang: 10000, interval: "weekly", start_date: "2026-07-02", next_run_date: "2026-07-02", status: "active" }).select("id, name").single())
  await f.signIn(owner)
  await page.goto(`/finance/subscriptions/${subscription.id}`)
  let dropResponse = true
  await page.route("**/*", async route => {
    if (dropResponse && route.request().method() === "POST" && route.request().headers()["next-action"]) {
      dropResponse = false
      await route.fetch() // Commit the scheduled occurrence before dropping its response.
      await route.abort("failed")
    } else await route.continue()
  })
  const receipts = async () => ok(await admin.from("invoices").select("id").eq("org_id", workspace.id))
  const nextRun = async () => ok(await admin.from("subscriptions").select("next_run_date").eq("id", subscription.id).single()).next_run_date
  await page.getByRole("button", { name: "Generate scheduled invoice", exact: true }).click()
  await expect(page.getByText("Could not confirm the invoice request. Retry in this tab.", { exact: true })).toBeVisible()
  await expect.poll(async () => (await receipts()).length).toBe(1)
  expect(await nextRun()).toBe("2026-07-09")
  const originalInvoice = (await receipts())[0].id

  await page.reload()
  const retry = page.getByRole("button", { name: "Retry invoice for 2026-07-02", exact: true })
  await expect(retry).toBeVisible()
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  await page.getByLabel("Bill missed periods").check()
  await page.getByRole("button", { name: "Resume subscription", exact: true }).click()
  await expect(retry).toBeEnabled()
  await retry.click()
  await expect(page.getByRole("button", { name: "Generate scheduled invoice", exact: true })).toBeVisible()
  expect(await receipts()).toEqual([{ id: originalInvoice }])
  expect(await nextRun()).toBe("2026-07-09")

  // Only a new acknowledged user command may bill the still-overdue July 9 slot.
  await page.getByRole("button", { name: "Generate scheduled invoice", exact: true }).click()
  await expect.poll(async () => (await receipts()).length).toBe(2)
  expect(await nextRun()).toBe("2026-07-16")
})
