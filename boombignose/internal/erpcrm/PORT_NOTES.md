# CRM Go port

Verified 2026-11-08 in this worktree. Scope is exclusively `boombignose/internal/erpcrm` and its tests. The baseline `go test ./internal/erpcrm/...` failed on seven undefined methods. All seven now exist. The export audit in `TestOperationsCoverTypeScriptServerExports` finds 26 server actions, page loaders and route handlers and requires an exact match with `Operations()`.

## Operation inventory

All keys below are implemented. The seven completed in this session are marked **new**; the other handlers already existed and were retained, formatted and exercised by package tests.

| Operation key | Handler |
| --- | --- |
| `app/(app)/clients/actions.ts::createClient` | `createClient` |
| `app/(app)/clients/actions.ts::updateClient` | `updateClient` |
| `app/(app)/clients/actions.ts::deleteClient` | `deleteClient` |
| `app/(app)/clients/actions.ts::addContact` | `addContact` |
| `app/(app)/clients/actions.ts::deleteContact` | `deleteContact` |
| `app/(app)/clients/page.tsx::load` | `clientsPage` |
| `app/(app)/clients/[id]/page.tsx::load` | `clientPage` |
| `app/(app)/clients/[id]/edit/page.tsx::load` | `clientEditPage` |
| `app/(app)/clients/new/page.tsx::load` | `clientNewPage` |
| `app/(app)/deals/actions.ts::createDeal` | `createDeal` |
| `app/(app)/deals/actions.ts::quickCreateDeal` | `quickCreateDeal` |
| `app/(app)/deals/actions.ts::updateDeal` | `updateDeal` |
| `app/(app)/deals/actions.ts::updateDealStage` | `updateDealStage` |
| `app/(app)/deals/actions.ts::deleteDeal` | `deleteDeal` |
| `app/(app)/deals/actions.ts::addActivity` | `addActivity` |
| `app/(app)/deals/actions.ts::toggleActivityDone` | `toggleActivityDone` |
| `app/(app)/deals/ai-actions.ts::summarizeDeal` | `summarizeDeal`, **new** |
| `app/(app)/deals/ai-actions.ts::draftFollowup` | `draftFollowup`, **new** |
| `app/(app)/deals/page.tsx::load` | `dealsPage` |
| `app/(app)/deals/[id]/page.tsx::load` | `dealPage`, **new** |
| `app/(app)/deals/[id]/edit/page.tsx::load` | `dealEditPage`, **new** |
| `app/(app)/deals/new/page.tsx::load` | `dealNewPage`, **new** |
| `app/(app)/deals/lost-reasons/actions.ts::addLostReason` | `addLostReason` |
| `app/(app)/deals/lost-reasons/actions.ts::setLostReasonActive` | `setLostReasonActive` |
| `app/(app)/deals/lost-reasons/page.tsx::load` | `reasonsPage`, **new** |
| `app/(app)/deals/export/route.ts::GET` | `exportDeals`, **new** |

No required server action, page loader or route handler is deliberately omitted. A repository-wide search of literal operation keys found no CRM keys in other domain packages and no duplicate keys.

The remaining TypeScript exports are intentionally not separate operations. `dynamic` exports are Next configuration. `DealInput`, `ActivityInput`, `AIResult`, `DealFormValues`, `LostReason`, and `DealOption` are compile-time types. The client component exports (`ClientForm`, `DeleteClientButton`, `AddContactDialog`, `ClientsToolbar`, `DeleteContactButton`, `DealForm`, `ChangeStageSelect`, `MarkWonButton`, `DeleteDealButton`, `DealsBoard`, `AiPanel`, `LostReasonDialog`, `MarkLostButton`, `ActivitiesSection`) remain browser UI. `formatDate` is presentation formatting. `dealFacetRow` is represented by the shared local facet projection, while `dealOptions` serves quote forms outside these handler entry points. `DealWonOffer` is a server-rendered quote-page component outside the required page/action/route inventory; its nested mark-won callback, like the detail page's transition/lose callbacks and edit page's bound update callback, delegates to the registered deal actions rather than defining another public operation.

## Behavior and data contracts

- Sources verified directly: the action and page files listed above, `lib/ai/prompts.ts`, `lib/export/csv.ts`, `lib/money.ts`, `lib/metrics/pipeline.ts`, and the CRM migrations `supabase/migrations/20261025120000_crm.sql` and `20261025160000_crm_fixes.sql`. Wire contracts come from `internal/erpwire/*.go` and `capabilities.json`.
- Operation arguments are ordered JSON arrays. Detail/edit loaders take `[id]`. List/new/reasons/export loaders take `[]` or `[queryParameters]`, using the existing `searchParams` convention. They do not accept an organization, SQL, role or database credential from the browser.
- `DealPageData`, `DealFormData` and `ReasonsPageData` supply the source page's data and controls. Existing `CountLink`, `RecordRef`, facet helpers and named-option queries are reused. Count queries require exact totals. Pageable collections use stable keys and traverse the store's pages.
- AI actions return `ActionResponse.Value` containing exactly `notConfigured`, `content`, or `error`. An absent `TextGenerator` returns `notConfigured` before validating the deal. An injected generator may wrap `ErrAINotConfigured` to report configuration loss. No provider client or model process is created here. Both prompts preserve the source text and tones, include the latest 12 org-scoped activities, and request 512 tokens. Successful content is cached best effort in `ai_outputs` with the actual injected `Model` and actor. Cache failure never loses generated content.
- Stage moves and deletion still call `move_deal` and `delete_deal` inside `Store.Write`. Database triggers retain ownership of probabilities, won/lost timestamps, sequence placement, active-reason checks, quote/client constraints and deletion's activity reassignment. Best-effort audit behavior, redirects and refresh paths follow the source actions. Tests assert exact command arguments and audit values for every one of the 49 stage pairs; they do not implement or prove the PostgreSQL triggers.
- Source comparison found that the preexisting Go deal parser rejected fractional satang and numeric coercions accepted by the TS action. `numbers.go` now uses exact rational arithmetic and `internal/money.Satang` for half-up rounding, including the maximum safe amount, without floating-point money. Optional probability coercion follows the same integer check. Numeric input is bounded to 4096 characters and decimal exponents of magnitude at most 1000 to bound parsing work. Nonfinite inputs are rejected.
- String trimming preserves JavaScript BOM/whitespace behavior and validation lengths remain UTF-16 lengths. Lost-reason toggle forms preserve `Object.fromEntries`' last-value behavior for repeated fields.
- CSV preserves the source header order, filters (including legacy `stage`), BOM, CRLF, no trailing newline, quote escaping, formula protection and Bangkok filename date. Money is emitted as exact decimal baht without redundant zeroes. At very large amounts the old TS `satangToBaht` floating-point division can lose a satang; this port deliberately retains the exact satang under the explicit money requirement, e.g. `90071992547409.91`.

## Shared-contract gaps and integration work

1. `erpwire` has no route-response DTO for status, headers and body. The local `CSVResponse` holds all three. The integrating transport owner must send its body as CSV and its headers as HTTP headers rather than JSON-encode the DTO. That adapter is outside this package's exclusive ownership and was not edited.
2. The shared text interface has no configuration-error type. The package-local `ErrAINotConfigured` is the adapter contract; a generator adapter must translate its provider's configuration failures to this sentinel. `New` requires a nonblank actual model identifier whenever a generator is supplied. No `localai` or bundle code was changed.
3. Form amounts are emitted as exact `json.Number` decimals. JavaScript consumers can still lose precision when converting extreme baht values to a binary number. A fully lossless browser form boundary needs the integrating browser owner to retain decimal text. CSV amounts are already text and do not have this issue.
4. Database error text is limited to the existing safe `BusinessMessage` contract plus known CRM state/constraint mappings. Arbitrary database exception details are not exposed. Read failures fail closed through the package loader errors instead of silently returning fabricated empty data; this is stricter than TS paths that ignore a Supabase read error.

No database migration or actual database operation was executed. No service-role credential, raw SQL, cloud provider, server, local model, npm/Next process, dependency installation or remote Git push was used.

## FAIR and validation

Stable operation keys and the source inventory make handlers findable. All direct reads and mutations bind the actor organization; permissions are checked before data access, with `settings:manage` required for lost-reason administration. CSV is an interoperable UTF-8 open format with exact monetary units and formula protection. Public DTOs, provenance, tests and the integration limits above document reuse.

Observed verification on 2026-11-08, from the `boombignose` module:

```sh
gofmt -l ./internal/erpcrm
go vet ./internal/erpcrm/...
go test ./internal/erpcrm/...
go build ./internal/erpcrm/...
```

All passed; gofmt reported no unformatted files. Tests use a small in-memory `erpwire.Store` and injected text generator. They cover all registered operations' unauthenticated denial, privileged action denial, cross-org read and mutation isolation, exact validation responses, all stage command transitions, audit/navigation values, pagination, BrowserMap output, loader defaults and smart links, money rounding/bounds, prompt bytes, tones, configuration failures, cache failures, facets and CSV bytes.

Not verified: live PostgreSQL grants/RLS, migrations, RPC/trigger execution, HTTP/browser rendering or real model inference. A human administrator must verify database-enforced least privilege and RLS with the actual identities; hooks and these handler tests are not security boundaries. AI/API database identities must remain read-only. These changes are source files and in-memory tests only, and do not provision credentials or grant runtime writes.

## Worker continuity

BBN's phases were applied to this single owned worktree with pstack/Ponytail simplicity review and a final source/contract pass. No merge, PR, independent-review approval or multi-agent run is claimed. The supplied Graft map and blast-radius context were checked against source. No project `graphify-out/graph.json` was present, so no graph relationship was claimed and no out-of-scope graph build was created. The named boombignose-mode was not found as an installed skill entry; the explicit worker instructions in the task governed this port.

The worktree had no root instruction/memory bundle. The user's later exclusive-package constraint forbids creating one outside this directory, so this file records the dated findings, verification and integration next steps. Next steps belong to the transport and database owners and are listed above.

Commit blocker observed 2026-11-08: the requested `git add -A && git commit` was attempted after successful checks. `git add -A` failed with `Operation not permitted` while creating `/Users/boombignose/orca/projects/boombignose-erp-harness-ai/.git/worktrees/erpcrm/index.lock`, outside the writable worktree. No commit was made. All changes remain in this package. Once Git metadata is writable, the intended local commit is:

```sh
git add -A
git commit -m "Complete CRM deal loaders, AI assists and CSV export" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```
