import Link from "next/link"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { BusinessProfileForm } from "../_components/business-profile-form"
import { TaxInvoiceTemplateForm } from "../_components/tax-invoice-template-form"
import { readTaxInvoiceTemplate, taxInvoiceChecklist } from "@/lib/tax/invoice-checklist"
export const dynamic = "force-dynamic"
export default async function BusinessProfilePage() {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "settings:manage")) return <p>Only owners and admins can manage the business profile.</p>
  const supabase = await createClient()
  const { data, error } = await supabase.from("org_settings").select("legal_name, business_address, tax_id, tax_status, vat_registered, vat_rate_bps, prices_include_vat, branch_label, tax_invoice_template").eq("org_id", ctx.orgId).maybeSingle()
  if (error) throw new Error("Business profile unavailable")
  const taxStatus = data?.tax_status === "registered" || data?.tax_status === "not_registered" ? data.tax_status : "unknown"
  const template = readTaxInvoiceTemplate(data?.tax_invoice_template)
  const checks = taxInvoiceChecklist({ legalName: data?.legal_name ?? "", address: data?.business_address ?? "", taxId: data?.tax_id ?? "", branchLabel: data?.branch_label ?? "", taxStatus, template })
  const stateLabel = { present: "Present", missing: "Missing", per_document: "On each invoice", gap: "Not in this product" } as const
  return <div className="space-y-6"><PageHeader title="ข้อมูลกิจการ / Business profile" description="Prepare the issuer details before issuing an operational invoice."><Button variant="outline" render={<Link href="/finance" />}>Back to finance</Button></PageHeader>
    <Card className="max-w-3xl"><CardContent><BusinessProfileForm orgId={ctx.orgId} initial={{ vatRateBps: data?.vat_rate_bps ?? 700, pricesIncludeVat: data?.prices_include_vat ?? false, branchLabel: data?.branch_label ?? "", legalName: data?.legal_name ?? "", address: data?.business_address ?? "", taxId: data?.tax_id ?? "", taxStatus }} /></CardContent></Card>
    <Card className="max-w-3xl"><CardContent className="space-y-4"><TaxInvoiceTemplateForm orgId={ctx.orgId} initial={template} />
      <h2 className="text-sm font-medium">Tax invoice checklist</h2>
      <p className="text-sm text-muted-foreground">A statutory tax invoice needs the items below. Gaps stay gaps. Optional fields do not close them. The same list is in docs/thai/tax-invoice-gaps.md.</p>
      <ul className="space-y-2 text-sm">{checks.map(item => <li key={item.id}><strong>{stateLabel[item.state]}.</strong> {item.label}. {item.detail}</li>)}</ul>
    </CardContent></Card>
  </div>
}
