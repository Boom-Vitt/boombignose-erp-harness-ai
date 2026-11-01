# pgTAP

GitHub Actions runs `pnpm exec tsc --noEmit` and `pnpm test`. It does not start Postgres and it does not run `supabase/tests/*.sql`.

The close-activity hash chain is checked two ways:

- `lib/finance/close-chain.test.ts` proves the payload, the SHA-256, a missing row, an edited row, and a stored head that still names a removed last row. `pnpm test` runs that file.
- `supabase/tests/close_chain.sql` proves the same rules inside Postgres, including the unit-test vector `c4f7f4b763bc9aa183ad7f5b730f5b3e7fed442bcf56e0bf65f5985a18c0cd23`.

Run the SQL file when a local Supabase stack is already up:

```sh
pnpm exec supabase test db --workdir .local-stack supabase/tests/close_chain.sql
```

That command needs Postgres, pgTAP, and the migrations applied. A machine without that stack cannot execute it. The Vitest file is the check that runs without Postgres.
