# Operational close, statutory close, and risk

The desktop product is the Wails window in `boombignose/`. After the local gate it opens `http://127.0.0.1:3100`. Month-end work happens in that window. This note is the close roadmap. `docs/boombignose/PHASES.md` is a different list: it tracks the desktop shell, packaging, and cutover.

Two closes are easy to mix up.

| Close | What it is | Status |
| --- | --- | --- |
| Operational close | Review open documents, cash, and bank lines, then block dates with the finance lock. Hand a support file to an accountant. | On main. Phases 1–5 below. |
| Statutory close | Books an accountant can stand behind under Thai rules, including a general ledger and the filings the Revenue Department expects. | End goal. Not shipped. |

ปิดงบปฏิบัติการได้สบายๆ ในแอปนี้ The statutory close is the end goal, and this app does not pretend the operational lock is that close.

## Done — operational close (phases 1–5)

These are on main. None of them calls the Revenue Department.

1. **Checklist.** `/reports#month-end-close` counts overdue receivables, unpaid vendor bills, unmatched bank lines, draft invoices, expense claims waiting for approval, and a seller profile. VAT on that list is support data. The screen says it is not a ภ.พ.30 filing and not a general-ledger close. Owners, admins, and an accountant can review it. A member cannot.
2. **Cash.** `/finance/cash` compares the saved cash balance with verified receipts, paid costs, and bank lines through a calendar month-end. It does not log in to a bank.
3. **Bank.** `/finance/bank` stores statement lines the operator enters. A line matches only when exactly one verified, non-reversal receipt has the same amount and trimmed reference. A close note says why an unmatched line is not a customer receipt. The note is not a journal entry. There is no bank-login automation.
4. **Accountant pack.** `/reports/accountant-pack` exports one month of output VAT, matched purchase VAT, and withholding already stored on issued invoices and credit notes. CSV and print/PDF are support files. Vendor bills do not store withholding. The difference between output and input VAT is not tax payable.
5. **FlowAccount export, the Ollama note, and optional Moli.** Pro settings can push an issued invoice to FlowAccount as a fixture on this machine or to the FlowAccount sandbox. That push does not replace an accountant and does not file. PEAK and Xero are adapter slots, not live connections. The month-end note on `/finance` asks Ollama on loopback to read overdue receivables, unpaid vendor bills, and unmatched bank lines. If Ollama is not running, the counts still show and nothing is sent to a cloud model. The text model is installed from Settings in the same window. The note does not post a journal. Moli is an optional local browser binary, documented in `docs/moli/README.md` and started with `pnpm moli:fetch` from a checkout. It can read one public page, including a public Revenue Department page, into Markdown under `artifacts/moli/`. It is not a button in the window, `boombignose serve` does not start it, and it refuses e-Filing login links. It does not file.

Other facts that are already true, and are not a statutory close:

- Roles are owner, admin, accountant, and member (`lib/permissions.ts`). An accountant can record invoices, receipts, and credit notes, read profit, and read the activity log. An accountant cannot change settings, the team, or the finance lock. Receipt reversal stays with owner and admin.
- `org_settings.lock_date` blocks invoice issue, verified receipts, and corrections dated on or before that date. The command is `update_finance_lock_date`. Owner and admin only.
- `audit_log` has no update or delete policy for signed-in users. Finance commands insert trusted rows from database functions. The activity page is `/audit`.
- `gl_accounts` is a Thai SME chart of names and codes. `install_thai_sme_chart` inserts missing codes and does not delete custom ones. `post_draft_journal` stores a balanced draft dated on or before the finance lock, using those codes, and writes `journal_draft_posted` on the close-activity chain. `/finance/journal/trial-balance` adds those lines by account. `post_issued_sales_invoice` can post one plain issued sales invoice into that journal when the stored VAT split matches the stated rate. `post_issued_credit_note` reverses part of that posted sale. `post_cash_receipt` clears part of the posted receivable for a verified receipt that is fully allocated. Cash posts to cash. A transfer, PromptPay, card, or cheque posts to the bank account, because this chart has no card-clearing account and no undeposited-cheque account. Withholding, method "other", deposits, and legacy adoptions are not posted. The draft and the trial balance are not signed statutory books.
- A draft 50 ทวิ page is HTML from an issued invoice with withholding greater than zero. The payer still issues the statutory certificate. The page says it is not a Revenue Department form.
- `docs/thai/tax-invoice-gaps.md` lists what a statutory tax invoice still needs. Issued snapshots are operational invoices.
- A local database dump can carry a SHA-256 sidecar (`lib/install/local-backup.ts`). That checksum is for the backup file. It is not a close seal.

## Gaps before a statutory close

These are missing. Shipping a screen that claims them would be false.

- No ภ.พ.30 filing, and no other Revenue Department form filing (ภ.ง.ด. and the rest).
- No e-Tax Invoice submission. The tax-invoice checklist marks that as a gap. Nothing is sent to the Revenue Department.
- No statutory general ledger or financial statements an auditor can sign. A draft journal can store balanced lines against the chart for a date the finance lock already covers. The trial balance adds those draft lines only. It is not a set of signed statutory statements.
- No accountant sign-off that creates a legal representation. The accountant role can read and prepare support data. It cannot certify the books.
- FlowAccount export is a document push of an issued operational invoice. It is not the book of record inside this app.
- The finance lock is a date block. An owner or admin can move it earlier or clear it. That reopen is now audited. It is still not a locked statutory period.
- The activity log is append-only for signed-in users. Close-activity rows, including a draft journal post, store a hash of the previous row. The database owner can still disable that trigger and rewrite the chain. There is no external timestamp.
- The draft 50 ทวิ is not the form the payer files.
- No bank feed and no bank login. Do not add one to "complete" the close.

## Risk management

Someone paying for this, SME or enterprise, needs to see who can do what, what was recorded, and what BoomBigNose will not take on.

| Party | Responsibility |
| --- | --- |
| BoomBigNose | Documents, the operational finance lock, and support files. |
| Accountant | Reviews those files and prepares the statutory books. |
| The business and the accountant | File with the Revenue Department (กรมสรรพากร). |

The same sentences are on the month-end checklist, finance settings, the statements VAT section, and the accountant pack, in Thai and English.

### R0 — shipped in this change

SME controls that fit the current database and the four roles.

- **Month close is a database command.** `close_completed_month` sets the lock to the last calendar day of a `YYYY-MM` month. It refuses the current month, a future month, and a month the lock already covers. February 2020 closes on the 29th. February 2021 closes on the 28th. Owner and admin only. The audit action is `period_closed`, with the previous lock date. It does not also pretend the change was a manual date edit.
- **The manual lock cannot sit in the future.** `update_finance_lock_date` still accepts any finite date on or before today in Asia/Bangkok, including a date that is not a month-end, and it can still clear the lock. A future date is refused. The same date twice does not write a second row. Moving the date earlier, or clearing it, is `finance_lock_reopened` and stores the date it left. Today is still a valid lock date, which is what the issue flow uses to block an invoice dated today.
- **Those actions cannot be typed in by a signed-in session.** `finance_lock_updated`, `finance_lock_reopened`, `period_closed`, and `support_exported` are reserved. The trigger is not security definer, so the command that owns the row can insert it and an `authenticated` or `service_role` session cannot.
- **Support downloads carry a checksum.** The accountant-pack CSV, the printable HTML, and the outstanding-pack CSV call `record_support_export` with the SHA-256 and byte length of the exact body. The response header is `X-Content-SHA256`. The download is refused when that row cannot be written. The activity summary includes the hash and says it is not a filing. An owner, admin, or accountant can record one. A member cannot. This is the checksum of the bytes that were sent. It is not a signature, and a finance user who calls the command directly can store a hash of bytes this screen did not produce.

### R1 — shipped for the screen

Still not a statutory close.

- `/audit/close` lists lock, reopen, reopen request, completed-month, and support-export rows. The previous date, the reason, and the SHA-256 are fields on the row.
- `propose_finance_lock` is what the finance-settings screen calls. A reopen needs a reason of 1–200 characters. When the workspace has one owner or admin, that person reopens and the activity row names them. When it has more than one, the lock does not move until a different owner or admin confirms. The requester cannot confirm their own request. A member cannot confirm.
- The close activity page can hash a saved CSV or HTML file in the browser and ask whether that checksum is in the log. The file is not uploaded. A match is not a signature.
- `/audit/close/export` downloads every close-activity row that exists at that moment. The checksum is stored with the same command as the other support files, after the file bytes are fixed, so the file does not include its own checksum row. The saved file can be checked on the close activity page. The screen still shows the latest 100 rows.
- A reopen with no reason is labeled on the screen and in that file as the older lock command. `update_finance_lock_date(org, date)` still applies a reopen immediately, including with no reason, so existing database checks can unlock a period. The screen does not call it.

- Close-activity rows form a hash chain. Each row stores the SHA-256 of the row before it, and the workspace stores the latest hash. `/audit/close` checks that chain. A missing middle row, an edited row, or a deleted last row whose head was left behind fails the check. The export-file checksum is a different hash. The database owner can disable the trigger and rewrite the chain. This is not an external timestamp and not a filing. `pnpm test` proves the chain rules without Postgres. `supabase/tests/close_chain.sql` proves them in Postgres. See `docs/boombignose/PGTAP.md`. GitHub Actions does not run that SQL file.

- A support-pack review mark records that the signed-in owner, admin, or accountant looked at one stored checksum. The row names that person and the time, and it joins the close chain. The same person does not get a second row for the same file. The mark is not a legal opinion, not a statutory sign-off, and not a ภ.พ.30 filing.

### R2 — enterprise

For a payer who needs a control report, not a filing product.

- Retention: how long close and export rows are kept, and a written rule that a database restore can roll them back. This desktop install is one Postgres cluster on the machine. It is not a separate audit archive. The close-activity hash chain is already on main. It is not an external timestamp.
- Custom roles and SSO. The four roles above are the whole matrix. There is no policy editor.
- An external timestamp. Not claimed, and not implied by the SHA-256 header.
- Pen test, dependency review, and a decision about who holds the database owner role on a hosted install. The local window's operator is the database owner.

## Statutory track

### S0 — done

Operational close, phases 1–5, plus the R0 controls above. Copy and the database both say this is not a filing.

### S1 — review mark, not a sign-off

An owner, admin, or accountant can record that they looked at one stored support file. The row keeps their name, the time, and the checksum. It means "I looked at this file." It is not a legal opinion, not a sign-off letter, and not a filing receipt.

### S2 — draft journal and a trial balance of those lines

A manual draft journal posts 2 to 20 lines that debit and credit the chart in equal satang. The date has to fall on or before the finance lock. The row is `journal_draft_posted` on the close-activity chain. The screen says it is not signed statutory books and not a ภ.พ.30 or e-Tax filing. Issued documents still do not post themselves.

`/finance/journal/trial-balance` adds the stored lines by account through a date, or through every posted date. Each account shows its net debit or its net credit. The two totals match when the stored lines match. A broken set stays visible. This is not signed statutory books, not a ภ.พ.30 or e-Tax filing, and not TAS, TFRS, or TFRS for NPAEs.

One issued sales invoice can be posted by hand. No VAT debits accounts receivable and credits sales for the total. VAT exclusive credits sales for the base and output VAT for the stored VAT. VAT inclusive does the same with the base after VAT is taken out. The stored VAT must match half-up rounding for the stated rate. Withholding, a deposit, and a legacy adoption are refused. The invoice does not post itself.

A credit note posts only after that sale is in the journal. It debits sales and output VAT and credits the receivable, using the stored split and the same rate check. It cannot exceed the sale or the receivable still posted. A verified receipt posts only when every satang is allocated to a posted invoice with no withholding, and only up to the receivable still open. Cash debits cash. A transfer, PromptPay, card, or cheque debits the bank account. This chart has no card-clearing account and no undeposited-cheque account, so those methods are not given a separate clearing balance. Method "other" is refused. Neither document posts itself.

A deposit invoice stays unposted. The chart has no customer-deposit account. The final invoice already folds the deposit into its discount, so posting the deposit as sales as well would need a netting rule this journal does not invent.

Still later: a customer-deposit account and a rule for the final invoice that deducts it. The screen keeps saying these lines are not statutory financial statements until an accountant accepts them.

### End goal

A month-end close that is legally valid under Thai rules (ปิดงบได้ตามกฎหมาย).

That means a general ledger an accountant will sign, the tax invoices and withholding certificates the law actually requires, and the filings the Revenue Department accepts (including ภ.พ.30 and e-Tax where the business is required to use them). BoomBigNose can prepare and lock the operational record, and it can hand a file to the accountant. The accountant and the business remain the people who file. This product does not become the Revenue Department, and a FlowAccount push does not become that filing.

Until a customer-deposit account exists and an accountant has accepted a real close, the product must not say the books are closed under Thai law.
