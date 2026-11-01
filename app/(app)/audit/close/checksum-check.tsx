"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { checksumVerdict, sha256HexBytes } from "@/lib/finance/export-integrity"
import { findSupportExport } from "./actions"

type Result = { tone: "ok" | "no"; text: string }

export function ChecksumCheck() {
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<Result | null>(null)

  return <section className="space-y-3 rounded-lg border p-4 text-sm">
    <h2 className="font-medium">ตรวจไฟล์ที่บันทึกไว้ / Check a saved file</h2>
    <p className="text-muted-foreground">เลือกไฟล์ CSV หรือ HTML ที่ดาวน์โหลดไว้ เครื่องนี้คำนวณ SHA-256 แล้วเทียบกับบันทึกกิจกรรม ไม่ได้อัปโหลดไฟล์ และไม่ใช่ลายเซ็นหรือการยื่นแบบ / Choose a downloaded CSV or HTML file. This machine hashes it and compares that checksum with the activity log. The file is not uploaded. This is not a signature and not a filing.</p>
    <input
      type="file"
      disabled={pending}
      aria-label="Saved support file"
      onChange={event => {
        const file = event.target.files?.[0]
        if (!file) return
        setPending(true)
        setResult(null)
        void file.arrayBuffer().then(async buffer => {
          const bytes = new Uint8Array(buffer)
          const sha256 = await sha256HexBytes(bytes)
          const stored = await findSupportExport(sha256)
          if (stored.error) { setResult({ tone: "no", text: stored.error }); return }
          const verdict = checksumVerdict({ sha256, bytes: bytes.byteLength }, stored.record)
          setResult(verdict.match
            ? { tone: "ok", text: `ตรงกับไฟล์ประกอบ ${verdict.kind} งวด ${verdict.period} / Matches the ${verdict.kind} support file for ${verdict.period}.` }
            : { tone: "no", text: verdict.message })
        }).catch(() => {
          setResult({ tone: "no", text: "Could not read that file." })
        }).finally(() => setPending(false))
      }}
    />
    {pending ? <p>กำลังตรวจ / Checking…</p> : null}
    {result ? <p role="status">{result.text}</p> : null}
    <Button type="button" variant="outline" disabled={pending} onClick={() => setResult(null)}>ล้างผล / Clear result</Button>
  </section>
}
