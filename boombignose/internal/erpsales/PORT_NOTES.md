# Sales-domain Go port

## Current handoff, 2026-11-08

Implemented 70 pure operation handlers in `internal/erpsales`, module `github.com/Boom-Vitt/nose-erp/boombignose`. `New(Options)` requires an authenticated `erpwire.Store`; `Operations()` exposes stable TypeScript path/export keys. Production runtime wiring is owned outside this package and was not changed. This package is source code, not a running API or database deployment.

Read this file, the relevant scoped TypeScript source, `erpwire/{actor,database,operation,capabilities.json}`, then the corresponding Go handlers before extending the port. The user's exclusive-package limit superseded root memory initialization; no root instructions/memory or shared package were changed. This file is the durable worktree handoff.

Workflow applied BBN six phases and pstack poteto/figure-it-out for source inventory, concrete domain seams, implementation, fake-store verification and handoff; Ponytail full for exact decimal arithmetic and reuse. Graft's supplied structural map was verified against source. No project Graphify graph exists in this worktree; no graph build, installation or unrelated memory setup was run under the exclusive-write/command limits. A separate installed `boombignose-mode` skill was not located; the user's explicit worker constraints define this run.

## Implemented behavior and provenance

Source-declared, verified by file inspection on 2026-11-08:

- Quotes preserve create/update/delete, draft/sent editing, status transitions and expiry, owner/admin acceptance/conversion/cancellation, partial line/deposit conversion arguments and durable keys, revalidation/redirects, best-effort source audits, client email/activity logging and list/new/detail/printable data. Quote number reservation uses `reserve_document_number` and commits before insertion, as the source RPC does. Draft totals, tax recomputation, acceptance/conversion project/milestone/invoice effects and concurrent guards remain owned by the existing database commands/triggers.
- Templates preserve management permissions, nullable pricing with exact decimal half-away-from-zero satang rounding, category slugging, trimmed checklist/tags and all library/detail/editor/new data. No floating-point monetary calculations or new dependencies.
- Purchasing preserves vendor schemas, purchase creation/approval/transition/update, cumulative receipt snapshots and tolerance floors, compare-against-previous checks, returns, bills/credits and cumulative billed rounding, idempotent bill payment, settings upsert, RFQ claim/send/finish/recovery, provider delivery keys, escaped section-aware HTML and all page/printable data. Query-only library exports are additionally available for callers.
- Products preserve pricing, catalogue validation, active/archive transitions, SKU/stock-history error mapping, cost visibility in picker responses and all page data. Inventory preserves warehouse/count/transfer/delivery/return/reorder/replenishment/policy commands, retry keys, exact quantities, stock documents and escaped stock print HTML, all page data, filtering, saved views, ledger cursors and full pagination.
- Shared line-grid action preserves the complete `saveDocumentLines` contract for quote, purchase-order and invoice callers, including their different capabilities, schema validation, stable row IDs, exact quantity-times-price overflow checks, atomic `save_document_lines`, audit summary, refresh and reload-failure recovery. Its RPC has no `p_org_id`; a scoped parent read inside the same transaction verifies the actor's current workspace before dispatch, and the SQL function remains security-invoker with RLS/guards.
- Facets, groups, period boundaries and timestamp month grouping follow Asia/Bangkok. Browser Map values use `erpwire.BrowserMap`; optional null/empty strings remain distinct where the source distinguishes them. Optional public references are canonical Bech32m-checked and returned by detail/print loaders.

Relevant source includes `app/(app)/{quotes,templates,purchases,vendors,products,inventory}`, `lib/products`, `lib/purchasing`, `lib/inventory`, `lib/line-grid`, `lib/workflows/service.ts`, `lib/money.ts`, `lib/search-facets.ts`, `lib/periods.ts`, `lib/dates.ts`, `lib/email`, and `lib/documents/{public-reference,public-reference-query,sales-chain,sales-chain-query}.ts`. Atomic database behavior was inspected in `supabase/migrations/20261026091500_mixed_deposits.sql`, `20261026110000_line_grid.sql`, `20261026120400_purchase_approval.sql`, `20261026120500_rfq_recovery.sql`, `20261026120600_scheduled_replenishment.sql`, `20261026120800_stock_noop_retries.sql` and their prerequisite migrations. SQL source inspection is not a live database test.

## Every operation key

- `app/(app)/inventory/adjust/page.tsx::load`
- `app/(app)/inventory/documents/[id]/print/route.ts::GET`
- `app/(app)/inventory/documents/page.tsx::load`
- `app/(app)/inventory/moves/page.tsx::load`
- `app/(app)/inventory/page.tsx::load`
- `app/(app)/inventory/replenish/page.tsx::load`
- `app/(app)/inventory/transfer/page.tsx::load`
- `app/(app)/inventory/warehouses/page.tsx::load`
- `app/(app)/products/[id]/edit/page.tsx::load`
- `app/(app)/products/[id]/page.tsx::load`
- `app/(app)/products/new/page.tsx::load`
- `app/(app)/products/page.tsx::load`
- `app/(app)/purchases/[id]/page.tsx::load`
- `app/(app)/purchases/[id]/pdf/route.ts::GET`
- `app/(app)/purchases/actions.ts::approvePurchase`
- `app/(app)/purchases/actions.ts::createPurchase`
- `app/(app)/purchases/actions.ts::createPurchaseBill`
- `app/(app)/purchases/actions.ts::linkVendorCredit`
- `app/(app)/purchases/actions.ts::markBillPaid`
- `app/(app)/purchases/actions.ts::receivePurchase`
- `app/(app)/purchases/actions.ts::reopenPurchaseRFQ`
- `app/(app)/purchases/actions.ts::returnPurchase`
- `app/(app)/purchases/actions.ts::transitionPurchase`
- `app/(app)/purchases/actions.ts::updateBillTolerance`
- `app/(app)/purchases/actions.ts::updatePurchase`
- `app/(app)/purchases/email-actions.ts::sendPurchaseRFQ`
- `app/(app)/purchases/new/page.tsx::load`
- `app/(app)/purchases/page.tsx::load`
- `app/(app)/quotes/[id]/page.tsx::load`
- `app/(app)/quotes/[id]/pdf/route.ts::GET`
- `app/(app)/quotes/actions.ts::cancelQuoteInvoice`
- `app/(app)/quotes/actions.ts::convertQuoteToInvoice`
- `app/(app)/quotes/actions.ts::createQuote`
- `app/(app)/quotes/actions.ts::deleteQuote`
- `app/(app)/quotes/actions.ts::setQuoteStatus`
- `app/(app)/quotes/actions.ts::updateQuote`
- `app/(app)/quotes/email-actions.ts::sendQuoteEmail`
- `app/(app)/quotes/new/page.tsx::load`
- `app/(app)/quotes/page.tsx::load`
- `app/(app)/templates/[id]/edit/page.tsx::load`
- `app/(app)/templates/[id]/page.tsx::load`
- `app/(app)/templates/actions.ts::createCategory`
- `app/(app)/templates/actions.ts::createTemplate`
- `app/(app)/templates/actions.ts::deleteTemplate`
- `app/(app)/templates/actions.ts::updateTemplate`
- `app/(app)/templates/new/page.tsx::load`
- `app/(app)/templates/page.tsx::load`
- `app/(app)/vendors/[id]/edit/page.tsx::load`
- `app/(app)/vendors/[id]/page.tsx::load`
- `app/(app)/vendors/actions.ts::saveVendor`
- `app/(app)/vendors/new/page.tsx::load`
- `app/(app)/vendors/page.tsx::load`
- `lib/inventory/actions.ts::adjustStock`
- `lib/inventory/actions.ts::createReplenishment`
- `lib/inventory/actions.ts::deleteWarehouse`
- `lib/inventory/actions.ts::deliverInvoice`
- `lib/inventory/actions.ts::returnInvoiceDelivery`
- `lib/inventory/actions.ts::savePurchasingPolicy`
- `lib/inventory/actions.ts::saveReorder`
- `lib/inventory/actions.ts::saveWarehouse`
- `lib/inventory/actions.ts::setNegativeStock`
- `lib/inventory/actions.ts::transferStock`
- `lib/line-grid/actions.ts::saveDocumentLines`
- `lib/products/actions.ts::saveProduct`
- `lib/products/actions.ts::setProductActive`
- `lib/products/queries.ts::activeProductOptions`
- `lib/purchasing/queries.ts::overdueVendorBillCount`
- `lib/purchasing/queries.ts::purchaseDetail`
- `lib/purchasing/queries.ts::purchaseOptions`
- `lib/purchasing/queries.ts::vendorDetail`

## Deliberately unported exports

No exported server action, page data loader or route handler within the assigned application paths is deliberately omitted. An operation-inventory audit on 2026-11-08 compared scoped page/route/action exports and imported server-action files against registrations; zero missing keys and zero duplicate keys with existing Go packages. The 70 keys include four additionally exposed `lib/purchasing/queries.ts` exports.

Type-only exports, page `dynamic` declarations, React rendering/client components and browser retry storage are not server operation keys. Page-local non-exported server closures delegate to their registered exported actions. Imported pure validation, calculations and query transformations are incorporated locally. `lib/inventory/math.ts::stockBalance` is an unimported reference calculator, not a production request dependency; valuation remains in the existing ledger commands/views. Document number suggestions are not used by the scoped request flows; production numbering uses the existing reserved-number/database commands.

## Shared-contract gaps and local workarounds

1. **Exact SQL error text is blocked upstream.** Observed in `erpcore/business_errors.go` on 2026-11-08, `DatabaseError.BusinessMessage()` exposes reviewed subscription/expense errors only and discards other original PostgreSQL messages. This package preserves trusted `BusinessMessage()` and explicit source validation errors, but cannot recover discarded quote/purchase/stock/line-grid or PostgREST diagnostic wording. Non-business infrastructure errors use safe generic text. The shared owner must review and extend that allowlist for full error-text parity; no shared file was edited and no raw SQL diagnostic is exposed. Quote conversion retains its key for redacted errors, including idempotency conflicts, rather than incorrectly emitting `rejected:true`.
2. **Inventory read RPCs are not allowlisted.** Observed in `erpcore/store.go::ReadRPC`, `inventory_snapshot`, `replenishment_plan` and `stock_moves_page` are unavailable. `inventory_reads.go` reproduces their newest source SQL read models via parameterized, org-scoped Select calls inside a repeatable-read Store transaction, with exact aggregates and filters. No forbidden RPC is called. Literal ledger substring search scans filtered pages because Select cannot express concatenated-field search. Upgrade to a reviewed, allowlisted read RPC if ledger size makes that scan expensive; no benchmark was run.
3. **Interior undefined arguments need transport support.** `erpwire.Arguments` preserves positional omission versus explicit null but has no explicit JavaScript `undefined` sentinel. Omitted trailing optionals work. A shared browser transport must represent interior omitted values without silently equating them with explicit null, especially delivery/receipt optionals. This package retains source validation of explicit null.
4. **Rendering and email adapters are injected.** `Options.PDFRenderer` accepts a Go `erpwire.Row` printable model and returns bytes. Both source quote/purchase `/pdf` routes serve printable HTML, so adapters must return HTML and handlers preserve `text/html; charset=utf-8`; purchase retains `private, no-store`. Stock-document print renders the source escaped HTML locally. No PDF engine, mail provider, runtime dispatch registration or external account configuration was added. Missing email configuration preserves the source degrade/recovery responses. The runtime owner must supply adapters and `AppURL`; missing PDFRenderer fails explicitly.

## Access and FAIR status

Implemented and fake-store tested stable operation identifiers, public JSON-compatible DTOs, descriptive model fields, immutable live-authority Actor checks, existing capability policy, parameter-bound values, current-workspace predicates and source audit/idempotency protocols. This makes operations findable, tenant access explicit, transport interoperable and source provenance reusable. No database/model/server was contacted or started. No credentials, customer material, keys or account identifiers are stored here.

Database-enforced least privilege, live reauthorization, grants, RLS, function/view security and deployed AI/API read-only identities remain administrator responsibilities. No deployment enforcement is claimed from hooks, source code or fake Stores. A human administrator must apply any database changes separately and verify permitted/denied operations with the exact deployed identities. No migration was applied or needed for this package.

## Verification and decisions

Observed 2026-11-08. Package fake-store tests assert all operations reject unbound actors before Store access; role denials; current-org reads/mutations; every quote transition; immutable quote states; purchase/stock command mappings; duplicate/stale receipt rejection; partial/deposit conversion keys; archive/restore; exact satang maximum, overflow and half-satang rounding; cumulative bills; RFQ retry/recovery; printable model/MIME; escaped HTML; policy audits; 1001-row pagination; stock snapshot aggregates; replenishment dates; Bangkok dates; canonical JSON quantities; redacted conflict key retention; line-grid scope/schema/audits/reloads; template normalization/pricing and unsafe tax breakdowns. Independent read-only review found quantity JSON, redacted rejection and printable tax validation bugs; they were corrected and regression-tested. Review covered source parity, not runtime acceptance.

Latest incremental package `go vet` and `go test` passed; final required command results are recorded below after integration. No npm/Next.js, dependency installation, server, database, local AI model, provider request, cross-worktree edit or push was performed. Database-backed transitions/concurrency, deployed RLS/grants, browser integration, real printable rendering and email delivery remain untested under the user's limits. Full production parity remains contingent on the shared error contract and runtime adapters above.

Next integration steps belong to the shared-runtime owner: mount these operation keys; supply printable/email adapters; extend reviewed business-error metadata and interior-undefined transport; have an administrator verify database identities and execute permitted integration acceptance. No further package stubs or omitted scoped handlers remain.

Final required validation observed 2026-11-08 from `boombignose`:

- `gofmt -l ./internal/erpsales`: PASS, no filenames printed.
- `go vet ./internal/erpsales/...`: PASS, exit 0.
- `go test ./internal/erpsales/...`: PASS, package tests succeeded.
- Source operation inventory: PASS, all 66 scoped/imported server-action/page/route keys present, plus four purchasing library queries; no duplicates with existing packages.
- `git diff --check`: PASS before staging. Git hooks contain samples only; no executable commit hook requires forbidden npm/server/database commands.

Commit attempt observed 2026-11-08: `git add -A` failed with exit 128 because the sandbox denied creating `/Users/boombignose/orca/projects/boombignose-erp-harness-ai/.git/worktrees/erpsales/index.lock` outside the writable worktree. No staging or commit completed. All 24 package files remain saved and untracked in this worktree. The required commit must be made by an environment permitted to write this worktree's Git metadata, using the English message `Port sales purchasing and inventory operations to Go` and trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. No permission bypass or other-worktree edit was attempted.
