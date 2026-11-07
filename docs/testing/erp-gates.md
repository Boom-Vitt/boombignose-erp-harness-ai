# ERP checkpoint QA gates

## Runtime compatibility

The locked `@supabase/supabase-js` 2.110.0 package declares `engines.node: >=22.0.0`. This repository's application engine therefore requires Node.js 22 or later. Supabase's [official deprecation notice](https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20) ended JavaScript SDK support for Node.js 20 on 30 June 2026 and directs SDK consumers to Node.js 22 or later. This requirement concerns the JavaScript application and SDK, not a claim about the Supabase server's runtime.

Record both the installed package requirement and the actual executing runtime:

```sh
node --version
node -p "require('@supabase/supabase-js/package.json').version"
node -p "require('@supabase/supabase-js/package.json').engines.node"
pnpm --version
```

Independent checkpoint execution uses the already installed Node.js 26.8.1 and frozen dependency versions. No runtime upgrade is part of QA. A future application CI job must use Node.js 22 or later, install with `pnpm install --frozen-lockfile --ignore-scripts`, and report its runtime. The existing GitHub Pages workflow publishes only static showcase files; it has no Node application job. Its successful deployment is not application QA evidence.

## Isolated local execution

Use a clean worktree pinned to the reviewed full commit SHA. Keep each lane's `.env.local`, `.local-stack`, `.next`, generated reports and synthetic database separate. Generate isolation with `node scripts/worktree-env.mjs <lane>` only before the lane's ports are in use. Verify that test API and app URLs match the generated metadata. Never reuse another lane's server or reset another database.

The checked-in `.env.example` uses the Supabase template's API port 54421. An isolated lane uses its generated API/app ports instead. Set `NEXT_PUBLIC_APP_URL` to the exact generated app origin before the production build; lane 6 uses `http://127.0.0.1:3106`. Browser configuration rejects a missing or mismatched trusted app origin. Replace required keys from that local project's status output privately; never print or commit service-role credentials. Optional cron, webhook, outbound email and AI configuration remains blank unless separately authorized.

Database reset executes `supabase/seed.sql`. The existing seed creates a known synthetic owner and sample records: opt in only for isolated local tests. It is not a production bootstrap or safe default owner. Removing that assumption from portable installation is a remaining handover prerequisite, not a gate this checkpoint claims to have passed.

Run state-changing database tests sequentially. Apply a fresh migration replay, execute direct API tests, and run pgTAP with explicit absolute `.sql` file paths; default discovery through the runtime's test-directory symlink has stalled previously. Then run lint, types, unit tests, one production build and the browser suite against that build. Do not run dev/build/browser writers concurrently against the same `.next` directory.

## Assistant financial evidence

Apply `20261106100000_assistant_financial_snapshot.sql` and `20261107090000_assistant_receivables_coverage.sql` before running an updated assistant. `list_invoices` uses `assistant_invoice_snapshot` for effective Bangkok status, client/status filtering, the complete matching aggregate, and only the requested display page. `finance_summary` uses `assistant_finance_snapshot` for all its inputs. Each RPC is one `STABLE`, security-invoker SQL statement: invoice rows, allocated verified receipts, credits, costs and other aggregates share the caller's MVCC snapshot and existing RLS. Separate tool calls are separate snapshots; they are not a transaction spanning an assistant conversation.

Every invoice-list response also includes `receivables_coverage: { invoice_count, outstanding_satang, items, has_more }`, independent of the requested status, client, offset and display limit. Its count and sum cover all positive issued-unpaid balances in the workspace, excluding drafts, cancelled and fully settled invoices. `items` contains at most 16 `{ id, number, status, due_date, outstanding_satang }` records, ordered by creation time descending then ID ascending, with effective Bangkok status; `has_more` means additional positive-balance records exist beyond those 16. These records, aggregate and filtered results share the same evidence CTE and snapshot. Financial task output must retain workspace coverage even if the model requests only overdue invoices; a filtered matching total is not a workspace total.

Do not replace these reads with independently offset-paged HTTP requests, even if accumulated row counts agree: an insertion can repeat a boundary invoice and still satisfy the count. SQL money aggregates are decimal integer strings on the wire; the tool rejects totals outside JavaScript's safe integer range before formatting. An existing manual cash setting of zero remains known zero; a missing cash setting produces `cash_balance_known: false` and null cash money fields. Query, permission and incomplete-response failures must not become zero balances.

Exercise the real database with an isolated synthetic organization: issue a WHT invoice, verify an allocated receipt, issue a linked credit, and compare the RPC against `invoice_balances` and `credit_note_revenue`. Include draft/cancelled exclusion, Bangkok midnight, filters before a limited display page, a foreign actor, missing settings, and aggregate overflow. Verify a narrow overdue/client filter (including an empty display page) still supplies the complete workspace coverage, and more than 16 receivables retain their full aggregate with bounded rows. For concurrency, block an RPC statement after its snapshot is acquired, commit a receipt or invoice from another connection, then prove its display rows, matching summary and workspace coverage all remain pre-commit while the next call sees the commit. An unsafe workspace total must fail even when the selected filter is empty. In-memory protocol regressions do not prove PostgreSQL snapshot behavior.

Both RPCs grant execution to `authenticated` and the existing trusted-admin `service_role`, never `anon`. The application's assistant supplies its user-session client and remains subject to actual membership and table/view RLS. The standalone stdio server retains its explicit local OS-admin service-role contract, including its existing RLS bypass, but every aggregate still filters the requested existing organization. Only the actual database invoker role (`current_user = 'service_role'`) satisfies the admin branch; a request body or JWT claim naming that role does not elevate an authenticated caller. Do not add a service-role client to the browser assistant. Exercise both real session and trusted-admin RPC calls, plus an authenticated foreign actor and anonymous denial.

## Evidence and limits

For each gate, record the exact Git SHA, branch/worktree, runtime project/ports, full command, exit code, pass/fail count, and log location. Record failed and unrun checks as such. A QA follow-up commit creates a new candidate; rerun the affected checks and identify both the supplied base and verified final commit.

Software gates do not authorize deployment, publication, production migration, customer data import or outreach. Upgrade preflight, real opening-balance reconciliation, accountant-reviewed workflows, backup/restore, portable opt-in initialization and license selection remain separate approval and release prerequisites. This QA document does not change the existing license.
