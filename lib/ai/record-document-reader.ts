import "server-only"

import { createHash } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { OrgContext } from "@/lib/auth"
import type { Database } from "@/lib/types/database"
import { authorizedRecordAttachment } from "@/lib/storage/record-attachments"
import { NativeAttachmentStore } from "@/lib/storage/native-attachments"
import { validAttachmentContent } from "@/lib/storage/attachment-content"
import { recognizePage, validateRaster } from "@/lib/ocr/server"

export const RECORD_DOCUMENT_FORMATS = ["text/plain", "text/csv", "image/png", "image/jpeg", "image/webp"]
type Content = { text: string; filename: string; contentType: string; extraction: { method: string; partial: boolean; limitations?: string[] } }

/** Request-local cache only; every use rechecks the session-visible parent, not just a retained file ID. */
export function recordDocumentReader(client: SupabaseClient<Database>, ctx: Pick<OrgContext, "orgId">, signal?: AbortSignal) {
  const cache = new Map<string, Promise<Content | null>>()
  const store = new NativeAttachmentStore()
  return async ({ orgId, attachmentId }: { orgId: string; attachmentId: string }): Promise<Content | null> => {
    if (orgId !== ctx.orgId) return null
    signal?.throwIfAborted()
    const attachment = await authorizedRecordAttachment(client, ctx, attachmentId)
    if (!attachment || !RECORD_DOCUMENT_FORMATS.includes(attachment.content_type)) return null
    let content = cache.get(attachment.id)
    if (!content) {
      if (cache.size === 4) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
      content = (async () => {
        const bytes = await store.read(attachment.id, attachment.size)
        if (!validAttachmentContent(bytes, attachment.content_type)) throw new Error("Invalid retained attachment content.")
        signal?.throwIfAborted()
        if (attachment.content_type === "text/plain" || attachment.content_type === "text/csv") {
          return { text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes), filename: attachment.filename, contentType: attachment.content_type, extraction: { method: "validated-original-utf8", partial: false } }
        }
        await validateRaster(bytes, attachment.content_type, signal)
        const sourceSha256 = createHash("sha256").update(bytes).digest("hex")
        const page = await recognizePage(bytes, { page: 1, totalPages: 1, sourceSha256 }, signal ?? AbortSignal.timeout(240_000))
        return {
          text: page.text, filename: attachment.filename, contentType: attachment.content_type,
          extraction: {
            method: `local-ocr:${page.model}; original-sha256:${sourceSha256}`,
            partial: /\[unreadable\]/i.test(page.text),
            limitations: page.warnings,
          },
        }
      })()
      cache.set(attachment.id, content)
    }
    return content
  }
}
