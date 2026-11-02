import { getOrgContext } from "@/lib/auth"
import { helperConfigured } from "@/lib/release/update-plan"

export const dynamic = "force-dynamic"

/** Window state from the desktop helper. `desktop:false` means a plain browser: the page uses the Fullscreen API instead. */
async function ask(method: "GET" | "POST", fullscreen?: boolean): Promise<Response> {
  const ctx = await getOrgContext()
  if (!ctx) return Response.json({ error: "Sign in required." }, { status: 401 })
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

export const GET = () => ask("GET")

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { fullscreen?: unknown } | null
  if (typeof body?.fullscreen !== "boolean") return Response.json({ error: "fullscreen must be true or false." }, { status: 400 })
  return ask("POST", body.fullscreen)
}
