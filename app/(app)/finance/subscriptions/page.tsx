import Link from "next/link"
import { ArrowLeft, Repeat, Plus } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { formatTHB } from "@/lib/money"
import type { Enums } from "@/lib/types/database"

import { PageHeader } from "@/components/page-header"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

import { SubscriptionStatusBadge } from "../_components/subscription-status-badge"

export const dynamic = "force-dynamic"

const INTERVAL_LABEL: Record<Enums<"recurring_interval">, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
}

export default async function SubscriptionsPage() {
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const { data: subs } = await supabase
    .from("subscriptions")
    .select(
      "id, name, amount_satang, interval, status, next_run_date, clients(name)"
    )
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })

  const subscriptions = subs ?? []

  return (
    <div className="space-y-6">
      <PageHeader
        title="Subscriptions"
        description="Recurring invoices."
        breadcrumbs={[{ label: "Finance", href: "/finance" }]}
      >
        <Button variant="outline" render={<Link href="/finance" />}>
          <ArrowLeft /> Back
        </Button>
        <Button render={<Link href="/finance/subscriptions/new" />}>
          <Plus /> New subscription
        </Button>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">All subscriptions</CardTitle>
          <p className="text-muted-foreground text-sm">
            Active subscriptions feed the MRR metric on the Finance dashboard.
          </p>
        </CardHeader>
        <CardContent>
          {subscriptions.length === 0 ? (
            <EmptyState
              icon={Repeat}
              title="No subscriptions yet"
              description="Create a subscription to bill a client automatically on a recurring schedule."
              action={
                <Button render={<Link href="/finance/subscriptions/new" />}>
                  <Plus /> New subscription
                </Button>
              }
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Client</TableHead>
                  <TableHead>Interval</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Next run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {subscriptions.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">
                      <Link
                        href={`/finance/subscriptions/${s.id}`}
                        className="hover:underline"
                      >
                        {s.name}
                      </Link>
                    </TableCell>
                    <TableCell>{s.clients?.name ?? "—"}</TableCell>
                    <TableCell>{INTERVAL_LABEL[s.interval]}</TableCell>
                    <TableCell>
                      <SubscriptionStatusBadge status={s.status} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatTHB(s.amount_satang)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {s.next_run_date}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
