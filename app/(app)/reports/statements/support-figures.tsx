import Link from "next/link"

import { FilingResponsibility } from "@/components/finance/filing-responsibility"
import { BAHT_CAPTION_EN, BAHT_CAPTION_TH, VAT_SUPPORT_EN, VAT_SUPPORT_TH, closeDateLabel, closeMonthLabel } from "@/lib/finance/close-copy"
import { AGING_BUCKET_DISPLAY } from "@/lib/finance/outstanding-pack"
import { formatTHB } from "@/lib/money"
import type { AgingBuckets } from "@/lib/reports/statements"
import { Card, CardContent } from "@/components/ui/card"

export function SupportFigures({
  month,
  asOf,
  profit,
  balance,
  vat,
  receivableAging,
  payableAging,
}: {
  month: string
  asOf: string
  profit: { revenueSatang: number; cogsSatang: number; expenseSatang: number; profitSatang: number }
  balance: { cashSatang: number; receivablesSatang: number; payablesSatang: number }
  vat: { outputVatSatang: number; inputVatSatang: number; netVatSatang: number }
  receivableAging: AgingBuckets
  payableAging: AgingBuckets
}) {
  return <>
    <p className="text-sm text-muted-foreground">งวด {closeMonthLabel(month)} · ถึง {closeDateLabel(asOf)} · {BAHT_CAPTION_TH} / {BAHT_CAPTION_EN}</p>
    <section className="space-y-2">
      <h2 className="font-semibold">กำไรขาดทุน / Profit and loss</h2>
      <Card><CardContent className="grid gap-2 py-4 text-sm sm:grid-cols-2">
        <p>รายได้ก่อนภาษีมูลค่าเพิ่ม / Revenue before VAT {formatTHB(profit.revenueSatang)}</p>
        <p>ต้นทุนขาย / Cost of goods sold {formatTHB(profit.cogsSatang)}</p>
        <p>ต้นทุนอื่นก่อนภาษีมูลค่าเพิ่ม / Other costs before VAT {formatTHB(profit.expenseSatang)}</p>
        <p>กำไร / Profit {formatTHB(profit.profitSatang)}</p>
      </CardContent></Card>
    </section>
    <section className="space-y-2">
      <h2 className="font-semibold">ฐานะการเงินเบื้องต้น / Balance support</h2>
      <p className="text-sm text-muted-foreground">เงินสดคือตัวเลขที่บันทึกใน Settings ลูกหนี้คือใบแจ้งหนี้ที่ออกแล้วและยังไม่รับครบ เจ้าหนี้คือต้นทุนที่ยังไม่จ่าย ยอดเหล่านี้ไม่ได้ลงดุล / Cash is the figure saved in settings. Receivables are unpaid issued invoices. Payables are unpaid costs. These amounts do not balance.</p>
      <Card><CardContent className="grid gap-2 py-4 text-sm sm:grid-cols-3">
        <p>เงินสด / Cash {formatTHB(balance.cashSatang)}</p>
        <p>ลูกหนี้ / Receivables {formatTHB(balance.receivablesSatang)}</p>
        <p>เจ้าหนี้ / Payables {formatTHB(balance.payablesSatang)}</p>
      </CardContent></Card>
    </section>
    <section className="space-y-2">
      <h2 className="font-semibold">ข้อมูลประกอบ ภ.พ.30 / VAT support</h2>
      <p className="text-sm text-muted-foreground">{VAT_SUPPORT_TH}</p>
      <p className="text-sm text-muted-foreground">{VAT_SUPPORT_EN}</p>
      <FilingResponsibility />
      <Card><CardContent className="grid gap-2 py-4 text-sm sm:grid-cols-3">
        <p>ภาษีขาย / Output VAT {formatTHB(vat.outputVatSatang)}</p>
        <p>ภาษีซื้อ / Input VAT {formatTHB(vat.inputVatSatang)}</p>
        <p>ภาษีขายลบภาษีซื้อ / Output minus input {formatTHB(vat.netVatSatang)}</p>
      </CardContent></Card>
    </section>
    <section className="space-y-2">
      <h2 className="font-semibold">อายุลูกหนี้และเจ้าหนี้ / AR and AP aging</h2>
      <AgingTable title="ลูกหนี้ / Receivables" buckets={receivableAging} />
      <AgingTable title="เจ้าหนี้ / Payables" buckets={payableAging} />
    </section>
    <Link className="text-sm underline" href="/reports">กลับไปรายงาน / Back to reports</Link>
  </>
}

function AgingTable({ title, buckets }: { title: string; buckets: AgingBuckets }) {
  return <Card><CardContent className="space-y-2 py-4 text-sm">
    <h3 className="font-medium">{title}</h3>
    <p>{AGING_BUCKET_DISPLAY.current} {formatTHB(buckets.current)}</p>
    <p>{AGING_BUCKET_DISPLAY.days1to30} {formatTHB(buckets.days1to30)}</p>
    <p>{AGING_BUCKET_DISPLAY.days31to60} {formatTHB(buckets.days31to60)}</p>
    <p>{AGING_BUCKET_DISPLAY.days61to90} {formatTHB(buckets.days61to90)}</p>
    <p>{AGING_BUCKET_DISPLAY.days91plus} {formatTHB(buckets.days91plus)}</p>
  </CardContent></Card>
}
