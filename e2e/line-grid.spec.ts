import { test as base, expect, type Page } from "@playwright/test"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"

const isolation = JSON.parse(readFileSync(".local-stack/isolation.json", "utf8"))
const env = Object.fromEntries(readFileSync(".env.local", "utf8").trim().split("\n").filter(line => line.includes("=")).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]))
if (env.NEXT_PUBLIC_SUPABASE_URL !== `http://127.0.0.1:${isolation.api}`) throw new Error("Line grid fixtures require this worktree's isolated local API")
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options)

function ok<T extends { data: unknown; error: { message: string } | null }>(response: T): NonNullable<T["data"]> {
  expect(response.error, response.error?.message).toBeNull()
  if (response.data == null) throw new Error("Expected local fixture result")
  return response.data as NonNullable<T["data"]>
}

/** A fresh VAT-registered workspace with one draft quote, so totals and VAT are deterministic. */
async function quoteWorkspace(page: Page, cleanup: (() => Promise<void>)[], status: "draft" | "sent" = "draft") {
  const email = `qa-grid-${randomUUID()}@example.invalid`
  const password = `Grid-${randomUUID()}`
  const user = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true })).user!
  const org = randomUUID()
  cleanup.push(async () => {
    expect((await admin.from("organizations").delete().eq("id", org)).error).toBeNull()
    expect((await admin.auth.admin.deleteUser(user.id)).error).toBeNull()
  })
  expect((await admin.from("organizations").insert({ id: org, name: `QA line grid ${org}`, slug: `qa-grid-${org}` })).error).toBeNull()
  expect((await admin.from("memberships").insert({ org_id: org, user_id: user.id, role: "owner" })).error).toBeNull()
  const owner: SupabaseClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
  ok(await owner.auth.signInWithPassword({ email, password }))
  expect((await owner.rpc("update_tax_business_profile", { p_org_id: org, p_legal_name: "Grid seller", p_business_address: "Grid address", p_tax_id: "1234567890123", p_vat_registered: true, p_vat_rate_bps: 700, p_prices_include_vat: false, p_branch_label: "Head office" })).error).toBeNull()
  const client = ok(await admin.from("clients").insert({ org_id: org, name: "Grid buyer" }).select("id").single())
  const quote = ok(await owner.from("quotes").insert({ org_id: org, client_id: client.id, number: `GRID-${org.slice(0, 8)}`, discount_satang: 1000 }).select("id").single())
  if (status === "sent") {
    expect((await owner.from("quote_items").insert({ org_id: org, quote_id: quote.id, description: "Agreed service", quantity: 1, unit_price_satang: 10000, tax_rate_bps: 700 })).error).toBeNull()
    expect((await owner.from("quotes").update({ status: "sent" }).eq("id", quote.id)).error).toBeNull()
  }
  await page.goto("/login")
  await page.getByLabel(/^(Email|อีเมล)$/).fill(email)
  await page.getByLabel(/^(Password|รหัสผ่าน)$/).fill(password)
  await page.getByRole("button", { name: /^(Sign in|เข้าสู่ระบบ)$/ }).click()
  await page.waitForURL(/\/(dashboard|onboarding)(?:\?.*)?$/)
  return { quoteId: quote.id }
}

const test = base.extend<{ cleanup: (() => Promise<void>)[] }>({
  cleanup: async ({}, provide) => {
    const tasks: (() => Promise<void>)[] = []
    try { await provide(tasks) } finally { for (const task of tasks) await task() }
  },
})

const grid = (page: Page) => page.getByRole("form", { name: "Edit line items" })

test("edit several lines, reorder, add a section and a note, save once, and the totals match the PDF", async ({ page, cleanup }) => {
  const { quoteId } = await quoteWorkspace(page, cleanup)
  await page.goto(`/quotes/${quoteId}`)
  const lines = grid(page)
  await expect(lines.getByText("No line items yet.")).toBeVisible()

  await lines.getByRole("button", { name: "Add a line", exact: true }).click()
  await expect(lines.getByLabel("Description, row 1")).toBeFocused()
  await page.keyboard.type("Design")
  await lines.getByLabel("Quantity, row 1").fill("1.5")
  await lines.getByLabel("Unit price, row 1").fill("333.33")
  await expect(lines.getByLabel("VAT, row 1")).toHaveValue("700")
  // Spreadsheet Enter: past the last row it starts a new line, ready for its description.
  await lines.getByLabel("Unit price, row 1").press("Enter")
  await expect(lines.getByLabel("Description, row 2")).toBeFocused()
  await page.keyboard.type("Boards")
  await lines.getByLabel("Quantity, row 1").press("Enter")
  await expect(lines.getByLabel("Quantity, row 2")).toBeFocused()
  await lines.getByLabel("Quantity, row 2").fill("2")
  await lines.getByLabel("Unit price, row 2").fill("100.00")
  await lines.getByLabel("VAT, row 2").selectOption("0")
  // Tab past the last cell of a filled-in last row starts the next line.
  await lines.getByLabel("VAT, row 2").press("Tab")
  await expect(lines.getByLabel("Description, row 3")).toBeFocused()
  await page.keyboard.type("Glue")
  await lines.getByLabel("Quantity, row 3").fill("0.333")
  await lines.getByLabel("Unit price, row 3").fill("0.99")
  await expect(lines.getByTestId("line-amount").nth(2)).toHaveText("฿0.33")

  await lines.getByRole("button", { name: "Add a section", exact: true }).click()
  await page.keyboard.type("Materials")
  await lines.getByRole("button", { name: "Move section 4", exact: true }).dragTo(lines.getByLabel("Description, row 2"))
  await expect(lines.getByLabel("Section text, row 2")).toHaveValue("Materials")
  await expect(lines.getByLabel("Description, row 3")).toHaveValue("Boards")
  await lines.getByRole("button", { name: "Move line 4", exact: true }).press("ArrowUp")
  await expect(lines.getByLabel("Description, row 3")).toHaveValue("Glue")
  await expect(lines.getByRole("button", { name: "Move line 3", exact: true })).toBeFocused()
  await lines.getByRole("button", { name: "Add a note", exact: true }).click()
  await page.keyboard.type("Delivered on site")
  await lines.getByRole("button", { name: "Move line 1", exact: true }).press("ArrowUp")
  await lines.getByLabel("Description, row 1").fill("Design ")
  await expect(lines.getByLabel("Description, row 1")).toBeFocused()
  await lines.getByLabel("Description, row 1").fill("Design")

  const totals = lines.getByTestId("line-grid-totals")
  await expect(totals).toContainText("฿700.33")
  await expect(totals).toContainText("-฿10.00")
  await expect(totals).toContainText("VAT 7%฿34.52")
  await expect(totals).toContainText("Amount due฿724.85")
  await expect(lines.getByText("Unsaved line changes", { exact: true })).toBeVisible()

  const actions: string[] = []
  page.on("request", request => { if (request.method() === "POST" && request.headers()["next-action"]) actions.push(request.url()) })
  await lines.getByRole("button", { name: "Save lines", exact: true }).click()
  await expect(lines.getByText("Unsaved line changes", { exact: true })).toHaveCount(0)
  expect(actions).toHaveLength(1)

  const items = ok(await admin.from("quote_items").select("description, quantity, position, amount_satang, tax_rate_bps").eq("quote_id", quoteId).order("position"))
  expect(items).toEqual([
    { description: "Design", quantity: 1.5, position: 0, amount_satang: 50000, tax_rate_bps: 700 },
    { description: "Glue", quantity: 0.333, position: 1, amount_satang: 33, tax_rate_bps: 700 },
    { description: "Boards", quantity: 2, position: 2, amount_satang: 20000, tax_rate_bps: 0 },
  ])
  expect(ok(await admin.from("document_sections").select("kind, description, lines_before").eq("quote_id", quoteId).order("position"))).toEqual([
    { kind: "section", description: "Materials", lines_before: 1 },
    { kind: "note", description: "Delivered on site", lines_before: 3 },
  ])
  expect(ok(await admin.from("quotes").select("subtotal_satang, vat_satang, total_satang").eq("id", quoteId).single())).toEqual({ subtotal_satang: 70033, vat_satang: 3452, total_satang: 72485 })

  // The server's rows replaced the draft: a reload shows the same grid and totals.
  await page.reload()
  await expect(grid(page).getByLabel("Section text, row 2")).toHaveValue("Materials")
  await expect(grid(page).getByLabel("Note text, row 5")).toHaveValue("Delivered on site")
  const shown = await grid(page).getByTestId("line-grid-totals").innerText()

  const pdf = await (await page.request.get(`/quotes/${quoteId}/pdf`)).text()
  const order = ["Design", "Materials", "Glue", "Boards", "Delivered on site"].map(text => pdf.indexOf(`>${text}<`))
  expect(order.every(index => index > 0), "every row is printed").toBe(true)
  expect([...order].sort((a, b) => a - b)).toEqual(order)
  for (const amount of ["฿700.33", "฿34.52", "฿724.85"]) {
    expect(shown).toContain(amount)
    expect(pdf).toContain(amount)
  }
})

test("Accept saves dirty lines first and freezes record fields until it finishes", async ({ page, cleanup }) => {
  const { quoteId } = await quoteWorkspace(page, cleanup, "sent")
  await page.goto(`/quotes/${quoteId}`)
  const lines = grid(page)
  await lines.getByLabel("Description, row 1").fill("Agreed service, revised")
  let release = () => {}
  const held = new Promise<void>(resolve => (release = resolve))
  let reached = () => {}
  const accepting = new Promise<void>(resolve => (reached = resolve))
  await page.route(`**/quotes/${quoteId}`, async route => {
    const body = route.request().postData() ?? ""
    if (route.request().method() === "POST" && body.includes("accepted") && !body.includes("rows")) {
      reached()
      await held
    }
    await route.continue()
  })
  await page.getByRole("button", { name: "Accept", exact: true }).click()
  await accepting
  expect(ok(await admin.from("quote_items").select("description").eq("quote_id", quoteId).single()).description).toBe("Agreed service, revised")
  await expect(page.getByLabel("Notes", { exact: true })).toBeDisabled()
  await expect(lines.getByLabel("Description, row 1")).toBeDisabled()
  release()
  await expect.poll(async () => ok(await admin.from("quotes").select("status").eq("id", quoteId).single()).status).toBe("accepted")
  await expect(page.getByRole("form", { name: "Edit line items" })).toHaveCount(0)
  await expect(page.getByText("Accepted scope is locked.", { exact: true })).toBeVisible()
  await expect(page.getByRole("table", { name: "Line items" })).toContainText("Agreed service, revised")
})

test("Accept saves header edits made while dirty lines are saving", async ({ page, cleanup }) => {
  const { quoteId } = await quoteWorkspace(page, cleanup, "sent")
  await page.goto(`/quotes/${quoteId}`)
  await grid(page).getByLabel("Description, row 1").fill("Updated service")
  let release = () => {}
  const held = new Promise<void>(resolve => (release = resolve))
  let reached = () => {}
  const saving = new Promise<void>(resolve => (reached = resolve))
  await page.route(`**/quotes/${quoteId}`, async route => {
    if (route.request().method() === "POST" && (route.request().postData() ?? "").includes('"rows"')) {
      reached()
      await held
    }
    await route.continue()
  })
  await page.getByRole("button", { name: "Accept", exact: true }).click()
  await saving
  await page.getByLabel("Notes", { exact: true }).fill("Header edited during line save")
  release()
  await expect.poll(async () => ok(await admin.from("quotes").select("notes").eq("id", quoteId).single()).notes).toBe("Header edited during line save")
  await expect.poll(async () => ok(await admin.from("quotes").select("status").eq("id", quoteId).single()).status).toBe("accepted")
  await expect(grid(page)).toHaveCount(0)
})

test("Accept stops if lines change while the header is saving", async ({ page, cleanup }) => {
  const { quoteId } = await quoteWorkspace(page, cleanup, "sent")
  await page.goto(`/quotes/${quoteId}`)
  await grid(page).getByLabel("Description, row 1").fill("First line edit")
  await page.getByLabel("Notes", { exact: true }).fill("Header edit")
  let release = () => {}
  const held = new Promise<void>(resolve => (release = resolve))
  let reached = () => {}
  const saving = new Promise<void>(resolve => (reached = resolve))
  await page.route(`**/quotes/${quoteId}`, async route => {
    const body = route.request().postData() ?? ""
    if (route.request().method() === "POST" && body.includes("Header edit") && !body.includes('"rows"')) {
      reached()
      await held
    }
    await route.continue()
  })
  await page.getByRole("button", { name: "Accept", exact: true }).click()
  await saving
  await grid(page).getByLabel("Description, row 1").fill("Later line edit")
  release()
  await expect(page.getByText("Nothing ran because some of your changes are not saved yet. Save them, then try again.", { exact: true })).toBeVisible()
  expect(ok(await admin.from("quotes").select("status").eq("id", quoteId).single()).status).toBe("sent")
  await expect(grid(page).getByLabel("Description, row 1")).toHaveValue("Later line edit")
  await grid(page).getByRole("button", { name: "Save lines", exact: true }).click()
  await expect(grid(page).getByText("Unsaved line changes", { exact: true })).toHaveCount(0)
  await page.getByRole("button", { name: "Accept", exact: true }).click()
  await expect.poll(async () => ok(await admin.from("quotes").select("status").eq("id", quoteId).single()).status).toBe("accepted")
  await expect(grid(page)).toHaveCount(0)
  expect(ok(await admin.from("quote_items").select("description").eq("quote_id", quoteId).single()).description).toBe("Later line edit")
})
