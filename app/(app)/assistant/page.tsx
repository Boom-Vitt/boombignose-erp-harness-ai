import { PageHeader } from "@/components/page-header"
import { AssistantChat } from "@/components/assistant/assistant-chat"
import { getOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "ERP AI" }

export default async function AssistantPage() {
  const ctx = await getOrgContext()
  const supabase = await createClient()
  const { data } = ctx ? await supabase.from("profiles").select("locale").eq("id", ctx.userId).maybeSingle() : { data: null }
  return (
    <div className="space-y-5">
      <PageHeader title="ERP AI" />
      <AssistantChat profileLocale={data?.locale ?? "th"} />
    </div>
  )
}
