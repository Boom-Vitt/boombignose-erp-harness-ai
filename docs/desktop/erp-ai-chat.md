# ERP AI chat (`/assistant`)

A chat thread in the ERP for every mode (SME, Startup, Individual). Nav: **ERP AI / แชท AI องค์กร**.

## What it does
- Multi-turn chat against the loopback Ollama only (`OLLAMA_HOST`, `OLLAMA_MODEL`). A remote host, a stopped service or a missing model shows the not-configured CTA that links to Settings → Local AI. The route never pulls a model and never calls a cloud model.
- Attach files by button or by pasting an image into the box. Accepted, by file content not by name: PNG/JPEG/WebP (shrunk to JPEG in the browser, thumbnail shown in the thread), PDF, `.txt .md .csv .tsv .json .log`. Everything else is refused (`lib/ai/chat-attachments.ts`).
- Images in the newest message go to the local vision model (`qwen2.5vl:3b`); otherwise the text model. Text files are inlined as fenced data, never as instructions.
- Attachments and the thread live in the page's memory and in the request to loopback Ollama. They are not written to the database or to storage.
- MCP panel: `GET /api/assistant/mcp` runs a real `initialize` + `tools/list` against `lib/mcp/erp-server.mjs` in process (no database touched) and lists the read-only tools, with the stdio connector config to copy. See `erp-mcp.md`.

## Not in this PR (HANDOFF)
- **Tool calls from the thread.** The chat lists the ERP MCP tools but does not run them; the BigNose desktop panel does. To dock it: add a tool-call loop in `lib/ai/assistant-chat.ts` that sends `tools` to Ollama and runs calls through `createErpMcpServer().handleMessage` (`tools/call`, needs local Supabase; scope `org_id` to the signed-in org, never the model's argument). Keep the read-only posture.
- **PDF pages are not read.** The PDF is accepted and shown, and the model is told it could not read it. Add text extraction (and a dependency decision) before relying on it.
- **Streaming and saved history.** Replies arrive whole; threads reset on reload. Persisting needs an org-scoped table and a retention decision.
- Reusing the `bignose/` chat UI as a sidecar panel (ADR `bignose/docs/decisions/0002-bignose-os.md`) is a separate piece of work.
