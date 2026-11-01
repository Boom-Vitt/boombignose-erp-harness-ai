import { localModelAccess } from "@/lib/ai/local-model-access"
import { installAsr, removeAsr } from "@/lib/ai/asr-install"

export const dynamic = "force-dynamic"

export async function POST() {
  const block = await localModelAccess(true)
  if (block) return block
  const result = await installAsr(process.platform, process.arch)
  if ("error" in result) {
    const status = result.error.includes("not available") ? 409 : 502
    return Response.json({ error: result.error }, { status })
  }
  return Response.json(result)
}

export async function DELETE() {
  const block = await localModelAccess(true)
  if (block) return block
  await removeAsr()
  return Response.json({ ok: true })
}
