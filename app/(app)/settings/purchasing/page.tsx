import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/page-header"
import { PurchasingPolicyForm } from "./policy-form"

export default async function PurchasingSettingsPage() {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "settings:manage")
  const db = await createClient()
  const { data, error } = await db.from("org_settings").select("over_receipt_tolerance_percent,purchase_approval_threshold_satang,scheduled_replenishment_enabled").eq("org_id", ctx.orgId).maybeSingle()
  if (error) throw new Error("Purchasing settings unavailable")
  return <div className="space-y-6"><PageHeader title="Purchasing settings" description="Receiving and approval." /><PurchasingPolicyForm tolerancePercent={data?.over_receipt_tolerance_percent ?? 0} approvalThreshold={data?.purchase_approval_threshold_satang ?? null} scheduled={data?.scheduled_replenishment_enabled ?? false} /></div>
}
