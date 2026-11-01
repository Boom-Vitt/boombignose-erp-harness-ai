import { localModelAccess, readJson } from "@/lib/ai/local-model-access"
import { transcribeLocalAudio } from "@/lib/ai/asr-install"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const block = await localModelAccess(false)
  if (block) return block
  const body = await readJson(request)
  const encoded = typeof body?.audioBase64 === "string" ? body.audioBase64.replace(/\s/g, "") : ""
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length < 16 || encoded.length > 6_000_000) {
    return Response.json({ error: "Use a WAV, MP3, FLAC, or Ogg file under 4 MB." }, { status: 400 })
  }
  const audio = Buffer.from(encoded, "base64")
  const result = await transcribeLocalAudio(audio, process.platform, process.arch)
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status })
  return Response.json({ text: result.text })
}
