import Link from "next/link"
import { z } from "zod"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { parsePublicReference, type DocumentKind } from "@/lib/documents/public-reference"
import { IssuePublicReferenceButton } from "@/components/documents/public-reference-card"
import { PageHeader } from "@/components/page-header"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export default async function StockDocumentsPage({ searchParams }: { searchParams: Promise<{ sourceId?: string }> }) {
  const ctx = await requireOrgContext()
  const source = z.guid().safeParse((await searchParams).sourceId).data
  const db = await createClient()
  const documents = await readAllOrThrow((from, to) => {
    let query = db.from("stock_documents").select("*").eq("org_id", ctx.orgId)
    if (source) query = query.or(`purchase_order_id.eq.${source},invoice_id.eq.${source}`)
    return query.order("created_at", { ascending: false }).order("id").range(from, to)
  })
  const { data: settings, error: settingsError } = await db.from("org_settings").select("public_document_refs_enabled").eq("org_id", ctx.orgId).maybeSingle()
  if (settingsError) throw new Error(settingsError.message)
  const publicRefs = settings?.public_document_refs_enabled === true
  const displays = new Map<string, string>()
  if (publicRefs && documents.length) {
    const refs = await readAllOrThrow((from, to) => db.from("document_public_refs").select("record_id, reference, kind").eq("org_id", ctx.orgId).in("kind", ["receipt", "delivery"]).order("record_id").range(from, to))
    for (const ref of refs) {
      const parsed = parsePublicReference(ref.reference, { canonical: true })
      if (parsed.ok && parsed.kind === ref.kind) displays.set(ref.record_id, parsed.display)
    }
  }
  const canIssue = can(ctx.role, "record:write")
  return <div className="space-y-6"><PageHeader title="Stock documents" description="Numbered receipt and delivery documents. Earlier ledger entries without a document remain legacy stock history." />
    <Table><TableHeader><TableRow><TableHead>Number</TableHead><TableHead>Date</TableHead><TableHead>Kind</TableHead><TableHead>Source</TableHead><TableHead>Print</TableHead>{publicRefs ? <TableHead>Public reference</TableHead> : null}</TableRow></TableHeader><TableBody>{documents.map(doc => {
      const kind: DocumentKind = doc.kind === "receipt" ? "receipt" : "delivery"
      const display = displays.get(doc.id)
      return <TableRow key={doc.id}><TableCell>{doc.number}</TableCell><TableCell>{doc.document_date}</TableCell><TableCell>{doc.kind}</TableCell><TableCell><Link className="underline" href={doc.purchase_order_id ? `/purchases/${doc.purchase_order_id}` : `/finance/invoices/${doc.invoice_id}`}>Source document</Link></TableCell><TableCell><Link className="underline" target="_blank" href={`/inventory/documents/${doc.id}/print`}>Print {doc.number}</Link></TableCell>{publicRefs ? <TableCell>{display ? <span className="font-mono text-sm">{display}</span> : canIssue ? <IssuePublicReferenceButton kind={kind} recordId={doc.id} /> : "—"}</TableCell> : null}</TableRow>
    })}</TableBody></Table>
    {!documents.length && <p>No stock documents yet.</p>}
  </div>
}
