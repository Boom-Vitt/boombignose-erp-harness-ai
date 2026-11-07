import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ClientForm } from "../../_components/client-form"
import { updateClient } from "../../actions"

export default async function EditClientPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  if (!z.guid().safeParse(id).success) notFound()
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const { data: client, error } = await supabase
    .from("clients")
    .select("id, name, industry, source, notes, tax_id, branch_label")
    .eq("org_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle()
  if (error) throw new Error("Client editor unavailable. Please reload.")

  if (!client) notFound()

  // Bind the client id so the shared form keeps its (values) => {...} shape.
  const updateAction = updateClient.bind(null, client.id)

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <PageHeader
        title="Edit client"
        description={`Update ${client.name}'s details.`}
      >
        <Button
          variant="ghost"
          size="sm"
          render={<Link href={`/clients/${client.id}`} />}
        >
          <ArrowLeft />
          Back
        </Button>
      </PageHeader>

      <Card>
        <CardContent>
          <ClientForm
            action={updateAction}
            submitLabel="Save changes"
            defaultValues={{
              name: client.name,
              tax_id: client.tax_id ?? "",
              branch_label: client.branch_label ?? "",
              industry: client.industry ?? "",
              source: client.source ?? "",
              notes: client.notes ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  )
}
