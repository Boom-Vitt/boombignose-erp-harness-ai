import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft, CheckCircle2, Pencil } from "lucide-react"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { formatTHB } from "@/lib/money"
import { DeleteTemplateButton } from "../_components/delete-template-button"

export const dynamic = "force-dynamic"

/** Coerce the jsonb implementation_checklist into a clean list of step strings. */
function toSteps(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter(Boolean)
}

export default async function TemplateDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const ctx = await requireOrgContext()
  const manage = can(ctx.role, "template:manage")
  const supabase = await createClient()

  const { data: template, error: templateError } = await supabase
    .from("automation_templates")
    .select(
      "id, name, description, internal_value_satang, price_satang, reusable_notes, implementation_checklist, tags, category_id"
    )
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (templateError) throw new Error("Template unavailable. Please reload.")
  if (!template) notFound()

  const { data: category, error: categoryError } = template.category_id
    ? await supabase
        .from("template_categories")
        .select("name")
        .eq("id", template.category_id)
        .eq("org_id", ctx.orgId)
        .maybeSingle()
    : { data: null, error: null }
  if (categoryError) throw new Error("Template category unavailable. Please reload.")

  const steps = toSteps(template.implementation_checklist)
  const tags = template.tags ?? []

  return (
    <div className="space-y-6">
      <PageHeader title={template.name} description={category?.name ?? "Uncategorized"}>
        <Button variant="outline" render={<Link href="/templates" />}>
          <ArrowLeft /> Back
        </Button>
        {manage && <>
          <Button variant="outline" render={<Link href={`/templates/${template.id}/edit`} />}>
            <Pencil /> Edit
          </Button>
          <DeleteTemplateButton id={template.id} name={template.name} />
        </>}
      </PageHeader>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Overview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm">
                {template.description || (
                  <span className="text-muted-foreground">No description.</span>
                )}
              </p>
              {tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge key={tag} variant="secondary">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Implementation checklist</CardTitle>
            </CardHeader>
            <CardContent>
              {steps.length === 0 ? (
                <p className="text-muted-foreground text-sm">No steps yet.</p>
              ) : (
                <ul className="space-y-2.5">
                  {steps.map((step, i) => (
                    <li key={i} className="flex items-start gap-2.5 text-sm">
                      <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {template.reusable_notes ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Reusable notes</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm whitespace-pre-wrap">{template.reusable_notes}</p>
              </CardContent>
            </Card>
          ) : null}
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-base">Pricing</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Client price</span>
              <span className="font-semibold">
                {template.price_satang != null
                  ? formatTHB(template.price_satang)
                  : "—"}
              </span>
            </div>
            <Separator />
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Internal value</span>
              <span className="font-medium">
                {template.internal_value_satang != null
                  ? formatTHB(template.internal_value_satang)
                  : "—"}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
