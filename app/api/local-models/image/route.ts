import { currentModelHost, localModelAccess, readJson } from "@/lib/ai/local-model-access"
import { drawLocalImage } from "@/lib/ai/ollama-admin"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const block = await localModelAccess(false)
  if (block) return block
  const body = await readJson(request)
  const prompt = typeof body?.prompt === "string" ? body.prompt : ""
  const result = await drawLocalImage(prompt, currentModelHost())
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status })
  return Response.json({ mediaType: result.mediaType, image: result.image })
}
