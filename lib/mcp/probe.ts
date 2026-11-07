// SERVER-ONLY. Real MCP handshake (initialize + tools/list) against the existing read-only ERP server, in process.
import "server-only"

import { createErpMcpServer } from "@/lib/mcp/erp-server.mjs"
import type { OrgContext } from "@/lib/auth"
import { assistantToolNames } from "@/lib/ai/assistant-evidence"
import { capabilitiesFor } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { createSupabaseDataLayer } from "@/lib/mcp/data.mjs"

export type McpStatus = { server: string; protocol: string; readOnly: true; tools: Array<{ name: string; description: string }> }

export async function probeErpMcp(ctx: Pick<OrgContext, "orgId" | "role">): Promise<McpStatus | { error: string }> {
  // The handshake lists capabilities without running a data query or launching a process.
  const server = createErpMcpServer({ onLog: () => {}, erpOrgId: ctx.orgId, trustedCapabilities: capabilitiesFor(ctx.role), createDataLayer: async () => createSupabaseDataLayer(await createClient()) })
  const init = (await server.handleMessage({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "erp-ai-chat", version: "1" } } })) as
    | { result?: { protocolVersion?: string; serverInfo?: { name?: string } } }
    | null
  const list = (await server.handleMessage({ jsonrpc: "2.0", id: 2, method: "tools/list" })) as
    | { result?: { tools?: Array<{ name: string; description?: string }> } }
    | null
  const tools = list?.result?.tools
  if (!init?.result || !tools) return { error: "The ERP MCP server did not answer." }
  return {
    server: init.result.serverInfo?.name ?? "boombignose-erp",
    protocol: init.result.protocolVersion ?? "",
    readOnly: true,
    tools: tools.filter((tool) => assistantToolNames(ctx.role).has(tool.name)).map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 200) })),
  }
}
