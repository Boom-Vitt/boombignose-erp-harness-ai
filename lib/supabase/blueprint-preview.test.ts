import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
}))

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({ data: state.user ? { claims: state.user } : null, error: null }),
    },
  }),
}))

vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>()
  return {
    ...actual,
    connection: async () => {},
  }
})

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND")
  },
}))

import { updateSession } from "./middleware"
import BlueprintPreviewPage from "@/app/blueprint-preview/page"

const originalPreviewEnv = process.env.ERP_BLUEPRINT_PREVIEW

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test")
  state.user = null
  delete process.env.ERP_BLUEPRINT_PREVIEW
})

afterEach(() => {
  vi.unstubAllEnvs()
  if (originalPreviewEnv === undefined) {
    delete process.env.ERP_BLUEPRINT_PREVIEW
  } else {
    process.env.ERP_BLUEPRINT_PREVIEW = originalPreviewEnv
  }
})

it("only /blueprint-preview is public", async () => {
  const previewRes = await updateSession(
    new NextRequest("https://app.example.test/blueprint-preview")
  )
  expect(previewRes.headers.get("location")).toBeNull()

  for (const guarded of [
    "/blueprint",
    "/blueprint/sub",
    "/blueprint-preview/sub",
    "/blueprint-preview-extra",
  ]) {
    const res = await updateSession(
      new NextRequest(`https://app.example.test${guarded}`)
    )
    expect(res.headers.get("location")).toBe(
      `https://app.example.test/login?redirect=${encodeURIComponent(guarded)}`
    )
  }
})

it("the preview page is not found without ERP_BLUEPRINT_PREVIEW", async () => {
  delete process.env.ERP_BLUEPRINT_PREVIEW
  await expect(BlueprintPreviewPage()).rejects.toThrow("NOT_FOUND")

  process.env.ERP_BLUEPRINT_PREVIEW = "0"
  await expect(BlueprintPreviewPage()).rejects.toThrow("NOT_FOUND")

  process.env.ERP_BLUEPRINT_PREVIEW = "1"
  const rendered = await BlueprintPreviewPage()
  expect(rendered).toBeTruthy()
})
