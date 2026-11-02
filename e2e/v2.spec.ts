import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { loginDemo } from "./auth"

/**
 * V2 feature smoke tests: CSV export (satang→baht), saved-view/stage filtering,
 * the audit trail, and signup password policy. Assumes the local Supabase stack
 * is running and seeded, with env loaded (`set -a && . ./.env.local`).
 */

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

test("invoices CSV exports amounts in baht, not satang", async ({ page }) => {
  await loginDemo(page)
  const res = await page.request.get("/finance/invoices/export")
  expect(res.status()).toBe(200)
  expect(res.headers()["content-type"]).toContain("csv")
  const body = await res.text()
  expect(body).toContain("Number") // header row present
  // INV-2026-001 is 9,000,000 satang → 90000 baht. Must be baht, never raw satang.
  expect(body).toContain("90000")
  expect(body).not.toContain("9000000")
})

test("deals CSV export downloads with a header", async ({ page }) => {
  await loginDemo(page)
  const res = await page.request.get("/deals/export")
  expect(res.status()).toBe(200)
  expect(res.headers()["content-type"]).toContain("csv")
  expect(await res.text()).toContain("Title")
})

test("deals board filters to a single stage via the URL", async ({ page }) => {
  await loginDemo(page)
  await page.goto("/deals?stage=won")
  // When filtered, only the selected stage's column renders.
  await expect(page.getByText("Won", { exact: true }).first()).toBeVisible()
  await expect(page.getByRole("region", { name: "Deals board" }).getByText("Lead", { exact: true })).toHaveCount(0)
})

test("signup enforces the password policy and gates submit", async ({ page }) => {
  await page.goto("/signup")
  await page.getByLabel(/^(Email|à¸­à¸µà¹à¸¡à¸¥)$/).fill("newperson@example.com")
  const submit = page.getByRole("button", { name: /create account/i })

  await page.getByLabel(/^(Password|à¸£à¸«à¸±à¸ªà¸à¹à¸²à¸)$/).fill("short")
  await expect(submit).toBeDisabled()
  await expect(page.locator("ul.text-destructive li").first()).toBeVisible()

  await page.getByLabel(/^(Password|à¸£à¸«à¸±à¸ªà¸à¹à¸²à¸)$/).fill("BoomDemo123!")
  await expect(submit).toBeEnabled()
})

test("changing a deal stage writes a stage_changed audit entry shown in /audit", async ({
  page,
}) => {
  const a = admin()
  const { data: deal } = await a
    .from("deals")
    .select("id,title,stage")
    .not("stage", "in", "(won,lost)")
    .limit(1)
    .single()
  expect(deal).toBeTruthy()

  await loginDemo(page)
  await page.goto(`/deals/${deal!.id}`)

  // Base UI Select (the stage changer) → open and pick a different stage.
  await page.getByRole("combobox").first().click()
  const target = deal!.stage === "proposal" ? "Negotiation" : "Proposal"
  await page.getByRole("option", { name: target, exact: true }).click()
  await expect(page.getByText(/stage updated/i)).toBeVisible()

  // The audit row is written by the server action.
  await expect
    .poll(async () => {
      const { count } = await a
        .from("audit_log")
        .select("*", { count: "exact", head: true })
        .eq("entity_id", deal!.id)
        .eq("action", "stage_changed")
      return count ?? 0
    })
    .toBeGreaterThan(0)

  // And it renders in the activity feed.
  await page.goto("/audit")
  await expect(page.getByText(/moved deal/i).first()).toBeVisible()
})
