import type { Page } from "@playwright/test"

export const demo = { email: "demo@boombignose.org", password: "BoomDemo123!" }

/** Signs in as the synthetic seeded owner (supabase/seed.sql) via the real form. */
export async function loginDemo(page: Page) {
  await page.goto("/login")
  await page.getByLabel(/^(Email|à¸­à¸µà¹à¸¡à¸¥)$/).fill(demo.email)
  await page.getByLabel(/^(Password|à¸£à¸«à¸±à¸ªà¸à¹à¸²à¸)$/).fill(demo.password)
  await page.getByRole("button", { name: /^(Sign in|à¹à¸à¹à¸²à¸ªà¸¹à¹à¸£à¸°à¸à¸)$/ }).click()
  await page.waitForURL("**/dashboard")
}
