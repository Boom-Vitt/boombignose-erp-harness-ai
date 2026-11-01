"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { reviewSupportPack } from "./actions"

export function ReviewPackButton({ sha256, already }: { sha256: string; already: boolean }) {
  const [done, setDone] = useState(already)
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  if (done) return <p>คุณบันทึกแล้วว่าตรวจไฟล์นี้ / You already recorded that you reviewed this file.</p>
  return <Button type="button" variant="outline" disabled={pending} onClick={() => startTransition(async () => {
    const result = await reviewSupportPack(sha256)
    if (result.error) { toast.error(result.error); return }
    setDone(true)
    toast.success("บันทึกแล้วว่าตรวจไฟล์นี้ ไม่ใช่การปิดงบตามกฎหมาย / Recorded that you reviewed this file. This is not a statutory sign-off.")
    router.refresh()
  })}>
    {pending ? "กำลังบันทึก / Saving…" : "ฉันตรวจไฟล์นี้แล้ว / I reviewed this file"}
  </Button>
}
