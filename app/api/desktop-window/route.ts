import { getVerifiedApiContext, machineOperatorDenied } from "@/lib/auth"
import { helperConfigured } from "@/lib/release/update-plan"
import { readLimitedJson } from "@/lib/http/read-json"

export const dynamic = "force-dynamic"

async function denied(request: Request, mutation: boolean): Promise<Response | null> {
  const access = await getVerifiedApiContext(request, { roles: ["owner", "admin"], mutation })
  if (access.response) return access.response
  return machineOperatorDenied(access.ctx.userId)
}

/** Window state from the desktop helper. `desktop:false` means a plain browser: the page uses the Fullscreen API instead. */
async function ask(method: "GET" | "POST", fullscreen?: boolean): Promise<Response> {
  const raw = process.env.BOOMBIGNOSE_UPDATE_URL?.trim() ?? ""
  const token = process.env.BOOMBIGNOSE_UPDATE_TOKEN?.trim() ?? ""
  if (!helperConfigured(raw, token)) return Response.json({ desktop: false })
  try {
    const response = await fetch(new URL("v1/fullscreen", raw.endsWith("/") ? raw : `${raw}/`), {
      method,
      redirect: "error",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: method === "POST" ? JSON.stringify({ fullscreen }) : undefined,
      signal: AbortSignal.timeout(3000),
      cache: "no-store",
    })
    if (!response.ok) return Response.json({ desktop: false })
    const data = (await response.json()) as { fullscreen?: unknown }
    return Response.json({ desktop: true, fullscreen: data.fullscreen === true })
  } catch {
    return Response.json({ desktop: false })
  }
}

export async function GET(request: Request) {
  const block = await denied(request, false)
  // Public capability discovery reveals no host state to unauthorized callers.
  // Commands below return the actual auth denial; they never reach the helper.
  if (block) return block.status === 401 || block.status === 403
    ? Response.json({ desktop: false }, { headers: { "cache-control": "no-store" } })
    : block
  return ask("GET")
}

export async function POST(request: Request) {
  const block = await denied(request, true)
  if (block) return block
  const parsed = await readLimitedJson(request, 256)
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: parsed.status })
  const body = parsed.data as { fullscreen?: unknown } | null
  if (typeof body?.fullscreen !== "boolean") return Response.json({ error: "fullscreen must be true or false." }, { status: 400 })
  return ask("POST", body.fullscreen)
}
