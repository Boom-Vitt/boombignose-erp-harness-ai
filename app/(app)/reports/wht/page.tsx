import Link from "next/link"

import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import { accountantPackMonth, canDownloadAccountantPack, previousCalendarMonth } from "@/lib/finance/accountant-pack"
import { loadAccountantPack } from "@/lib/finance/accountant-pack-load"
import { buildWhtReport, WHT_FORM_LABEL, WHT_FORMS, WHT_INCOME_LABEL, WHT_REPORT_DISCLAIMER_EN, WHT_REPORT_DISCLAIMER_TH } from "@/lib/finance/wht-report"
import { readLang } from "@/lib/lang"
import { formatTHB } from "@/lib/money"
import { readAll } from "@/lib/supabase/read-all"
import { createClient } from "@/lib/supabase/server"
import { Bi } from "@/components/bi"
import { LangScope } from "@/components/lang-scope"
import { PageHeader } from "@/components/page-header"
import { PrintButton } from "@/components/print-button"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { recordPurchaseWithholding } from "./actions"

export const dynamic = "force-dynamic"

type Search = { month?: string; error?: string; saved?: string }

export default async function WhtReportPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requireOrgContext()
  const lang = await readLang()
  const header = (
    <PageHeader
      title={<Bi th="รายการหัก ณ ที่จ่าย (ข้อมูลประกอบ ภ.ง.ด.3 / 53)" en="Withholding lists (ภ.ง.ด.3 / 53 support)" />}
      description={<Bi th="ภาษีที่หักตอนจ่ายเงินผู้ขาย ไม่ใช่การยื่นแบบและไม่ใช่ 50 ทวิ ที่ลงนามแล้ว" en="Tax deducted when paying vendors. Not a filing and not a signed 50 ทวิ." />}
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
  const query = await searchParams
  const month = query.month?.trim() || previousCalendarMonth(todayISO()) || todayISO().slice(0, 7)
  const parsed = accountantPackMonth(month)
  return (
    <LangScope initial={lang}>
      {header}
      <form className="flex flex-wrap items-end gap-3 print:hidden" method="get">
        <label className="text-sm">
          <Bi th="เดือนที่จ่ายเงิน" en="Payment month" />
          <Input className="mt-1 w-44" type="month" name="month" defaultValue={parsed ? month : ""} />
        </label>
        <Button type="submit" variant="outline"><Bi th="แสดง" en="Show" /></Button>
      </form>
      {query.error ? <p role="alert" className="rounded-lg border border-destructive p-3 text-sm text-destructive">{query.error}</p> : null}
      {query.saved ? <p role="status" className="rounded-lg border p-3 text-sm"><Bi th="บันทึกการหัก ณ ที่จ่ายแล้ว" en="Withholding recorded." /></p> : null}
      {parsed ? <WhtResult month={parsed.month} canRecord={ctx.role === "owner" || ctx.role === "admin"} orgId={ctx.orgId} /> : <p><Bi th="เลือกเดือนเป็น YYYY-MM" en="Choose a month as YYYY-MM." /></p>}
    </LangScope>
  )
}

async function WhtResult({ month, canRecord, orgId }: { month: string; canRecord: boolean; orgId: string }) {
  const loaded = await loadAccountantPack(month)
  if (!loaded.ok) return <p>{loaded.message}</p>
  const report = buildWhtReport(loaded.pack)
  return (
    <>
      <div className="rounded-lg border p-4 text-sm" role="note">
        <p><Bi th={WHT_REPORT_DISCLAIMER_TH} en={WHT_REPORT_DISCLAIMER_EN} /></p>
      </div>
      <div className="flex flex-wrap gap-2 print:hidden">
        <Button variant="outline" render={<a href={`/reports/wht/export?month=${month}`} />}><Bi th="ดาวน์โหลด CSV ทั้งหมด (พร้อม checksum)" en="Download all as CSV (with checksum)" /></Button>
        {WHT_FORMS.map((form) => (
          <Button key={form} variant="outline" render={<a href={`/reports/wht/export?month=${month}&form=${form}`} />}>
            <Bi th={`CSV ${WHT_FORM_LABEL[form].th}`} en={`CSV ${WHT_FORM_LABEL[form].en}`} />
          </Button>
        ))}
        <Button variant="outline" render={<Link href={`/reports/vat?month=${month}`} />}><Bi th="รายงานภาษีมูลค่าเพิ่ม" en="VAT report" /></Button>
      </div>
      <p className="text-sm"><Bi th="รวมภาษีที่หักจากผู้ขาย" en="Total withheld on purchases" /> {formatTHB(report.whtSatang)} · {report.orgName} · {report.month}</p>
      {report.lists.map((list) => (
        <Card key={list.form}>
          <CardHeader><CardTitle><Bi th={WHT_FORM_LABEL[list.form].th} en={WHT_FORM_LABEL[list.form].en} /></CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm"><Bi th="ฐานเงินได้" en="Income base" /> {formatTHB(list.baseSatang)} · <Bi th="ภาษีที่หัก" en="Withheld" /> {formatTHB(list.whtSatang)}</p>
            {list.missingTaxId > 0 ? (
              <p className="text-sm text-destructive"><Bi th={`${list.missingTaxId} แถวไม่มีเลขผู้เสียภาษีของผู้รับเงิน กรุณาเพิ่มก่อนส่งนักบัญชี`} en={`${list.missingTaxId} rows have no payee tax ID. Add it before handing to your accountant.`} /></p>
            ) : null}
            {list.rows.length === 0 ? (
              <p className="text-sm text-muted-foreground"><Bi th="ไม่มีรายการในเดือนนี้" en="No rows in this month." /></p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead><Bi th="เลขที่ WHT" en="WHT number" /></TableHead>
                    <TableHead><Bi th="วันที่จ่าย" en="Paid on" /></TableHead>
                    <TableHead><Bi th="ผู้รับเงิน" en="Payee" /></TableHead>
                    <TableHead><Bi th="เลขผู้เสียภาษี" en="Tax ID" /></TableHead>
                    <TableHead><Bi th="ประเภทเงินได้" en="Income type" /></TableHead>
                    <TableHead className="text-right"><Bi th="อัตรา" en="Rate" /></TableHead>
                    <TableHead className="text-right"><Bi th="ฐาน" en="Base" /></TableHead>
                    <TableHead className="text-right"><Bi th="ภาษีที่หัก" en="Withheld" /></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.certificateNo}</TableCell>
                      <TableCell>{row.paidOn}</TableCell>
                      <TableCell>{row.vendorName}</TableCell>
                      <TableCell>{row.vendorTaxId ?? "—"}</TableCell>
                      <TableCell><Bi th={WHT_INCOME_LABEL[row.incomeType]?.th ?? row.incomeType} en={WHT_INCOME_LABEL[row.incomeType]?.en ?? row.incomeType} /></TableCell>
                      <TableCell className="text-right tabular-nums">{row.rateBps / 100}%</TableCell>
                      <TableCell className="text-right tabular-nums">{formatTHB(row.baseSatang)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatTHB(row.whtSatang)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ))}
      {canRecord ? <RecordForm month={month} orgId={orgId} /> : null}
      <PrintButton><Bi th="พิมพ์ / PDF" en="Print / PDF" /></PrintButton>
    </>
  )
}

/** Costs paid in the month that carry no withholding record yet. */
async function RecordForm({ month, orgId }: { month: string; orgId: string }) {
  const span = accountantPackMonth(month)!
  const supabase = await createClient()
  const [costs, done] = await Promise.all([
    readAll((from, to) => supabase.from("costs").select("id, vendor, bill_number, amount_satang, input_vat_satang, incurred_on")
      .eq("org_id", orgId).gt("amount_satang", 0).gte("incurred_on", span.from).lt("incurred_on", span.toExclusive).order("id").range(from, to)),
    readAll((from, to) => supabase.from("purchase_withholdings").select("id, cost_id").eq("org_id", orgId).order("id").range(from, to)),
  ])
  if (costs.error || done.error) return <p><Bi th="โหลดรายการค่าใช้จ่ายไม่สำเร็จ" en="Could not load costs." /></p>
  const taken = new Set((done.data ?? []).map((row) => row.cost_id))
  const open = (costs.data ?? []).filter((row) => !taken.has(row.id)).slice(0, 200)
  return (
    <Card className="print:hidden">
      <CardHeader><CardTitle><Bi th="บันทึกการหัก ณ ที่จ่ายจากรายจ่าย" en="Record withholding on a cost" /></CardTitle></CardHeader>
      <CardContent>
        {open.length === 0 ? (
          <p className="text-sm text-muted-foreground"><Bi th="ไม่มีรายจ่ายที่ยังไม่บันทึกการหักภาษีในเดือนนี้" en="No costs in this month are waiting for a withholding record." /></p>
        ) : (
          <form action={recordPurchaseWithholding} className="grid max-w-xl gap-3 text-sm">
            <input type="hidden" name="month" value={month} />
            <label>
              <Bi th="รายจ่าย" en="Cost" />
              <select name="cost_id" required className="mt-1 w-full rounded-md border bg-background p-2">
                {open.map((row) => (
                  <option key={row.id} value={row.id}>{row.incurred_on} · {row.vendor || row.bill_number || row.id.slice(0, 8)} · {formatTHB(row.amount_satang - row.input_vat_satang)}</option>
                ))}
              </select>
            </label>
            <label>
              <Bi th="วันที่จ่ายเงิน" en="Paid on" />
              <Input className="mt-1" type="date" name="paid_on" required defaultValue={span.from} />
            </label>
            <label>
              <Bi th="แบบ" en="Form" />
              <select name="form" className="mt-1 w-full rounded-md border bg-background p-2">
                {WHT_FORMS.map((form) => <option key={form} value={form}>{WHT_FORM_LABEL[form].th} / {WHT_FORM_LABEL[form].en}</option>)}
              </select>
            </label>
            <label>
              <Bi th="ประเภทเงินได้" en="Income type" />
              <select name="income_type" className="mt-1 w-full rounded-md border bg-background p-2">
                {Object.entries(WHT_INCOME_LABEL).map(([key, label]) => <option key={key} value={key}>{label.th} / {label.en}</option>)}
              </select>
            </label>
            <label>
              <Bi th="อัตราหัก ณ ที่จ่าย" en="Withholding rate" />
              <select name="rate_bps" defaultValue="300" className="mt-1 w-full rounded-md border bg-background p-2">
                {[100, 200, 300, 500].map((bps) => <option key={bps} value={bps}>{bps / 100}%</option>)}
              </select>
            </label>
            <Button type="submit"><Bi th="บันทึก" en="Record" /></Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
