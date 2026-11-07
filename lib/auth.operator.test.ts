import { afterEach, expect, it, vi } from "vitest"
import { machineOperatorDenied } from "./auth"

const operator = "11111111-1111-4111-8111-111111111111"
const other = "22222222-2222-4222-8222-222222222222"
afterEach(() => vi.unstubAllEnvs())

it.each([
  { configured: operator, actor: operator, allowed: true },
  { configured: `${other},${operator}`, actor: operator, allowed: true },
  { configured: operator, actor: other, allowed: false },
  { configured: "", actor: operator, allowed: false },
  { configured: "invalid", actor: operator, allowed: false },
  { configured: `${operator},invalid`, actor: operator, allowed: false },
  { configured: `${operator},`, actor: operator, allowed: false },
  { configured: operator, actor: operator.slice(0, -1), allowed: false },
])("enforces exact host operator authority: $configured / $actor", ({ configured, actor, allowed }) => {
  vi.stubEnv("BOOMBIGNOSE_OPERATOR_USER_IDS", configured)
  const denial = machineOperatorDenied(actor)
  if (allowed) expect(denial).toBeNull()
  else {
    expect(denial?.status).toBe(403)
    expect(denial?.headers.get("cache-control")).toBe("no-store")
  }
})
