import { currentModelHost, localModelAccess, readJson } from "@/lib/ai/local-model-access"
import { describeLocalImage } from "@/lib/ai/ollama-admin"
import { RECEIPT_PROMPT } from "@/lib/ai/model-catalog"
import { parseReceiptDraft } from "@/lib/expenses/receipt-scan"

export const dynamic = "force-dynamic"

export async function POST(request: Request) {
  const block = await localModelAccess(false)
  if (block) return block
  const body = await readJson(request)
  const mediaType = typeof body?.mediaType === "string" ? body.mediaType : ""
  const imageBase64 = typeof body?.imageBase64 === "string" ? body.imageBase64 : ""
  const receipt = body?.purpose === "receipt"
  const result = await describeLocalImage({ mediaType, imageBase64, prompt: receipt ? RECEIPT_PROMPT : undefined }, currentModelHost())
  if ("error" in result) return Response.json({ error: result.error }, { status: result.status })
  // Receipt scans only suggest values for the form. Nothing is saved or posted here.
  if (receipt) return Response.json({ text: result.text, draft: parseReceiptDraft(result.text) })
  return Response.json({ text: result.text })
}
