# ERP insight port

## Scope and provenance

2026-11-08. This package follows `erpcrm`'s `New(Options)` and `Operations()` contract from `boombignose/internal/erpcrm/service.go`, and the authenticated transaction and argument types in `boombignose/internal/erpwire/{database,operation,actor}.go`. Source behavior is declared by the TypeScript paths listed below and their imports. No application, adapter, schema, migration, dependency, or other package files were changed.

The task's explicit exclusive-directory rule takes precedence over initializing a root memory bundle or graph output. The supplied Graft repository map and source reads were used. This worktree has no existing `graphify-out/graph.json`, `AGENTS.md`, `INSTRUCTIONS.md`, or `.project-memory/`; no graph or root instruction files were created. No separate installed `boombignose-mode` skill was found; the worker constraints supplied in the task govern this port. BBN sequences the work, pstack supplies scoped implementation/review, and Ponytail full keeps the existing transaction/registry design.

## Operation keys

- `app/(app)/views/actions.ts::createSavedView`
- `app/(app)/views/actions.ts::deleteSavedView`
- `app/(app)/intake/actions.ts::intakeMeeting`
- `app/(app)/import/actions.ts::importSheet`
- `app/(app)/import/page.tsx::load`
- `app/(app)/documents/actions.ts::setPublicDocumentRefsEnabled`
- `app/(app)/documents/actions.ts::issueDocumentPublicReference`
- `app/(app)/documents/lookup/page.tsx::load`
- `app/(app)/documents/ocr/page.tsx::load`
- `app/(app)/assistant/page.tsx::load`
- `app/(app)/audit/page.tsx::load`
- `app/(app)/audit/close/page.tsx::load`
- `app/(app)/audit/close/actions.ts::findSupportExport`
- `app/(app)/audit/close/actions.ts::reviewSupportPack`
- `app/(app)/audit/close/export/route.ts::GET`
- `app/(app)/automation/page.tsx::load`
- `app/(app)/network/page.tsx::load`
- `app/(app)/reports/page.tsx::load`
- `app/(app)/reports/statements/page.tsx::load`
- `app/(app)/reports/vat/page.tsx::load`
- `app/(app)/reports/wht/page.tsx::load`
- `app/(app)/reports/accountant-pack/page.tsx::load`
- `app/(app)/reports/print/route.ts::GET`
- `app/(app)/reports/vat/export/route.ts::GET`
- `app/(app)/reports/wht/export/route.ts::GET`
- `app/(app)/reports/accountant-pack/export/route.ts::GET`
- `app/(app)/reports/accountant-pack/print/route.ts::GET`
- `app/(app)/reports/wht/actions.ts::recordPurchaseWithholding`
- `app/(app)/reports/lang-action.ts::saveLang`

## Existing ownership and deliberate exclusions

2026-11-08, observed from `erpmetrics/service.go` and `erpexpenses/service.go` and operation-key searches. These keys already exist and are deliberately not duplicated:

- `app/(app)/dashboard/page.tsx::load`
- `app/(app)/blueprint/page.tsx::load` (including its scene model in `erpmetrics/scene.go`)
- `app/(app)/expenses/page.tsx::load`
- `app/(app)/expenses/[id]/page.tsx::load`
- `app/(app)/expenses/new/page.tsx::load`
- `app/(app)/expenses/actions.ts::createExpenseClaim`
- `app/(app)/expenses/actions.ts::addExpenseLine`
- `app/(app)/expenses/actions.ts::removeExpenseLine`
- `app/(app)/expenses/actions.ts::transitionExpenseClaim`
- `app/(app)/expenses/actions.ts::rejectExpenseClaim`

`intake/page.tsx` is a client component with no server loader. Metadata, `dynamic` constants, TypeScript types, and client component exports are not request handlers. OCR's scoped page only authenticates and returns the workbench's initial empty data; actual OCR API routes are outside `app/(app)/documents/**`. Network enrollment, ingest, policy mutations and assistant chat API routes likewise live in `app/api/**`, outside this worker's assigned scope. No new model implementation is included; meeting intake uses only the injected `TextGenerator` and explicit configured model identifier.

## Contracts and integration gaps

2026-11-08, source inspection only; native runtime integration is not tested here.

- `HTTPResponse` is package-local because `erpwire` has no route response DTO. The host dispatcher must apply its status, headers and exact UTF-8 body, rather than JSON-encode a download as its final HTTP response.
- Report pivots expose `BrowserMap` cells and row/column totals. JavaScript closure methods cannot cross the operation boundary; the browser must read those values with missing intersections equal to zero.
- `erpcore/store.go`'s `ReadRPC` allowlist does not admit `find_support_export` or `verify_close_activity_chain`; the integration owner must admit these read-only functions under their source authorization. This package cannot edit that shared list. Correction to the initial discovery: `Command` has no corresponding static name list; it resolves installed public functions through the checked schema (`erpcore/query.go:call`). `record_purchase_withholding`, `record_support_export`, `review_support_pack` and `adjust_stock` therefore require the existing source migrations and grants, whose installation was not tested here.
- Source actions sometimes expose raw Supabase `error.message`. This port preserves adapter-approved `BusinessMessage()` values and uses a domain fallback for arbitrary driver errors, so unapproved SQL/credential details cannot leak. Exact raw database error parity requires the shared adapter to expose the corresponding reviewed business messages; it is not fabricated here.
- `saveLang` is implemented for a workspace-bound actor, including own-profile scope and invalid-language no-op. The TypeScript action also permits authenticated users before they have a workspace. `erpwire.Actor` and `Store` require verified workspace membership and have no authenticated-user-only transaction contract, so that pre-workspace case cannot be represented safely in this package. It needs a shared authenticated-profile operation contract; this port does not invent an organization or bypass Store authorization.
- PostgreSQL remains the owner of stock adjustments, WHT sequences and rate/lock checks, close-chain verification, support review idempotency and export audit writes. No Go-only substitute claims to enforce their concurrency or database rules.
- The constructor is not wired into a host registry in this patch because files outside this package are excluded. Runtime registration, route/DTO adaptation and command admission remain integration work.

## FAIR and database boundary

2026-11-08, source-declared and fake-store tested. Stable operation keys make the handlers findable. Actor validation, capability checks, active-org predicates, per-user saved-view ownership and explicit projections govern access. CSV, UTF-8 JSON and integer satang preserve interoperable data; ordered DTOs, provenance, pure parsers and focused tests support reuse. All database access is expressed through authenticated `erpwire.Store` callbacks; no credentials, raw SQL, service role or live connection is used. The code files describe source application mutations; no database changes were applied by this task. Actual read-only API/AI credentials, grants, RLS and allowed/denied operations require administrator provisioning and verification. Hooks are not treated as authorization.

## Work record

2026-11-08. Grounded the explicit registry/Actor/Store design in the existing packages; rejected a generic table-dispatch operation because it would weaken the fixed operation and field contract. Implemented disjoint domain files and reviewed them against their TypeScript sources. Cross-review found and corrected best-effort saved-view lookup behavior, JavaScript whitespace/object-order details, import UTF-8/XLSX/quantity edge cases, report snapshot trust boundaries, and stable equal-name party ordering. Migration inspection identified non-`id` primary keys for `document_public_refs` and `network_policy`; their queries and schema-aware fake checks now use the real columns. Final review also checked repeated query parameters, locked Zod 4.6.7 validation wording, and WHT redirect URI/UTF-16 behavior. No npm/Next command, dependency install, server, database, model process, network provider call, push or other-worktree modification was performed.

2026-11-08 validation, run from `boombignose/` on the completed package:

- `gofmt -l ./internal/erpinsight` PASS, no output.
- `go vet ./internal/erpinsight/...` PASS.
- `go test ./internal/erpinsight/...` PASS.
- `go build ./internal/erpinsight/...` PASS.
- `git diff --check` PASS. Source-key inventory found 29 unique scoped app keys and no overlap with existing packages.

Tests use in-memory stores and assert concrete values for authorization and tenant/user isolation, parsing/validation errors, money boundaries and overflow, partial import persistence, document-reference settings/issuance/reuse/collision retries, review idempotency, close readiness/lock states, statement aging, exact CSV fields/BOM/CRLF/formula guards, checksum recording/refusal and HTML escaping/print inputs. No live RLS, migrations, runtime browser dispatch or database-backed sequence/concurrency acceptance was run. Next integration steps are host registration/DTO adaptation, the two read-RPC admissions, approved business-error mapping, and administrator verification of installed functions/grants/RLS. The pre-workspace language action needs the authenticated-profile contract described above.

Commit blocker, observed 2026-11-08: the requested `git add -A && git commit` sequence failed during `git add` with exit 128, `Unable to create .../.git/worktrees/erpinsight/index.lock: Operation not permitted`. The worktree's Git metadata is outside the session's writable roots, and elevation is unavailable. No commit or staging was created. The only worktree change remains this new package. A permitted session can finish with `git add -A && git commit -m "Port ERP insight operations to Go" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"` after reviewing the package.
