// SERVER-ONLY. Real MCP handshake (initialize + tools/list) against the existing read-only ERP server, in process.
import "server-only"

import { createErpMcpServer } from "@/lib/mcp/erp-server.mjs"

export type McpStatus = { server: string; protocol: string; readOnly: true; tools: Array<{ name: string; description: string }> }

export async function probeErpMcp(): Promise<McpStatus | { error: string }> {
  // tools/list needs no database; no Supabase call happens until a tool is run.
  const server = createErpMcpServer({ onLog: () => {} })
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
    tools: tools.map((t) => ({ name: t.name, description: (t.description ?? "").slice(0, 200) })),
  }
}
