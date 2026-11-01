"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Plug, Unplug } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"

import { connectAccounting, disconnectAccounting } from "@/ee/accounting/actions"
import type { AccountingTransport } from "@/ee/accounting/flowaccount"

/**
 * Owner/admin controls for the FlowAccount export. Fixture stays on this
 * machine. Sandbox uses the server token and does not store it here.
 */
export function AccountingConnectionForm({
  connected,
  transport,
}: {
  connected: boolean
  transport: AccountingTransport
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [choice, setChoice] = useState<AccountingTransport>(transport)

  if (connected) {
    return (
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-muted-foreground text-sm">
          การยกเลิกการเชื่อมต่อหยุดการส่งออกใหม่ เลขเอกสารเดิมยังอยู่ เชื่อมต่ออีกครั้งเพื่อเปลี่ยนโหมดตัวอย่างหรือ sandbox / Disconnecting stops new exports. Existing document numbers are kept.
          Connect again to change fixture or sandbox.
        </p>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await disconnectAccounting()
              if (res?.error) {
                toast.error(res.error)
                return
              }
              toast.success("FlowAccount disconnected")
              router.refresh()
            })
          }
        >
          <Unplug /> {pending ? "กำลังยกเลิก… / Disconnecting…" : "ยกเลิกการเชื่อมต่อ / Disconnect"}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <RadioGroup value={choice} onValueChange={(value) => setChoice(value === "sandbox" ? "sandbox" : "fixture")}>
        <div className="flex items-start gap-2">
          <RadioGroupItem id="transport-fixture" value="fixture" />
          <Label htmlFor="transport-fixture" className="grid gap-1 font-normal">
            <span className="font-medium">ตัวอย่างบนเครื่องนี้ / Fixture demo</span>
            <span className="text-muted-foreground text-sm">
              สร้างเอกสาร FlowAccount บนเครื่องนี้และเก็บเลขตัวอย่าง ไม่มีการเรียกเครือข่าย / Builds the FlowAccount document on this machine and stores a demo number. No network call.
            </span>
          </Label>
        </div>
        <div className="flex items-start gap-2">
          <RadioGroupItem id="transport-sandbox" value="sandbox" />
          <Label htmlFor="transport-sandbox" className="grid gap-1 font-normal">
            <span className="font-medium">FlowAccount sandbox</span>
            <span className="text-muted-foreground text-sm">
              ส่งเอกสารเดียวกันไป FlowAccount ตั้ง FLOWACCOUNT_ACCESS_TOKEN ที่เซิร์ฟเวอร์ ไม่ได้บันทึกในเวิร์กสเปซนี้ / Posts the same document to FlowAccount. Set FLOWACCOUNT_ACCESS_TOKEN on the server. It is not saved in this workspace.
            </span>
          </Label>
        </div>
      </RadioGroup>
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const res = await connectAccounting({ transport: choice })
            if (res?.error) {
              toast.error(res.error)
              return
            }
            toast.success(choice === "sandbox" ? "FlowAccount sandbox connected" : "FlowAccount fixture connected")
            router.refresh()
          })
        }
      >
        <Plug /> {pending ? "กำลังเชื่อมต่อ… / Connecting…" : <><span aria-hidden="true">เชื่อมต่อ FlowAccount / </span>Connect</>}
      </Button>
    </div>
  )
}
