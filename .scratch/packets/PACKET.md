# Task: ERP AI harness = real chat (MCP + file/screenshot upload)

Worktree: ~/orca/projects/bbn-ai-chat-harness
Branch: feat/ai-chat-harness (from origin/main)
Repo: Boom-Vitt/boombignose-erp-harness-ai

## Outcome
The ERP AI harness is a **chat** you talk in: connect MCP tools, upload files and screenshots into the thread — not just the Individual "summarize notes" box.

## Context already in repo
- `components/personal-ai.tsx` — Individual-only note summarizer (HUD chat CSS).
- `lib/mcp/erp-server.mjs` + `docs/desktop/erp-mcp.md` — read-only ERP MCP.
- `bignose/` — full agent chat UI with MCP (`POST /api/mcp`, tool rows, composer). ADR `bignose/docs/decisions/0002-bignose-os.md` (ERP + BigNose panel). Prefer **reuse/adapt** patterns; do not invent a second agent SDK.

## Do (MVP in this PR)
1. Promote harness to all modes (or always on dashboard / dedicated `/assistant` route) titled **ERP AI** / แชท AI องค์กร.
2. Chat thread UI: messages in/out, composer, attach file + paste/upload image/screenshot; show thumbnails in thread.
3. Wire local model path already used by ERP (Ollama loopback) for replies when configured; clear empty/notConfigured state like personal-ai.
4. MCP: settings or composer control to connect/list MCP (at least document + hook to existing erp MCP / local API if BigNose daemon present). If full BigNose sidecar is too heavy for this PR, ship: (a) chat+attachments working on local model, (b) MCP connect UI stub that calls existing erp-server or `/api` endpoints with tests — and HANDOFF for docking BigNose panel if blocked.
5. Security: no silent cloud; attachments stay local/org storage; follow ERP MCP read-only posture for tools.
6. Tests for parser/upload accept image+pdf/text; refuse weird types.
7. Commit, push, PR, auto-merge when green.

## QA criteria
- Can open chat, send a message, see a reply or notConfigured CTA
- Can attach a PNG/JPEG screenshot and see it in the thread
- MCP section visible (connected / how to connect)
- Works outside individual-only gate
- CI green

## Don't
- Don't pull models at desktop startup
- Don't send secrets to cloud
- Don't rewrite all of bignose into Next in one PR
