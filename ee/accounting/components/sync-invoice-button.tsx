"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"

import { syncInvoiceToAccounting } from "@/ee/accounting/invoice-actions"

/** Export this issued invoice through the connected FlowAccount adapter. */
export function SyncInvoiceButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await syncInvoiceToAccounting(invoiceId)
          if (res?.error) {
            toast.error(res.error)
            return
          }
          toast.success(
            res.externalId
              ? `ส่งออกแล้ว / Exported (${res.externalId})`
              : "ส่งออกแล้ว / Exported"
          )
          router.refresh()
        })
      }
    >
      <RefreshCw className={pending ? "animate-spin" : undefined} />
      {pending ? "กำลังส่งออก… / Exporting…" : "ส่งออกไป FlowAccount / Export to FlowAccount"}
    </Button>
  )
}
