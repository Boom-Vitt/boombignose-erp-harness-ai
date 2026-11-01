import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/types/database"

import { parsePublicReference, type DocumentKind } from "./public-reference"

type DatabaseClient = SupabaseClient<Database>

/** Read the optional reference. Returns no display when the workspace flag is off. */
export async function publicReferenceForDocument(
  supabase: DatabaseClient,
  orgId: string,
  kind: DocumentKind,
  recordId: string
): Promise<{ enabled: boolean; display: string | null }> {
  const { data: settings, error: settingsError } = await supabase
    .from("org_settings")
    .select("public_document_refs_enabled")
    .eq("org_id", orgId)
    .maybeSingle()
  if (settingsError) throw new Error(settingsError.message)
  if (!settings?.public_document_refs_enabled) return { enabled: false, display: null }

  const { data, error } = await supabase
    .from("document_public_refs")
    .select("reference")
    .eq("org_id", orgId)
    .eq("kind", kind)
    .eq("record_id", recordId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { enabled: true, display: null }
  const parsed = parsePublicReference(data.reference, { canonical: true })
  if (!parsed.ok || parsed.kind !== kind) return { enabled: true, display: null }
  return { enabled: true, display: parsed.display }
}
