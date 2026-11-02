import Link from "next/link"
import { overdueVendorBillCount } from "@/lib/purchasing/queries"
import { expenseApprovalCount } from "@/lib/expenses/queries"
import { todayISO } from "@/lib/dates"
import { ActivityDue } from "@/components/record/activity-due"
import {
  Wallet,
  TrendingUp,
  Flame,
  Hourglass,
  Target,
  Repeat,
  FileWarning,
  Briefcase,
  CalendarClock,
  AlertTriangle,
  FileText,
  Clock,
  UserPlus,
  Package,
} from "lucide-react"

import { getDashboardData } from "@/lib/queries/dashboard"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { EmptyState } from "@/components/empty-state"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatTHB, formatTHBWhole } from "@/lib/money"

export const dynamic = "force-dynamic"

function runwayLabel(months: number | null): { value: string; hint: string; tone: "default" | "positive" | "warning" | "negative" } {
  if (months === null) return { value: "∞", hint: "Revenue ≥ burn this month", tone: "positive" }
  const rounded = months.toFixed(1)
  if (months < 6) return { value: `${rounded} mo`, hint: "Runway under 6 months", tone: "negative" }
  if (months < 12) return { value: `${rounded} mo`, hint: "Keep an eye on burn", tone: "warning" }
  return { value: `${rounded} mo`, hint: "Healthy runway", tone: "default" }
}

export default async function DashboardPage() {
  const [d, overdueBills, expenseApprovals] = await Promise.all([getDashboardData(), overdueVendorBillCount(), expenseApprovalCount()])
  const runway = runwayLabel(d.runwayMonths)
  const maxRevenue = Math.max(...d.revenueHistory.map((row) => row.revenueSatang))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Cash, pipeline, delivery, and what needs attention today."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          featured
          className="col-span-2"
          label="Cash on hand"
          value={formatTHBWhole(d.cashSatang)}
          icon={Wallet}
          hint="Manual balance · edit in Settings"
        />
        <StatCard
          label="Revenue this month"
          value={formatTHB(d.monthlyRevenueSatang)}
          icon={TrendingUp}
          tone="positive"
        />
        <StatCard
          label="Burn this month"
          value={formatTHB(d.monthlyBurnSatang)}
          icon={Flame}
          tone="negative"
          hint={`Operating costs · net burn ${formatTHB(d.netBurnSatang)}`}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard
          label="Cost of goods sold this month"
          value={formatTHB(d.monthlyCogsSatang)}
          icon={Package}
          hint="Delivered stock cost less customer returns"
        />
        <StatCard
          label="Runway"
          value={runway.value}
          icon={Hourglass}
          tone={runway.tone}
          hint={runway.hint}
        />
        <StatCard
          label="Open pipeline"
          value={formatTHBWhole(d.pipelineSatang)}
          icon={Target}
          hint={`Weighted ${formatTHBWhole(d.weightedPipelineSatang)}`}
        />
        <StatCard
          label="Open quotes"
          value={formatTHBWhole(d.openQuotesValueSatang)}
          icon={FileText}
          hint={`${d.openQuotesCount} open quote${d.openQuotesCount === 1 ? "" : "s"}`}
        />
        <StatCard
          label="MRR"
          value={formatTHB(d.mrrSatang)}
          icon={Repeat}
          hint="Active subscriptions / month"
        />
        <StatCard
          label="Billable hours"
          value={`${d.billableHoursThisMonth.toFixed(1)} h`}
          icon={Clock}
          hint={`${Math.round(d.utilizationThisMonth * 100)}% utilization · this month`}
        />
        <StatCard
          label="Unpaid invoices"
          value={formatTHB(d.unpaidSatang)}
          icon={FileWarning}
          tone={d.overdueInvoiceCount > 0 ? "warning" : "default"}
          hint={`${d.unpaidInvoiceCount} open · ${d.overdueInvoiceCount} overdue`}
        />
        <StatCard
          label="Active projects"
          value={String(d.activeProjectCount)}
          icon={Briefcase}
          hint="In delivery or support"
        />
        <StatCard
          label="New clients this month"
          value={String(d.newClientsThisMonth)}
          icon={UserPlus}
          hint="Added since the 1st (Bangkok time)"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle id="revenue-history-title">รายได้ 6 เดือนล่าสุด</CardTitle>
          <CardDescription>
            ยอดรับชำระที่ยืนยันแล้ว รวมเดือนปัจจุบัน · เวลาไทย (Asia/Bangkok)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <figure
            aria-labelledby="revenue-history-title"
            tabIndex={0}
            className="min-w-0 overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-4">
              {d.revenueHistory.map(({ month, revenueSatang }) => (
                <li key={month} className="space-y-2 text-center">
                  <div className="text-xs font-medium tabular-nums sm:text-sm">
                    {formatTHB(revenueSatang)}
                  </div>
                  <div aria-hidden="true" className="flex h-40 items-end justify-center border-b">
                    <div
                      className="w-full max-w-16 rounded-t bg-primary"
                      style={{ height: `${maxRevenue > 0 ? (revenueSatang / maxRevenue) * 100 : 0}%` }}
                    />
                  </div>
                  <time dateTime={month} className="text-muted-foreground text-xs">
                    {month}
                  </time>
                </li>
              ))}
            </ol>
          </figure>
          {maxRevenue === 0 && (
            <p className="text-muted-foreground mt-4 text-sm">ยังไม่มีรายได้ในช่วง 6 เดือนนี้</p>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4" /> Follow-ups due today
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.followUpsDueToday.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="Nothing due today"
                description="You're all caught up on follow-ups."
                className="border-0 p-6"
              />
            ) : (
              <ul className="divide-y">
                {d.followUpsDueToday.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <Badge variant="outline" className="shrink-0 capitalize">
                      {f.type.replace("_", " ")}
                    </Badge>
                    <span className="truncate">{f.body ?? "Follow up"}</span>
                    <ActivityDue dueDate={f.due_date} today={todayISO()} />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4" /> Needs attention
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span>Overdue invoices</span>
              <Badge variant={d.overdueInvoiceCount > 0 ? "destructive" : "secondary"}>
                {d.overdueInvoiceCount}
              </Badge>
            </div>
            <Link href="/finance?tab=costs" prefetch={false} className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span>Overdue vendor bills</span>
              <Badge variant={overdueBills > 0 ? "destructive" : "secondary"}>{overdueBills}</Badge>
            </Link>
            {expenseApprovals !== null && <Link href="/expenses?tab=approve" prefetch={false} className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span>Expense claims to approve</span>
              <Badge variant={expenseApprovals > 0 ? "default" : "secondary"}>{expenseApprovals}</Badge>
            </Link>}
            <div className="rounded-md border">
              <div className="border-b px-3 py-2 text-sm font-medium">
                Overdue follow-ups ({d.overdueFollowUps.length})
              </div>
              {d.overdueFollowUps.length === 0 ? (
                <p className="text-muted-foreground px-3 py-3 text-sm">None — nice work.</p>
              ) : (
                <ul className="divide-y">
                  {d.overdueFollowUps.slice(0, 5).map((f) => (
                    <li key={f.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      <Badge variant="outline" className="shrink-0 capitalize">
                        {f.type.replace("_", " ")}
                      </Badge>
                      <span className="truncate">{f.body ?? "Follow up"}</span>
                      <ActivityDue dueDate={f.due_date} today={todayISO()} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
