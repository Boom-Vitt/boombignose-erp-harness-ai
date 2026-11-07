# Project domain port

2026-11-08. Source of truth is the scoped TypeScript in `app/(app)/projects`,
`timesheets`, `calendar`, and `activities`, plus their imported domain helpers.

## Execution checkpoint

- Verified the existing `erpcrm` / `erpwire` operation, actor, store, money, and navigation contracts.
- Inventory is 13 exported actions and seven page loaders; no scoped route handlers.
- Use existing Store transactions and durable billing commands. Keep decimal money exact with `internal/money` and integer/rational arithmetic.
- Keep source edits, test fixtures, validation, and handoff within this package. No runtime, database, model, dependency installation, or unrelated graph/memory writes.
- Implemented all scoped operations and completed the source comparison / Ponytail review pass.
- Verified package-only formatting, vet, tests, and build on 2026-11-08. The requested commit was attempted and blocked by the filesystem sandbox; see the commit handoff below.

The requested boombignose-mode skill was read from the installed Claude skills
directory. Ponytail full and FAIR guide implementation. No existing Graphify graph
or project memory bundle was present in this worktree. Graft's supplied structural
map was checked against source; package notes hold the handoff under the exclusive
write boundary.

## Ported operation keys

Project actions, with their existing authenticated workspace access (no additional staff restriction):

- `app/(app)/projects/actions.ts::createProject`
- `app/(app)/projects/actions.ts::quickCreateProject`
- `app/(app)/projects/actions.ts::updateProject`
- `app/(app)/projects/actions.ts::updateProjectStatus`
- `app/(app)/projects/actions.ts::addTask`
- `app/(app)/projects/actions.ts::toggleTask`
- `app/(app)/projects/actions.ts::addMilestone`
- `app/(app)/projects/actions.ts::toggleMilestone`

Timesheet actions, retaining `record:write`, `invoice:delete`, and `settings:manage` checks and their exact domain rejection text:

- `app/(app)/timesheets/actions.ts::logTime`
- `app/(app)/timesheets/actions.ts::deleteTimeEntry`
- `app/(app)/timesheets/actions.ts::updateTimeEntry`
- `app/(app)/timesheets/actions.ts::billTime`
- `app/(app)/timesheets/actions.ts::setMemberCostRate`

Authenticated page data loaders:

- `app/(app)/projects/page.tsx::load`
- `app/(app)/projects/[id]/page.tsx::load`
- `app/(app)/projects/[id]/edit/page.tsx::load`
- `app/(app)/projects/new/page.tsx::load`
- `app/(app)/timesheets/page.tsx::load`
- `app/(app)/calendar/page.tsx::load`
- `app/(app)/activities/page.tsx::load`

No exported scoped server action or page loader was deliberately omitted. There
are no scoped `route.ts` handlers, CSV/PDF endpoints, or model calls. `dynamic`
exports are rendering metadata, not operations. Inline page server closures
delegate to the canonical project actions; the new-page DTO carries
`resolvedDealId`, and detail/edit DTOs carry the record identity. General record
history/actions remain outside this domain; detail supplies `recordRef` for the
shared history composition, following the existing expense/CRM convention.
The pre-port operation search found no keys from this scope in other packages.

## Behavior and source ownership

- `projects.go` preserves project validation, trimmed names, nullable selects and dates, member owner validation, retained former owners, quick-create defaults, redirect/invalidation paths, all seven accepted statuses, and coherent task `done` / `status` flags. Source enum order is from `lib/types/database.ts`. The action permits every enum-to-enum status change, including reopening a cancelled project, just as the TypeScript does; the UI's suggested flow is not an additional action restriction.
- `input.go`, `timesheets.go`, and the loaders preserve integer minutes, per-entry half-up hourly valuation, non-billable/unrated zero values, exact safe satang bounds, and author/staff edits only when unbilled or linked to a cancelled invoice. Source references are `lib/metrics/{timesheets,projects}.ts`, `lib/{money,dates,search-facets,periods}.ts`, `lib/payments/{input,balances}.ts`, and `lib/workflows/service.ts`. Money uses `internal/money` plus integer/rational arithmetic, never binary floating-point monetary arithmetic. Nonmonetary input hours retain the source binary64 rounding and maximum-minute boundary.
- Time log/update/delete audit writes remain best effort after the successful mutation, matching `lib/audit.ts`. Project status audits remain the existing database `log_record_status` trigger's responsibility; duplicating them here would append two events.
- Billing and member rate changes invoke the existing `bill_project_time` / `set_member_cost_rate` commands inside `Store.Write`. The original project/key/org arguments are unchanged on retries. Atomic invoice creation, safe totals, item descriptions, draft numbering, billing-link locks, rate audit writes, and idempotency stay in the source database commands in `supabase/migrations/20261025110000_time_metrics.sql` and `20261025110500_time_metrics_fixes.sql`. No command was replaced with a process-local approximation.
- Project/timesheet filters, saved views, lifecycle board ordering, nullable budgets, owner names as `BrowserMap`, month metrics independent of current filters, grouping, labour/VAT/credit-note profit, and staff-only member rates are included. Full lists traverse store pagination. Optional project section/options/name read failures retain the source empty fallback through separate read transactions; monetary aggregates that the source rejects still reject. Authorization, cancellation, and identity changes are always propagated.
- Calendar retains the Monday-first six-week grid, adjacent-month spillover, leap years, source year-0-to-99 `Date.UTC` behavior, due-state labels/tones, record links, and independent empty-on-error source reads. Activity lists include only the actor's open entries, ordered by due date then ID, grouped into all four due states. Source references are `lib/calendar/month.ts` and `lib/record-history/{model,due,queries}.ts`. Calendar/month/period calculations use Bangkok; the legacy project deadline helper keeps server-local midnight and en-GB date labels, including `Sept`.

## Shared-contract gaps and integration handoff

1. **Layout invalidation.** `erpwire.ActionResponse.Refresh` only carries paths, so `setMemberCostRate` returns `/timesheets` and `/projects`. It cannot represent the source's `revalidatePath("/projects", "layout")` scope. The integration owner must extend the shared contract/browser adapter for exact descendant-layout invalidation. Shared files were not edited.
2. **Database error text.** `erpcore/business_errors.go` currently exposes reviewed subscription/expense messages, not time command/guard messages. This package preserves the exact known time messages when `BusinessMessage()` supplies them, and locally handles edit/task validation. A redacted error cannot be reconstructed locally. Until the shared allowlist includes the source time messages, other command rejections such as `No billable unbilled time`, `Idempotency conflict`, and `Member unavailable` use `Unable to save changes. Please try again.` Arbitrary SQL/constraint details are never echoed.
3. **Team profile projection.** `erpcore/query.go` restricts direct `profiles` reads to the actor. The local workaround uses the existing org-scoped `record_activity_assignees` read RPC. It resolves current workspace members without scanning another tenant. A former owner's ID is retained, and the edit selector uses `Former member`; names for departed members with no current-org RPC row remain unknown. This follows the existing CRM workaround without widening shared profile access.
4. **Integration outside ownership.** The application composition root must instantiate `New(Options{Store: store})` and register `Operations()`, then consume these DTOs and bind canonical actions in the browser adapter. Those files and shared record-history composition are outside the exclusive package. No transport registration, production runtime switch, or UI execution is claimed here.

## Validation and FAIR status

Observed on 2026-11-08 in the `boombignose` module:

- `gofmt -l ./internal/erpprojects` passed with empty output.
- `go vet ./internal/erpprojects/...` passed.
- `go test ./internal/erpprojects/...` passed.
- `go build ./internal/erpprojects/...` passed.

The in-memory store rejects missing tenant predicates, enforces fixture parent
scope, supports relations/pagination, and rolls back failed fake transactions.
Table tests assert the 20-key inventory, zero-actor denial, exact validation and
capability messages, cross-org read/write rejection, 49 project transitions,
task/milestone transitions, 192 author/role/invoice edit/delete combinations,
money overflow and half-satang boundaries, per-entry rounding, audit behavior,
unchanged billing retry arguments, financial permissions, filtering, prefills,
optional-read recovery, and calendar/activity aggregation.

FAIR is implemented in source through stable documented keys, JSON DTOs, exact
money, explicit tenant predicates, actor/capability checks, and source references.
These are fake-store tests, not verification of a live database's RLS, grants,
function privileges, concurrency, invoice numbering, or command idempotency. A
human administrator must verify least-privilege identities and permitted/denied
operations against the actual database before enabling this domain. AI/API
database identities must remain read-only. No database changes were executed.
No servers, Node/Next commands, models, installations, pushes, or other worktree
changes were performed.

## Commit handoff

Observed on 2026-11-08: `git add -A && git commit` failed at staging with exit 128.
Git could not create the worktree's `index.lock` in the shared Git metadata
directory because it is outside the writable sandbox (`Operation not permitted`).
No commit was created; `git status --short` lists only this package as untracked.
No alternative Git metadata directory or other-worktree workaround was used.
The completed package is ready for the integration owner to stage and commit
from an environment permitted to write this worktree's Git metadata, with:

```text
Port project, timesheet, calendar and activity operations to Go

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>
```
