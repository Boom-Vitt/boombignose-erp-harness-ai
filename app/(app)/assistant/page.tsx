import { PageHeader } from "@/components/page-header"
import { AssistantChat } from "@/components/assistant/assistant-chat"

export const metadata = { title: "ERP AI" }

export default function AssistantPage() {
  return (
    <div className="space-y-5">
      <PageHeader
        title="ERP AI · แชท AI องค์กร"
        description="Chat with the on-device model, attach screenshots and files, and connect the read-only ERP MCP tools. Nothing is sent to a cloud model."
      />
      <AssistantChat />
    </div>
  )
}
