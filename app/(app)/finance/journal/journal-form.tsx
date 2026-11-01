"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { draftJournalLines, journalAmountSatang, journalDateInClosedPeriod, journalMemo } from "@/lib/finance/draft-journal"
import { postDraftJournal } from "./actions"

type Account = { code: string; nameTh: string; nameEn: string }
type Line = { accountCode: string; debit: string; credit: string }

const LINE_LIMIT = 6

export function JournalForm({ accounts, lockDate }: { accounts: Account[]; lockDate: string | null }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [entryDate, setEntryDate] = useState(lockDate ?? "")
  const [memo, setMemo] = useState("")
  const [lines, setLines] = useState<Line[]>([
    { accountCode: accounts[0]?.code ?? "", debit: "", credit: "" },
    { accountCode: accounts[1]?.code ?? accounts[0]?.code ?? "", debit: "", credit: "" },
  ])
  const closed = Boolean(lockDate)

  function updateLine(index: number, patch: Partial<Line>) {
    setLines(current => current.map((line, i) => i === index ? { ...line, ...patch } : line))
  }

  return <form className="space-y-4" onSubmit={event => {
    event.preventDefault()
    const date = journalDateInClosedPeriod(entryDate, lockDate)
    if (!date.ok) { toast.error(date.error); return }
    const note = journalMemo(memo)
    if (!note.ok) { toast.error(note.error); return }
    const parsed: { accountCode: string; debitSatang: number; creditSatang: number }[] = []
    for (const line of lines) {
      const debit = journalAmountSatang(line.debit)
      const credit = journalAmountSatang(line.credit)
      if (!debit.ok) { toast.error(debit.error); return }
      if (!credit.ok) { toast.error(credit.error); return }
      parsed.push({ accountCode: line.accountCode, debitSatang: debit.satang, creditSatang: credit.satang })
    }
    const check = draftJournalLines(parsed, accounts.map(account => account.code))
    if (!check.ok) { toast.error(check.error); return }
    start(async () => {
      const result = await postDraftJournal({ entryDate, memo: note.memo, lines: parsed })
      if (result.error) { toast.error(result.error); return }
      toast.success("Draft journal posted. It is not signed statutory books.")
      setMemo("")
      setLines(current => current.map(line => ({ ...line, debit: "", credit: "" })))
      router.refresh()
    })
  }}>
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="space-y-2">
        <Label htmlFor="journal-date">วันที่บันทึก / Journal date</Label>
        <Input id="journal-date" type="date" value={entryDate} max={lockDate ?? undefined} required disabled={!closed || pending} onChange={event => setEntryDate(event.target.value)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="journal-memo">คำอธิบาย / Memo</Label>
        <Input id="journal-memo" value={memo} maxLength={200} required disabled={!closed || pending} onChange={event => setMemo(event.target.value)} />
      </div>
    </div>
    <div className="space-y-3">
      {lines.map((line, index) => <div key={index} className="grid gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="space-y-1">
          <Label htmlFor={`journal-account-${index}`}>บัญชี / Account</Label>
          <select id={`journal-account-${index}`} className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm" value={line.accountCode} disabled={!closed || pending} onChange={event => updateLine(index, { accountCode: event.target.value })}>
            {accounts.map(account => <option key={account.code} value={account.code}>{account.code} · {account.nameTh} / {account.nameEn}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor={`journal-debit-${index}`}>เดบิต (บาท) / Debit (THB)</Label>
          <Input id={`journal-debit-${index}`} inputMode="decimal" value={line.debit} disabled={!closed || pending} onChange={event => updateLine(index, { debit: event.target.value })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`journal-credit-${index}`}>เครดิต (บาท) / Credit (THB)</Label>
          <Input id={`journal-credit-${index}`} inputMode="decimal" value={line.credit} disabled={!closed || pending} onChange={event => updateLine(index, { credit: event.target.value })} />
        </div>
        <div className="flex items-end">
          <Button type="button" variant="outline" disabled={!closed || pending || lines.length <= 2} onClick={() => setLines(current => current.filter((_, i) => i !== index))}>เอาออก / Remove</Button>
        </div>
      </div>)}
    </div>
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" disabled={!closed || pending || lines.length >= LINE_LIMIT} onClick={() => setLines(current => [...current, { accountCode: accounts[0]?.code ?? "", debit: "", credit: "" }])}>เพิ่มบรรทัด / Add a line</Button>
      <Button type="submit" disabled={!closed || pending}>{pending ? "กำลังบันทึก…" : "บันทึกรายวัน / Post draft journal"}</Button>
    </div>
    {closed ? null : <p className="text-sm">Post a journal only into a closed period.</p>}
  </form>
}
