import { chatLocal } from "@/lib/ai/assistant-chat"
import { parseChatRequest } from "@/lib/ai/chat-attachments"
import { getOrgContext } from "@/lib/auth"

export const dynamic = "force-dynamic"

const MAX_BODY = 14_000_000

export async function POST(request: Request) {
  const ctx = await getOrgContext()
  if (!ctx) return Response.json({ error: "Sign in required." }, { status: 401 })
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY) return Response.json({ error: "That message is too large." }, { status: 413 })
  const body = await request.json().catch(() => null)
  const parsed = parseChatRequest(body)
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 })
  const result = await chatLocal(parsed.messages)
  if ("error" in result) return Response.json({ error: result.error }, { status: 502 })
  return Response.json(result)
}
