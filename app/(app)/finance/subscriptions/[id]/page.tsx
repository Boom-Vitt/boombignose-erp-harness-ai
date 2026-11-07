import { RecordHistory } from "@/components/record/record-history"
import { notFound } from "next/navigation"
import { FolderKanban, ReceiptText } from "lucide-react"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import { formatTHB, satangToBaht } from "@/lib/money"
import type { Enums } from "@/lib/types/database"
import { SUBSCRIPTION_FLOW } from "@/lib/record/status"
import { activeProductOptions } from "@/lib/products/queries"

import { PageHeader } from "@/components/page-header"
import { StatusBar } from "@/components/record/status-bar"
import { SmartButtons, recordHref } from "@/components/record/smart-buttons"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

import { setSubscriptionStatus, updateSubscription } from "../../subscription-actions"
import {
  SubscriptionForm,
  type SubscriptionFormValues,
  type SubscriptionFormSubmitValues,
} from "../../_components/subscription-form"
import { SubscriptionControls } from "../../_components/subscription-controls"
import { SubscriptionStatusBadge } from "@/components/status-badge"
import type { Option } from "../../_components/form-fields"

export const dynamic = "force-dynamic"

const INTERVAL_LABEL: Record<Enums<"recurring_interval">, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
}

const SUBSCRIPTION_DETAIL_FLOW = {
  ...SUBSCRIPTION_FLOW,
  next: {
    ...SUBSCRIPTION_FLOW.next,
    paused: { ...SUBSCRIPTION_FLOW.next.paused, primary: undefined },
  },
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

export default async function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const [subRes, clientsRes, projectsRes, occurrencesRes, products] = await Promise.all([
    supabase
      .from("subscriptions")
      .select(
        "id, name, amount_satang, interval, status, start_date, next_run_date, last_generated_on, auto_generate, notes, client_id, project_id, product_id, unit, tax_rate_bps, wht_rate_bps, prices_include_vat, clients(name), projects(name)"
      )
      .eq("id", id)
      .eq("org_id", ctx.orgId)
      .maybeSingle(),
    supabase.from("clients").select("id, name").eq("org_id", ctx.orgId).order("name"),
    supabase.from("projects").select("id, name").eq("org_id", ctx.orgId).order("name"),
    supabase
      .from("subscription_occurrences")
      .select("id:invoice_id", { count: "exact" })
      .eq("org_id", ctx.orgId)
      .eq("subscription_id", id)
      .limit(1),
    activeProductOptions(),
  ])
  if (subRes.error || clientsRes.error || projectsRes.error || occurrencesRes.error) {
    throw new Error("Subscription details unavailable. Please reload.")
  }

  const sub = subRes.data
  if (!sub) notFound()

  const canManage = ctx.role === "owner" || ctx.role === "admin"

  const clients: Option[] = (clientsRes.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }))
  const projects: Option[] = (projectsRes.data ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }))

  const defaultValues: SubscriptionFormValues = {
    name: sub.name,
    client_id: sub.client_id,
    project_id: sub.project_id ?? "",
    amountBaht: satangToBaht(sub.amount_satang),
    interval: sub.interval,
    start_date: sub.start_date,
    notes: sub.notes ?? "",
    product_id: sub.product_id,
    unit: sub.unit ?? "period",
    tax_rate_bps: sub.tax_rate_bps,
    wht_rate_bps: sub.wht_rate_bps,
    prices_include_vat: sub.prices_include_vat,
  }

  // Bind the subscription id into a real server action so the "use client"
  // SubscriptionForm can call it across the RSC boundary (like invoices/[id]).
  const subId = sub.id
  async function saveSubscription(values: SubscriptionFormSubmitValues) {
    "use server"
    return updateSubscription({ id: subId, ...values })
  }
  async function transitionSubscription(to: Enums<"subscription_status">) {
    "use server"
    return setSubscriptionStatus({ id: subId, status: to })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={sub.name}
        description={sub.clients?.name ?? "Subscription"}
        breadcrumbs={[
          { label: "Finance", href: "/finance" },
          { label: "Subscriptions", href: "/finance/subscriptions" },
        ]}
      />

      <SmartButtons
        buttons={[
          {
            label: "Invoices",
            icon: ReceiptText,
            count: occurrencesRes.count ?? 0,
            href: recordHref(occurrencesRes, (invoiceId) => `/finance/invoices/${invoiceId}`, "/finance"),
          },
          {
            label: "Project",
            icon: FolderKanban,
            count: sub.project_id ? 1 : 0,
            href: `/projects/${sub.project_id}`,
          },
        ]}
      />
      <StatusBar
        label="Subscription status"
        flow={SUBSCRIPTION_DETAIL_FLOW}
        status={sub.status}
        transition={canManage ? transitionSubscription : undefined}
      />

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Overview</CardTitle>
          <SubscriptionStatusBadge status={sub.status} />
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Amount" value={formatTHB(sub.amount_satang)} />
            <Field label="Interval" value={INTERVAL_LABEL[sub.interval]} />
            <Field label="Client" value={sub.clients?.name ?? "—"} />
            <Field label="Project" value={sub.projects?.name ?? "—"} />
            <Field label="Start date" value={sub.start_date} />
            <Field label="Next run" value={sub.next_run_date} />
            <Field label="VAT rate" value={`${sub.tax_rate_bps / 100}%`} />
            <Field label="Withholding tax" value={`${sub.wht_rate_bps / 100}%`} />
            <Field
              label="Last generated"
              value={sub.last_generated_on ?? "—"}
            />
            <Field
              label="Auto-generate"
              value={sub.auto_generate ? "On" : "Off"}
            />
          </dl>
          {sub.notes ? (
            <>
              <Separator />
              <Field label="Notes" value={sub.notes} />
            </>
          ) : null}
          <Separator />
          <SubscriptionControls
            occurrence={sub.next_run_date}
            isDue={sub.next_run_date <= todayISO()}
            id={sub.id}
            orgId={ctx.orgId}
            status={sub.status}
            canManage={canManage}
          />
        </CardContent>
      </Card>

      {canManage ? <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">Edit subscription</CardTitle>
        </CardHeader>
        <CardContent>
          <SubscriptionForm
            clients={clients}
            projects={projects}
            products={products}
            defaultValues={defaultValues}
            submitLabel="Save changes"
            action={saveSubscription}
          />
        </CardContent>
      </Card> : null}
      <RecordHistory recordType="subscription" recordId={id} />
    </div>
  )
}
