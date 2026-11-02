# ERP AI chat (`/assistant`)

A chat thread in the ERP for every mode (SME, Startup, Individual). Nav: **ERP AI / แชท AI องค์กร**.

## What it does
- Multi-turn chat against the loopback Ollama only (`OLLAMA_HOST`, `OLLAMA_MODEL`). A remote host, a stopped service or a missing model shows the not-configured CTA that links to Settings → Local AI. The route never pulls a model and never calls a cloud model.
- Attach files by button or by pasting an image into the box. Accepted, by file content not by name: PNG/JPEG/WebP (shrunk to JPEG in the browser, thumbnail shown in the thread), PDF, `.txt .md .csv .tsv .json .log`. Everything else is refused (`lib/ai/chat-attachments.ts`).
- Images in the newest message go to the local vision model (`qwen2.5vl:3b`); otherwise the text model. Text files are inlined as fenced data, never as instructions.
- Attachments and the thread live in the page's memory and in the request to loopback Ollama. They are not written to the database or to storage.
- **Tool calls from the thread.** On the text model the chat sends the read-only ERP MCP tools to Ollama (`tools`) and runs each call the model makes through `createErpMcpServer().handleMessage` (`tools/call`), up to 4 rounds, then returns the grounded answer plus compact tool chips (`list_clients · 12 rows`). Rules, all in `erpToolRunner` (`lib/ai/assistant-chat.ts`): only `list_*` / `finance_*` tools are offered; `list_workspaces` (every org) is never offered; `org_id` is hidden from the model and overwritten with the signed-in org on every call, whatever the model sends; any other tool name is refused. Needs local Supabase (the MCP server reads it with the service role, so the org rewrite is the isolation boundary). If Supabase is down the tool result is an error the model relays; chat itself still works. Image turns use the vision model, which gets no tools; a model that rejects `tools` falls back to plain chat.
- **Language.** Thai by default; the **สลับ ENG / สลับ ไทย** button in the card header shows one language at a time for every string on the screen (`COPY` in `components/assistant/assistant-chat.tsx`). Initial language is `profiles.locale` (default `th`); a choice made with the button wins and is remembered in this browser (`localStorage` key `bbn-ui-lang`). It is not written back to the profile yet.
- MCP panel: `GET /api/assistant/mcp` runs a real `initialize` + `tools/list` against `lib/mcp/erp-server.mjs` in process (no database touched) and lists the read-only tools, with the stdio connector config to copy. See `erp-mcp.md`.

## Not in this PR (HANDOFF)
- **PDF pages are not read.** The PDF is accepted and shown, and the model is told it could not read it. Add text extraction (and a dependency decision) before relying on it.
- **Streaming and saved history.** Replies arrive whole; threads reset on reload. Persisting needs an org-scoped table and a retention decision.
- Reusing the `bignose/` chat UI as a sidecar panel (ADR `bignose/docs/decisions/0002-bignose-os.md`) is a separate piece of work.
