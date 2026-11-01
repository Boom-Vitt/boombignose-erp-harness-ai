import type { OrgContext } from "@/lib/auth"
import type { Tables } from "@/lib/types/database"

export type WorkspaceHeaderProps = { context: OrgContext }
export type PortalPageProps = { params: Promise<{ token: string }> }
export type InvoiceAccounting = {
  connected: boolean
  sync: Pick<Tables<"accounting_sync_map">, "external_id" | "provider" | "status" | "last_synced_at" | "last_error"> | null
}
export type InvoiceAccountingControlsProps = { invoiceId: string; connected: boolean }
export type InvoiceAccountingStatusProps = { sync: InvoiceAccounting["sync"] }
