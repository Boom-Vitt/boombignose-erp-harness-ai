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
	<a href="https://boom-vitt.github.io/boombignose-erp-harness-ai/">Website</a>
	-
	<a href="./docs">Documentation</a>
	-
	<a href="https://github.com/Boom-Vitt/boombignose-erp-harness-ai/issues">Issues</a>
</div>

The download page is [https://boom-vitt.github.io/boombignose-erp-harness-ai/](https://boom-vitt.github.io/boombignose-erp-harness-ai/). The previous address [https://boom-vitt.github.io/boombignose-erp/](https://boom-vitt.github.io/boombignose-erp/) is retired and returned HTTP 404 after the rename deploy. Releases are at [https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/latest](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/latest). Tag `boombignose-v0.2.0` is the desktop window. Tag `boombignose-v0.1.1` is the older harness command.

Release `boombignose-v0.2.0` is the Wails window. GitHub Actions builds it with Go and attaches:

- `BoomBigNose-windows-x64-setup.exe` — unsigned NSIS installer. The installed program is `BoomBigNose.exe` and opens a window. SmartScreen can show More info, then Run anyway. Smart App Control may still block an unsigned app.
- `BoomBigNose-macos-arm64.dmg` — ad-hoc signed (`codesign --sign -`). There is no paid Apple Developer certificate, so opening can require Open Anyway.
- `BoomBigNose-linux-amd64.tar.gz` — the window binary named `BoomBigNose`. It needs WebKitGTK 4.1.
- `BoomBigNose-linux-amd64.AppImage` — the same binary. It also needs WebKitGTK 4.1.
- `SHA256SUMS` for those four files.

Those v0.2.0 installers do not bundle Node, Docker, Postgres, or Ollama. They have not been click-tested on a physical machine. Tag `boombignose-v0.1.1` is the older harness command, not this window. No code-signing certificate was purchased.

The desktop app name is BoomBigNose. From tag `boombignose-v0.3.0` the BoomBigNose installers include a private Node runtime, `server.js`, Postgres, Auth, PostgREST, and Ollama inside the app. Node is not the product name.

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
- **Reports and Calendar**: Revenue by month and by client, hours by project and cost of goods sold, shown as bar, line or pivot views. Saved views, CSV export, and a calendar of follow-ups, meetings, due dates and deadlines.
- **Automation and AI**: Reusable automation templates, scheduled follow-up reminders, an outbox that delivers events to n8n, and inbound n8n webhooks. AI deal summaries, follow-up drafts and meeting-note intake call Ollama on this machine (`127.0.0.1:11434` by default). If Ollama is not running, those screens say so and do not call a cloud model.
- **Across the app**: A command palette on Ctrl/Cmd+K, a search and filter bar on list pages, a status header and a history of notes, attachments and activities on business records, and an audit log for owners and admins.
- **Team**: Owner, admin and member roles, and invitations shared by link.

### Under the Hood

- [**Next.js 16**](https://nextjs.org) with the App Router, React 19 Server Components and Server Actions, written in TypeScript. Server Actions validate their form input with [Zod](https://zod.dev).
- [**Supabase**](https://supabase.com) for Postgres and authentication. Every table carries an `org_id` with forced Row Level Security, so one organization can never read another's data. The service-role key never reaches the browser.
- Money is stored as integer satang (`bigint`), never as floating point. Business rules live as pure functions in `lib/` with Vitest unit tests that need no database. Database rules have their own SQL tests, and Playwright covers the main flows end to end.

### Scope

BoomBigNose ERP is not a general ledger. Statutory accounting, tax filing, payroll and manufacturing are out of scope. VAT and withholding tax are calculated on documents only, so this is not a statutory tax system or an e-Tax Invoice service. Customer credit notes are in development.

## Editions

| | Community | Pro |
|---|:---:|:---:|
| License | [AGPL-3.0](./LICENSE) or [Commercial](./COMMERCIAL-LICENSE.md) | [Commercial](./ee/LICENSE) |
| Every module listed above | Yes | Yes |
| Sign-up, first workspace, team invitations, owner/admin/member roles | Yes | Yes |
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
   git clone https://github.com/Boom-Vitt/boombignose-erp-harness-ai.git
   cd boombignose-erp-harness-ai
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

`NEXT_PUBLIC_*` values are baked into the build, so rebuild after you change them. [`.env.example`](./.env.example) is a commented template.

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

A packaged one-command install is planned. Today a production install takes four steps.

1. Create a Supabase project and apply the migrations with `pnpm exec supabase link` and `pnpm exec supabase db push`. Do not load the demo seed.
2. In Supabase Auth, set the Site URL to your app URL, add `<app URL>/auth/confirm` to the redirect URLs, and configure custom SMTP so confirmation emails reach your users.
3. Set the environment variables above, then run `pnpm build` and `pnpm start` on any Node.js 22 host.
4. Call `POST /api/cron/followups`, `/api/cron/outbox` and `/api/cron/subscriptions` on a schedule with the `X-Cron-Secret` header.

A licensed Pro install also needs `ee/supabase/provision-hosted-workspace.sql` and a build with `BBN_EDITION=pro`. See [the open-core boundary](./docs/OPEN_CORE_BOUNDARY.md#build-and-license-scope).

For the hosted Pro edition, contact [boombignose.org](https://boombignose.org).

## Learning and Community

1. [Documentation](./docs): open-core boundary, n8n integration, testing gates, and security and PDPA notes.
2. [Website](https://boom-vitt.github.io/boombignose-erp-harness-ai/): product overview.
3. [Issues](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/issues): bug reports and feature requests.

## Contributing

1. [Contributing guide](./CONTRIBUTING.md): run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` before you open a pull request.
2. [Contributor License Agreement](./CLA.md): required for every pull request.
3. [Issue templates](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/issues/new/choose): for bug reports and feature requests.

## Security

Report vulnerabilities privately through [GitHub Security Advisories](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/security/advisories/new), never in a public issue. See [SECURITY.md](./SECURITY.md) for what to include and for the fallback contact. Do not put real customer data into a demo install, and read the [PDPA notes](./docs/PDPA_SECURITY_NOTES.md) before you go live.

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
