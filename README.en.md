<!-- BBN:HEADER:START -->
<img src="site/assets/brandmark.png" width="180" alt="BoomBigNose" />
<!-- BBN:HEADER:END -->

<div align="center">

<h2>BoomBigNose ERP</h2>
<p>Open-source ERP for businesses of every size</p>

[![License](https://img.shields.io/badge/license-AGPL--3.0%20%7C%20Commercial-blue?style=flat-square)](./LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-16-000000?style=flat-square&logo=nextdotjs&logoColor=white)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20RLS-3FCF8E?style=flat-square&logo=supabase&logoColor=white)](https://supabase.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)

**English** · [ภาษาไทย](./README.th.md)

</div>

<div align="center">
	<a href="https://boom-vitt.github.io/nose-erp/">Website</a>
	-
	<a href="./docs">Documentation</a>
	-
	<a href="https://github.com/Boom-Vitt/nose-erp/issues">Issues</a>
</div>

The download page is [https://boom-vitt.github.io/nose-erp/](https://boom-vitt.github.io/nose-erp/). The previous address [https://boom-vitt.github.io/boombignose-erp/](https://boom-vitt.github.io/boombignose-erp/) is retired and returned HTTP 404 after the rename deploy. Releases are at [https://github.com/Boom-Vitt/nose-erp/releases/latest](https://github.com/Boom-Vitt/nose-erp/releases/latest). Tag `boombignose-v0.2.0` is the desktop window. Tag `boombignose-v0.1.1` is the older harness command.

Release `boombignose-v0.2.0` is the Wails window. GitHub Actions builds it with Go and attaches:

- `BoomBigNose-windows-x64-setup.exe` — unsigned NSIS installer. The installed program is `BoomBigNose.exe` and opens a window. SmartScreen can show More info, then Run anyway. Smart App Control may still block an unsigned app.
- `BoomBigNose-macos-arm64.dmg` — ad-hoc signed (`codesign --sign -`). There is no paid Apple Developer certificate, so opening can require Open Anyway.
- `BoomBigNose-linux-amd64.tar.gz` — the window binary named `BoomBigNose`. It needs WebKitGTK 4.1.
- `BoomBigNose-linux-amd64.AppImage` — the same binary. It also needs WebKitGTK 4.1.
- `SHA256SUMS` for those four files.

Those v0.2.0 installers do not bundle Node, Docker, Postgres, or Ollama. They have not been click-tested on a physical machine. Tag `boombignose-v0.1.1` is the older harness command, not this window. No code-signing certificate was purchased.

The desktop app name is BoomBigNose. From tag `boombignose-v0.3.0` the BoomBigNose installers include a private Node runtime, `server.js`, Postgres, Auth, PostgREST, and Ollama inside the app. Node is not the product name.

The product you run is that desktop window. It opens the local ERP at `http://127.0.0.1:3100`. Month-end close, bank lines, cash at close, statements, the accountant pack, sheet import, and the local backup control are screens in that window. The page on GitHub Pages is the brochure and the installer download. It is not where those screens run.

**Release boundary:** the confirmed published release is [1.4.4 (`ddc5c11`)](https://github.com/Boom-Vitt/nose-erp/releases/tag/boombignose-v1.4.4). New local AI/OCR, task profiles, organization workload 3D, headless server and private mobile controls described in current-source docs are not claimed as shipped there. Integrated page/AI/OCR/recovery/real-phone acceptance is not established by source changes or health checks.

## BoomBigNose ERP

BoomBigNose ERP runs sales, purchasing, inventory, projects and billing for a business on one database. It is built for Thai businesses first, with VAT and withholding tax on documents, THB amounts and the Asia/Bangkok time zone built in, and it works for a two-person shop as well as a growing company with several teams.

### Motivation

Most businesses start with a CRM, a project tool, a spreadsheet of invoices and a stock list that never quite agree with each other. BoomBigNose ERP keeps those records in one place, so a quote becomes an invoice, an invoice becomes a delivery, and the dashboard shows the cash position without copying numbers between tools. It handles the operational side of the business and leaves the statutory books to the accounting software you already use, such as FlowAccount, PEAK or Xero.

### Key Features

- **Dashboard**: Cash, monthly burn, runway, revenue, unpaid and overdue invoices, MRR and weighted pipeline on one screen, with a list of items that need attention such as overdue vendor bills and expense claims waiting for approval.
- **CRM**: Clients and contacts with their deals, quotes, invoices, projects and open balance in one view. A kanban deal pipeline with win probability, expected revenue and required lost reasons. Scheduled activities grouped as late, today and upcoming. Web-to-lead forms that turn website enquiries into deals.
- **Sales**: Quotations with product lines and VAT that you can email or print. An accepted quote converts into one or more invoices by remaining quantity, chosen quantity, or a percentage or fixed deposit. Subscriptions raise recurring invoices on a schedule.
- **Invoicing and Payments**: Invoices move from draft to issued to paid, and an issued invoice is frozen so its number and amounts cannot change. Withholding tax at 1, 2, 3 or 5 percent, a business tax profile, recorded payments with bank date and method, a finance lock date for closed periods, and adoption of invoices created before the current rules.
- **Purchasing**: Vendors, requests for quotation sent by email, purchase orders, partial receipts, vendor bills and purchase returns with vendor credits.
- **Inventory**: Warehouses, stock on hand and its value, a full stock movement history, deliveries and customer returns from the invoice, physical counts, and replenishment that drafts requests for quotation grouped by vendor.
- **Products**: A catalog with SKU, unit, price, cost, tax rate and a stockable flag. Picking a product on a quote or invoice line fills in its details.
- **Expenses**: Expense claims that staff submit and a manager approves or rejects. Nobody can approve their own claim, and approved claims become costs in Finance.
- **Projects and Timesheets**: Projects as a list or kanban board, with tasks, milestones and logged time. Billable time turns into a draft invoice in one step. Member cost rates and project profit are visible to owners and admins only.
- **Reports and Calendar**: Revenue by month and by client, hours by project and cost of goods sold, shown as bar, line or pivot views. Operational profit, VAT, and aging statements. A month-end close checklist, cash at close, and an accountant pack of output VAT, purchase VAT, and withholding for the external accountant. Saved views, CSV export, and a calendar of follow-ups, meetings, due dates and deadlines.
- **Automation and AI**: Reusable automation templates, scheduled follow-up reminders, an outbox that delivers events to n8n, and inbound n8n webhooks. AI deal summaries, follow-up drafts, meeting-note intake, and the Finance month-end note call Ollama on this machine (`127.0.0.1:11434` by default). If Ollama is not running, those screens say so and do not call a cloud model. Settings → Local AI models downloads, lists, and removes models inside the ERP. You do not install Ollama Desktop, ComfyUI, Whisper, or a separate voice app for the modalities this build can run.
- **Across the app**: A command palette on Ctrl/Cmd+K, a search and filter bar on list pages, a status header and a history of notes, attachments and activities on business records, and an audit log for owners and admins.
- **Team**: Owner, admin, accountant, and member roles, and invitations shared by link. An accountant can record finance and review the close. A member cannot.

### Under the Hood

- [**Next.js 16**](https://nextjs.org) with the App Router, React 19 Server Components and Server Actions, written in TypeScript. Server Actions validate their form input with [Zod](https://zod.dev).
- [**Supabase**](https://supabase.com) for Postgres and authentication. Business access uses verified workspace membership, role/capability checks and RLS; review each table/RPC rather than assume every table has the same policy shape. Service-role is server-only, but not seed-only: dedicated cron, invitation/public token and device-ingest paths must authorize and scope their own privileged operations. Native browser login/MFA uses the same-origin loopback Auth relay; session cookies remain JavaScript-readable, not universally httpOnly. See [SECURITY.md](./SECURITY.md#current-source-security-boundaries).
- Money is stored as integer satang (`bigint`), never as floating point. Business rules live as pure functions in `lib/` with Vitest unit tests that need no database. Database rules have their own SQL tests, and Playwright covers the main flows end to end.

### Local models

The current-source native stack starts bundled Ollama on loopback (default `127.0.0.1:11434`) only when the address is unused; it does not replace an independently managed daemon. No model weights are in git/the installer or downloaded at startup. Use Settings (`/settings#local-models`) or an explicit CLI pull.

| Workload / hardware planning guidance | Current-source model | License / boundary |
|---|---|---|
| Thai/English OCR; allow 12 GB RAM for ERP+model | `qwen3.5:4b`; measured Mac artifact 3,973,305,013 bytes | [Apache-2.0](https://huggingface.co/Qwen/Qwen3.5-4B/resolve/main/LICENSE); Thai/English/Thai-numeral CER 1.227%/0%/3.004%; clean amounts/IDs matched, but degraded rotated JPEG/PDF had a wrong month; human review required |
| ERP chat/assistant images; allow 24 GB+ RAM | `qwen3.5:9b-q4_k_m`; GGUF artifact 6,550,825,550 bytes | [Apache-2.0](https://huggingface.co/Qwen/Qwen3.5-9B/resolve/main/LICENSE); portable bounded-context GGUF required; no complete current AI quality acceptance has passed |
| Image generation, macOS | `x/flux2-klein:4b` | Separate modality; see actual catalog |
| Speech, Apple Silicon | `phonon` | English built-in voice, not Thai/voice cloning |
| Speech-to-text, Linux/Windows | whisper.cpp b5454 + `ggml-tiny.bin` | No packaged macOS runtime in this build |

`boombignose pull-model` or `boombignose pull-model qwen3.5:9b-q4_k_m` installs the chat/assistant-image default; `boombignose pull-model qwen3.5:4b` installs the separate OCR default. `OLLAMA_MODEL` and `OCR_MODEL` are separate selectors; restart after changing them. Browser installation/removal requires owner/admin capability **and** explicit OS-enrolled machine-operator authority. The [catalog](./boombignose/internal/bundle/ollama_models.json) controls named pulls/platform eligibility; see [Ollama](https://ollama.com/library/qwen3.5). RAM is planning guidance, not a measured minimum. Measurements use a 48 GiB Apple Silicon host and synthetic corpus, not cross-host accuracy/latency certification. Actual figures and coverage are server-owned; AI proposals await human review and cannot create, approve, pay or delete records.

Chat requires GGUF and explicitly disables truncation/context shifting. Local GGUF rejected a 40,018-token prompt at requested context 32,768; bare `qwen3.5:9b` on Mac used MLX and accepted it, so that alias is not a portable bounded-context substitute. Separate OCR may still use local MLX. There is no silent model fallback or prompt truncation. Latest 9B GGUF candidates failed independent evidence validation; 27B is neither an approved default nor evidence that a larger model is better.

Chat uses the publisher's [non-thinking sampling guidance](https://huggingface.co/Qwen/Qwen3.5-9B#best-practices): temperature 0.7, top-p 0.8, top-k 20, min-p 0 and repetition penalty 1; presence penalty is 1.5 for lookup and 0.5 for the final review plan. Near-greedy decoding produced a measured repeated-token loop; extending its output allowance is not a fix. Numeric/reference validation remains mandatory. Previous assistant replies are not current ERP evidence: record questions require fresh authorized reads, and source-free guidance cannot contain findings or be presented as verified workspace balances.

Assistant **Source access** defaults to **ERP records**, which requires fresh authorized reads even for follow-ups. **Guidance / documents** performs no ERP reads; use it for file-only interpretation or unverified general guidance. Changing access explicitly starts a new thread. ERP answers contain server-owned facts plus selected human-review task codes, not model-authored amounts/status claims. Mandatory workspace receivables stay visible; other cited details can be expanded separately. UUID checks describe only the actual scoped/bounded read, not another tenant's record existence. Conversation text is not silently sliced to a shorter thread; exceeding the message/context bound requires an explicit new thread. Images are sent only from the current user message, so reattach an image for a visual follow-up.

Typhoon OCR is not the default: despite its model-card Apache label, [official terms](https://opentyphoon.ai/tac) restrict personal-data input, competitive benchmarking and similar services and purport to apply through third-party/model access. Seek clarification/legal review rather than assume the label resolves that conflict. Pulls contact registries, but inference requires loopback and checks metadata for remote/cloud aliases before business bytes. Spawned Ollama has no-cloud mode; the owner must secure any pre-existing daemon. There is no permanent cloud fallback or hostile-OS sandbox.

OCR uses a locally shipped PDF.js worker and a bounded pure-Go server raster decoder, supports JPEG/PNG/WebP/PDF with page/pixel/byte limits, and produces unverified review suggestions, not confidence scores. Sharp is development-only, not a runtime requirement. Unknown fields remain null, not zero; compare originals and use explicit expense/purchase save actions. Neither OCR nor chat posts accounts or files tax. See [privacy and limits](./docs/PDPA_SECURITY_NOTES.md#local-ai-ocr-and-attachments) and [distribution requirements](./NOTICE).

### Scope

BoomBigNose ERP is not a general ledger. Statutory accounting, tax filing, payroll and manufacturing are out of scope. VAT and withholding tax are calculated on documents only, so this is not a statutory tax system or an e-Tax Invoice service. Customer credit notes are in development.

## Editions

| | Community | Pro |
|---|:---:|:---:|
| License | [AGPL-3.0](./LICENSE) or [Commercial](./COMMERCIAL-LICENSE.md) | [Commercial](./ee/LICENSE) |
| Every module listed above | Yes | Yes |
| Sign-up, first workspace, team invitations, owner/admin/accountant/member roles | Yes | Yes |
| AI assistant, automation and scheduled jobs | Yes | Yes |
| Client portal: customers view documents, accept quotes and report payments | | Yes |
| FlowAccount invoice export (fixture demo on this machine, or sandbox when a server token is set). PEAK and Xero are not connected in this build | | Yes |
| Multiple workspaces with a workspace switcher | | Yes |
| Hosted workspace provisioning | | Yes |

The default build is Community. Pro code lives in [`ee/`](./ee/) and is built with `BBN_EDITION=pro`. See [the open-core boundary](./docs/OPEN_CORE_BOUNDARY.md) for exactly what sits on each side.

## Development Setup

### Prerequisites

- [Node.js 22+](https://nodejs.org) and [pnpm](https://pnpm.io)
- [Docker](https://docs.docker.com/get-docker/) for the local Supabase stack
- The [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) is installed with the dev dependencies, so `pnpm exec supabase` works without a global install

### Local

1. Clone the repository and install dependencies
   ```sh
   git clone https://github.com/Boom-Vitt/nose-erp.git
   cd nose-erp
   pnpm install
   ```

2. Start Supabase, then apply the migrations and load the demo data
   ```sh
   pnpm exec supabase start
   pnpm exec supabase db reset
   ```

3. Create `.env.local` and fill in the URL and keys printed by `supabase status`
   ```sh
   cp .env.example .env.local
   pnpm exec supabase status
   ```

4. Start the app and open `http://localhost:3000`
   ```sh
   pnpm dev
   ```

To start with an empty database instead, run `pnpm exec supabase db reset --no-seed`, sign up at `/signup`, confirm the email (local mail goes to the Inbucket inbox that `supabase status` lists), and create your workspace at `/onboarding`. Confirmation links use `site_url` in `supabase/config.toml` (`http://127.0.0.1:3100`), so run the app at that address and set `NEXT_PUBLIC_APP_URL` to match, or change both and restart Supabase. To check the seed and Row Level Security after a reset, load `.env.local` into your shell and run `node scripts/verify-seed.mjs`.

### Demo accounts

| Email | Password | Role |
|---|---|---|
| `demo@boombignose.org` | `BoomDemo123!` | owner |
| `nattapong@boombignose.org` | `BoomDemo123!` | member |
| `praewa@boombignose.org` | `BoomDemo123!` | member |

The **Use demo account** button on the login page appears only when `NEXT_PUBLIC_DEMO_LOGIN_EMAIL` and `NEXT_PUBLIC_DEMO_LOGIN_PASSWORD` are set. Never set them in production.

### Environment

| Variable | Required | Purpose |
|---|:---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase API URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key, safe for the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only key for scheduled jobs, webhooks, invitations, public lead forms and the Pro client portal |
| `NEXT_PUBLIC_APP_URL` | Yes | Public URL of the app, used in invitation, lead-form and email links |
| `CRON_SECRET` | Yes | Checks the `X-Cron-Secret` header on scheduled jobs |
| `N8N_WEBHOOK_SECRET` | Yes | Checks the `X-Webhook-Secret` header on inbound n8n webhooks |
| `N8N_OUTBOUND_URL`, `N8N_OUTBOUND_SECRET` | No | Turns on delivery of outbox events to n8n |
| `OLLAMA_HOST`, `OLLAMA_MODEL` | No | Local Ollama address (default `127.0.0.1:11434`) and model. A remote host is refused |
| `RESEND_API_KEY` | No | Turns on outbound email through Resend |
| `EMAIL_FROM` | No | Sender address for outbound email |
| `LEAD_FORM_TRUST_PROXY` | No | Set to `true` behind a proxy that overwrites `X-Forwarded-For`, so lead-form rate limits apply per visitor |
| `LEAD_FORM_IP_SECRET` | No | Key for hashing lead-form visitor IPs. Falls back to the service-role key |
| `BBN_EDITION` | No | `community` (default) or `pro`, chosen at build time |

For a conventional source web build, `NEXT_PUBLIC_*` values are inlined at build time. The native bundle also injects a strictly public runtime Supabase URL/anon-key/Auth-relay selector so one standalone build can run on private per-profile ports; private service credentials are never in that payload. See [`.env.example`](./.env.example) and the [native runbook](./docs/boombignose/BUNDLE.md).

Server-side sessions, the Auth relay, and privileged clients also resolve their Supabase backend from the running process, not the public build-time defaults. When validating a standalone bundle on different ports, use a fixture present only in the intended database and confirm that reads and explicit writes stay there; identical copied workspaces alone cannot prove backend isolation.

### Scripts

```sh
pnpm dev          # development server
pnpm build        # production build
pnpm test         # unit tests, no database needed
pnpm typecheck    # TypeScript check
pnpm lint         # ESLint
pnpm e2e          # Playwright tests, needs the isolated stack in docs/testing/erp-gates.md
pnpm local:up     # start the local Supabase stack and apply pending migrations
```

## Production Setup

### Native local-first desktop / headless server

Use the [source-matched native deployment runbook](./docs/boombignose/BUNDLE.md#headless-server-installation-and-private-access) for current-source artifact paths, dedicated OS account/systemd setup, distinct ports/private data+secrets, first-owner local onboarding, explicit MFA enrollment, operator enrollment, offline `secure-db`, private Tailscale HTTPS and DB-only/full recovery. The native Go/Wails desktop remains the GUI; the separate Go CLI needs no WebKit/display. These new instructions are not an assertion that the published 1.4.4 binary supports the new commands. Do not expose Auth/REST/DB/model ports, use public Funnel or replace unrelated Serve mappings.

### Separately managed hosted web deployment

The following is a different deployment choice, not a prerequisite for native local mode:

1. Create a Supabase project and apply the migrations with `pnpm exec supabase link` and `pnpm exec supabase db push`. Do not load the demo seed.
2. In Supabase Auth, set the Site URL to your app URL, add `<app URL>/auth/confirm` to the redirect URLs, and configure custom SMTP so confirmation emails reach your users.
3. Set the environment variables above, then run `pnpm build` and `pnpm start` on any Node.js 22 host.
4. Call `POST /api/cron/followups`, `/api/cron/outbox` and `/api/cron/subscriptions` on a schedule with the `X-Cron-Secret` header.

A licensed Pro install also needs `ee/supabase/provision-hosted-workspace.sql` and a build with `BBN_EDITION=pro`. See [the open-core boundary](./docs/OPEN_CORE_BOUNDARY.md#build-and-license-scope).

For the hosted Pro edition, contact [boombignose.org](https://boombignose.org).

## Learning and Community

1. [Documentation](./docs): open-core boundary, n8n integration, testing gates, and security and PDPA notes.
2. [Website](https://boom-vitt.github.io/nose-erp/): product overview.
3. [Issues](https://github.com/Boom-Vitt/nose-erp/issues): bug reports and feature requests.

## Contributing

1. [Contributing guide](./CONTRIBUTING.md): run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` before you open a pull request.
2. [Contributor License Agreement](./CLA.md): required for every pull request.
3. [Issue templates](https://github.com/Boom-Vitt/nose-erp/issues/new/choose): for bug reports and feature requests.

## Security

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/Boom-Vitt/nose-erp/security/advisories/new), never in a public issue. See [SECURITY.md](./SECURITY.md) for what to include and for the fallback contact. Do not put real customer data into a demo install, and read the [PDPA notes](./docs/PDPA_SECURITY_NOTES.md) before you go live.

## License

Community Edition is dual-licensed under [AGPL-3.0-only](./LICENSE) or a separately agreed [Commercial license](./COMMERCIAL-LICENSE.md). Pro code in [`ee/`](./ee/) is commercial source-available software under [`ee/LICENSE`](./ee/LICENSE), and production use requires a commercial agreement. [`bignose/`](./bignose/LICENSE) is a separate proprietary product and is not covered by the AGPL. Third-party licenses are listed in [NOTICE](./NOTICE).

## Logo and Trademark Policy

The BoomBigNose name and logo are reserved. Forks must rebrand under [TRADEMARK.md](./TRADEMARK.md).

<div align="center">
<br />
Copyright © 2026 BoomBigNose AI Co., Ltd.
</div>

<!-- BBN:FOOTER:START -->
[Made by BoomBigNose](https://github.com/Boom-Vitt)
<!-- BBN:FOOTER:END -->
