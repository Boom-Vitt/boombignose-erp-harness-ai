import { defineConfig, devices } from "@playwright/test"
import { readFileSync } from "node:fs"
const isolation = JSON.parse(readFileSync(".local-stack/isolation.json", "utf8"))
const baseURL = `http://127.0.0.1:${isolation.app}`
const localEnv = Object.fromEntries(readFileSync(".env.local", "utf8").trim().split("\n").filter(line=>line.includes("=")).map(line=>[line.slice(0,line.indexOf("=")),line.slice(line.indexOf("=")+1)]))
if (localEnv.NEXT_PUBLIC_SUPABASE_URL !== `http://127.0.0.1:${isolation.api}`) throw new Error("Test API must match this worktree's isolated stack")
if (localEnv.NEXT_PUBLIC_APP_URL !== baseURL) throw new Error("Configure this worktree's trusted NEXT_PUBLIC_APP_URL before the production build and browser tests")
for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NEXT_PUBLIC_APP_URL"]) process.env[name] = localEnv[name]
if (process.env.PLAYWRIGHT_BASE_URL && process.env.PLAYWRIGHT_BASE_URL !== baseURL) throw new Error("Playwright must use this worktree's isolated server")

/**
 * Smoke E2E. Assumes the local Supabase stack is running and seeded, and
 * `.env.local` is set. Run with: `pnpm e2e` (starts `pnpm dev` if needed).
 */
export default defineConfig({
  testDir: "./e2e",
  // The seeded suite stays the default. ERP_E2E_CORE=1 runs the unseeded
  // signup flow. That spec creates the only workspace this install allows
  // and stays out of the seeded demo-login suite.
  testMatch: process.env.ERP_E2E_CORE === "1" ? ["core-flows.spec.ts"] : "**/*.spec.ts",
  testIgnore: process.env.ERP_E2E_CORE === "1" ? undefined : ["core-flows.spec.ts"],
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL,
    // Specs drive the login form by its English labels; this keeps the screen English without touching profiles.locale.
    storageState: { cookies: [], origins: [{ origin: baseURL, localStorage: [{ name: "bbn-lang", value: "en" }] }] },
    trace: process.env.ERP_E2E_CORE === "1" ? "retain-on-failure" : "on-first-retry",
    launchOptions: { executablePath: process.env.ERP_PLAYWRIGHT_EXECUTABLE_PATH },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm start --hostname 127.0.0.1 --port ${isolation.app}`,
    url: `${baseURL}/login`,
    reuseExistingServer: false,
    env: { OLLAMA_HOST: "127.0.0.1:1", RESEND_API_KEY: "" },
    timeout: 120_000,
  },
})
