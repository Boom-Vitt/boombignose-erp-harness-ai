# Invoicing port — 2026-11-08

Source baseline: this worktree's `app/(app)/finance`, its imported `lib/` helpers, and the existing `internal/erpcrm` / `internal/erpwire` operation contracts. All authored files stay in `boombignose/internal/erpinvoicing`. No shared package, migration, TypeScript source, other worktree, dependency, or runtime configuration was changed.

## Operation inventory

`Service.Operations()` covers these 37 keys. `TestOperationCoverageMatchesSource` independently scans the scoped TypeScript action exports, pages and routes and compares the complete key set.

```text
app/(app)/finance/actions.ts::createInvoice
app/(app)/finance/actions.ts::updateInvoice
app/(app)/finance/actions.ts::recordPayment
app/(app)/finance/actions.ts::reconcileLegacyPayment
app/(app)/finance/actions.ts::reviewPaymentClaim
app/(app)/finance/actions.ts::createCost
app/(app)/finance/actions.ts::deleteCost
app/(app)/finance/actions.ts::issueInvoice
app/(app)/finance/actions.ts::issueTaxInvoice
app/(app)/finance/actions.ts::adoptLegacyInvoice
app/(app)/finance/actions.ts::updateBusinessProfile
app/(app)/finance/actions.ts::saveTaxInvoiceTemplate
app/(app)/finance/actions.ts::updateInvoiceWithholding
app/(app)/finance/actions.ts::cancelDraftInvoice
app/(app)/finance/actions.ts::updateFinanceLockDate
app/(app)/finance/actions.ts::confirmFinanceLockReopen
app/(app)/finance/actions.ts::cancelFinanceLockReopen
app/(app)/finance/actions.ts::closeCompletedMonth
app/(app)/finance/email-actions.ts::sendInvoiceEmail
app/(app)/finance/close-summary-actions.ts::summarizeMonthEnd
app/(app)/finance/correction-actions.ts::issueCreditNote
app/(app)/finance/correction-actions.ts::reversePayment
app/(app)/finance/correction-actions.ts::updatePaymentReviewPolicy
app/(app)/finance/receipt-actions.ts::reportCustomerReceipt
app/(app)/finance/receipt-actions.ts::applyCustomerCredit
app/(app)/finance/receipt-actions.ts::refundCustomerCredit
app/(app)/finance/page.tsx::load
app/(app)/finance/business-profile/page.tsx::load
app/(app)/finance/invoices/new/page.tsx::load
app/(app)/finance/invoices/[id]/page.tsx::load
app/(app)/finance/receipts/page.tsx::load
app/(app)/finance/invoices/export/route.ts::GET
app/(app)/finance/payments/export/route.ts::GET
app/(app)/finance/outstanding/export/route.ts::GET
app/(app)/finance/invoices/[id]/pdf/route.ts::GET
app/(app)/finance/invoices/[id]/wht/route.ts::GET
app/(app)/finance/credit-notes/[id]/pdf/route.ts::GET
```

No scoped exported server action, page data loader, or route handler was deliberately omitted. Type-only exports and Next's `dynamic` rendering constant are not executable operations. The invoice page's non-exported `saveInvoice` closure delegates to the ported `updateInvoice`; client button/form components remain browser presentation. Imported journal, inventory, line-grid mutation and record-history operations belong to their respective domains and are not registered again here. `recordRef` lets the host compose the existing record-history domain.

## Contracts and behavior

- `New(Options)` requires `erpwire.Store`; optional integrations are `PDFRenderer`, `TextGenerator`, `EmailSender`, application URL and a clock. There is no concrete network, model, database, or renderer adapter in this package.
- Actions accept an ordered JSON argument array and return `erpwire.ActionResponse` with source values, redirects and refresh paths. Page loaders accept resolved props (`searchParams`/`params`), and also direct ID/search objects. Routes accept a serialized `{url, params}` request (or direct ID/query arguments) and return the package-local `RouteResponse{Status, Headers, Body}`. The host must write those bytes directly rather than JSON-encode them as a document response.
- Authorization uses the live-bound `Actor` and the shared capabilities. Source error wording is retained, including owner/admin wording on some actions whose actual capability also permits accountants. Every database read/update/delete carries the bound `org_id`; commands receive only the bound `p_org_id`. User input cannot select SQL, a role, or a workspace.
- Number allocation, version checks, atomic status transitions, ledger allocations, reversals/refunds, idempotency and command-authored audits stay in their existing PostgreSQL commands, exactly as in the TypeScript actions. Draft labels never allocate INV/TX/ABB numbers. Retried requests reuse the supplied key. Direct draft/cost mutations retain the source's separate best-effort audit behavior.
- Money is `money.Satang`, exact decimal THB text at boundaries, and checked safe-integer sums. Tax discount allocation and VAT/WHT use `math/big` intermediates, largest remainders, sorted rate ties, and half-up rounding once per rate. MRR sums interval twelfths before rounding once. CSV preserves exact two-decimal amounts, BOM/CRLF, escaping and formula neutralization. Outstanding export records SHA-256 and UTF-8 byte count before serving the file, and retains the source's current-balance (not reconstructed historical-ledger) semantics.
- Invoice detail includes line-grid rows, stock lines/moves/count, product choices, credit notes, receipt posting evidence, sales-chain state and community accounting (`connected:false, sync:null`). The current `tsconfig.json` maps `@edition` to the community edition. Enterprise adapters are outside this package.
- Shared `ReadRPC` rejects `inventory_snapshot`. `financeInventorySnapshot` locally reproduces the unfiltered read-only projection from `supabase/migrations/20261026120600_scheduled_replenishment.sql` using scoped product, stock, forecast and lead-time views. No shared allowlist was changed.
- Month-close text is injected, uses the source counts/prompt and visible-answer filtering, and returns the source not-configured/error states. A provider adapter should map unavailable configuration to `ErrTextNotConfigured`. No model/provider is started or selected here. Email uses an injected sender with the source draft HTML, first contact, audit and activity behavior; the host supplies the same application URL as `NEXT_PUBLIC_APP_URL`.

## Document rendering today

There is no `lib/pdf` directory in this baseline. The named `/pdf` routes call `lib/documents/printable.ts::renderDocumentHtml`; `/wht` calls `lib/tax/wht-certificate.ts::renderWhtCertificate`. They return self-contained `text/html; charset=utf-8`, with inline CSS, escaped content and browser print-to-PDF. Printable rendering uses Thai/Buddhist-era date labels, exact THB formatting, section placement, and a locally generated PromptPay QR from `lib/payments/promptpay.ts` when eligible. WHT is explicitly a draft with the original Thai/English disclaimers and `X-Robots-Tag:noindex`.

Go ports all scoped loading and document models. `PDFRenderer.Render(context.Context, DocumentModel)` returns bytes and content type; the host can supply the current HTML format or another renderer. An absent renderer returns 503 `Document renderer unavailable`, rather than an empty document. The immutable issued snapshot supplies seller/buyer/lines/totals, ABB buyer privacy and original/copy labels; live profile changes do not rewrite it. Optional receipt-balance fields remain absent on credit notes. The renderer must preserve the HTML escaping, formatting, conditional fields, PromptPay behavior and disclaimers described above. Byte/layout parity cannot be checked until that adapter is supplied.

## Shared-contract gaps and remaining limits

1. **Finance database errors are lost upstream.** `internal/erpcore/business_errors.go` only preserves allowlisted subscription/expense errors, and `store.go::databaseError` intentionally strips arbitrary PostgreSQL messages. Therefore exact finance command refusals from TypeScript's `error.message` cannot be recovered in this package using the current Store. This package passes through a safe `BusinessMessage()` when supplied and otherwise returns the generic safe action failure; canonical authentication/authorization errors remain errors. The integration owner must extend the reviewed shared finance business-message contract to restore exact database-error parity. Reading `Error()` or guessing database state is not a safe workaround.
2. `RouteResponse` is package-local because the shared wire has no HTTP byte-response type. Runtime operation registration/HTTP adaptation is deliberately left to the integration owner; `bundle`, `erpwire`, `erpcore`, `erpdata`, and `localai` were not edited.
3. Malformed WHT snapshots produce `Invalid issued snapshot` for structural validation failures, rather than Zod's serialized issue-array diagnostics. The validation rules, refusal and HTTP status are implemented; malformed-data diagnostic formatting is a known compatibility difference. Invoice PDF and credit-note routes retain their source fixed snapshot-error messages. No exported operation is stubbed.
4. Real PostgreSQL function execution, grants, RLS, revocation and concurrent/idempotent SQL semantics were not exercised. The fake validates handler requests and transaction isolation; it does not prove database enforcement or reimplement the financial SQL. Existing migrations remain authoritative and must be applied/verified by a human administrator.

## FAIR and administrator responsibilities

Findable: stable TS operation keys and this source inventory. Accessible: live Actor capabilities, scoped transactions and explicit unknown/error states. Interoperable: UTF-8 JSON models, exact integer satang, ISO/Bangkok dates, protected CSV and SHA-256. Reusable: injected integrations and table tests, with the limitations above recorded.

AI/API database identities must remain read-only with database grants/RLS, never service-role or bypass-RLS credentials. This task writes source only and runs in-memory tests; no database connection or mutation was attempted. A human administrator must verify the exact deployed identities, view/function access and denied operations, and arrange any authorized command-execution boundary before enabling mutations. Hooks are not a security boundary. No new migration or credential provisioning is performed here.

## Validation and handoff

The table/in-memory tests cover all operation keys, unauthenticated/capability denial, cross-org isolation, validation errors, exact money boundaries, draft guards, all command-transition requests/retry keys, effective status transitions, VAT/WHT allocation, frozen documents, renderer inputs, CSV/checksum integrity, page totals and month-close/email fallbacks. Independent read-only review found and verified fixes for net-before-sum VAT accumulation, accountant close access, supplied-subtotal fallback, JavaScript whitespace validation and optional document fields.

Required final commands (from `boombignose`):

```sh
gofmt -l ./internal/erpinvoicing
go vet ./internal/erpinvoicing/...
go test ./internal/erpinvoicing/...
```

Observed final checks, 2026-11-08: `gofmt -l ./internal/erpinvoicing` PASS with no output; `go vet ./internal/erpinvoicing/...` PASS; `go test ./internal/erpinvoicing/...` PASS (0.478s). `git diff --check` PASS. No server, database, model, npm/Next command, dependency installation, push, or cross-worktree edit is part of validation. Project-wide memory/graph output was absent; this scoped handoff stays in the exclusive package instead of creating root-level files. BBN/pstack/Ponytail were applied; the supplied Graft map and source searches informed relationships. Graphify was read but no graph was built under the package-only/tool limits. An installed `boombignose-mode` skill was not present in the supplied catalog/shared index; the explicit porting instructions governed this task.
