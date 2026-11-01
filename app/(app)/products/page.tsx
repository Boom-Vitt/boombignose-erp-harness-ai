import Link from "next/link"
import { Package, Plus } from "lucide-react"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { formatTHB } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ProductsToolbar } from "./_components/products-toolbar"
import { productSearchFilter } from "@/lib/products/search"

export const dynamic = "force-dynamic"

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function ProductsPage({ searchParams }: {
  searchParams: Promise<{ q?: string | string[]; status?: string | string[]; page?: string | string[] }>
}) {
  const ctx = await requireOrgContext()
  const params = await searchParams
  const search = (firstParam(params.q) ?? "").trim().slice(0, 200)
  const requestedStatus = firstParam(params.status)
  const status = requestedStatus === "archived" ? "archived" : requestedStatus === "all" ? "all" : "active"
  const requestedPage = Number(firstParam(params.page) ?? "1")
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 && Number.isSafeInteger(requestedPage * 50) ? requestedPage : 1
  const offset = (page - 1) * 50
  const supabase = await createClient()
  let query = supabase.from("products").select("id, sku, name, type, unit, list_price_satang, active")
    .eq("org_id", ctx.orgId).order("name").order("id").range(offset, offset + 50)
  if (status !== "all") query = query.eq("active", status === "active")
  if (search) query = query.or(productSearchFilter(search))
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const products = data.slice(0, 50)
  function pageHref(nextPage: number) {
    const query = new URLSearchParams({ status, page: String(nextPage) })
    if (search) query.set("q", search)
    return `/products?${query}`
  }
  return (
    <div className="space-y-6">
      <PageHeader title="Products" description="Products and services with reusable prices and units.">
        <Button variant="outline" render={<Link href="/import" />}>Import</Button>
        {can(ctx.role, "product:manage") && <Button render={<Link href="/products/new" />}><Plus /> New product</Button>}
      </PageHeader>
      <ProductsToolbar key={`${search}-${status}`} search={search} status={status} />
      {products.length === 0 ? <EmptyState icon={Package} title="No products found" description="Create a product or adjust your search and status filter." /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>SKU</TableHead><TableHead>Type</TableHead><TableHead>Unit</TableHead><TableHead className="text-right">Sales price</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
          <TableBody>{products.map(product => <TableRow key={product.id}>
            <TableCell><Link href={`/products/${product.id}`} className="font-medium hover:underline">{product.name}</Link></TableCell>
            <TableCell>{product.sku ?? "—"}</TableCell><TableCell>{product.type === "service" ? "Service" : "Goods"}</TableCell><TableCell>{product.unit}</TableCell>
            <TableCell className="text-right tabular-nums">{formatTHB(product.list_price_satang)}</TableCell><TableCell><Badge variant={product.active ? "secondary" : "outline"}>{product.active ? "Active" : "Archived"}</Badge></TableCell>
          </TableRow>)}</TableBody>
        </Table>
      )}
      <nav aria-label="Product pages" className="flex items-center gap-3">
        {page > 1 && <Button variant="outline" render={<Link href={pageHref(page - 1)} />}>Previous</Button>}
        <span className="text-sm text-muted-foreground">Page {page}</span>
        {data.length > 50 && <Button variant="outline" render={<Link href={pageHref(page + 1)} />}>Next</Button>}
      </nav>
    </div>
  )
}
