# BoomBigNose ERP Harness AI — local architecture

Product name: **BoomBigNose ERP Harness AI**. The short name on the window title, installer, and asset filenames is **BoomBigNose**. The desktop product stays fully local at runtime: data and rules on the machine, and no cloud model call.

## Milestones

**Milestone 1.** `boombignose/cmd/boombignose-desktop` is a Wails window titled BoomBigNose ERP Harness AI. It is built with `-tags desktop` so the harness command does not link a webview. Before the window is created, it runs the same local gate as `boombignose check`: it refuses `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `RESEND_API_KEY`, and it refuses a Supabase, n8n, ERP, or `OLLAMA_HOST` value that is not loopback. After the splash page is ready, the window looks for a checkout (`BOOMBIGNOSE_ERP_DIR`, then the working directory and the executable directory). When nothing is listening on the ERP port and a checkout is present, it runs `node scripts/local/stack.mjs serve --port <port>`. It then navigates the top-level webview to `http://127.0.0.1:3100` (or `BOOMBIGNOSE_ERP_URL` when that value is loopback). That navigation keeps first-party cookies on loopback. It is not a reverse proxy. `.github/workflows/boombignose-release.yml` packages that window. The macOS link adds `UniformTypeIdentifiers`, which the Wails WebKit bridge uses for file types.

**Milestone 2.** Ship a bundled local stack so the download does not ask the operator to install Node, pnpm, and Docker by hand. Linux CI packs `bundle/node`, `bundle/erp/server.js`, and portable Postgres, starts them with `boombignose serve`, and requires `http://127.0.0.1:3100/api/health`. The window uses that same start and stops it on shutdown. Windows and macOS CI pack that same shape and run the same health check. Run [40526064339](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/actions/runs/40526064339) printed `health ok` on Linux, Windows, and macOS. Run [40536898121](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/actions/runs/40536898121) on commit `cc20239` also packed Auth v2.197.0 and PostgREST v16.5 and printed `signup ok` and `signin ok` on all three. v0.2.1 contains Node, `server.js`, and portable Postgres. It does not contain Auth, PostgREST, or Ollama. Release `boombignose-v0.3.0` packs those plus Auth v2.197.0, PostgREST v16.5, and Ollama v0.40.11. Linux and Windows omit the CUDA runners. `ollama serve` can start on loopback. The window does not run `ollama pull`. The explicit pull is `boombignose pull-model`. Workflow run [40549096601](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/actions/runs/40549096601) printed `signup ok` and `signin ok` against the built installer artifacts. That smoke is not a click test on a physical machine. Postgres stays the database; SQLite cannot run the ERP functions. See `docs/boombignose/BUNDLE.md`. Hosted Supabase (`*.supabase.co`) is refused. An empty `OLLAMA_HOST` is allowed. A remote `OLLAMA_HOST` is refused. TOTP enroll and verify are on in the local Supabase config. The enrollment screen stays closed unless `LOCAL_TOTP_ENROLL=1`. An account with a verified factor must reach `aal2` before app pages load. An account with no factor stays on one step. See `docs/boombignose/TOTP.md`.

The shell in `bignose/` also uses port 3100, so only one program may listen. See `docs/boombignose/CUTOVER.md`.

## What stays where it is

Business writes stay in the Postgres functions already shipped with the ERP. The Go module does not reimplement them. `boombignose/internal/money` only formats an integer satang amount. The Next.js UI stays the screen inside the webview.

## Auth

Sign-in stays the ERP's Supabase email and password session, stored in cookies for `127.0.0.1`.

`supabase/config.toml` has an `[auth.mfa]` block and an `[auth.mfa.totp]` block. In the committed file TOTP `enroll_enabled` and `verify_enabled` are `true`. Phone stays `false`. A search of `supabase/migrations` found no policy, trigger, or function that requires a second factor (AAL2) before a row is read or written. The screen at `app/(app)/settings/security` is closed unless `LOCAL_TOTP_ENROLL=1`. `sessionNeedsStepUp` does not read that flag. The login page and `requireOrgContext` send an account that already has a verified factor to `/login/mfa` until the session is `aal2`. The proxy does not make that call. The shell must not bypass it with a service-role key. The service-role key stays out of the desktop binary.

## Cloud calls the gate refuses

- `lib/ai/client.ts` posts to Ollama on loopback (`OLLAMA_HOST`, default `127.0.0.1:11434`). A remote host throws before any request. A refused connection becomes a not-configured notice.
- `lib/email/send.ts` posts to Resend when `RESEND_API_KEY` is set. The harness refuses that variable.
- `app/api/cron/outbox/route.ts` posts to `N8N_OUTBOUND_URL`. The harness allows that URL only when it is loopback or empty.
- `lib/local/stack.mjs` does not copy cloud model keys into `next start`. It forwards `OLLAMA_HOST` only when that value is loopback, it forwards `OLLAMA_MODEL`, and it forwards `LOCAL_TOTP_ENROLL` only when the value is `1`.

## Pages

The desktop window is the product surface. After sign-in on `http://127.0.0.1:3100`, month-end work stays in that webview:

| Screen | Path |
| --- | --- |
| Finance, including the Ollama month-end note | `/finance` |
| Bank lines | `/finance/bank` |
| Cash at close | `/finance/cash` |
| Month-end close checklist | `/reports#month-end-close` |
| Operational profit, VAT, and aging | `/reports/statements` |
| Accountant pack (output VAT, purchase VAT, withholding) | `/reports/accountant-pack` |
| Customer, product, and opening-stock import | `/import` |
| Local database backup | `/settings` |

`boombignose/internal/shell.FinanceScreens` lists those paths and refuses to place them on any host other than the loopback ERP. FlowAccount export is a Pro control inside the same window (`/settings/accounting` when `BBN_EDITION=pro`). It is an export from an issued invoice, not a page on the brochure.

The site at `site/` is a static brochure and the installer download. It is not the app and it does not call a model.
