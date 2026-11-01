import Link from "next/link"

import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import { ACCOUNTANT_PACK_DISCLAIMER_EN, ACCOUNTANT_PACK_DISCLAIMER_TH, VENDOR_WHT_NOTE, accountantPackMonth, canDownloadAccountantPack, previousCalendarMonth, type VatSupportLine } from "@/lib/finance/accountant-pack"
import { loadAccountantPack } from "@/lib/finance/accountant-pack-load"
import { formatTHB } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { FilingResponsibility } from "@/components/finance/filing-responsibility"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export const dynamic = "force-dynamic"

export default async function AccountantPackPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireOrgContext()
  if (!canDownloadAccountantPack(ctx.role)) {
    return (
      <div className="space-y-4">
        <PageHeader
          title="ชุดข้อมูลนักบัญชี / Accountant pack"
          description="Support data for an external accountant."
          breadcrumbs={[{ label: "Reports", href: "/reports" }]}
        />
        <FilingResponsibility />
        <p>เจ้าของ ผู้ดูแล และนักบัญชีเท่านั้นที่ดาวน์โหลดชุดนี้ได้ / Only an owner, an admin, or an accountant can download this pack.</p>
      </div>
    )
  }
  const requested = (await searchParams).month?.trim() ?? ""
  const month = requested || previousCalendarMonth(todayISO()) || todayISO().slice(0, 7)
  const parsed = accountantPackMonth(month)
  return (
    <div className="space-y-6">
      <PageHeader
        title="ชุดข้อมูลนักบัญชี / Accountant pack"
        description="ข้อมูลประกอบสำหรับนักบัญชีภายนอก ไม่ใช่การยื่นแบบ ภ.พ.30 / Support data for your external accountant. This does not file ภ.พ.30."
        breadcrumbs={[{ label: "Reports", href: "/reports" }]}
      />
      <FilingResponsibility />
      <form className="flex flex-wrap items-end gap-3" method="get">
        <label className="text-sm">
          เดือน / Month
          <Input className="mt-1 w-44" type="month" name="month" defaultValue={parsed ? month : ""} />
        </label>
        <Button type="submit" variant="outline">Show</Button>
      </form>
      {parsed ? <PackResult month={parsed.month} /> : <p>Choose a month as YYYY-MM.</p>}
    </div>
  )
}

async function PackResult({ month }: { month: string }) {
  const loaded = await loadAccountantPack(month)
  if (!loaded.ok) return <p>{loaded.message}</p>
  const pack = loaded.pack
  return (
    <>
      <div className="rounded-lg border p-4 text-sm">
        <p>{ACCOUNTANT_PACK_DISCLAIMER_TH}</p>
        <p className="mt-2 text-muted-foreground">{ACCOUNTANT_PACK_DISCLAIMER_EN}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" render={<Link href={`/reports/accountant-pack/export?month=${month}`} />}>Download CSV</Button>
        <Button variant="outline" render={<a href={`/reports/accountant-pack/print?month=${month}`} target="_blank" rel="noopener" />}>Print / PDF</Button>
      </div>
      <p className="text-sm text-muted-foreground">{pack.orgName} · {pack.month} ({pack.buddhistMonth}). Purchase VAT by month stays on <Link className="underline" href="/reports#purchase-vat">Reports</Link>.</p>
      <Card>
        <CardHeader><CardTitle>ภาษีขาย / Output VAT</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Issued invoices minus credit notes in this month. One row per document, using the VAT stored on that document.</p>
          <p className="text-sm">Base {formatTHB(pack.outputBaseSatang)} · VAT {formatTHB(pack.outputVatSatang)}</p>
          <LineTable rows={pack.outputLines} empty="No issued invoices or credit notes in this month." />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>ภาษีซื้อ / Input VAT</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">Matched vendor bills already on the purchase VAT table. Linked credit notes reduce the total. Unmatched costs are left out.</p>
          <p className="text-sm">Base {formatTHB(pack.inputBaseSatang)} · VAT {formatTHB(pack.inputVatSatang)}</p>
          <LineTable rows={pack.inputLines} empty="No matched vendor bills in this month." />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>ผลต่าง / Output minus input</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <p>{formatTHB(pack.outputMinusInputVatSatang)}</p>
          <p className="text-sm text-muted-foreground">Support difference only. Not tax payable and not a ภ.พ.30 filing.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>หัก ณ ที่จ่าย / Stored withholding</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">{VENDOR_WHT_NOTE}</p>
          {pack.whtParties.length === 0 ? <p className="text-sm text-muted-foreground">No stored withholding in this month.</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Tax ID</TableHead>
                  <TableHead className="text-right">Base</TableHead>
                  <TableHead className="text-right">WHT</TableHead>
                  <TableHead className="text-right">Documents</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pack.whtParties.map((row) => (
                  <TableRow key={row.partyId}>
                    <TableCell>{row.partyName}</TableCell>
                    <TableCell>{row.taxId ?? ""}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTHB(row.baseSatang)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatTHB(row.whtSatang)}</TableCell>
                    <TableCell className="text-right tabular-nums">{row.documentCount}</TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell />
                  <TableCell />
                  <TableCell className="text-right font-semibold tabular-nums">{formatTHB(pack.whtSatang)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}

function LineTable({ rows, empty }: { rows: readonly VatSupportLine[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Date</TableHead>
          <TableHead>Document</TableHead>
          <TableHead>Number</TableHead>
          <TableHead>Party</TableHead>
          <TableHead>Tax ID</TableHead>
          <TableHead className="text-right">Base</TableHead>
          <TableHead className="text-right">VAT</TableHead>
          <TableHead className="text-right">WHT</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{row.date}</TableCell>
            <TableCell>{row.kind}</TableCell>
            <TableCell>{row.number}</TableCell>
            <TableCell>{row.partyName}</TableCell>
            <TableCell>{row.taxId ?? ""}</TableCell>
            <TableCell className="text-right tabular-nums">{formatTHB(row.baseSatang)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatTHB(row.vatSatang)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatTHB(row.whtSatang)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
