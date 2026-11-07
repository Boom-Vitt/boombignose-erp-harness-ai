import { currentModelHost, localModelAccess, readJson } from "@/lib/ai/local-model-access"
import { describeLocalImage } from "@/lib/ai/ollama-admin"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const block = await localModelAccess(false, request)
  if (block) return block
  const body = await readJson(request)
  const mediaType = typeof body?.mediaType === "string" ? body.mediaType : ""
  const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : ""
  const result = await describeLocalImage({ mediaType, imageBase64 }, currentModelHost())
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status })
  return Response.json({ text: result.text })
}
