import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { satangToBaht } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  TemplateForm,
  type TemplateFormDefaults,
} from "../../_components/template-form"
import { updateTemplate } from "../../actions"

export const dynamic = "force-dynamic"

function toSteps(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((s): s is string => typeof s === "string")
}

export default async function EditTemplatePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const ctx = await requireOrgContext()
  requireCapability(ctx, "template:manage")
  const supabase = await createClient()

  const [{ data: template, error: templateError }, { data: categories, error: categoryError }] = await Promise.all([
    supabase
      .from("automation_templates")
      .select(
        "id, name, description, internal_value_satang, price_satang, reusable_notes, implementation_checklist, tags, category_id"
      )
      .eq("id", id)
      .eq("org_id", ctx.orgId)
      .maybeSingle(),
    supabase
      .from("template_categories")
      .select("id, name")
      .eq("org_id", ctx.orgId)
      .order("name", { ascending: true }),
  ])
  if (templateError || categoryError) throw new Error("Template editor unavailable. Please reload.")

  if (!template) notFound()

  const defaults: TemplateFormDefaults = {
    name: template.name,
    categoryId: template.category_id,
    description: template.description,
    internalValueBaht:
      template.internal_value_satang != null
        ? satangToBaht(template.internal_value_satang)
        : null,
    priceBaht:
      template.price_satang != null ? satangToBaht(template.price_satang) : null,
    reusableNotes: template.reusable_notes,
    checklist: toSteps(template.implementation_checklist),
    tags: template.tags ?? [],
  }

  async function action(payload: Parameters<typeof updateTemplate>[1]) {
    "use server"
    return updateTemplate(id, payload)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Edit template" description={template.name}>
        <Button variant="outline" render={<Link href={`/templates/${id}`} />}>
          <ArrowLeft /> Back
        </Button>
      </PageHeader>

      <Card className="max-w-2xl">
        <CardContent>
          <TemplateForm
            categories={categories ?? []}
            defaults={defaults}
            action={action}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
    </div>
  )
}
