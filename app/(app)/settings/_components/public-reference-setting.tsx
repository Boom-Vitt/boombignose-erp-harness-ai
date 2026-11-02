"use client"

import Link from "next/link"
import { useState, useTransition, type FormEvent } from "react"

import { setPublicDocumentRefsEnabled } from "@/app/(app)/documents/actions"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function PublicReferenceSetting({ enabled, canEdit }: { enabled: boolean; canEdit: boolean }) {
  const [pending, start] = useTransition()
  const [message, setMessage] = useState("")

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const next = new FormData(event.currentTarget).has("enabled")
    start(async () => {
      const result = await setPublicDocumentRefsEnabled(next)
      setMessage(result.error ?? (next ? "Typed public references are on." : "Typed public references are off."))
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Public document references</CardTitle>
        <CardDescription>Optional typed codes on document references. Off leaves numbers unchanged.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input name="enabled" type="checkbox" defaultChecked={enabled} disabled={!canEdit || pending} />
            Enable typed public references
          </label>
          {enabled ? <p className="text-sm"><Link className="underline" href="/documents/lookup">Look up a public reference</Link></p> : null}
          {message ? <p role="status" className="text-sm">{message}</p> : null}
          {canEdit ? <Button type="submit" disabled={pending}>Save public reference setting</Button> : <p className="text-muted-foreground text-sm">Only an owner or admin can change this.</p>}
        </form>
      </CardContent>
    </Card>
  )
}
