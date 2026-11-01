import Link from "next/link"
import { PlugZap } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import type { Enums } from "@/lib/types/database"
import { Button } from "@/components/ui/button"
import { SyncInvoiceButton } from "./components/sync-invoice-button"

const ACCOUNTING_PROVIDER_LABEL: Record<Enums<"accounting_provider">, string> = {
  flowaccount: "FlowAccount",
  peak: "PEAK",
  xero: "Xero",
}

export async function getInvoiceAccounting(orgId: string, invoiceId: string) {
  const supabase = await createClient()
  const [connection, mappings] = await Promise.all([
    supabase.from("accounting_connections").select("provider, status").eq("org_id", orgId).maybeSingle(),
    // Provider switches retain earlier mappings; display the latest one.
    supabase.from("accounting_sync_map").select("external_id, provider, status, last_synced_at, last_error")
      .eq("org_id", orgId).eq("local_entity", "invoice").eq("local_id", invoiceId)
      .order("last_synced_at", { ascending: false, nullsFirst: false }).limit(1),
  ])
  return { connected: connection.data?.status === "connected", sync: mappings.data?.[0] ?? null }
}

export function InvoiceAccountingControls({ invoiceId, connected }: { invoiceId: string; connected: boolean }) {
  return connected ? <SyncInvoiceButton invoiceId={invoiceId} /> : (
    <Button variant="outline" size="sm" render={<Link href="/settings/accounting" />}>
      <PlugZap /> เชื่อมต่อการส่งออก / Connect accounting
    </Button>
  )
}

export function InvoiceAccountingStatus({ sync }: { sync: Awaited<ReturnType<typeof getInvoiceAccounting>>["sync"] }) {
  const value = sync?.external_id ? (
    <span className="space-y-0.5">
      <span className="block font-medium">{ACCOUNTING_PROVIDER_LABEL[sync.provider]} · {sync.external_id}</span>
      {sync.last_synced_at ? (
        <span className="text-muted-foreground block text-xs">ส่งออกแล้ว / Exported {sync.last_synced_at.slice(0, 10)}</span>
      ) : null}
      {sync.status === "error" && sync.last_error ? (
        <span className="text-destructive block text-xs">{sync.last_error}</span>
      ) : null}
    </span>
  ) : <span className="text-muted-foreground">ยังไม่ส่งออก / Not synced</span>
  return <div className="space-y-1"><dt className="text-muted-foreground text-xs font-medium">การส่งออกบัญชี / Accounting sync</dt><dd className="text-sm">{value}</dd></div>
}
