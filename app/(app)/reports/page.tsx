import { ReportChart } from "./_components/report-chart"
import type { SearchParams } from "@/lib/search-facets"
import Link from "next/link"
import { TrendingUp, Timer, Printer, BarChart3, Clock, Package } from "lucide-react"

import { formatTHB } from "@/lib/money"
import { getReportData } from "./_data"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
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

export const dynamic = "force-dynamic"

/** Hours with two decimals, e.g. 3.5 → "3.50". */
function fmtHours(hours: number): string {
  return hours.toFixed(2)
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> } = { searchParams: Promise.resolve({}) }) {
  const params = await searchParams
  const view = params.view === "line" || params.view === "pivot" ? params.view : "bar"
  const { months, rangeLabel, revenue, hours, totalRevenueSatang, cogsByMonth, totalCogsSatang, purchaseVatByMonth } =
    await getReportData()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={`Operational reports · ${rangeLabel}`}
      >
        <Button variant="outline" render={<Link href="/reports/statements" />}>Statements</Button>
        <Button
          variant="outline"
          render={
            <Link href="/reports/print" target="_blank" rel="noopener" />
          }
        >
          <Printer /> Print / PDF
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Cost of goods sold"
          value={formatTHB(totalCogsSatang)}
          icon={Package}
          hint="Delivered stock cost less customer returns"
        />
        <StatCard
          label="Revenue before VAT"
          value={formatTHB(totalRevenueSatang)}
          icon={TrendingUp}
          tone="positive"
          hint="Issued invoices in range · Issue month"
        />
        <StatCard
          label="Billable hours"
          value={fmtHours(hours.billableHours)}
          icon={Timer}
          hint="Logged & billable in range"
        />
        <StatCard
          label="Total hours"
          value={fmtHours(hours.totalHours)}
          icon={Clock}
          hint="All time logged in range"
        />
      </div>

      <nav aria-label="Report view" className="flex flex-wrap gap-2">
        {(["bar", "line", "pivot"] as const).map((value) => <Button key={value} variant={view === value ? "secondary" : "outline"}
          render={<Link href={`/reports?view=${value}`} />} aria-current={view === value ? "page" : undefined}>
          {value === "pivot" ? "Pivot / table" : value === "bar" ? "Bar chart" : "Line chart"}
        </Button>)}
      </nav>

      <Card>
        <CardHeader><CardTitle>Cost of goods sold by month</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader><TableRow><TableHead>Month</TableHead><TableHead className="text-right">Cost of goods sold</TableHead></TableRow></TableHeader>
            <TableBody>
              {cogsByMonth.map((row) => <TableRow key={row.month}>
                <TableCell>{row.month}</TableCell><TableCell className="text-right tabular-nums">{formatTHB(row.amount_satang)}</TableCell>
              </TableRow>)}
              <TableRow><TableCell className="font-semibold">Total</TableCell><TableCell className="text-right font-semibold tabular-nums">{formatTHB(totalCogsSatang)}</TableCell></TableRow>
            </TableBody>
          </Table>
          <p className="text-sm text-muted-foreground mt-3">Delivery costs less customer returns, grouped by Bangkok month. Inventory bills are excluded from operating costs.</p>
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle><h2>Purchase VAT by month</h2></CardTitle></CardHeader><CardContent>
        <p className="mb-3 text-sm text-muted-foreground">Matched vendor invoices and linked credit notes by bill month, including inventory purchases. Credit notes reduce the totals. Operational report only.</p>
        <Table><TableHeader><TableRow><TableHead>Month</TableHead><TableHead>Purchase base</TableHead><TableHead>Input VAT</TableHead><TableHead>Vendor total</TableHead></TableRow></TableHeader>
          <TableBody>{purchaseVatByMonth.map(row => <TableRow key={row.month}><TableCell>{row.month}</TableCell><TableCell>{formatTHB(row.base_satang)}</TableCell><TableCell>{formatTHB(row.input_vat_satang)}</TableCell><TableCell>{formatTHB(row.total_satang)}</TableCell></TableRow>)}</TableBody>
        </Table>
      </CardContent></Card>

      {view !== "pivot" ? <div className="space-y-6">
        <Card><CardHeader><CardTitle>Revenue by month</CardTitle></CardHeader><CardContent>
          <ReportChart title="Revenue by month" unit="satang" kind={view} rows={months.map((month) => ({ label: month, value: revenue.colTotal(month) }))} />
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Revenue by client</CardTitle></CardHeader><CardContent>
          <ReportChart title="Revenue by client" unit="satang" kind={view} rows={revenue.rowKeys.map((client) => ({ label: client, value: revenue.rowTotal(client) }))} />
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Hours by project</CardTitle></CardHeader><CardContent>
          <ReportChart title="Hours by project" unit="hours" kind={view} rows={hours.projects.map((project) => ({ label: project.project_name, value: project.totalHours }))} />
        </CardContent></Card>
        <p className="text-sm text-muted-foreground">Revenue is issued invoice value before VAT, grouped by issue month. Pivot / table shows the underlying totals.</p>
      </div> : <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue by client × month</CardTitle>
        </CardHeader>
        <CardContent>
          {revenue.rowKeys.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No issued invoices in range"
              description="Issued revenue before VAT appears here by client and issue month."
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  {months.map((m) => (
                    <TableHead key={m} className="text-right">
                      {m}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revenue.rowKeys.map((client) => (
                  <TableRow key={client}>
                    <TableCell className="font-medium">{client}</TableCell>
                    {months.map((m) => (
                      <TableCell
                        key={m}
                        className="text-right tabular-nums"
                      >
                        {formatTHB(revenue.cell(client, m))}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatTHB(revenue.rowTotal(client))}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell className="font-semibold">Total</TableCell>
                  {months.map((m) => (
                    <TableCell
                      key={m}
                      className="text-right font-semibold tabular-nums"
                    >
                      {formatTHB(revenue.colTotal(m))}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatTHB(revenue.grandTotal)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hours by project</CardTitle>
        </CardHeader>
        <CardContent>
          {hours.projects.length === 0 ? (
            <EmptyState
              icon={Timer}
              title="No time logged in range"
              description="Logged time entries will roll up here by project."
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Total hours</TableHead>
                  <TableHead className="text-right">Billable hours</TableHead>
                  <TableHead className="text-right">Non-billable</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hours.projects.map((p) => (
                  <TableRow key={p.project_name}>
                    <TableCell className="font-medium">
                      {p.project_name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtHours(p.totalHours)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtHours(p.billableHours)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtHours(p.totalHours - p.billableHours)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {fmtHours(hours.totalHours)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {fmtHours(hours.billableHours)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {fmtHours(hours.totalHours - hours.billableHours)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
      </>}
    </div>
  )
}
