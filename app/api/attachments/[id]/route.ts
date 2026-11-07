import { z } from "zod"
import { getVerifiedApiContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { NativeAttachmentStore, nativeAttachmentStorage } from "@/lib/storage/native-attachments"
import { attachmentDisposition, authorizedRecordAttachment } from "@/lib/storage/record-attachments"
import { validAttachmentContent } from "@/lib/storage/attachment-content"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Referrer-Policy": "no-referrer",
  Vary: "Cookie",
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!nativeAttachmentStorage()) return Response.json({ error: "Attachment not found." }, { status: 404, headers: PRIVATE_HEADERS })
  const verified = await getVerifiedApiContext(request)
  if (verified.response) {
    for (const [key, value] of Object.entries(PRIVATE_HEADERS)) verified.response.headers.set(key, value)
    return verified.response
  }
  const parsed = z.guid().safeParse((await params).id)
  if (!parsed.success) return Response.json({ error: "Attachment not found." }, { status: 404, headers: PRIVATE_HEADERS })
  try {
    const supabase = await createClient()
    const attachment = await authorizedRecordAttachment(supabase, verified.ctx, parsed.data)
    if (!attachment) return Response.json({ error: "Attachment not found." }, { status: 404, headers: PRIVATE_HEADERS })
    const bytes = await new NativeAttachmentStore().read(parsed.data, attachment.size)
    if (!validAttachmentContent(bytes, attachment.content_type)) throw new Error("Invalid retained attachment.")
    return new Response(new Uint8Array(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength), {
      headers: {
        ...PRIVATE_HEADERS,
        "Content-Type": attachment.content_type,
        "Content-Length": String(bytes.length),
        "Content-Disposition": attachmentDisposition(attachment.filename),
      },
    })
  } catch {
    return Response.json({ error: "Attachment not found." }, { status: 404, headers: PRIVATE_HEADERS })
  }
}
