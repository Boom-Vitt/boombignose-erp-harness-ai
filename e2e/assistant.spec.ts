import { test, expect } from "@playwright/test"

import { loginDemo } from "./auth"

// 1x1 PNG. The e2e server points OLLAMA_HOST at a dead port, so a send must end in the not-configured CTA.
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64")

test("ERP AI chat: send, attach a screenshot, MCP panel", async ({ page }) => {
  await loginDemo(page)
  await page.goto("/assistant")

  await expect(page.getByTestId("assistant-mcp")).toContainText("read-only")
  await expect(page.getByTestId("assistant-mcp")).toContainText("list_invoices")

  await page.getByTestId("assistant-file").setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: PNG })
  await expect(page.getByRole("list", { name: "Attachments to send" }).getByRole("img", { name: "shot.png" })).toBeVisible()
  await page.getByLabel("ข้อความ / Message").fill("what is in this screenshot?")
  await page.getByRole("button", { name: /ส่ง \/ Send/ }).click()

  await expect(page.getByTestId("assistant-thread").getByRole("img", { name: "shot.png" })).toBeVisible()
  await expect(page.getByTestId("assistant-not-configured")).toBeVisible()
})
