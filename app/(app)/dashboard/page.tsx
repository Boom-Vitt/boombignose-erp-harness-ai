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
import { PersonalAssistant } from "@/components/personal-ai"
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
    <div className="space-y-5">
      <PageHeader
        title="Dashboard"
        description="Cash, pipeline, delivery, and what needs attention today."
      />

      <PersonalAssistant />

      {/* Board: one tall cash sheet on the left, four key numbers pinned to its right. */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <StatCard
          featured
          className="lg:row-span-2"
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
      </div>

      {/* Tickets: the rest, one line each. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard compact label="Cost of goods sold" value={formatTHB(d.monthlyCogsSatang)} icon={Package} hint="Delivered stock less returns" />
        <StatCard compact label="Open quotes" value={formatTHBWhole(d.openQuotesValueSatang)} icon={FileText} hint={`${d.openQuotesCount} open quote${d.openQuotesCount === 1 ? "" : "s"}`} />
        <StatCard compact label="MRR" value={formatTHB(d.mrrSatang)} icon={Repeat} hint="Active subscriptions / month" />
        <StatCard compact label="Billable hours" value={`${d.billableHoursThisMonth.toFixed(1)} h`} icon={Clock} hint={`${Math.round(d.utilizationThisMonth * 100)}% utilization`} />
        <StatCard
          compact
          label="Unpaid invoices"
          value={formatTHB(d.unpaidSatang)}
          icon={FileWarning}
          tone={d.overdueInvoiceCount > 0 ? "warning" : "default"}
          hint={`${d.unpaidInvoiceCount} open · ${d.overdueInvoiceCount} overdue`}
        />
        <StatCard compact label="Active projects" value={String(d.activeProjectCount)} icon={Briefcase} hint="In delivery or support" />
        <StatCard compact label="New clients" value={String(d.newClientsThisMonth)} icon={UserPlus} hint="Since the 1st (Bangkok time)" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle id="revenue-history-title" className="flex items-center gap-2">
              <TrendingUp className="text-primary size-4" aria-hidden />
              รายได้ 6 เดือนล่าสุด
            </CardTitle>
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
              <ol className="grid grid-cols-3 gap-2 sm:grid-cols-6 sm:gap-3">
                {d.revenueHistory.map(({ month, revenueSatang }) => (
                  <li key={month} className="space-y-2 text-center">
                    <div className="text-xs font-medium tabular-nums sm:text-sm">
                      {formatTHB(revenueSatang)}
                    </div>
                    <div aria-hidden="true" className="bbn-ruled flex h-44 items-end justify-center border-b">
                      <div
                        className="bbn-hatch w-full max-w-14"
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="text-primary size-4" aria-hidden /> Needs attention
            </CardTitle>
          </CardHeader>
          <CardContent className="bbn-ledger space-y-0 [&>*]:py-3 [&>*:first-child]:pt-0">
            <div className="flex items-center justify-between text-sm">
              <span>Overdue invoices</span>
              <Badge variant={d.overdueInvoiceCount > 0 ? "destructive" : "secondary"}>
                {d.overdueInvoiceCount}
              </Badge>
            </div>
            <Link href="/finance?tab=costs" prefetch={false} className="hover:text-primary flex items-center justify-between text-sm">
              <span>Overdue vendor bills</span>
              <Badge variant={overdueBills > 0 ? "destructive" : "secondary"}>{overdueBills}</Badge>
            </Link>
            {expenseApprovals !== null && <Link href="/expenses?tab=approve" prefetch={false} className="hover:text-primary flex items-center justify-between text-sm">
              <span>Expense claims to approve</span>
              <Badge variant={expenseApprovals > 0 ? "default" : "secondary"}>{expenseApprovals}</Badge>
            </Link>}
            <div>
              <div className="pb-2 text-sm font-medium">
                Overdue follow-ups ({d.overdueFollowUps.length})
              </div>
              {d.overdueFollowUps.length === 0 ? (
                <p className="text-muted-foreground text-sm">None — nice work.</p>
              ) : (
                <ul className="space-y-2">
                  {d.overdueFollowUps.slice(0, 5).map((f) => (
                    <li key={f.id} className="flex items-center gap-3 text-sm">
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="text-primary size-4" aria-hidden /> Follow-ups due today
          </CardTitle>
        </CardHeader>
        <CardContent>
          {d.followUpsDueToday.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Nothing due today"
              description="You're all caught up on follow-ups."
              className="border-0 bg-transparent p-4"
            />
          ) : (
            <ul className="bbn-ledger">
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
    </div>
  )
}
