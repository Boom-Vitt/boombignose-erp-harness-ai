# pgTAP

GitHub Actions runs `pnpm exec tsc --noEmit` and `pnpm test`. It does not start Postgres and it does not run `supabase/tests/*.sql`.

The close-activity hash chain is checked two ways:

- `lib/finance/close-chain.test.ts` proves the payload, the SHA-256, a missing row, an edited row, and a stored head that still names a removed last row. `pnpm test` runs that file.
- `supabase/tests/close_chain.sql` proves the same rules inside Postgres, including the unit-test vector `c4f7f4b763bc9aa183ad7f5b730f5b3e7fed442bcf56e0bf65f5985a18c0cd23`.

Run the SQL file when a local Supabase stack is already up:

```sh
pnpm exec supabase test db --workdir .local-stack supabase/tests/close_chain.sql
pnpm exec supabase test db --workdir .local-stack supabase/tests/draft_journal.sql
pnpm exec supabase test db --workdir .local-stack supabase/tests/sales_invoice_journal.sql
```

`sales_invoice_journal.sql` posts one VAT-exclusive invoice, one VAT-inclusive invoice, and one zero-VAT invoice into a locked day. It refuses withholding, a draft, a second post, and a member.

```sh
pnpm exec supabase test db --workdir .local-stack supabase/tests/follow_on_journal.sql
```

`follow_on_journal.sql` posts a partial credit note, a verified cash receipt, and a bank transfer after the sale. The transfer debits bank account 1120. It refuses a credit note before the sale, an unclassified receipt method, a second credit note, and a member.

```sh
pnpm exec supabase test db --workdir .local-stack supabase/tests/customer_deposit_journal.sql
```

`customer_deposit_journal.sql` posts a 2,500 satang deposit to liability 2120, then applies that whole base on the final invoice. It refuses the final invoice before the deposit is posted.

```sh
pnpm exec supabase test db --workdir .local-stack supabase/tests/draft_close_acceptance.sql
```

`draft_close_acceptance.sql` accepts a balanced draft trial balance inside a locked period. Two finance users require a second confirmation. The requester cannot confirm their own request. A member cannot accept. The stored figures hash is `c19e039fcea6e8aa5a2a925d72200b5e5df3beadce8ad68560bbdbe2833e577e`.

`draft_journal.sql` checks a balanced post into a locked period, and it checks that an unbalanced journal, an unknown account, an open period, a member, and a forged audit row are refused.

That command needs Postgres, pgTAP, and the migrations applied. A machine without that stack cannot execute it. The Vitest file is the check that runs without Postgres.
