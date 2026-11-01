import Link from "next/link"
import { ArrowLeft, Lock, PlugZap } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import type { Enums } from "@/lib/types/database"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

import { AccountingConnectionForm } from "@/ee/accounting/components/accounting-connection-form"
import { connectionTransport } from "@/ee/accounting/flowaccount"


const PROVIDER_LABEL: Record<Enums<"accounting_provider">, string> = {
  flowaccount: "FlowAccount",
  peak: "PEAK",
  xero: "Xero",
}

const STATUS_META: Record<
  Enums<"accounting_conn_status">,
  { label: string; variant: "secondary" | "outline" | "destructive" }
> = {
  connected: { label: "Connected", variant: "secondary" },
  disconnected: { label: "Not connected", variant: "outline" },
  error: { label: "Error", variant: "destructive" },
}

export default async function AccountingSettingsPage() {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const canEdit = ctx.role === "owner" || ctx.role === "admin"

  // Single row per org (org_id unique). May not exist yet.
  const { data: conn } = await supabase
    .from("accounting_connections")
    .select("provider, status, config, updated_at")
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  const status = conn?.status ?? "disconnected"
  const isConnected = status === "connected"
  const statusMeta = STATUS_META[status]
  const transport = connectionTransport(conn?.config)
  const sandboxTokenSet = Boolean(process.env.FLOWACCOUNT_ACCESS_TOKEN?.trim())

  return (
    <div className="space-y-6">
      <PageHeader
        title="การส่งออกบัญชี / Accounting export"
        description="ส่งใบแจ้งหนี้ที่ออกแล้วไป FlowAccount / Export issued invoices to FlowAccount."
      >
        <Button variant="outline" render={<Link href="/settings" />}>
          <ArrowLeft /> Settings
        </Button>
      </PageHeader>

      <Alert>
        <PlugZap className="size-4" />
        <AlertTitle>ส่งออก FlowAccount ไม่ใช่บัญชีแยกประเภท / FlowAccount export — not a general ledger</AlertTitle>
        <AlertDescription>
          ส่งใบแจ้งหนี้ที่ออกแล้วออกไป ไม่ยื่นแบบ ภ.พ.30 และไม่แทนนักบัญชี
          An issued invoice is mapped to FlowAccount&apos;s inline document and
          the returned document number is stored here. Fixture mode does not
          leave this machine. Sandbox mode posts only when the server has
          FLOWACCOUNT_ACCESS_TOKEN. This does not file e-Tax, does not file ภ.พ.30,
          and does not replace an accountant. PEAK and Xero are not connected in this build.
        </AlertDescription>
      </Alert>

      <Card className="max-w-2xl">
        <CardHeader className="flex-row items-center justify-between">
          <div className="space-y-1">
            <CardTitle className="text-base">Connection</CardTitle>
            <CardDescription>
              {isConnected && conn
                ? conn.provider === "flowaccount"
                  ? transport === "sandbox"
                    ? "FlowAccount sandbox. Issued invoices are posted when you export them."
                    : "FlowAccount fixture. Issued invoices get a demo document number on this machine."
                  : `${PROVIDER_LABEL[conn.provider]} is connected, but this build exports to FlowAccount only. Disconnect, then connect FlowAccount.`
                : "FlowAccount is not connected yet."}
            </CardDescription>
          </div>
          <Badge variant={statusMeta.variant} className="shrink-0">
            {statusMeta.label}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {conn ? (
            <dl className="divide-y text-sm">
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-muted-foreground">Provider</dt>
                <dd className="font-medium">
                  {PROVIDER_LABEL[conn.provider]}
                </dd>
              </div>
              <div className="flex items-center justify-between py-2.5">
                <dt className="text-muted-foreground">Status</dt>
                <dd className="font-medium">{statusMeta.label}</dd>
              </div>
              {conn.provider === "flowaccount" ? (
                <div className="flex items-center justify-between py-2.5">
                  <dt className="text-muted-foreground">Transport</dt>
                  <dd className="font-medium">{transport === "sandbox" ? "Sandbox" : "Fixture demo"}</dd>
                </div>
              ) : null}
              {conn.provider === "flowaccount" && transport === "sandbox" ? (
                <div className="flex items-center justify-between py-2.5">
                  <dt className="text-muted-foreground">Server token</dt>
                  <dd className="font-medium">{sandboxTokenSet ? "Set" : "Missing"}</dd>
                </div>
              ) : null}
            </dl>
          ) : null}

          {canEdit ? (
            <AccountingConnectionForm connected={isConnected} transport={transport} />
          ) : (
            <Alert>
              <Lock className="size-4" />
              <AlertTitle>View only</AlertTitle>
              <AlertDescription>
                Only an owner or admin can change the accounting connection.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
