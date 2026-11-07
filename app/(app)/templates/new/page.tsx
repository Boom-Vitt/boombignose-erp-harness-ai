import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { TemplateForm } from "../_components/template-form"
import { createTemplate } from "../actions"

export const dynamic = "force-dynamic"

export default async function NewTemplatePage() {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "template:manage")
  const supabase = await createClient()
  const { data: categories, error } = await supabase
    .from("template_categories")
    .select("id, name")
    .eq("org_id", ctx.orgId)
    .order("name", { ascending: true })
  if (error) throw new Error("Template categories unavailable. Please reload.")

  async function action(payload: Parameters<typeof createTemplate>[0]) {
    "use server"
    return createTemplate(payload)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="New template" description="Add a reusable automation playbook.">
        <Button variant="outline" render={<Link href="/templates" />}>
          <ArrowLeft /> Back
        </Button>
      </PageHeader>

      <Card className="max-w-2xl">
        <CardContent>
          <TemplateForm
            categories={categories ?? []}
            action={action}
            submitLabel="Create template"
          />
        </CardContent>
      </Card>
    </div>
  )
}
