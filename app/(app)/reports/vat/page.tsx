import Link from "next/link"

import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import { accountantPackMonth, canDownloadAccountantPack, previousCalendarMonth } from "@/lib/finance/accountant-pack"
import { loadAccountantPack } from "@/lib/finance/accountant-pack-load"
import { buildVatReport, vatRowLabel, VAT_REPORT_DISCLAIMER_EN, VAT_REPORT_DISCLAIMER_TH, type VatReportRow } from "@/lib/finance/vat-report"
import { readLang } from "@/lib/lang"
import { formatTHB } from "@/lib/money"
import { Bi } from "@/components/bi"
import { LangScope } from "@/components/lang-scope"
import { PrintButton } from "@/components/print-button"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export const dynamic = "force-dynamic"

export default async function VatReportPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const ctx = await requireOrgContext()
  const lang = await readLang()
  const header = (
    <PageHeader
      title={<Bi th="รายงานภาษีมูลค่าเพิ่ม (ข้อมูลประกอบ ภ.พ.30)" en="VAT report (ภ.พ.30 support)" />}
      description={<Bi th="สรุปรายเดือนจากเอกสารที่บันทึกไว้ ไม่ใช่การยื่นแบบ" en="Monthly totals from stored documents. Not a filing." />}
      breadcrumbs={[{ label: "Reports", href: "/reports" }]}
    />
  )
  if (!canDownloadAccountantPack(ctx.role)) {
    return (
      <LangScope initial={lang}>
        {header}
        <p><Bi th="เจ้าของ ผู้ดูแล และนักบัญชีเท่านั้นที่เปิดรายงานนี้ได้" en="Only an owner, an admin, or an accountant can open this report." /></p>
      </LangScope>
    )
  }
  const requested = (await searchParams).month?.trim() ?? ""
  const month = requested || previousCalendarMonth(todayISO()) || todayISO().slice(0, 7)
  const parsed = accountantPackMonth(month)
  return (
    <LangScope initial={lang}>
      {header}
      <form className="flex flex-wrap items-end gap-3 print:hidden" method="get">
        <label className="text-sm">
          <Bi th="เดือน" en="Month" />
          <Input className="mt-1 w-44" type="month" name="month" defaultValue={parsed ? month : ""} />
        </label>
        <Button type="submit" variant="outline"><Bi th="แสดง" en="Show" /></Button>
      </form>
      {parsed ? <VatResult month={parsed.month} /> : <p><Bi th="เลือกเดือนเป็น YYYY-MM" en="Choose a month as YYYY-MM." /></p>}
    </LangScope>
  )
}

async function VatResult({ month }: { month: string }) {
  const loaded = await loadAccountantPack(month)
  if (!loaded.ok) return <p>{loaded.message}</p>
  const report = buildVatReport(loaded.pack)
  return (
    <>
      <div className="rounded-lg border p-4 text-sm" role="note">
        <p><Bi th={VAT_REPORT_DISCLAIMER_TH} en={VAT_REPORT_DISCLAIMER_EN} /></p>
      </div>
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="outline" render={<a href={`/reports/vat/export?month=${month}`} />}><Bi th="ดาวน์โหลด CSV (พร้อม checksum)" en="Download CSV (with checksum)" /></Button>
        <Button variant="outline" render={<Link href={`/reports/wht?month=${month}`} />}><Bi th="รายการหัก ณ ที่จ่าย" en="Withholding lists" /></Button>
        <Button variant="outline" render={<Link href={`/reports/accountant-pack?month=${month}`} />}><Bi th="ชุดข้อมูลนักบัญชี" en="Accountant pack" /></Button>
      </div>
      <p className="text-sm text-muted-foreground">{report.orgName} · {report.month}</p>
      <Card>
        <CardHeader><CardTitle><Bi th="ภาษีขาย" en="Output VAT" /></CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm"><Bi th="ฐานภาษี" en="Base" /> {formatTHB(report.outputBaseSatang)} · <Bi th="ภาษีมูลค่าเพิ่ม" en="VAT" /> {formatTHB(report.outputVatSatang)}</p>
          <p className="text-sm text-muted-foreground"><Bi th="ใบกำกับภาษีอย่างย่อ (ABB) รวมเป็นหนึ่งแถวต่อวัน" en="Abbreviated tax invoices (ABB) are rolled into one row per day." /></p>
          <Rows rows={report.output} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle><Bi th="ภาษีซื้อ" en="Input VAT" /></CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm"><Bi th="ฐานภาษี" en="Base" /> {formatTHB(report.inputBaseSatang)} · <Bi th="ภาษีมูลค่าเพิ่ม" en="VAT" /> {formatTHB(report.inputVatSatang)}</p>
          <Rows rows={report.input} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle><Bi th="ผลต่างภาษีขายกับภาษีซื้อ" en="Output minus input" /></CardTitle></CardHeader>
        <CardContent className="space-y-1">
          <p className="text-lg font-medium">{formatTHB(report.netVatSatang)}</p>
          <p className="text-sm text-muted-foreground"><Bi th="ผลต่างนี้เป็นข้อมูลประกอบ ไม่ใช่ภาษีที่ต้องชำระ" en="Support difference only. Not tax payable." /></p>
        </CardContent>
      </Card>
      <PrintButton><Bi th="พิมพ์ / PDF" en="Print / PDF" /></PrintButton>
    </>
  )
}

function Rows({ rows }: { rows: VatReportRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-foreground"><Bi th="ไม่มีรายการในเดือนนี้" en="No rows in this month." /></p>
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead><Bi th="วันที่" en="Date" /></TableHead>
          <TableHead><Bi th="เอกสาร" en="Document" /></TableHead>
          <TableHead><Bi th="เลขที่" en="Number" /></TableHead>
          <TableHead><Bi th="คู่ค้า" en="Party" /></TableHead>
          <TableHead className="text-right"><Bi th="ฐานภาษี" en="Base" /></TableHead>
          <TableHead className="text-right"><Bi th="ภาษีมูลค่าเพิ่ม" en="VAT" /></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.kind}-${row.date}-${row.number}`}>
            <TableCell>{row.date}</TableCell>
            <TableCell>{vatRowLabel(row)}{row.documents > 1 ? ` ×${row.documents}` : ""}</TableCell>
            <TableCell>{row.number}</TableCell>
            <TableCell>{row.partyName}</TableCell>
            <TableCell className="text-right tabular-nums">{formatTHB(row.baseSatang)}</TableCell>
            <TableCell className="text-right tabular-nums">{formatTHB(row.vatSatang)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
