import { PageHeader } from "@/components/page-header"
import { AssistantChat } from "@/components/assistant/assistant-chat"
import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "ERP AI" }

export default async function AssistantPage() {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const { data } = await supabase.from("profiles").select("locale").eq("id", ctx.userId).maybeSingle()
  return (
    <div className="space-y-5">
      <PageHeader title="ERP AI" />
      <AssistantChat key={`${ctx.userId}:${ctx.orgId}`} profileLocale={data?.locale ?? "th"} workspaceName={ctx.orgName} />
    </div>
  )
}
