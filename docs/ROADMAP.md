# Roadmap

The current close roadmap is `docs/boombignose/LEGAL_CLOSE.md`. Operational month-end close is on main. A close that is legally valid under Thai rules is the end goal and is not shipped. The V1–V3 list below is the earlier Company OS plan.

From `docs/brainstorm/product-strategy.md`. Strategy: **dogfood an internal
Company OS first**, keep the seams clean (`org_id` everywhere, clean module
boundaries) so it can become an open-core Community + Pro product without a
rewrite.

## V1 — now (internal MVP)

- Auth + single org + roles (owner/admin/member)
- Dashboard (cash, burn, revenue, unpaid, MRR, pipeline, runway, follow-ups, overdue)
- CRM (clients, contacts, deals pipeline, activities)
- Projects (delivery board, tasks, milestones, from-won-deal)
- Finance tracker (invoices, payments, costs, profit, MRR)
- Template / automation library
- n8n webhook hooks (secret-validated placeholders)
- Settings (org, cash balance, team)
- Fake Thai demo data

## V2 — make it sharper

- **Accounting integration**: FlowAccount / PEAK / Xero sync (the legal book of record)
- Reporting & exports (CSV/PDF); saved views; richer filters
- AI assists: deal summaries, follow-up drafting, meeting-summary intake
- Real follow-up automation via n8n/Hermes (LINE reminders), outbound events
- Lightweight `audit_log` and basic activity history
- Email confirmation + auth hardening for real (non-demo) use

## V3 — productize (open-core)

- Real **multi-org UX** (org switcher, invitations) on the already-multi-tenant model
- Self-host packaging + one-command deploy; Community Edition release (AGPL)
- **Pro tier**: hosted SaaS, SSO, advanced RBAC, client portal, automation packs,
  white-label, support/SLA
- Marketplace of automation templates

## Explicit non-goals (guarding against ERP creep)

No inventory, procurement, payroll engine, or accounting/tax-invoice generation in
the core. No per-client forks. Mobile: an iOS MVP (Flutter, QR pair, Tailscale-only) started 2026-11-03 by owner override — see `docs/mobile/README.md`. Accounting
stays in FlowAccount/PEAK/Xero — this product is the operational layer.

## Personas (who we build for)

- **Founder-operator** (primary): one dashboard for pipeline, delivery, and cash.
- **Junior delivery dev**: "my tasks" + fire reusable automation templates.
- **Future SME owner**: shapes the architecture (multi-tenant, self-host) but is
  not a V1 user.
