# BoomBigNose ERP Harness AI — local architecture

Product name: **BoomBigNose ERP Harness AI**, short name **BoomBigNose**. This describes current development source. The confirmed published baseline is [1.4.4 (`ddc5c11`)](https://github.com/Boom-Vitt/nose-erp/releases/tag/boombignose-v1.4.4); new AI/OCR, headless, private mobile and operator-security work is not claimed as shipped or fully acceptance-tested there.

## Native supervisor and runtime

`boombignose/cmd/boombignose-desktop` remains the Go/Wails GUI (`-tags desktop`). It starts the private portable Node/Next ERP, PostgreSQL16, Auth, PostgREST and Ollama services, then opens the loopback ERP origin (default `http://127.0.0.1:3100`). The separate CGO-disabled `cmd/boombignose` CLI supervises the same stack with `serve` without a webview, GUI toolkit or Docker dependency. Business rules remain in Postgres/TypeScript rather than being duplicated in Go.

macOS discovers resources under `Contents/Resources/bundle`; Linux/Windows keep `bundle/` beside the executable. Source packaging rebuilds a target-native CGO-disabled Go raster helper and prunes Sharp/libvips and optional PDF.js Node canvas addons; no Linux native image addon may survive into another platform. Generated runtime and notice inventories must still be checked on the actual artifact. Credentials/JWT state and attachments live outside installers; new clusters use separate random SCRAM role credentials. Old trust clusters need explicit offline `secure-db`, never a reset. See [portable bundle/deployment/recovery](./BUNDLE.md).

ERP, API, Auth, REST and PostgreSQL ports are configurable and must be distinct; choose independent private data and unused ports for concurrent profiles rather than stopping another program on3100. Only a separately administered HTTPS ERP front door is reachable by authorized tailnet clients; backend addresses remain loopback. The native persisted origin/operator policy lives in `BOOMBIGNOSE_DATA + ".secrets/runtime.json"`. Configuring a public origin is not automatic tunnel setup or proof of phone access.

## What stays where it is

Business writes stay in the Postgres functions already shipped with the ERP. The Go module does not reimplement them. `boombignose/internal/money` only formats an integer satang amount. The Next.js UI stays the screen inside the webview.

## Auth

Normal Supabase email/password login, refresh and MFA remain the session mechanism. Native browser requests use fixed same-origin `/auth/local/*` routes with trusted-browser/origin checks and a small Auth endpoint allowlist; they do not reach a public Auth/REST service. The browser client retains the original Supabase URL for cookie namespace compatibility. `@supabase/ssr` session cookies are JavaScript-readable, not universally httpOnly; the active-workspace selector is a separate httpOnly cookie. HTTPS transport does not encrypt those tokens or other files at rest.

`LOCAL_TOTP_ENROLL=1` opens enrollment at `/settings/security`; closing enrollment does not remove verified factors. An enrolled verified factor requires AAL2 at shared page/API boundaries; unknown assurance fails closed, while unenrolled accounts can remain AAL1. Network staff RLS additionally enforces assurance in the database. Do not generalize that guarantee to every existing SQL policy. Workspace membership/role/RLS remains separate from individual/SME/organization task preferences.

Service-role is private server state, not compiled into the GUI/browser and not seed-only. Explicit privileged cron, invitation/provisioning, public lead-token, mobile connection-record and network-ingest paths authenticate/scope their own operations. Normal business access stays session-bound. Browser all-workspace DB backup/restore additionally requires owner/admin plus an explicit OS-enrolled machine operator; QR pairing never grants a session/role. See [security boundaries](../../SECURITY.md#current-source-security-boundaries).

## Cloud calls the gate refuses

- [`lib/ai/client.ts`](../../lib/ai/client.ts) requires loopback Ollama; [`local-runtime.ts`](../../lib/ai/local-runtime.ts) inspects model metadata and refuses cloud/remote aliases before business bytes. Loopback alone is not proof a model runs locally.
- Current-source chat/assistant images default to `qwen3.5:9b-q4_k_m` (GGUF, 6,550,825,550 bytes), OCR to separate `qwen3.5:4b` (3,973,305,013 bytes); selectors are separate. Chat requires portable GGUF with truncation/context shifting disabled: local GGUF rejected 40,018 prompt tokens at requested context 32,768, while the bare Mac 9B MLX alias accepted them. Separate OCR may use local MLX; no silent model fallback. Sampling uses temperature 0.7/top-p 0.8/top-k 20/min-p 0/repetition penalty 1, with presence penalty 1.5 for lookup and 0.5 for the final review plan. Actual figures/coverage are server-owned and proposals await human review. Actual 48 GiB Mac task/corpus results, failed current AI quality acceptance, and RAM planning (24 GB+ chat/12 GB OCR, not cross-host certification) are in [model guidance](../../README.en.md#local-models). Host-wide model/ASR/update mutations require OS-enrolled operator authority in addition to owner/admin. Explicit pulls contact the registry; startup never pulls. Spawned Ollama has no-cloud mode; an independent daemon must be secured by its owner.
- Native policy refuses configured cloud-provider credentials and non-loopback service URLs; children receive an allowlisted environment, not arbitrary parent credentials. This does not sandbox malicious local software or prove no egress from all processes/features. A trusted OS/daemon, disk encryption, patching and separately reviewed exports/integrations remain operator responsibilities.
- OCR uses local PDF.js page rendering and server-side validation by the pure-Go raster helper before local inference. Unknown/ambiguous values stay null, review against originals is required, and extraction never posts financial records. Source code is not final Thai/English accuracy/latency evidence; see [models and privacy limits](../PDPA_SECURITY_NOTES.md#local-ai-ocr-and-attachments).

## Pages

The desktop window is the product surface. After sign-in on `http://127.0.0.1:3100`, month-end work stays in that webview:

| Screen | Path |
| --- | --- |
| Finance, including the Ollama month-end note | `/finance` |
| Bank lines | `/finance/bank` |
| Cash at close | `/finance/cash` |
| Month-end close checklist | `/reports#month-end-close` |
| Operational profit, VAT, and aging | `/reports/statements` |
| Accountant pack (output VAT, purchase VAT, withholding) | `/reports/accountant-pack` |
| Customer, product, and opening-stock import | `/import` |
| Local database backup | `/settings` |

`boombignose/internal/shell.FinanceScreens` lists those paths and refuses to place them on any host other than the loopback ERP. FlowAccount export is a Pro control inside the same window (`/settings/accounting` when `BBN_EDITION=pro`). It is an export from an issued invoice, not a page on the brochure.

The site at `site/` is a static brochure and the installer download. It is not the app and it does not call a model.
