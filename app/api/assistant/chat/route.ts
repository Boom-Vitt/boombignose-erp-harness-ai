import { chatLocal, erpToolRunner, type ToolRunner } from "@/lib/ai/assistant-chat"
import { parseChatRequest } from "@/lib/ai/chat-attachments"
import { getVerifiedApiContext } from "@/lib/auth"
import { readLimitedJson } from "@/lib/http/read-json"
import { validateRaster, OcrError } from "@/lib/ocr/server"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const access = await getVerifiedApiContext(request, { mutation: true })
  if ("response" in access) return access.response
  const body = await readLimitedJson(request, 14_000_000)
  if ("error" in body) return Response.json({ error: body.error }, { status: body.status })
  const parsed = parseChatRequest(body.data)
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 })
  try {
    for (const attachment of parsed.messages.at(-1)?.attachments ?? []) {
      if (attachment.kind === "image") await validateRaster(Buffer.from(attachment.base64, "base64"), attachment.mediaType)
    }
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid image." }, { status: error instanceof OcrError ? error.status : 400 })
  }
  let tools: ToolRunner | undefined
  if (parsed.dataScope === "erp") {
    try { tools = await erpToolRunner(access.ctx, undefined, request.signal) } catch {
      return Response.json({ error: "Authorized ERP data tools are unavailable. No ungrounded fallback was used." }, { status: 503 })
    }
  }
  const result = await chatLocal(parsed.messages, fetch, tools, request.signal, parsed.dataScope)
  if ("error" in result) return Response.json({ error: result.error }, { status: 502 })
  return Response.json(result, { headers: { "Cache-Control": "private, no-store" } })
}
