import { test, expect } from "@playwright/test"
import { loginDemo } from "./auth"

test("invalid public form remains readable without JavaScript or login", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, baseURL })
  try {
    const page = await context.newPage()
    await page.goto("/f/invalid-token")
    await expect(page.getByRole("heading", { name: "Form unavailable", exact: true })).toBeVisible()
    await expect(page).toHaveURL(/\/f\/invalid-token$/)
  } finally {
    await context.close()
  }
})

test("public form without JavaScript creates a deal in Lead and can be disabled", async ({ page, browser }) => {
  const suffix = Date.now()
  const name = `Website sales ${suffix}`
  const visitor = `Website visitor ${suffix}`
  const message = `Please contact us about project ${suffix}.`
  await loginDemo(page)
  await page.goto("/settings")
  await page.getByRole("link", { name: "Lead forms", exact: true }).click()
  await page.getByLabel("Form name", { exact: true }).fill(name)
  await page.getByRole("button", { name: "Create form", exact: true }).click()
  await expect(page.getByRole("heading", { name, exact: true })).toBeVisible()
  const linkField = page.getByLabel("Public link", { exact: true }).first()
  const publicLink = await linkField.inputValue()
  expect(publicLink).toMatch(/\/f\/[A-Za-z0-9_-]{43}$/)
  await expect(page.getByLabel("Embed snippet").first()).toHaveValue(new RegExp(`<iframe src="${publicLink}"`))

  const publicContext = await browser.newContext({ javaScriptEnabled: false })
  const publicPage = await publicContext.newPage()
  await publicPage.goto(publicLink)
  await expect(publicPage.getByRole("heading", { name, exact: true })).toBeVisible()
  await publicPage.getByLabel("Name", { exact: true }).fill(visitor)
  await publicPage.getByLabel("Company (optional)").fill(`Website company ${suffix}`)
  await publicPage.getByLabel(/^(Email|à¸­à¸µà¹à¸¡à¸¥)$/).fill(`website-${suffix}@example.invalid`)
  await publicPage.getByLabel("Phone (optional)").fill("+66 20000000")
  await publicPage.getByLabel("Message", { exact: true }).fill(message)
  await publicPage.getByRole("button", { name: "Send message", exact: true }).click()
  await expect(publicPage.getByRole("status")).toHaveText("Thank you. We will be in touch soon.")

  await page.goto(`/deals?q=${encodeURIComponent(visitor)}`)
  const leadColumn = page.getByRole("region", { name: /^Lead/ })
  const deal = leadColumn.getByRole("link", { name: `Web form: ${visitor}`, exact: true })
  await expect(deal).toBeVisible()
  await deal.click()
  // Wait for the deal page itself; the board can still be on screen right after the click.
  await expect(page).toHaveURL(/\/deals\/[0-9a-f-]{36}$/)
  await expect(page.getByRole("heading", { level: 1, name: `Web form: ${visitor}`, exact: true })).toBeVisible()
  await expect(page.getByText("Web form", { exact: true })).toBeVisible()
  await expect(page.getByText(message, { exact: false })).toBeVisible()

  await page.goto("/settings/lead-forms")
  await page.getByRole("button", { name: `Disable ${name}`, exact: true }).click()
  await expect(page.getByRole("button", { name: `Disable ${name}`, exact: true })).toHaveCount(0)
  await publicPage.goto(publicLink)
  await expect(publicPage.getByRole("heading", { name: "Form unavailable" })).toBeVisible()
  await publicContext.close()
})
