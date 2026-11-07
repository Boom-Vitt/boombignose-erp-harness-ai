# Ledger port — 2026-11-08

## Scope and operation catalog

Source: `app/(app)/finance/`, the imported `lib/finance/`, `lib/metrics/finance.ts`, `lib/metrics/invoice-status.ts`, `lib/payments/{input,balances}.ts`, `lib/search-facets.ts`, `lib/export/csv.ts`, and existing finance migrations. The operation contract follows `internal/erpcrm` and `internal/erpwire`. Only this package was changed.

`New(Options{Store: store}).Operations()` supplies these 23 keys:

```text
app/(app)/finance/page.tsx::load
app/(app)/finance/actions.ts::createCost
app/(app)/finance/actions.ts::deleteCost
app/(app)/finance/actions.ts::updateFinanceLockDate
app/(app)/finance/actions.ts::confirmFinanceLockReopen
app/(app)/finance/actions.ts::cancelFinanceLockReopen
app/(app)/finance/actions.ts::closeCompletedMonth
app/(app)/finance/costs/new/page.tsx::load
app/(app)/finance/costs/export/route.ts::GET
app/(app)/finance/bank/actions.ts::addBankLine
app/(app)/finance/bank/actions.ts::matchBankLine
app/(app)/finance/bank/actions.ts::noteBankLine
app/(app)/finance/bank/page.tsx::load
app/(app)/finance/cash/page.tsx::load
app/(app)/finance/journal/actions.ts::postDraftJournal
app/(app)/finance/journal/actions.ts::postIssuedSalesInvoice
app/(app)/finance/journal/actions.ts::postIssuedCreditNote
app/(app)/finance/journal/actions.ts::postCashReceipt
app/(app)/finance/journal/acceptance-actions.ts::proposeDraftCloseAcceptance
app/(app)/finance/journal/acceptance-actions.ts::confirmDraftCloseAcceptance
app/(app)/finance/journal/acceptance-actions.ts::cancelDraftCloseAcceptance
app/(app)/finance/journal/page.tsx::load
app/(app)/finance/journal/trial-balance/page.tsx::load
```

Arguments are the ordered JSON argument array defined by `erpwire.Arguments`. List loaders accept zero arguments or one search-parameter object. Detail posting and acceptance actions take their original string argument. Other actions take their original object. Ordinary new-cost/journal loaders and the CSV route take no arguments. Actions use `ActionResponse`; page loaders return data, including the source refusal text for unauthorized views. `BrowserMap` carries journal account names and invoice balances.

## Source exports deliberately not duplicated

- Already implemented by `internal/erpbilling/service.go`: `subscription-actions.ts::{createSubscription,updateSubscription,setSubscriptionStatus,deleteSubscription,generateInvoiceNow}` and `subscriptions/{page.tsx,new/page.tsx,[id]/page.tsx}::load`. The integrating registry should retain erpbilling's eight operations; this package neither copies nor wraps them.
- Other worker's explicit scope in `finance/actions.ts`: `createInvoice`, `updateInvoice`, `recordPayment`, `reconcileLegacyPayment`, `reviewPaymentClaim`, `issueInvoice`, `issueTaxInvoice`, `adoptLegacyInvoice`, `updateBusinessProfile`, `saveTaxInvoiceTemplate`, `updateInvoiceWithholding`, `cancelDraftInvoice`.
- Other worker's explicit scope: `close-summary-actions.ts::summarizeMonthEnd`; `correction-actions.ts::{issueCreditNote,reversePayment,updatePaymentReviewPolicy}`; `receipt-actions.ts::{reportCustomerReceipt,applyCustomerCredit,refundCustomerCredit}`; `email-actions.ts::sendInvoiceEmail`; all page loaders/routes beneath `invoices/`, `receipts/`, `credit-notes/`, `payments/`, `outstanding/`, and `business-profile/`.
- `dynamic`, type exports, and client-rendered React components are not operation handlers. Their existing bilingual UI copy stays in those source files. Journal posting of issued invoices, credit notes and receipts **is** implemented here because its actions live in `journal/actions.ts`.
- No uncovered server operation in the assigned scope was stubbed or deliberately omitted. No PDF route exists in this package's scope.

## Behavior and ownership

- Exact integer satang uses `internal/money`, checked sums and rational/integer VAT calculations. Integral JSON spellings such as `1.0` and `1e3` are decoded exactly, without floating-point conversion. Safe boundaries, frozen snapshot agreement, chart membership, closed periods, memo limits, deposits, receipt allocation and posted-credit/receipt limits are checked before journal commands.
- Finance overview uses verified balances, credit-note revenue, pre-VAT sales, recoverable input VAT, inventory exclusions, exact aggregate MRR rounding, effective statuses, saved views, facets and ordered groups. Bank reconciliation includes ambiguous/taken/reversal exclusions and all queue states. Cash close uses Bangkok calendar cutoffs and signed verified reversals.
- Existing `post_draft_journal`, `post_issued_sales_invoice`, `post_deposit_invoice`, `post_final_with_deposit`, `post_issued_credit_note`, `post_cash_receipt`, bank and acceptance/lock commands remain database-owned. Their locking, unique constraints, retry/refusal rules, dual control and audit writes are not replaced with direct Go mutations. The authoritative sources are `supabase/migrations/20261028120200_bank_lines.sql`, `20261101120100_bank_line_close_note.sql`, `20261101130000_close_risk_controls.sql`, `20261101140000_finance_lock_reopen.sql`, and `20261101180000` through `20261101230000` journal/acceptance migrations.
- Document posting gathers its validation data and calls its command inside one Store transaction. Source commands revalidate state under their own locks. Costs retain direct scoped insert/delete, best-effort separate audit, and original refresh/redirect behavior. Cost creation has no retry key in the source, so this port does not invent one.
- Explicit organization predicates accompany every select/delete; commands receive only the actor's `p_org_id`. Input cannot override workspace authority. No raw SQL, database connection, credentials, model, provider or dependency was added.

## Shared-contract gaps and integration work

1. **HTTP response contract:** `erpwire` has no route-response value. The local `RouteResponse` preserves status, headers and exact UTF-8/BOM CSV body. The integrating HTTP dispatcher must recognize it (or map it to its eventual shared response contract). CSV rates normalize stored numeric scale (`7.00` → `7`); text is escaped for formulas and RFC 4180, with CRLF and no extra terminal newline. Success is 200 and failed reads return the source 503 body. Authentication failures propagate.
2. **Database rejection text:** `internal/erpcore/business_errors.go` currently allows expense/subscription messages only; `DatabaseError` discards other PostgreSQL rejection messages. Exact Go validation messages and supplied `BusinessMessage()` errors are retained here. A racing/DB-only ledger rejection cannot be recovered from that contract without exposing unsafe server errors. Such errors currently use a safe domain fallback. The shared owner must add reviewed static ledger/bank/lock/acceptance messages to the core allowlist for complete SQL error-text parity. No reflection, raw error leakage or shared-file edit was used to bypass it.
3. **Registry and rendering:** no shared registry, HTTP/browser adapter or bundling files were changed, as required. The integration owner must register these operations and bind the returned DTOs/`RouteResponse` to rendering/HTTP. React rendering itself was not rewritten in this handler-only package.
4. **Derived context and durable notes:** no root `AGENTS.md`, `INSTRUCTIONS.md`, `.project-memory/` or `graphify-out/graph.json` was present in this worktree. Root initialization/builds would violate the package-only fence. Relevant existing Graft cards were read and verified against TypeScript source. This file is the package-local dated handoff; no global memory or unrelated project was changed.

## FAIR and validation

Findable operation keys and source paths are catalogued above; identity/capabilities and organization scoping use the existing wire contract. JSON DTOs, exact integer satang, SHA-256 acceptance payloads and UTF-8 CSV retain interoperable source formats. Reuse is limited to the injected Store and existing PostgreSQL commands. These are source-level guarantees and fake-store checks, not proof of live grants/RLS.

No database/server/model/npm process was started and no migration was applied. AI/API database access and any integration probes must remain read-only. A human administrator must verify actual least-privilege grants, forced tenant RLS, execute permissions and allowed/denied identities, including SECURITY DEFINER commands, before deployment. No credentials or customer data were used.

Observed on 2026-11-08: package tests use an in-memory Store with transaction/read/write separation, scoped projections, pagination, relations, command recording and rollback. They assert denial before I/O, cross-org isolation, exact validation errors, satang boundaries, VAT/deposit/credit/receipt rules, all action transition command contracts, Bangkok windows, account netting, the TypeScript acceptance hash fixture, finance metrics/facets and CSV output. They do **not** simulate PostgreSQL's concurrency, dual-control or trigger implementation; those require administrator-run database integration checks.

Required final checks from `boombignose/`: `gofmt -l ./internal/erpledger` (empty output), `go vet ./internal/erpledger/...`, and `go test ./internal/erpledger/...`. Additional package build and coverage checks were run. See the completion entry below for final results.

## Completion

2026-11-08: all 23 operations implemented. Independent read-only review found three parity issues (numeric CSV scale, integral JSON number spellings, and fractional credit-snapshot refusal messages); all were fixed, regression-tested and re-reviewed as resolved. Further boundary checks cover overpaid balances and unsafe follow-on aggregates. Final `gofmt -l ./internal/erpledger` returned no files; `go vet ./internal/erpledger/...`, `go test ./internal/erpledger/...` and `go build ./internal/erpledger/...` passed. `go test -cover ./internal/erpledger/...` reported 84.9% statement coverage. `git diff --check` passed before staging.

The package is prepared for the requested local commit and co-author trailer. Next steps belong to the integrating owner: register handlers, adapt the CSV response, extend the safe SQL-message allowlist, and arrange administrator-run database/RLS integration validation. No server/database/model execution, npm checks, push or merge was performed.

Local commit **blocked by the host filesystem sandbox**: `git add -A` failed with `Unable to create .../.git/worktrees/erpledger/index.lock: Operation not permitted`. The worktree's Git metadata resolves outside the writable root. No files were staged and no commit was created. Once Git metadata is writable, the owner can stage this package and commit with English subject `Port finance ledger operations to Go` and trailer `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. No permission bypass or other worktree was used.
