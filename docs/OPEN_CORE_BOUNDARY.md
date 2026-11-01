# Open-core implementation boundary

Inventory verified on 2026-10-22 against `docs/OPEN_CORE_STRATEGY.md` and source.

| Area | Implementation | Reason |
| --- | --- | --- |
| Client portal | `ee/portal/` | Pro table: tokenized client-facing access, quote acceptance, payment reports, and staff share-link management |
| Accounting | `ee/accounting/` | Pro table: FlowAccount export (fixture or sandbox), PEAK/Xero adapter slots, invoice payload mapping, connection settings, invoice push and sync-map reads/UI |
| Workspaces | `ee/workspaces/` | Pro table: real multi-org list/switcher and hosted or additional-org provisioning |
| BoomBigNose | `bignose/` | Separate proprietary product, including its agent runtime, desktop application and bundled skills; see `bignose/LICENSE` |

`app/portal/[token]/page.tsx` and `app/(app)/settings/accounting/page.tsx`
are thin Next.js edition entry points. Their static `dynamic` settings remain
at the route boundary. Ordinary onboarding and invitation routes are Community
implementations, with no Pro import.

The root `tsconfig.json` maps `@edition` to `lib/edition/community.tsx`.
The default build uses it. `BBN_EDITION=pro` selects `tsconfig.pro.json`, which
maps the same import to `ee/edition.tsx`. The Community implementation shows
one workspace name, omits Pro controls and queries, and returns not-found for
Pro-only routes. The Pro implementation uses the existing commercial modules. Onboarding passes
the edition-selected server action into the shared form. Community selects
`createFirstWorkspace`; Pro selects its hosted `provisionWorkspace` action.
The sidebar accepts a rendered workspace header, so it imports no Pro code.

## Community code deliberately retained

- Signup and confirmed-account login, first-org setup in `app/onboarding/`,
  team invitation creation/revocation in `app/(app)/settings/org-actions.ts`,
  invitation management components, and acceptance at `app/invite/[token]/`.
  The setup actor becomes owner. Owners and admins invite admin/member roles;
  ordinary team membership does not require Pro. Shared cookie/retry helpers
  and tests remain in `lib/supabase/`.
- CRM, deals, projects, tasks, milestones, quotes, operational invoices, receipt
  verification, reports/exports, subscriptions and recurring draft generation.
- Optional typed public document references (`lib/documents/public-reference.ts`,
  `document_public_refs`, and the Settings toggle). They are off by default and
  do not replace tax IDs, accounting document numbers, or existing document
  links. This is Community document identification, not a Pro portal, SSO, or
  accounting integration.
- Dashboard, calendar, template library, blueprint/showcase, and warehouse view.
- Basic AI assists in `lib/ai/`: single-request deal summaries, follow-up drafts,
  and meeting intake. There is no ERP agent loop, tool-executing planner,
  automation-pack marketplace, or advanced agent pack in these modules.
- `lib/automation/`, cron routes and n8n webhooks: baseline reminders, recurring
  billing commands, durable outbox/retries, and inbound receipt deduplication.
  Reliability/security supporting basic workflows is Community infrastructure.
- `lib/mcp/`: tenant-scoped ERP data tools, not the BigNose agent runtime.
- Authentication/session context (`lib/auth.ts`), membership validation, the
  active-org cookie contract, sign-out/account recovery, and fixed
  owner/admin/member checks (`lib/permissions.ts`). A capability lookup over
  those three roles is basic RBAC; no custom roles, policy editor, or SSO exists.
- Shared Supabase clients, generated database types, schema, migrations, RLS,
  and atomic finance/workspace/claim RPC contracts. Historical migrations mix
  these contracts and security fixes across features; they are retained under
  Community terms without rewriting applied history. Pro modules own their
  application-level queries, mutations, and orchestration. A backing table or
  shared RPC does not grant a license to the Pro application implementation.

No separate SSO implementation, advanced RBAC, white-label implementation,
SLA service, or advanced ERP AI/automation pack was found. Future implementations
of those Pro features belong in `ee/` from the outset. Basic AI, recurring
billing/outbox, and shared database contracts are the interpretation points to
revisit if the product boundary changes; do not infer a license from a feature's
name alone.

## Single-org setup and Pro provisioning

The additive migration `20261022090000_community_first_workspace.sql` restricts
the existing authenticated `provision_workspace` RPC to the first organization
in an installation. A transaction advisory lock serializes concurrent setup
across users and retry keys. A matching completed request returns its org only
while the actor remains a member. Changed request data conflicts. Any new setup
request after an org exists fails and directs the user to request an invitation.
The transaction creates the org, owner, settings, audit entry, and retry result
together. It never automatically admits later signups to the existing org.

Pro additional-org and hosted provisioning use the separate
`provision_hosted_workspace` RPC, installed from
`ee/supabase/provision-hosted-workspace.sql` after the shared migrations.
The Pro server action is in `ee/workspaces/actions.ts`. Community migrations do
not install that command. Normal team invitations still use the shared,
authenticated acceptance transaction with recipient and role checks.

## Build and license scope

Default commands build Community. A self-hosted Community installation can
sign up, create its first org, invite its team, and accept invitations with
`ee/` absent. Start from an empty database when testing initial setup. The
optional demo seed already creates an organization and uses demo accounts.
For a fresh local database, `supabase db reset --no-seed` skips that demo data.

For a licensed Pro deployment, retain `ee/`, apply the shared migrations, and
install its additional provisioning SQL with your database administrator:

```sh
psql "$DATABASE_URL" --set ON_ERROR_STOP=1 --file ee/supabase/provision-hosted-workspace.sql
BBN_EDITION=pro pnpm build
BBN_EDITION=pro pnpm start
```

Use `BBN_EDITION=pro pnpm dev` for Pro development and
`pnpm exec tsc --noEmit -p tsconfig.pro.json` for its typecheck. Restart the dev
server after an edition change. Select the edition at build time; changing
only the environment of an already-built server does not change its modules.
An unknown `BBN_EDITION` value fails configuration rather than enabling Pro.

`ee/` is commercial source-available software under `ee/LICENSE`. Production
Pro use requires a commercial agreement. BigNose stays outside the ERP build,
as declared by `tsconfig.json` and `eslint.config.mjs`; its pnpm workspace and
bundled third-party license remain in place.

## Final Pro file inventory

Regenerate with `rg --files ee | sort`.

```text
ee/LICENSE
ee/accounting/actions.ts
ee/accounting/components/accounting-connection-form.tsx
ee/accounting/components/sync-invoice-button.tsx
ee/accounting/flowaccount.test.ts
ee/accounting/flowaccount.ts
ee/accounting/integration-card.tsx
ee/accounting/invoice-actions.test.ts
ee/accounting/invoice-actions.ts
ee/accounting/invoice-sync.test.ts
ee/accounting/invoice-sync.tsx
ee/accounting/mapping.test.ts
ee/accounting/mapping.ts
ee/accounting/provider.ts
ee/accounting/settings-page.tsx
ee/edition.tsx
ee/portal/actions.ts
ee/portal/client-card.test.ts
ee/portal/client-card.tsx
ee/portal/components/accept-quote-button.tsx
ee/portal/components/mark-invoice-paid-button.tsx
ee/portal/components/portal-share-card.tsx
ee/portal/manage-actions.ts
ee/portal/page.tsx
ee/portal/portal-action.test.ts
ee/portal/portal-page.test.ts
ee/supabase/provision-hosted-workspace.sql
ee/workspaces/actions.test.ts
ee/workspaces/actions.ts
ee/workspaces/components/org-switcher.tsx
ee/workspaces/org-switcher.test.ts
ee/workspaces/queries.test.ts
ee/workspaces/queries.ts
```

See `NOTICE`, `COMMERCIAL-LICENSE.md`, `CLA.md`, and `TRADEMARK.md` for the
repository's licensing and contribution boundaries. License preparation does
not certify financial, tax, or customer-production readiness; the separate
acceptance gates in `docs/testing/erp-gates.md` still apply.
