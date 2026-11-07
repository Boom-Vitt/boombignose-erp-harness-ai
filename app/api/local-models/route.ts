import { currentModelHost, localModelAccess, readJson } from "@/lib/ai/local-model-access"
import { deleteInstalledModel, loadModelSettings } from "@/lib/ai/ollama-admin"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const block = await localModelAccess(false, request)
  if (block) return block
  return Response.json(await loadModelSettings(currentModelHost()))
}

export async function DELETE(request: Request) {
  const block = await localModelAccess(true, request)
  if (block) return block
  const body = await readJson(request)
  const model = typeof body?.model === "string" ? body.model : ""
  const result = await deleteInstalledModel(model, currentModelHost())
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status })
  return Response.json({ ok: true })
}
