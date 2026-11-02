import { expect, it } from "vitest"

import { GET } from "@/app/api/health/route"

it("answers the local health check", async () => {
  const response = await GET()
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ ok: true, app: "boombignose-erp" })
})
