"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireCapability, requireOrgContext } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"
import {
  DOCUMENT_KINDS,
  documentHref,
  mintPublicReference,
  parsePublicReference,
  planPublicReferenceIssue,
  type DocumentKind,
} from "@/lib/documents/public-reference"
import { createClient } from "@/lib/supabase/server"

const Kind = z.enum(DOCUMENT_KINDS)
const RecordId = z.guid()

export async function setPublicDocumentRefsEnabled(enabled: boolean): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "settings:manage")
  } catch {
    return { error: "Only an owner or admin can update settings." }
  }
  if (typeof enabled !== "boolean") return { error: "Choose whether public references are enabled." }

  const supabase = await createClient()
  const { error } = await supabase
    .from("org_settings")
    .upsert({ org_id: ctx.orgId, public_document_refs_enabled: enabled }, { onConflict: "org_id" })
  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "settings",
    entityId: ctx.orgId,
    action: "updated",
    summary: enabled ? "Enabled typed public document references" : "Disabled typed public document references",
  })
  revalidatePath("/settings")
  revalidatePath("/documents/lookup")
  return {}
}

async function targetExists(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  kind: DocumentKind,
  recordId: string
): Promise<boolean> {
  if (kind === "receipt" || kind === "delivery") {
    const { data, error } = await supabase
      .from("stock_documents")
      .select("id")
      .eq("org_id", orgId)
      .eq("id", recordId)
      .eq("kind", kind)
      .maybeSingle()
    if (error) throw new Error(error.message)
    return Boolean(data)
  }
  const table = kind === "quote" ? "quotes" : kind === "invoice" ? "invoices" : "purchase_orders"
  const { data, error } = await supabase.from(table).select("id").eq("org_id", orgId).eq("id", recordId).maybeSingle()
  if (error) throw new Error(error.message)
  return Boolean(data)
}

export async function issueDocumentPublicReference(
  kindInput: string,
  recordIdInput: string
): Promise<{ error?: string; display?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "record:write")
  } catch {
    return { error: "You cannot issue a public reference." }
  }
  const kind = Kind.safeParse(kindInput)
  const recordId = RecordId.safeParse(recordIdInput)
  if (!kind.success || !recordId.success) return { error: "Choose a document before issuing a public reference." }

  const supabase = await createClient()
  const { data: settings, error: settingsError } = await supabase
    .from("org_settings")
    .select("public_document_refs_enabled")
    .eq("org_id", ctx.orgId)
    .maybeSingle()
  if (settingsError) return { error: settingsError.message }
  const enabled = settings?.public_document_refs_enabled === true
  if (!enabled) return { error: "Public document references are off for this workspace." }

  if (!(await targetExists(supabase, ctx.orgId, kind.data, recordId.data))) {
    return { error: "Document unavailable." }
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: existing, error: existingError } = await supabase
      .from("document_public_refs")
      .select("reference")
      .eq("org_id", ctx.orgId)
      .eq("kind", kind.data)
      .eq("record_id", recordId.data)
      .maybeSingle()
    if (existingError) return { error: existingError.message }

    const plan = planPublicReferenceIssue({
      enabled: true,
      existingCanonical: existing?.reference ?? null,
      kind: kind.data,
      mint: () => mintPublicReference(kind.data),
    })
    if (plan.status === "invalid_stored") return { error: "The stored public reference failed validation." }
    if (plan.status === "exhausted") return { error: "Could not issue a unique public reference." }
    if (plan.status === "disabled") return { error: "Public document references are off for this workspace." }
    if (plan.status === "reuse") return { display: plan.display }

    const parsed = parsePublicReference(plan.canonical, { canonical: true })
    if (!parsed.ok || parsed.kind !== kind.data) return { error: "The new public reference failed validation." }

    const { error } = await supabase.from("document_public_refs").insert({
      org_id: ctx.orgId,
      reference: plan.canonical,
      kind: kind.data,
      record_id: recordId.data,
      created_by: ctx.userId,
    })
    if (!error) {
      await writeAudit(ctx, {
        entity: "document_public_ref",
        entityId: recordId.data,
        action: "issued",
        summary: `Issued a ${kind.data.replaceAll("_", " ")} public reference`,
        meta: { kind: kind.data, reference: plan.display },
      })
      revalidatePath(documentHref(kind.data, recordId.data))
      revalidatePath("/documents/lookup")
      revalidatePath("/inventory/documents")
      return { display: plan.display }
    }
    if (error.code !== "23505") return { error: error.message }
  }
  return { error: "Could not issue a unique public reference." }
}
