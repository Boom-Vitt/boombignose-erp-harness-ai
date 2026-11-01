import Link from "next/link"

import { requireOrgContext } from "@/lib/auth"
import {
  DOCUMENT_KIND_LABEL,
  DOCUMENT_KINDS,
  parsePublicReference,
  resolvePublicReference,
  type DocumentKind,
} from "@/lib/documents/public-reference"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export const dynamic = "force-dynamic"

const MESSAGES: Record<string, string> = {
  disabled: "Typed public references are off for this workspace. Document numbers and tax IDs are unchanged.",
  type: "Enter the public reference as text.",
  too_long: "That code is too long to be a public reference.",
  format: "That code is not a typed public reference. Accounting numbers and tax IDs stay in their own fields.",
  case: "Use one case for the whole code.",
  character: "That code contains a character this reference alphabet does not use.",
  checksum: "The checksum does not match. This looks like a typo, not a different document.",
  prefix: "That checksum is valid for a different reference type than this workspace uses.",
  length: "That code uses a different reference length than this workspace.",
  non_canonical: "Use the printed reference.",
  not_found: "The code is valid, and this workspace has no matching document. A checksum does not grant access.",
  mismatch: "The stored row does not match the reference type. It was not opened.",
}

function isKind(value: string): value is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(value)
}

export default async function PublicReferenceLookupPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>
}) {
  const ctx = await requireOrgContext()
  const code = (await searchParams).code ?? ""
  const supabase = await createClient()
  const { data: settings, error } = await supabase
    .from("org_settings")
    .select("public_document_refs_enabled")
    .eq("org_id", ctx.orgId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const enabled = settings?.public_document_refs_enabled === true

  let message = ""
  let match: { label: string; href: string; display: string } | null = null
  if (code && !enabled) message = MESSAGES.disabled
  if (code && enabled) {
    const parsed = parsePublicReference(code)
    if (!parsed.ok) message = MESSAGES[parsed.error] ?? "That code is not a public reference."
    else {
      const found = await supabase
        .from("document_public_refs")
        .select("kind, record_id")
        .eq("org_id", ctx.orgId)
        .eq("reference", parsed.canonical)
        .maybeSingle()
      if (found.error) throw new Error(found.error.message)
      const row = found.data
      const resolved = resolvePublicReference(code, true, () =>
        row && isKind(row.kind) ? { kind: row.kind, recordId: row.record_id } : null
      )
      if (resolved.ok) match = { label: DOCUMENT_KIND_LABEL[resolved.kind], href: resolved.href, display: resolved.display }
      else message = MESSAGES[resolved.error] ?? "That code is not a public reference."
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Public reference lookup" description="Paste a typed public reference. This does not search tax IDs or accounting numbers." />
      <form action="/documents/lookup" method="get" className="max-w-xl space-y-3">
        <div>
          <Label htmlFor="public-reference-code">Public reference</Label>
          <Input id="public-reference-code" name="code" defaultValue={code} autoComplete="off" spellCheck={false} />
        </div>
        <Button type="submit">Look up</Button>
      </form>
      {!enabled ? <p className="text-muted-foreground text-sm">This workspace has not enabled typed public references. An owner or admin can turn them on in Settings.</p> : null}
      {message ? <p role="status">{message}</p> : null}
      {match ? <p role="status">This is a {match.label}: <span className="font-mono">{match.display}</span>. <Link className="underline" href={match.href}>Open the document</Link></p> : null}
    </div>
  )
}
