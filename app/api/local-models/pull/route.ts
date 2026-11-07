import { currentModelHost, localModelAccess, readJson } from "@/lib/ai/local-model-access"
import { pullInstalledModel } from "@/lib/ai/ollama-admin"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const block = await localModelAccess(true, request)
  if (block) return block
  const body = await readJson(request)
  const model = typeof body?.model === "string" ? body.model : ""
  const result = await pullInstalledModel(model, currentModelHost())
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status })
  return new Response(result.stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  })
}
