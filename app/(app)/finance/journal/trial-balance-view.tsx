import { BAHT_CAPTION_EN, BAHT_CAPTION_TH, closeDateLabel } from "@/lib/finance/close-copy"
import { TRIAL_BALANCE_BALANCED_EN, TRIAL_BALANCE_LIMIT_EN, TRIAL_BALANCE_LIMIT_TH, TRIAL_BALANCE_OPEN_EN, type TrialBalance } from "@/lib/finance/trial-balance"
import { formatTHB } from "@/lib/money"

export function TrialBalanceView({
  balance,
  through,
  lockDate,
}: {
  balance: TrialBalance
  through: string | null
  lockDate: string | null
}) {
  const scope = through
    ? `ถึง ${closeDateLabel(through)} / Through ${closeDateLabel(through)}`
    : "ทุกวันที่บันทึกแล้ว / All posted dates"
  return <div className="space-y-4">
    <p className="text-sm">{TRIAL_BALANCE_LIMIT_TH}</p>
    <p className="text-sm text-muted-foreground">{TRIAL_BALANCE_LIMIT_EN}</p>
    <p className="text-sm text-muted-foreground">{scope} · {balance.lineCount} lines · {BAHT_CAPTION_TH} / {BAHT_CAPTION_EN}</p>
    <p className="text-sm text-muted-foreground">ใบแจ้งหนี้และใบเสร็จที่ออกแล้วไม่ได้อยู่ในยอดนี้ / Issued invoices and receipts are not in these totals.{lockDate ? ` Finance lock ${closeDateLabel(lockDate)}.` : ""}</p>
    {balance.rows.length === 0 ? <p className="text-sm">No draft journal lines in this trial balance.</p> : <table className="w-full text-sm">
      <thead>
        <tr className="border-b text-left">
          <th className="py-2 pr-3 font-medium">รหัส / Code</th>
          <th className="py-2 pr-3 font-medium">บัญชี / Account</th>
          <th className="py-2 pr-3 font-medium">เดบิต / Debit</th>
          <th className="py-2 font-medium">เครดิต / Credit</th>
        </tr>
      </thead>
      <tbody>
        {balance.rows.map(row => <tr key={row.code} className="border-b">
          <td className="py-2 pr-3">{row.code}</td>
          <td className="py-2 pr-3">{row.nameTh}{row.nameTh && row.nameEn ? " / " : ""}{row.nameEn}{row.kind ? ` · ${row.kind}` : ""}</td>
          <td className="py-2 pr-3">{row.debitSatang > 0 ? formatTHB(row.debitSatang) : ""}</td>
          <td className="py-2">{row.creditSatang > 0 ? formatTHB(row.creditSatang) : ""}</td>
        </tr>)}
      </tbody>
      <tfoot>
        <tr>
          <td className="py-2 pr-3 font-medium" colSpan={2}>รวม / Total</td>
          <td className="py-2 pr-3 font-medium">{formatTHB(balance.debitSatang)}</td>
          <td className="py-2 font-medium">{formatTHB(balance.creditSatang)}</td>
        </tr>
      </tfoot>
    </table>}
    <p className="text-sm">{balance.balanced ? `ยอดเดบิตเท่ากับยอดเครดิต / ${TRIAL_BALANCE_BALANCED_EN}` : `ยอดเดบิตไม่เท่ากับยอดเครดิต อย่าใช้เป็นงบที่ปิดแล้ว / ${TRIAL_BALANCE_OPEN_EN}`}</p>
  </div>
}
