"use client"

import { useState, useTransition } from "react"

import { issueDocumentPublicReference } from "@/app/(app)/documents/actions"
import { Button } from "@/components/ui/button"
import { DOCUMENT_KIND_LABEL, type DocumentKind } from "@/lib/documents/public-reference"

export function IssuePublicReferenceButton({ kind, recordId }: { kind: DocumentKind; recordId: string }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState("")
  return (
    <span className="inline-flex flex-col gap-1">
      <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => start(async () => {
        const result = await issueDocumentPublicReference(kind, recordId)
        setError(result.error ?? "")
      })}>
        Issue reference
      </Button>
      {error ? <span role="alert" className="text-xs">{error}</span> : null}
    </span>
  )
}

export function PublicReferenceCard({
  kind,
  recordId,
  display,
  canIssue,
}: {
  kind: DocumentKind
  recordId: string
  display: string | null
  canIssue: boolean
}) {
  return (
    <section className="space-y-2 rounded-xl border p-4" aria-label="Public reference">
      <h2 className="text-sm font-medium">Public reference</h2>
      <p className="text-muted-foreground text-sm">
        Optional code for a {DOCUMENT_KIND_LABEL[kind].toLowerCase()}. It does not replace the document number or a tax ID. The checksum catches typos and does not grant access.
      </p>
      {display ? <p className="font-mono text-sm">{display}</p> : canIssue ? <IssuePublicReferenceButton kind={kind} recordId={recordId} /> : <p className="text-sm">No public reference has been issued.</p>}
    </section>
  )
}
