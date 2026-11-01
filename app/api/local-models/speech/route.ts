import { currentModelHost, localModelAccess, readJson } from "@/lib/ai/local-model-access"
import { speakLocalText } from "@/lib/ai/ollama-admin"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const block = await localModelAccess(false)
  if (block) return block
  const body = await readJson(request)
  const text = typeof body?.text === "string" ? body.text : ""
  const result = await speakLocalText(text, currentModelHost())
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status })
  const copy = new ArrayBuffer(result.audio.byteLength)
  new Uint8Array(copy).set(result.audio)
  return new Response(copy, {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" },
  })
}
