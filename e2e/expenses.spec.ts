import { test, expect, type Browser, type Page } from "@playwright/test"
import { loginDemo } from "./auth"

/** A seeded member (supabase/seed.sql); members can claim but never approve. */
async function loginMember(page: Page) {
  await page.goto("/login")
  await page.getByLabel(/^(Email|à¸­à¸µà¹à¸¡à¸¥)$/).fill("nattapong@boombignose.org")
  await page.getByLabel(/^(Password|à¸£à¸«à¸±à¸ªà¸à¹à¸²à¸)$/).fill("BoomDemo123!")
  await page.getByRole("button", { name: /^(Sign in|à¹à¸à¹à¸²à¸ªà¸¹à¹à¸£à¸°à¸à¸)$/ }).click()
  await page.waitForURL("**/dashboard")
}

async function newPage(browser: Browser) {
  return (await browser.newContext()).newPage()
}

const step = (page: Page) => page.locator('[aria-label="Expense status"] [aria-current="step"]')

test("a member submits a claim, the owner approves it and its costs reach Finance", async ({ browser }) => {
  const member = await newPage(browser)
  await loginMember(member)
  await member.goto("/expenses")
  await member.getByRole("link", { name: "New claim", exact: true }).click()
  await member.getByLabel("Title").fill(`Expense smoke ${Date.now()}`)
  await member.getByRole("button", { name: "Create claim", exact: true }).click()
  await expect(member.getByRole("heading", { name: /^EXP-\d{4}-\d+$/ })).toBeVisible()
  const number = await member.getByRole("heading", { name: /^EXP-/ }).innerText()

  await member.getByLabel("Category").selectOption("other")
  await member.getByLabel("Amount (THB)").fill("123.45")
  await member.getByLabel("Description", { exact: true }).fill("Smoke taxi")
  await member.getByRole("button", { name: "Add line", exact: true }).click()
  await expect(member.getByRole("row").filter({ hasText: "Smoke taxi" })).toContainText("123.45")
  await member.getByRole("button", { name: "Submit", exact: true }).click()
  await expect(step(member)).toHaveText("Submitted")
  await expect(member.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0)

  const owner = await newPage(browser)
  await loginDemo(owner)
  await owner.goto("/expenses?tab=approve")
  await owner.getByRole("link", { name: number, exact: true }).click()
  await owner.getByRole("button", { name: "Approve", exact: true }).click()
  await expect(step(owner)).toHaveText("Approved")
  await expect(owner.getByRole("navigation", { name: "Related records" }).getByRole("link", { name: /Costs/ })).toContainText("1")

  await owner.goto("/finance?tab=costs")
  const cost = owner.getByRole("row").filter({ hasText: number })
  await expect(cost).toContainText("123.45")
  await expect(cost).toContainText("Awaiting reimbursement")
  await expect(cost.getByRole("link", { name: number, exact: true })).toHaveAttribute("href", /^\/expenses\/[0-9a-f-]{36}$/)
  await expect(cost.getByRole("button", { name: /^Delete/ })).toHaveCount(0)
})
