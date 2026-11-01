import { SearchFacets } from "@/components/search/search-facets"
import { GroupedTableRows } from "@/components/search/grouped-table-rows"
import { parseFacets, matchesFacets, type SearchParams } from "@/lib/search-facets"
import { getFacetSavedViews } from "@/lib/queries/saved-views"
import { monthKey } from "@/lib/dates"
import Link from "next/link"
import { Users, Plus } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { readAll } from "@/lib/supabase/read-all"
import { requireOrgContext } from "@/lib/auth"
import { OPEN_STAGES } from "@/lib/metrics/pipeline"
import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatDate } from "./_lib/format"

export const dynamic = "force-dynamic"

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const config = parseFacets(await searchParams, "clients")
  const now = new Date()
  const savedViews = await getFacetSavedViews("clients")

  const pattern = config.q ? `%${config.q.replace(/[\\%_(),.":]/g, "\\$&")}%` : undefined
  const { data, error } = await readAll((from, to) => {
    const query = supabase
      .from("clients")
      .select("id, name, industry, source, created_at, owner, deals(count)")
      .eq("org_id", ctx.orgId)
      .in("deals.stage", OPEN_STAGES)
      .order("name", { ascending: true }).order("id")
      .range(from, to)
    return pattern ? query.ilike("name", pattern) : query
  })
  if (error) throw new Error("Clients unavailable. Please reload.")
  const clients = (data ?? []).filter((c) => matchesFacets(config, {
    text: c.name, date: c.created_at, owner: c.owner,
  }, ctx.userId, now))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Everyone you work with, and who to talk to."
      >
        <Button variant="outline" render={<Link href="/import" />}>Import</Button>
        <Button render={<Link href="/clients/new" />}>
          <Plus />
          New client
        </Button>
      </PageHeader>

      <SearchFacets list="clients" config={config} savedViews={savedViews} />

      {clients.length === 0 ? (
        Object.keys(config).length ? (
          <EmptyState
            icon={Users}
            title="No matching clients"
            description="No clients match the selected search and filters."
          />
        ) : (
          <EmptyState
            icon={Users}
            title="No clients yet"
            description="Add your first client to start tracking contacts, deals, and work."
            action={
              <Button render={<Link href="/clients/new" />}>
                <Plus />
                New client
              </Button>
            }
          />
        )
      ) : (
        <div className="rounded-xl ring-1 ring-foreground/10">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Industry</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="text-right">Open deals</TableHead>
                <TableHead className="text-right">Added</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <GroupedTableRows rows={clients} colSpan={5}
                group={config.groupBy ? (c) => {
                  const value = config.groupBy === "month" ? monthKey(c.created_at)
                    : config.groupBy === "industry" ? c.industry : c.source
                  return { key: value === null ? "missing" : `value:${value}`, label: value ?? "Unassigned" }
                } : undefined}>
              {(c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link
                      href={`/clients/${c.id}`}
                      className="hover:underline"
                    >
                      {c.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.industry ?? "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {c.source ?? "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {c.deals[0]?.count ?? 0}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-right">
                    {formatDate(c.created_at)}
                  </TableCell>
                </TableRow>
              )}</GroupedTableRows>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
