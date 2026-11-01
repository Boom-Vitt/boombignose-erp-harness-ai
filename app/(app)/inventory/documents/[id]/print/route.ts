import { notFound } from "next/navigation"
import { z } from "zod"
import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { renderStockDocument } from "@/lib/inventory/printable"
import { publicReferenceForDocument } from "@/lib/documents/public-reference-query"

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireOrgContext()
  const id = z.guid().safeParse((await params).id).data
  if (!id) notFound()
  const db = await createClient()
  const { data: doc, error } = await db.from("stock_documents").select("*").eq("org_id", ctx.orgId).eq("id", id).maybeSingle()
  if (error) throw new Error("Stock document unavailable")
  if (!doc) notFound()
  const lines = await readAllOrThrow((from, to) => db.from("stock_document_lines").select("*").eq("org_id", ctx.orgId).eq("document_id", id).order("id").range(from, to))
  const publicReference = (await publicReferenceForDocument(db, ctx.orgId, doc.kind === "receipt" ? "receipt" : "delivery", id)).display
  return new Response(renderStockDocument(ctx.orgName, doc, lines, publicReference), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } })
}
