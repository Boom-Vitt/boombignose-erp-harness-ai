# MVP Spec — BoomBigNose Company OS

> AI-native **Company OS** for CRM, project delivery, finance visibility,
> automation, and management dashboards. This is the **operational layer** — not
> a legal accounting/tax system. Accounting integrates with FlowAccount / PEAK /
> Xero later.

## Product goal

Give a founder-led AI studio (founder + 2 junior devs) one place to see and run
the business: clients and deals, project delivery, money in/out, a reusable
automation-template library, and a dashboard showing cash, burn, revenue,
pipeline, and runway. Useful internally first; structured so it can later ship as
a Community + Pro open-core product.

## Irreversible / foundational decisions (review these first)

| Decision | Choice | Why |
|---|---|---|
| Money representation | **Integer satang (`bigint`)**, never floats | Exact, testable finance math; `formatTHB()` at the edges |
| Tenancy | **Multi-tenant-ready, single-org UX.** `org_id` on every business table | Going multi-org later is a policy change, not a migration |
| Isolation | **Postgres RLS** on every table via `private.is_org_member(org_id)`; `force` RLS; service role only for seeding | Enforced in the database, not app code |
| Data access | Next.js **Server Actions + server Supabase client on the user session** | Centralized, validated, secure; no service role in request paths |
| Auth | Supabase Auth (email+password) via `@supabase/ssr` cookies + middleware | Current, httpOnly-cookie sessions |
| Currency / locale | THB, Asia/Bangkok timezone for "today"/"this month" | Thai studio |
| Business logic | **Pure functions** in `lib/` (DB-independent), unit-tested | `npm test` needs no database |

## V1 modules

1. **Auth / Organization** — Supabase Auth, single org, roles owner/admin/member.
2. **Dashboard** — cash, monthly burn, revenue this month, unpaid invoices,
   pipeline value, MRR, active projects, runway, follow-ups due today, overdue.
3. **CRM** — clients, contacts, deals (pipeline), activities/follow-ups.
4. **Project delivery** — projects (from won deals), tasks, milestones/checklist.
5. **Finance tracker** — invoices, payments, costs; gross profit; MRR; no legal tax invoices.
6. **Template / Automation library** — automation_templates, categories.
7. **Automation hooks** — n8n inbound webhooks (followup, invoice-overdue, project-deadline) with `X-Webhook-Secret`.
8. **Settings** — org name, manual cash balance, optional burn override, team list.

## Non-goals (V1) — fence against ERP scope creep

No inventory, procurement, payroll engine, or accounting/tax-invoice generation.
No multi-org **UX** (the data model is ready; the UI is single-org). No native
mobile app in the core MVP (owner override 2026-11-03: a Flutter iOS companion started, see `docs/mobile/README.md`). No per-client code forks. No advanced RBAC beyond owner/admin/member.
Accounting is delegated to FlowAccount/PEAK/Xero (future integration).

## User roles

- **owner** — full access incl. settings/finance edits.
- **admin** — full operational access incl. settings/finance edits.
- **member** — normal CRUD on CRM/projects/finance; read-only settings.

(Enforced by RLS for org isolation + `requireRole()` for sensitive actions.)

## Database entities

`organizations`, `profiles`, `memberships`, `org_settings` ·
`clients`, `contacts`, `deals`, `activities` ·
`projects`, `project_tasks`, `milestones` ·
`invoices`, `payments`, `costs` ·
`template_categories`, `automation_templates`.

Enums: `role_enum`, `deal_stage`, `project_status`, `invoice_status`,
`task_status`, `activity_type`, `payment_method`, `recurring_interval`,
`cost_category`. See `supabase/migrations` and `docs/brainstorm/database.md`.

## Routes / pages

```
/                       → redirects to /dashboard (or /login)
/login                  email+password + demo button
/dashboard              metric cards + follow-ups + attention
/clients, /clients/[id] CRM: clients + contacts (+ related deals/activities)
/deals, /deals/[id]     pipeline board + deal detail + activities
/projects, /projects/[id] delivery board + tasks + milestones (+ from won deal)
/finance                invoices + costs + finance summary; /finance/invoices/[id]
/templates, /templates/[id] automation library
/settings               org settings, cash balance, team
/api/webhooks/n8n/{followup,invoice-overdue,project-deadline}  (X-Webhook-Secret)
/auth/signout           POST sign out
```

## API / server actions (per module)

Server actions are `"use server"`, call `requireOrgContext()`, Zod-validate,
set `org_id`, mutate via the session Supabase client, and `revalidatePath`.
Examples: `createClient/updateClient/addContact`, `createDeal/updateDealStage/addActivity`,
`createProject/addTask/addMilestone`, `createInvoice/recordPayment/createCost`,
`createTemplate/createCategory`, `updateOrgSettings`. Webhooks are Route Handlers
validating `X-Webhook-Secret`.

## Tests required (and present)

Unit (Vitest, pure functions — **43 tests passing**):
- money satang conversion & formatting
- dates (Bangkok today / month / past-due)
- invoice status derivation
- finance: revenue-this-month, costs-this-month, MRR, unpaid total/count, net burn, **runway**
- pipeline: value, weighted value, by-stage
- project profit
- webhook secret validation (constant-time)

Plus `scripts/verify-seed.mjs` (login + RLS read + anonymous isolation) and a
Playwright smoke test for the critical login→dashboard path.

## Acceptance criteria

1. App runs locally (`pnpm dev`) after `supabase start` + `supabase db reset`.
2. README setup works; `.env.example` documents all env; no secrets committed.
3. Demo data loads (fake Thai SMEs); dashboard shows non-empty metrics.
4. Create/edit clients, deals, projects, invoices/payments/costs, templates.
5. Runway, MRR, revenue, unpaid-invoice, pipeline, and project-profit calcs are unit-tested.
6. n8n webhook endpoints exist and reject a missing/invalid `X-Webhook-Secret`.
7. RLS isolates org data (verified: anonymous sees 0 rows).
8. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all pass.
