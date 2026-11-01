import { PublicReferenceCard } from "@/components/documents/public-reference-card"
import { requireOrgContext } from "@/lib/auth"
import { publicReferenceForDocument } from "@/lib/documents/public-reference-query"
import type { DocumentKind } from "@/lib/documents/public-reference"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"

/** Renders nothing while typed public references are off, so unused document pages stay the same. */
export async function PublicReferenceSlot({ kind, recordId }: { kind: DocumentKind; recordId: string }) {
  const ctx = await requireOrgContext()
  const state = await publicReferenceForDocument(await createClient(), ctx.orgId, kind, recordId)
  if (!state.enabled) return null
  return <PublicReferenceCard kind={kind} recordId={recordId} display={state.display} canIssue={can(ctx.role, "record:write")} />
}
