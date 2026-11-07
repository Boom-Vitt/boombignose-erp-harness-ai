import "server-only"
import { Buffer } from "node:buffer"

export async function readLimitedJson(request: Request, maxBytes: number): Promise<{ data: unknown } | { error: string; status: 400 | 413 }> {
  const declared = request.headers.get("content-length")
  if (declared !== null) {
    const length = Number(declared)
    if (!Number.isSafeInteger(length) || length < 0) return { error: "Invalid request size.", status: 400 }
    if (length > maxBytes) return { error: "The request is too large.", status: 413 }
  }
  if (!request.body) return { error: "Send a JSON request body.", status: 400 }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
        await reader.cancel().catch(() => {})
        return { error: "The request is too large.", status: 413 }
      }
      chunks.push(value)
    }
    return { data: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, length))) }
  } catch {
    return { error: "The request is not valid UTF-8 JSON.", status: 400 }
  } finally {
    reader.releaseLock()
  }
}
